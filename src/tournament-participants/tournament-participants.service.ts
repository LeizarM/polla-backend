import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TournamentParticipantsService {
  constructor(private prisma: PrismaService) {}

  /** User requests to join a tournament (admin users are auto-approved) */
  async requestParticipation(userId: string, tournamentId: string, userRole?: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');
    if (tournament.status !== 'active' && tournament.status !== 'draft') {
      throw new BadRequestException('Este torneo ya no acepta inscripciones');
    }

    const isAdmin = userRole === 'admin';
    const initialStatus = isAdmin ? 'approved' : 'pending';

    const existing = await this.prisma.tournament_participant.findUnique({
      where: { user_id_tournament_id: { user_id: userId, tournament_id: tournamentId } },
    });
    if (existing) {
      if (existing.status === 'approved') throw new ConflictException('Ya estás inscrito en este torneo');
      if (existing.status === 'pending' && !isAdmin) throw new ConflictException('Ya tienes una solicitud pendiente');
      // Re-request (or admin upgrading pending to approved)
      return this.prisma.tournament_participant.update({
        where: { id: existing.id },
        data: { status: initialStatus, updated_at: new Date() },
        include: { tournament: true },
      });
    }

    return this.prisma.tournament_participant.create({
      data: { user_id: userId, tournament_id: tournamentId, status: initialStatus },
      include: { tournament: true },
    });
  }

  /** Get user's participations */
  async findMyParticipations(userId: string) {
    const participations = await this.prisma.tournament_participant.findMany({
      where: { user_id: userId },
      include: { tournament: { include: { _count: { select: { matchdays: true } } } } },
      orderBy: { created_at: 'desc' },
    });
    return participations.map(p => ({
      ...p,
      tournament: {
        ...p.tournament,
        bet_per_matchday: Number(p.tournament.bet_per_matchday),
        bet_final: Number(p.tournament.bet_final),
      },
    }));
  }

  /** Admin: get all requests for a tournament (incluye PII: phone, ci). */
  async findByTournament(tournamentId: string, status?: string) {
    const where: any = { tournament_id: tournamentId };
    if (status) where.status = status;
    return this.prisma.tournament_participant.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, full_name: true, phone: true, ci: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Roster público (cualquier usuario autenticado) — SOLO datos no sensibles.
   * Usado por bet-log para calcular "quién no apostó". NUNCA incluye phone/ci.
   * Devuelve solo participantes aprobados (los pendientes/rechazados son
   * info de gestión que no debe filtrarse a usuarios normales).
   */
  async findRoster(tournamentId: string) {
    const rows = await this.prisma.tournament_participant.findMany({
      where: { tournament_id: tournamentId, status: 'approved' },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    // Devolvemos forma mínima — sin status interno ni timestamps de gestión
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      status: r.status,
      user: r.user,
    }));
  }

  /** Admin: approve or reject. When approving a late joiner, retroactively
   *  prorrate their share into every resolved matchday and top-up past winners. */
  async updateStatus(id: string, status: string) {
    const participant = await this.prisma.tournament_participant.findUnique({ where: { id } });
    if (!participant) throw new NotFoundException('Solicitud no encontrada');

    const wasApproved = participant.status === 'approved';
    const becomingApproved = status === 'approved';

    const updated = await this.prisma.tournament_participant.update({
      where: { id },
      data: { status, updated_at: new Date() },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
        tournament: true,
      },
    });

    // Trigger auto-prorrateo only when transitioning from non-approved → approved
    if (!wasApproved && becomingApproved) {
      try {
        await this.proRateLateJoiner(participant.user_id, participant.tournament_id);
      } catch (e) {
        // Don't fail the approval if prorrate fails — log it but keep the participant
        // eslint-disable-next-line no-console
        console.error('[prorrateLateJoiner] failed:', e);
      }
    }

    return updated;
  }

  /**
   * Retroactively integrate a late joiner into ALREADY-RESOLVED matchdays:
   *   1. Create a "ghost" lost ticket for them on each resolved matchday
   *      (records that they paid in for that jornada).
   *   2. Recompute the pool of each resolved matchday with the new bettors count.
   *   3. Top-up the prize_won of the past winners (they get a bigger share now).
   *   4. Push the delta to each winner's balance.
   * Open matchdays are NOT touched — the joiner can place real picks on those.
   */
  private async proRateLateJoiner(userId: string, tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, bet_per_matchday: true },
    });
    if (!tournament) return;
    const bet = Number(tournament.bet_per_matchday ?? 0);
    if (bet <= 0) return;

    const resolvedMatchdays = await this.prisma.matchday.findMany({
      where: { tournament_id: tournamentId, status: 'resolved' },
      select: { id: true, name: true },
    });
    if (resolvedMatchdays.length === 0) return;

    for (const md of resolvedMatchdays) {
      await this.prisma.$transaction(async (tx) => {
        // 1) Skip if the user already has a ticket on this matchday (idempotent)
        const existing = await tx.ticket.findFirst({
          where: { user_id: userId, matchday_id: md.id },
          select: { id: true },
        });
        if (existing) return;

        // 2) Create a lost ticket recording their retroactive contribution
        await tx.ticket.create({
          data: {
            user_id: userId,
            matchday_id: md.id,
            amount_bet: bet,
            pool_contribution: bet,
            total_correct: 0,
            status: 'lost',
            prize_won: 0,
          },
        });

        // 3) Find max correct + winner tickets
        const maxRow: any[] = await tx.$queryRaw`
          SELECT MAX(total_correct) AS max_correct
          FROM ticket
          WHERE matchday_id = ${md.id}::uuid AND amount_bet > 0
        `;
        const maxCorrect = Number(maxRow?.[0]?.max_correct ?? 0);
        if (maxCorrect <= 0) return; // No winners → nothing to redistribute

        const winnerTickets = await tx.ticket.findMany({
          where: { matchday_id: md.id, amount_bet: { gt: 0 }, total_correct: maxCorrect },
          select: { id: true, user_id: true, prize_won: true },
        });
        if (winnerTickets.length === 0) return;

        // 4) Each winner gets an extra share = bet / winnersCount
        const extraPerWinner = bet / winnerTickets.length;

        // 5) Bump each winner's prize_won + their user balance
        for (const w of winnerTickets) {
          const newPrize = Number(w.prize_won ?? 0) + extraPerWinner;
          await tx.ticket.update({
            where: { id: w.id },
            data: { prize_won: newPrize, status: 'won' },
          });
          // Add the delta to user balance so they actually receive it
          await tx.$executeRaw`
            UPDATE "user"
            SET balance = balance + ${extraPerWinner}
            WHERE id = ${w.user_id}::uuid
          `;
        }

        // 6) Update matchday total_pool (now bettors × bet)
        await tx.$executeRaw`
          UPDATE matchday
          SET total_pool = total_pool + ${bet}
          WHERE id = ${md.id}::uuid
        `;
      });
    }
  }

  /** Check if user is approved participant */
  async isApproved(userId: string, tournamentId: string): Promise<boolean> {
    const p = await this.prisma.tournament_participant.findUnique({
      where: { user_id_tournament_id: { user_id: userId, tournament_id: tournamentId } },
    });
    return p?.status === 'approved';
  }
}
