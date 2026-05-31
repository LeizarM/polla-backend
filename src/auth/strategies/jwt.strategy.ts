/**
 * JwtStrategy — valida JWT.
 *
 * Política de rotación de JWT_SECRET (cada 90 días recomendado):
 *
 *   ssh deploy@server
 *   cd /opt/mundial2026
 *   NEW=$(openssl rand -base64 48)
 *   sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW|" .env.prod
 *   docker compose -f docker-compose.prod.yml --env-file .env.prod restart backend
 *
 * Efecto: todos los tokens emitidos con el secret viejo dejan de funcionar.
 * Los usuarios verán "Unauthorized" y son redirigidos al login.
 * En el frontend (auth/api.ts) ya manejamos 401 → redirect a /auth/login.
 *
 * Esto es una "rotación dura". La alternativa "soft" con grace period
 * requiere almacenar tokens en BD (refresh tokens) — opcional para más adelante.
 *
 * Defensa contra mis-config: rechaza el arranque si JWT_SECRET es muy corto.
 */
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private static readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret = (config.get<string>('JWT_SECRET') ?? '').trim();
    if (secret.length < 32) {
      throw new Error(
        'SECURITY: JWT_SECRET debe ser ≥32 chars. Genera uno con `openssl rand -base64 48`.',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
      ignoreExpiration: false,
    });

    // Si la última rotación fue hace >90 días → warning en logs
    const lastRotation = config.get<string>('JWT_LAST_ROTATION');
    if (lastRotation) {
      const days = (Date.now() - new Date(lastRotation).getTime()) / 86_400_000;
      if (days > 90) {
        JwtStrategy.logger.warn(
          `JWT_SECRET fue rotado hace ${Math.round(days)} días — recomendado <90. Considera rotar.`,
        );
      }
    }
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.status === 'blocked') {
      throw new UnauthorizedException();
    }
    return { userId: user.id, username: user.username, role: user.role };
  }
}
