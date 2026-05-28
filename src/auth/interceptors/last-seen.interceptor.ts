/**
 * Actualiza user.last_seen_at en cada request autenticada.
 *
 * Para no martillar la BD: cacheamos en memoria el último ts por user, y
 * solo escribimos si han pasado >60s. Resultado: máximo 1 UPDATE por
 * usuario por minuto, sin importar cuántas requests haga.
 *
 * Se registra como interceptor GLOBAL en app.module.ts.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

const ONE_MIN = 60_000;

@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
  // Map<userId, last_write_ms>
  private cache = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(() => {
        try {
          const req = ctx.switchToHttp().getRequest();
          const userId = req?.user?.userId ?? req?.user?.id ?? req?.user?.sub;
          if (!userId) return;

          const now = Date.now();
          const last = this.cache.get(userId) ?? 0;
          if (now - last < ONE_MIN) return;

          this.cache.set(userId, now);
          // Fire-and-forget — no bloquea la respuesta
          this.prisma.user
            .update({ where: { id: userId }, data: { last_seen_at: new Date(now) } })
            .catch(() => {/* ignore */});
        } catch {/* ignore */}
      }),
    );
  }
}
