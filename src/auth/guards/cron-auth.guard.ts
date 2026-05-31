/**
 * CronAuthGuard — protege endpoints internos /cron/* con shared secret.
 *
 * El cliente (cron de sistema, watchtower, GH Actions) debe mandar:
 *   X-Cron-Secret: <valor de env CRON_SECRET>
 *
 * Sin el secret correcto → 403. Comparación constant-time para evitar
 * ataques de timing.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class CronAuthGuard implements CanActivate {
  private readonly logger = new Logger(CronAuthGuard.name);

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const expected = process.env.CRON_SECRET;
    const provided = (req.headers['x-cron-secret'] as string) || '';

    // En PROD el secret es obligatorio. Si no está configurado, deny por defecto.
    if (!expected || expected.length < 16) {
      this.logger.error('CRON_SECRET no configurado o muy corto. Deny por defecto.');
      throw new ForbiddenException('Cron endpoint locked');
    }

    // Comparación constant-time → previene timing attacks.
    if (provided.length !== expected.length) {
      throw new ForbiddenException('Invalid cron secret');
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (!timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid cron secret');
    }
    return true;
  }
}
