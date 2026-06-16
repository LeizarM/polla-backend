import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  async findMyTickets(userId: string, matchday_id?: string, status?: string) {
    const where: Prisma.ticketWhereInput = {
      user_id: userId,
      ...(matchday_id && { matchday_id }),
      ...(status && { status }),
    };
    const tickets = await this.prisma.ticket.findMany({
      where,
      include: { matchday: true },
      orderBy: { created_at: 'desc' },
    });
    return tickets.map(t => ({
      ...t,
      amount_bet: Number(t.amount_bet),
      pool_contribution: Number(t.pool_contribution),
      prize_won: t.prize_won ? Number(t.prize_won) : null,
    }));
  }

  async findOne(userId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, user_id: userId },
      include: {
        matchday: { include: { tournament: true } },
        ticket_picks: {
          include: {
            match: { include: { team_a: true, team_b: true } },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return {
      ...ticket,
      amount_bet: Number(ticket.amount_bet),
      pool_contribution: Number(ticket.pool_contribution),
      prize_won: ticket.prize_won ? Number(ticket.prize_won) : null,
    };
  }

  async create(userId: string, dto: any) {
    const { matchday_id, picks } = dto;

    // Get matchday and tournament
    const matchday = await this.prisma.matchday.findUnique({
      where: { id: matchday_id },
      include: { tournament: true, matches: true },
    });
    if (!matchday) throw new NotFoundException('Matchday not found');
    if (matchday.status !== 'open') throw new BadRequestException('Jornada no está abierta para apuestas');

    // SEGURIDAD: la ventana de "1 día antes" también se valida al APOSTAR (no
    // solo al listar). No se puede apostar en una jornada que falta más de 1
    // día, aunque su status sea 'open' o se llame la API directamente.
    //   permitido ⇔ date <= ahora + 1 día
    const betCutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (matchday.date && new Date(matchday.date) > betCutoff) {
      throw new BadRequestException(
        'Esta jornada todavía no está disponible para apostar (abre 1 día antes de su fecha)',
      );
    }

    // Check user is approved participant
    const participant = await this.prisma.tournament_participant.findUnique({
      where: { user_id_tournament_id: { user_id: userId, tournament_id: matchday.tournament_id } },
    });
    if (!participant || participant.status !== 'approved') {
      throw new BadRequestException('Debes estar inscrito y aprobado en el torneo para apostar');
    }

    // Per-MATCH locking: only require at least ONE unstarted match (so the user
    // still has something they can bet on). Picks for started matches are
    // rejected individually.
    const now = new Date();
    const allMatches = matchday.matches ?? [];
    const startedMatchIds = new Set(
      allMatches.filter(m => new Date(m.match_date) <= now).map(m => m.id),
    );
    if (allMatches.length > 0 && startedMatchIds.size === allMatches.length) {
      throw new BadRequestException(
        'No puedes apostar — todos los partidos de esta jornada ya iniciaron',
      );
    }
    // Reject picks targeting started matches (but still allow the bet for the rest)
    const blockedIncoming = (picks ?? []).filter((p: any) => startedMatchIds.has(p.match_id));
    if (blockedIncoming.length > 0) {
      throw new BadRequestException(
        `No puedes elegir ${blockedIncoming.length} partido(s) que ya iniciaron. Quita esas selecciones.`,
      );
    }

    // Atajo de UX: si ya tiene boleto, devolvemos el mensaje amable sin pegarle
    // a la BD con un error de constraint. PERO esto NO es la garantía real: este
    // chequeo corre fuera de la transacción, así que dos POST casi simultáneos
    // (doble-tap) podían colarse ambos. La garantía dura es el índice único
    // @@unique([user_id, matchday_id]) — el try/catch de P2002 más abajo
    // convierte ese choque en el mismo mensaje amable.
    const existing = await this.prisma.ticket.findFirst({
      where: { user_id: userId, matchday_id, amount_bet: { gt: 0 } },
    });
    if (existing) throw new BadRequestException('Ya tienes una apuesta en esta jornada');

    // Fixed bet amount from tournament config
    const betAmount = Number(matchday.tournament.bet_per_matchday);

    // Create ticket with picks
    let ticket;
    try {
      ticket = await this.prisma.$transaction(async (tx) => {
        // Update matchday pool
        await tx.matchday.update({
          where: { id: matchday_id },
          data: { total_pool: { increment: betAmount } },
        });

        const createdTicket = await tx.ticket.create({
          data: {
            user_id: userId,
            matchday_id,
            amount_bet: betAmount,
            pool_contribution: betAmount,
          },
        });

        await tx.ticket_pick.createMany({
          data: picks.map((p: any) => ({
            ticket_id: createdTicket.id,
            match_id: p.match_id,
            pick: p.pick,
          })),
        });

        return createdTicket;
      });
    } catch (e) {
      // P2002 = violación de índice único (uniq_ticket_user_matchday). Pasa cuando
      // una 2ª petición casi simultánea ganó la carrera y ya creó el boleto. La
      // transacción entera (incluido el increment del pozo) se revierte sola, así
      // que NO hay doble apuesta ni pozo inflado. Respondemos el mensaje de siempre.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Ya tienes una apuesta en esta jornada');
      }
      throw e;
    }

    return this.findOne(userId, ticket.id);
  }

  async updatePicks(userId: string, ticketId: string, picks: any[]) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, user_id: userId },
      include: { matchday: { include: { matches: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.matchday.status !== 'open') {
      throw new BadRequestException('La jornada ya está cerrada');
    }
    const now = new Date();

    // Per-MATCH locking (was per-jornada): each match is independent. Users can
    // update picks for matches that haven't started yet, even if other matches
    // in the same matchday have already begun.
    const startedMatchIds = new Set(
      (ticket.matchday.matches ?? [])
        .filter((m: any) => new Date(m.match_date) <= now)
        .map((m: any) => m.id),
    );

    // Reject any incoming picks that target an already-started match.
    const blockedPicks = picks.filter((p: any) => startedMatchIds.has(p.match_id));
    if (blockedPicks.length > 0) {
      throw new BadRequestException(
        `No puedes modificar predicciones para ${blockedPicks.length} partido(s) que ya iniciaron. ` +
          'Quita esas selecciones e intenta de nuevo.',
      );
    }

    // Filter accepted picks: only those targeting matches that haven't started
    const acceptedPicks = picks.filter((p: any) => !startedMatchIds.has(p.match_id));

    await this.prisma.$transaction(async (tx) => {
      // Only delete picks for UNSTARTED matches — preserve picks for started ones
      await tx.ticket_pick.deleteMany({
        where: {
          ticket_id: ticketId,
          match_id: { notIn: Array.from(startedMatchIds) as string[] },
        },
      });
      if (acceptedPicks.length > 0) {
        await tx.ticket_pick.createMany({
          data: acceptedPicks.map((p: any) => ({
            ticket_id: ticketId,
            match_id: p.match_id,
            pick: p.pick,
          })),
        });
      }
    });
    return this.findOne(userId, ticketId);
  }

  async findMatchdayTickets(matchday_id: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { matchday_id },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return tickets.map(t => ({
      ...t,
      amount_bet: Number(t.amount_bet),
      pool_contribution: Number(t.pool_contribution),
      prize_won: t.prize_won ? Number(t.prize_won) : null,
    }));
  }
}
