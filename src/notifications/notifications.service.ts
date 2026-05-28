import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

interface ExpoPushMessage {
  to: string;
  sound?: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

// device_type que usamos en BD:
//   "android" | "ios"  → token = Expo Push Token (string corto)
//   "web"              → token = JSON.stringify(PushSubscription)
const WEB_DEVICE = 'web';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private webPushReady = false;

  constructor(private prisma: PrismaService) {}

  /**
   * Configura web-push con las VAPID keys del .env. Si faltan, deshabilita
   * el envío web pero no rompe el módulo. Genera nuevas con:
   *   npx web-push generate-vapid-keys
   */
  onModuleInit() {
    const pub  = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const sub  = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';
    if (pub && priv) {
      webpush.setVapidDetails(sub, pub, priv);
      this.webPushReady = true;
      this.logger.log('Web Push (VAPID) ready');
    } else {
      this.logger.warn('VAPID keys missing — web push deshabilitado');
    }
  }

  /** Public endpoint helper: que el frontend lea la VAPID public key */
  getVapidPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  async registerToken(userId: string, token: string, deviceType?: string) {
    // Upsert: if token exists for another user, reassign it
    const existing = await this.prisma.push_token.findUnique({ where: { token } });
    if (existing) {
      if (existing.user_id === userId) {
        return existing;
      }
      // Reassign token to new user
      return this.prisma.push_token.update({
        where: { token },
        data: { user_id: userId, device_type: deviceType, updated_at: new Date() },
      });
    }
    return this.prisma.push_token.create({
      data: { token, user_id: userId, device_type: deviceType },
    });
  }

  async removeToken(token: string) {
    try {
      await this.prisma.push_token.delete({ where: { token } });
    } catch {
      // Token already removed
    }
  }

  async getTokensForUsers(userIds: string[]) {
    return this.prisma.push_token.findMany({
      where: { user_id: { in: userIds } },
      select: { token: true, device_type: true },
    });
  }

  async getAllTokens() {
    return this.prisma.push_token.findMany({
      select: { token: true, device_type: true, user_id: true },
    });
  }

  async sendToUsers(userIds: string[], title: string, body: string, data?: Record<string, any>) {
    const rows = await this.getTokensForUsers(userIds);
    if (rows.length === 0) return { sent: 0, total: 0 };
    return this.sendBatch(rows, title, body, data);
  }

  async sendToAll(title: string, body: string, data?: Record<string, any>) {
    const rows = await this.getAllTokens();
    if (rows.length === 0) return { sent: 0, total: 0 };
    return this.sendBatch(rows, title, body, data);
  }

