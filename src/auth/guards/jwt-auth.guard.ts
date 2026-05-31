/**
 * JwtAuthGuard — valida JWT + chequea que el usuario:
 *  1) Exista en BD (puede haber sido borrado tras emitir el token)
 *  2) Esté ACTIVO (no blocked)
 *
 *  Antes solo confiábamos en el JWT firmado, pero un token con role admin
 *  emitido en el pasado seguiría funcionando aunque suspendamos la cuenta.
 *
 *  Cache simple en memoria (60s/userId) para no martillar la BD en cada
 *  request. Aceptable porque el TTL del JWT es 7 días — 60s es 0.001%.
 */
import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';

const CACHE_TTL_MS = 60_000;
const userStatusCache = new Map<string, { status: string; role: string; ts: number }>();

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private prisma: PrismaService) {
    super();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Validar JWT primero (firma + expiración) usando passport
    const result = await super.canActivate(ctx);
    if (!result) return false;

    const req = ctx.switchToHttp().getRequest();
    const userId: string | undefined =
      req.user?.userId ?? req.user?.id ?? req.user?.sub;

    if (!userId) {
      throw new UnauthorizedException('Token inválido');
    }

    // Cache lookup
    const now = Date.now();
    const cached = userStatusCache.get(userId);
    let status: string;
    let role: string;
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      status = cached.status;
      role   = cached.role;
    } else {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, role: true },
      });
      if (!dbUser) {
        userStatusCache.delete(userId);
        throw new UnauthorizedException('Usuario no encontrado');
      }
      status = dbUser.status;
      role   = dbUser.role;
      userStatusCache.set(userId, { status, role, ts: now });
    }

    if (status === 'blocked') {
      throw new ForbiddenException('Cuenta suspendida');
    }
    if (status !== 'active') {
      throw new ForbiddenException('Cuenta inactiva');
    }

    // Inyecta el role REAL de BD (no confiamos en el JWT)
    // Esto previene "yo era admin, el admin me degradó, pero mi token viejo
    // aún dice admin → ahora se respeta el estado actual".
    req.user.role = role;
    return true;
  }
}
