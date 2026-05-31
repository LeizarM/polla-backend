/**
 * FreshAuthGuard — exige que el JWT sea reciente (<5 min desde emisión).
 *
 * Aplica a acciones críticas: cambio de password, borrado de cuenta,
 * cambio de email, etc. Si el token es viejo, el usuario debe re-loguearse.
 *
 *  @UseGuards(JwtAuthGuard, FreshAuthGuard)
 *  @Patch('me/password')
 *  changePass(...) { }
 *
 * El JWT lleva `iat` (issued-at) en segundos. Si han pasado más de 5 min,
 * rechazamos.
 */
import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const MAX_AGE_SECONDS = 5 * 60; // 5 minutos

@Injectable()
export class FreshAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers?.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }
    let payload: any;
    try {
      payload = this.jwt.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    const iat = Number(payload?.iat);
    if (!iat) {
      throw new UnauthorizedException('Token missing iat');
    }
    const ageSeconds = Math.floor(Date.now() / 1000) - iat;
    if (ageSeconds > MAX_AGE_SECONDS) {
      throw new UnauthorizedException(
        'Esta acción requiere autenticación reciente. Vuelve a iniciar sesión.',
      );
    }
    return true;
  }
}
