/**
 * GeoFenceMiddleware — bloquea peticiones de IPs fuera de países permitidos.
 *
 * Configuración por env vars:
 *   ALLOWED_COUNTRIES=BO,US        (códigos ISO 3166-1 alpha-2, separados por coma)
 *   GEOIP_PROVIDER=ipapi           ('ipapi' | 'off') — default 'off'
 *
 * Si ALLOWED_COUNTRIES está vacío o GEOIP_PROVIDER='off' → no bloquea nada.
 * Si una IP no se puede resolver → DEJA PASAR (fail-open) para no
 * autobloquear por errores temporales del API GeoIP.
 *
 * Aplicar solo a rutas sensibles (no a /health ni /api/settings).
 *
 * Cache en memoria: cada IP se resuelve UNA vez y se cachea 1 hora.
 */
import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const CACHE_TTL_MS = 60 * 60_000; // 1 hora

@Injectable()
export class GeoFenceMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GeoFenceMiddleware.name);
  private readonly cache = new Map<string, { country: string | null; ts: number }>();
  private readonly enabled: boolean;
  private readonly allowed: Set<string>;

  constructor() {
    const provider = process.env.GEOIP_PROVIDER ?? 'off';
    const allowed = (process.env.ALLOWED_COUNTRIES ?? '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    this.enabled = provider !== 'off' && allowed.length > 0;
    this.allowed = new Set(allowed);
    if (this.enabled) {
      this.logger.log(`GeoFence ENABLED. Allowed countries: [${[...this.allowed].join(', ')}]`);
    } else {
      this.logger.log('GeoFence DISABLED (set ALLOWED_COUNTRIES and GEOIP_PROVIDER to activate)');
    }
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    if (!this.enabled) return next();

    const ip = this.getIp(req);
    if (!ip) return next();    // IP no detectable → fail-open

    // Private IPs (localhost, docker, LAN) → siempre permitidas
    if (this.isPrivateIp(ip)) return next();

    let country = await this.lookupCountry(ip);
    if (country === null) {
      // No pudimos resolver → fail-open (no bloqueamos por error)
      return next();
    }

    if (!this.allowed.has(country)) {
      this.logger.warn(`GeoFence BLOCK: ip=${ip} country=${country}`);
      throw new ForbiddenException(`Acceso no permitido desde tu región (${country})`);
    }
    next();
  }

  private getIp(req: Request): string | null {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      return fwd.split(',')[0].trim();
    }
    return req.ip ?? (req.socket?.remoteAddress as string | undefined) ?? null;
  }

  private isPrivateIp(ip: string): boolean {
    return (
      ip === '127.0.0.1' || ip === '::1' ||
      ip.startsWith('10.') ||
      ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
      ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('fc') || ip.startsWith('fd')
    );
  }

  private async lookupCountry(ip: string): Promise<string | null> {
    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.country;
    }
    try {
      // ipapi.co — free tier 30k req/month, sin api key
      const res = await fetch(`https://ipapi.co/${ip}/country_code/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        this.cache.set(ip, { country: null, ts: Date.now() });
        return null;
      }
      const text = (await res.text()).trim().toUpperCase();
      const country = text.length === 2 ? text : null;
      this.cache.set(ip, { country, ts: Date.now() });
      return country;
    } catch {
      this.cache.set(ip, { country: null, ts: Date.now() });
      return null;
    }
  }
}
