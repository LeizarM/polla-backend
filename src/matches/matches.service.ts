import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class MatchesService {
  constructor(private prisma: PrismaService) {}

  async findAll(matchday_id?: string, status?: string) {
    const where: Prisma.matchWhereInput = {
      ...(matchday_id && { matchday_id }),
      ...(status && { status }),
    };
    
    return this.prisma.match.findMany({
      where,
      include: {
        team_a: true,
        team_b: true,
        matchday: true,
      },
      orderBy: { match_date: 'asc' },
    });
  }

  async findOne(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: {
        team_a: true,
        team_b: true,
        matchday: true,
      },
    });
    
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    
    return match;
  }

  private async checkDuplicateMatchup(
    matchday_id: string,
    team_a_id: string,
    team_b_id: string,
    excludeMatchId?: string,
  ) {
    const existing = await this.prisma.match.findFirst({
      where: {
        matchday_id,
        id: excludeMatchId ? { not: excludeMatchId } : undefined,
        OR: [
          { team_a_id, team_b_id },
          { team_a_id: team_b_id, team_b_id: team_a_id },
        ],
      },
      include: { team_a: true, team_b: true },
    });
    if (existing) {
      throw new BadRequestException(
        `El enfrentamiento ${existing.team_a.name} vs ${existing.team_b.name} ya existe en esta jornada`,
      );
    }
  }

  async create(data: any) {
    if (data.team_a_id && data.team_b_id && data.matchday_id) {
      await this.checkDuplicateMatchup(data.matchday_id, data.team_a_id, data.team_b_id);
    }
    return this.prisma.match.create({
      data: {
        ...data,
        match_date: new Date(data.match_date),
      },
      include: {
        team_a: true,
        team_b: true,
      },
    });
  }

  async update(id: string, data: any) {
    const current = await this.findOne(id);

    // If teams are being changed, check for duplicate matchup
    const newTeamA = data.team_a_id ?? current.team_a_id;
    const newTeamB = data.team_b_id ?? current.team_b_id;
    if (data.team_a_id || data.team_b_id) {
      await this.checkDuplicateMatchup(current.matchday_id, newTeamA, newTeamB, id);
    }

    return this.prisma.match.update({
      where: { id },
      data: {
        ...data,
        ...(data.match_date && { match_date: new Date(data.match_date) }),
        updated_at: new Date(),
      },
      include: {
        team_a: true,
        team_b: true,
      },
    });
  }

  async delete(id: string) {
    const match = await this.findOne(id);

    // Block deletion if any ticket has picks for this match
    const picksCount = await this.prisma.ticket_pick.count({
      where: { match_id: id },
    });
    if (picksCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar: hay ${picksCount} apuesta(s) registrada(s) para este partido`,
      );
    }

    await this.prisma.match.delete({ where: { id } });
    return { success: true, deleted_id: id };
  }

  async updateScores(id: string, score_a: number, score_b: number, advancedTeamId?: string | null) {
    // Calculate result: L = local wins, V = visitor wins, E = draw
    let result = 'E';
    if (score_a > score_b) result = 'L';
    else if (score_b > score_a) result = 'V';

    // Avance de fase (opcional; solo eliminación). Si se envía, debe ser uno de
    // los dos equipos del partido. `undefined` = NO tocar la columna (preservar
    // lo que haya). El result de 90' sigue siendo el de la APUESTA de la jornada;
    // esto es aparte (incluye alargue/penales).
    const matchData: any = { score_a, score_b, result, status: 'finished', updated_at: new Date() };
    if (advancedTeamId !== undefined) {
      if (advancedTeamId) {
        const m = await this.prisma.match.findUnique({
          where: { id },
          select: { team_a_id: true, team_b_id: true, matchday: { select: { tournament_id: true } } },
        });
        if (!m) throw new NotFoundException('Partido no encontrado');
        if (advancedTeamId !== m.team_a_id && advancedTeamId !== m.team_b_id) {
          throw new BadRequestException('El equipo que avanza debe ser uno de los dos del partido');
        }
        // El avance solo aplica a ELIMINACIÓN: ambos equipos deben estar
        // clasificados a cuartos (advanced_to_quarters) en el torneo.
        const qCount = await this.prisma.tournament_team.count({
          where: {
            tournament_id: m.matchday.tournament_id,
            advanced_to_quarters: true,
            team_id: { in: [m.team_a_id, m.team_b_id] },
          },
        });
        if (qCount < 2) {
          throw new BadRequestException('El avance de fase solo aplica a equipos clasificados a cuartos');
        }
      }
      matchData.advanced_team_id = advancedTeamId || null;
    }

    // Run match update + pick correctness + ticket totals in a single transaction.
    // Doing this on EVERY score save (not only on full-matchday finalization) means
    // the bet-log endpoint always shows accurate per-match aciertos in real time.
    return this.prisma.$transaction(async (tx) => {
      // 1) Update the match
      const updated = await tx.match.update({
        where: { id },
        data: matchData,
        include: {
          team_a: true,
          team_b: true,
        },
      });

      // 2) Mark ticket_pick.is_correct = (pick === result) for all picks on this match
      const picksForMatch = await tx.ticket_pick.findMany({
        where: { match_id: id },
        select: { id: true, pick: true, ticket_id: true },
      });
      for (const p of picksForMatch) {
        await tx.ticket_pick.update({
          where: { id: p.id },
          data: { is_correct: p.pick === result },
        });
      }

      // 3) Recompute ticket.total_correct for affected tickets (all in this matchday)
      const affectedTicketIds = Array.from(new Set(picksForMatch.map(p => p.ticket_id)));
      for (const ticketId of affectedTicketIds) {
        const correctCount = await tx.ticket_pick.count({
          where: { ticket_id: ticketId, is_correct: true },
        });
        await tx.ticket.update({
          where: { id: ticketId },
          data: { total_correct: correctCount },
        });
      }

      return updated;
    });
  }
}