  /**
   * Acepta una mezcla de tokens nativos (Expo) y suscripciones web.
   * Cada fila debe traer `device_type` para que sepamos por dónde mandar.
   */
  async sendBatch(
    rows: { token: string; device_type: string | null }[],
    title: string,
    body: string,
    data?: Record<string, any>,
  ) {
    const expoTokens: string[] = [];
    const webSubs:    string[] = [];

    for (const r of rows) {
      if (r.device_type === WEB_DEVICE) webSubs.push(r.token);
      else expoTokens.push(r.token);
    }

    const invalidTokens: string[] = [];
    let sent = 0;

    // ── 1) Expo Push (native APK / iOS) ────────────────────────────
    if (expoTokens.length > 0) {
      const messages: ExpoPushMessage[] = expoTokens.map(token => ({
        to: token, sound: 'default', title, body, data: data ?? {},
      }));
      const chunks: ExpoPushMessage[][] = [];
      for (let i = 0; i < messages.length; i += 100) {
        chunks.push(messages.slice(i, i + 100));
      }
      for (const chunk of chunks) {
        try {
          const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunk),
          });
          const result = await response.json();
          if (Array.isArray(result?.data)) {
            for (let i = 0; i < result.data.length; i++) {
              const item = result.data[i];
              if (item?.status === 'ok') sent++;
              else if (item?.details?.error === 'DeviceNotRegistered') {
                invalidTokens.push(chunk[i]?.to);
              }
            }
          }
        } catch (e) {
          this.logger.error('Expo push error', e as any);
        }
      }
    }

    // ── 2) Web Push (browsers) ──────────────────────────────────────
    if (webSubs.length > 0 && this.webPushReady) {
      const payload = JSON.stringify({ title, body, data: data ?? {} });
      await Promise.all(webSubs.map(async (raw) => {
        try {
          const sub = JSON.parse(raw);
          await webpush.sendNotification(sub, payload, { TTL: 3600 });
          sent++;
        } catch (e: any) {
          // 404 / 410 = suscripción expirada → borrar
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            invalidTokens.push(raw);
          } else {
            this.logger.error(`Web push error (${e?.statusCode})`, e?.body);
          }
        }
      }));
    }

    // ── 3) Limpieza de tokens inválidos ─────────────────────────────
    if (invalidTokens.length > 0) {
      await this.prisma.push_token.deleteMany({
        where: { token: { in: invalidTokens } },
      });
    }

    const total = expoTokens.length + webSubs.length;
    this.logger.log(`Push sent: ${sent}/${total} (invalid removed: ${invalidTokens.length})`);
    return { sent, total, invalidRemoved: invalidTokens.length };
  }

  /**
   * Send reminders to users who haven't bet on upcoming matchdays.
   * Called by cron job endpoint.
   */
  async sendMatchdayReminders() {
    // Find open matchdays with upcoming matches (within 24 hours)
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const openMatchdays = await this.prisma.matchday.findMany({
      where: {
        status: 'open',
        matches: {
          some: {
            match_date: { gte: now, lte: in24h },
          },
        },
      },
      include: {
        tournament: true,
        tickets: { select: { user_id: true } },
      },
    });

    if (openMatchdays.length === 0) {
      this.logger.log('No upcoming matchdays requiring reminders');
      return { reminded: 0 };
    }

    let totalReminded = 0;

    for (const md of openMatchdays) {
      // Get all participants of the tournament
      const participants = await this.prisma.tournament_participant.findMany({
        where: { tournament_id: md.tournament_id, status: 'approved' },
        select: { user_id: true },
      });

      const participantIds = participants.map(p => p.user_id);
      const bettorIds = new Set(md.tickets.map(t => t.user_id));

      // Users who haven't bet yet
      const missingBettors = participantIds.filter(id => !bettorIds.has(id));

      if (missingBettors.length > 0) {
        const result = await this.sendToUsers(
          missingBettors,
          '⚽ ¡No olvides apostar!',
          `Aún no has registrado tu quiniela para ${md.name}. ¡Los partidos comienzan pronto!`,
          { type: 'matchday_reminder', matchday_id: md.id, tournament_id: md.tournament_id },
        );
        totalReminded += result.sent;
      }
    }

    this.logger.log(`Matchday reminders sent: ${totalReminded}`);
    return { reminded: totalReminded };
  }

  /**
   * Send reminders for final bet deadline approaching.
   */
  async sendFinalBetReminders() {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const tournaments = await this.prisma.tournament.findMany({
      where: {
        status: 'active',
        final_bet_deadline: { gte: now, lte: in48h },
      },
      include: {
        final_bets: { select: { user_id: true } },
        participants: { where: { status: 'approved' }, select: { user_id: true } },
      },
    });

    let totalReminded = 0;

    for (const t of tournaments) {
      const bettorIds = new Set(t.final_bets.map(fb => fb.user_id));
      const missingBettors = t.participants
        .map(p => p.user_id)
        .filter(id => !bettorIds.has(id));

      if (missingBettors.length > 0) {
        const result = await this.sendToUsers(
          missingBettors,
          '🏆 ¡Apuesta final pendiente!',
          `Aún no has registrado tu apuesta final para ${t.name}. ¡La fecha límite se acerca!`,
          { type: 'final_bet_reminder', tournament_id: t.id },
        );
        totalReminded += result.sent;
      }
    }

    this.logger.log(`Final bet reminders sent: ${totalReminded}`);
    return { reminded: totalReminded };
  }
}
