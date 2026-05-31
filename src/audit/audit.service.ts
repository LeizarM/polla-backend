/**
 * AuditService — registro de acciones sensibles para forenses + alertas.
 *
 * Fire-and-forget: no bloquea la respuesta principal.
 *
 *  audit.log({
 *    action: 'login.success',
 *    user_id: u.id,
 *    ip: req.ip,
 *    ua: req.headers['user-agent'],
 *  });
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  user_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  ip?: string | null;
  ua?: string | null;
  metadata?: Record<string, any> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  log(entry: AuditEntry) {
    // Fire-and-forget — nunca bloquea la respuesta
    this.prisma.audit_log
      .create({
        data: {
          action:      entry.action,
          user_id:     entry.user_id ?? null,
          target_type: entry.target_type ?? null,
          target_id:   entry.target_id ?? null,
          ip:          entry.ip ?? null,
          user_agent:  entry.ua ?? null,
          metadata:    entry.metadata ?? undefined,
        },
      })
      .catch((e) => {
        // Si falla la BD, no rompemos la app — solo logueamos
        this.logger.warn(`audit_log insert failed: ${e?.message}`);
      });
  }

  /** Extrae IP "real" considerando el header X-Forwarded-For (nginx). */
  static getIp(req: any): string | null {
    const fwd = req?.headers?.['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      return fwd.split(',')[0].trim();
    }
    return req?.ip ?? req?.connection?.remoteAddress ?? null;
  }
}
