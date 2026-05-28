/**
 * Servicio que evalúa los `notification_schedule` y dispara los pushes.
 *
 * Corre cada minuto via @Cron.
 *
 * - kind="pre_match":  busca partidos que arrancan en aprox `offset_minutes`
 *   y para cada uno, manda push a los usuarios objetivo (no apostadores por
 *   defecto). Loguea en `match_reminder_log` para evitar duplicados.
 *
 * - kind="cron":       evalúa la expresión cron; si "ahora" cae dentro de la
 *   ventana de este minuto, dispara broadcast.
 *
 * Hot-reload: cualquier cambio en la tabla `notification_schedule` se ve
 * en el siguiente tick (no requiere reiniciar el server).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
// `cron-parser` viene como dep transitiva de @nestjs/schedule
// (la usamos para evaluar cron_expr custom)
import { CronExpressionParser } from 'cron-parser';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class SchedulesService implements OnModuleInit {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Al primer arranque, crea una programación default sensata:
   * "60 min antes de cada partido, avisar a los que NO han apostado".
   * El admin puede deshabilitarla o editarla.
   */
  async onModuleInit() {
    try {
      const count = await this.prisma.notification_schedule.count();
      if (count === 0) {
        await this.prisma.notification_schedule.create({
          data: {
            name: 'Recordatorio 60min antes',
            enabled: false,   // OFF por defecto — admin lo activa cuando quiera
            kind: 'pre_match',
            offset_minutes: 60,
            target: 'non_bettors',
            title: '⚽ ¡No olvides apostar!',
            body: '{team_a} vs {team_b} empieza en {minutes} min. Aún no has registrado tu apuesta.',
          },
        });
        this.logger.log('Seeded default pre_match schedule (disabled)');
      }
    } catch (e) {
      this.logger.error('Seed default schedule failed', e as any);
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────
  async list() {
    return this.prisma.notification_schedule.findMany({
      orderBy: { created_at: 'desc' },
    });
  }

  async create(data: any) {
    return this.prisma.notification_schedule.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.notification_schedule.update({
      where: { id },
      data: { ...data, updated_at: new Date() },
    });
  }

  async remove(id: string) {
    return this.prisma.notification_schedule.delete({ where: { id } });
  }

  async toggle(id: string, enabled: boolean) {
    return this.prisma.notification_schedule.update({
      where: { id },
      data: { enabled, updated_at: new Date() },
    });
  }

  // ─── Tick: corre cada minuto ───────────────────────────────────────────
  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      const schedules = await this.prisma.notification_schedule.findMany({
        where: { enabled: true },
      });
      if (!schedules.length) return;

      for (const s of schedules) {
        try {
          if (s.kind === 'pre_match') await this.runPreMatch(s);
          else if (s.kind === 'cron') await this.runCron(s);
        } catch (e) {
          this.logger.error(`Schedule ${s.id} (${s.name}) failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error('Tick fatal', e as any);
    }
  }

  // ─── Pre-match: aviso N minutos ANTES del kickoff ──────────────────────
  private async runPreMatch(s: any) {
    const offset = Number(s.offset_minutes ?? 60);
    const now = new Date();
    // Ventana: [now + offset, now + offset + 1min)
    // Esto evita perder un partido por jitter del cron (corre c/60s)
    const winStart = new Date(now.getTime() + offset * 60_000);
    const winEnd   = new Date(winStart.getTime() + 60_000);

    const matches = await this.prisma.match.findMany({
      where: {
        match_date: { gte: winStart, lt: winEnd },
        status: { in: ['scheduled', 'open'] },
      },
      include: {
        matchday: {
          include: {
            tournament: {
              include: {
                participants: {
                  where: { status: 'approved' },
                  select: { user_id: true },
                },
              },
            },
            tickets: { select: { user_id: true } },
          },
        },
        team_a: { select: { name: true } },
        team_b: { select: { name: true } },
      },
    });

    if (matches.length === 0) return;

    let totalSent = 0;

    for (const m of matches) {
      // ¿Ya enviamos este aviso (este schedule × este match)?
      const already = await this.prisma.match_reminder_log.findUnique({
        where: { match_id_schedule_id: { match_id: m.id, schedule_id: s.id } },
      });
      if (already) continue;

      // Construir target
      const md = m.matchday;
      const allParticipants = md.tournament.participants.map((p: any) => p.user_id);
      const bettors = new Set(md.tickets.map((t: any) => t.user_id));

      let targetUserIds: string[] = [];
      if (s.target === 'all') {
        // broadcast: no filtramos por torneo
        targetUserIds = [];   // sendToAll abajo
      } else if (s.target === 'tournament_participants') {
        targetUserIds = allParticipants;
      } else {
        // non_bettors (default): solo los que NO han apostado en esta jornada
        targetUserIds = allParticipants.filter((id: string) => !bettors.has(id));
      }

      // Plantilla simple: reemplaza {team_a}/{team_b}/{minutes} en title/body
      const interp = (txt: string) =>
        (txt ?? '')
          .replace(/\{team_a\}/g, m.team_a?.name ?? '')
          .replace(/\{team_b\}/g, m.team_b?.name ?? '')
          .replace(/\{minutes\}/g, String(offset))
          .replace(/\{matchday\}/g, md.name ?? '');

      const title = interp(s.title);
      const body  = interp(s.body);
      const data  = {
        type: 'matchday_reminder',
        matchday_id: md.id,
        tournament_id: md.tournament_id,
        schedule_id: s.id,
      };

      let result: { sent: number; total: number } = { sent: 0, total: 0 };
      if (s.target === 'all') {
        result = await this.notifications.sendToAll(title, body, data) as any;
      } else if (targetUserIds.length > 0) {
        result = await this.notifications.sendToUsers(targetUserIds, title, body, data) as any;
      }

      await this.prisma.match_reminder_log.create({
        data: { match_id: m.id, schedule_id: s.id, sent_count: result.sent ?? 0 },
      });
      totalSent += result.sent ?? 0;

      this.logger.log(
        `[pre_match ${s.name}] match=${m.team_a.name} vs ${m.team_b.name} → sent=${result.sent}/${result.total}`,
      );
    }

    if (totalSent > 0) {
      await this.prisma.notification_schedule.update({
        where: { id: s.id },
        data: { last_run_at: new Date(), last_sent_count: totalSent },
      });
    }
  }

  // ─── Cron: broadcast por expresión cron ────────────────────────────────
  private async runCron(s: any) {
    const expr = s.cron_expr;
    if (!expr) return;
    let parsed;
    try {
      parsed = CronExpressionParser.parse(expr);
    } catch {
      this.logger.warn(`Cron inválido en schedule ${s.id}: ${expr}`);
      return;
    }
    // ¿Hay alguna ejecución dentro del minuto actual?
    const now = new Date();
    const minuteStart = new Date(now);
    minuteStart.setSeconds(0, 0);
    const minuteEnd = new Date(minuteStart.getTime() + 60_000);

    // .prev() devuelve la última ejecución que debió ocurrir
    const prev = parsed.prev().toDate();
    if (prev < minuteStart || prev >= minuteEnd) return;

    // ¿Ya disparamos en este minuto?
    if (s.last_run_at && new Date(s.last_run_at).getTime() >= minuteStart.getTime()) return;

    const result = await this.notifications.sendToAll(s.title, s.body, {
      type: 'admin_broadcast', schedule_id: s.id,
    }) as any;

    await this.prisma.notification_schedule.update({
      where: { id: s.id },
      data: { last_run_at: new Date(), last_sent_count: result.sent ?? 0 },
    });

    this.logger.log(`[cron ${s.name}] broadcast sent=${result.sent}/${result.total}`);
  }

  // ─── Estadísticas ──────────────────────────────────────────────────────
  async stats() {
    const [tokensByType, totalUsers, connected5m, connected1h, lastSchedules, lastReminders] =
      await Promise.all([
        this.prisma.push_token.groupBy({
          by: ['device_type'],
          _count: { token: true },
        }),
        this.prisma.user.count({ where: { status: 'active' } }),
        this.prisma.user.count({
          where: { last_seen_at: { gte: new Date(Date.now() - 5 * 60_000) } },
        }),
        this.prisma.user.count({
          where: { last_seen_at: { gte: new Date(Date.now() - 60 * 60_000) } },
        }),
        this.prisma.notification_schedule.findMany({
          where: { last_run_at: { not: null } },
          orderBy: { last_run_at: 'desc' },
          take: 5,
          select: { id: true, name: true, last_run_at: true, last_sent_count: true, kind: true },
        }),
        this.prisma.match_reminder_log.findMany({
          orderBy: { sent_at: 'desc' },
          take: 10,
          include: { schedule: { select: { name: true } } },
        }),
      ]);

    return {
      tokens: {
        total: tokensByType.reduce((s, r) => s + r._count.token, 0),
        byType: tokensByType.map(t => ({ device_type: t.device_type ?? 'unknown', count: t._count.token })),
      },
      users: {
        total_active: totalUsers,
        connected_5m: connected5m,
        connected_1h: connected1h,
      },
      lastSchedules,
      lastReminders,
    };
  }
}
