import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinalBetDto, UpdateFinalBetDto } from './dto/final-bets.dto';

@Injectable()
export class FinalBetsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateFinalBetDto) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournament_id },
    });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');
    if (tournament.status !== 'active') throw new BadRequestException('Torneo no está activo');

    // Check deadline
    if (tournament.final_bet_deadline) {
      if (new Date() > tournament.final_bet_deadline) {
        throw new BadRequestException('La fecha límite para la apuesta final ha pasado');
      }
    }

    // Check user is approved participant
    const participant = await this.prisma.tournament_participant.findUnique({
      where: { user_id_tournament_id: { user_id: userId, tournament_id: dto.tournament_id } },
    });
    if (!participant || participant.status !== 'approved') {
      throw new BadRequestException('Debes estar inscrito y aprobado en el torneo para apostar');
    }

    // Validate all picks are quarter-final teams
    const quarterTeams = await this.prisma.tournament_team.findMany({
      where: { tournament_id: dto.tournament_id, advanced_to_quarters: true },
    });
    const quarterIds = new Set(quarterTeams.map(t => t.team_id));
    const picks = [dto.pick_1st, dto.pick_2nd, dto.pick_3rd, dto.pick_4th];
    for (const pick of picks) {
      if (!quarterIds.has(pick)) throw new BadRequestException('Todos los picks deben ser equipos en cuartos de final');
    }
    // Validate no duplicates
    if (new Set(picks).size !== 4) throw new BadRequestException('Los picks deben ser 4 equipos diferentes');

    // Check existing
    const existing = await this.prisma.final_bet.findUnique({
      where: { user_id_tournament_id: { user_id: userId, tournament_id: dto.tournament_id } },
    });
    if (existing) throw new BadRequestException('Ya tienes una apuesta final en este torneo');

    return this.prisma.final_bet.create({
      data: {
        user_id: userId,
        tournament_id: dto.tournament_id,
        pick_1st: dto.pick_1st,
        pick_2nd: dto.pick_2nd,
        pick_3rd: dto.pick_3rd,
        pick_4th: dto.pick_4th,
      },
      include: { tournament: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateFinalBetDto) {
    const bet = await this.prisma.final_bet.findFirst({ where: { id, user_id: userId } });
    if (!bet) throw new NotFoundException('Apuesta no encontrada');
    if (bet.status !== 'active') throw new BadRequestException('Apuesta ya resuelta');

    return this.prisma.final_bet.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
      include: { tournament: true },
    });
  }

  async findMyBets(userId: string, tournament_id?: string) {
    const where: any = { user_id: userId };
    if (tournament_id) where.tournament_id = tournament_id;
    const bets = await this.prisma.final_bet.findMany({
      where,
      include: { tournament: true },
      orderBy: { created_at: 'desc' },
    });
    return bets.map(b => ({
      ...b,
      prize_won: Number(b.prize_won),
    }));
  }

  async findByTournament(tournamentId: string) {
    const bets = await this.prisma.final_bet.findMany({
      where: { tournament_id: tournamentId },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
      },
      orderBy: [{ total_points: 'desc' }, { created_at: 'asc' }],
    });
    return bets.map(b => ({
      ...b,
      prize_won: Number(b.prize_won),
    }));
  }

  // Admin resolves the final bet for a tournament
  // actual_1st..4th are team IDs for the actual final positions
  async resolve(tournamentId: string, actual: { result_1st: string; result_2nd: string; result_3rd: string; result_4th: string }) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { _count: { select: { matchdays: true } } },
    });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');

    const bets = await this.prisma.final_bet.findMany({ where: { tournament_id: tournamentId } });
    if (bets.length === 0) throw new BadRequestException('No hay apuestas finales');

    // Calculate pool: matchdays_count * participants * Y
    const matchdayCount = tournament._count.matchdays;
    const participantCount = bets.length;
    const betFinal = Number(tournament.bet_final);
    const pool = matchdayCount * participantCount * betFinal;

    // Calculate points for each bet
    const PTS = { '1st': 12, '2nd': 8, '3rd': 4, '4th': 2 };
    const scored = bets.map(b => {
      let pts = 0;
      if (b.pick_1st === actual.result_1st) pts += PTS['1st'];
      if (b.pick_2nd === actual.result_2nd) pts += PTS['2nd'];
      if (b.pick_3rd === actual.result_3rd) pts += PTS['3rd'];
      if (b.pick_4th === actual.result_4th) pts += PTS['4th'];
      return { ...b, total_points: pts };
    });

    const maxPts = Math.max(...scored.map(s => s.total_points));
    const winners = scored.filter(s => s.total_points === maxPts && maxPts > 0);
    const prizePerWinner = winners.length > 0 ? pool / winners.length : 0;

    // Update all bets
    for (const s of scored) {
      const isWinner = s.total_points === maxPts && maxPts > 0;
      await this.prisma.final_bet.update({
        where: { id: s.id },
        data: {
          total_points: s.total_points,
          status: isWinner ? 'won' : 'lost',
          prize_won: isWinner ? prizePerWinner : 0,
          updated_at: new Date(),
        },
      });
    }

    return {
      success: true,
      pool,
      winners_count: winners.length,
      prize_per_winner: prizePerWinner,
      max_points: maxPts,
    };
  }

  async getReport(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { _count: { select: { matchdays: true } } },
    });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');

    const bets = await this.prisma.final_bet.findMany({
      where: { tournament_id: tournamentId },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
      },
      orderBy: [{ total_points: 'desc' }, { created_at: 'asc' }],
    });

    // Get quarter teams
    const quarterTeams = await this.prisma.tournament_team.findMany({
      where: { tournament_id: tournamentId, advanced_to_quarters: true },
      include: { team: true },
    });

    // Get approved participants who haven't placed a bet
    const participants = await this.prisma.tournament_participant.findMany({
      where: { tournament_id: tournamentId, status: 'approved' },
      include: { user: { select: { id: true, username: true, full_name: true, phone: true } } },
    });
    const betUserIds = new Set(bets.map(b => b.user_id));
    const pendingUsers = participants
      .filter(p => !betUserIds.has(p.user_id))
      .map(p => ({
        user_id: p.user?.id,
        username: p.user?.username,
        full_name: p.user?.full_name,
        phone: p.user?.phone,
      }));

    const betFinal = Number(tournament.bet_final);
    const matchdayCount = tournament._count.matchdays;
    const pool = matchdayCount * bets.length * betFinal;

    return {
      tournament: {
        id: tournament.id,
        name: tournament.name,
        bet_final: betFinal,
        matchday_count: matchdayCount,
        status: tournament.status,
        currency: tournament.currency ?? 'Bs',
      },
      pool,
      participant_count: bets.length,
      pending_count: pendingUsers.length,
      quarter_teams: quarterTeams.map(qt => qt.team),
      bets: bets.map((b, i) => ({
        position: i + 1,
        user_id: b.user?.id,
        username: b.user?.username,
        full_name: b.user?.full_name,
        pick_1st: b.pick_1st,
        pick_2nd: b.pick_2nd,
        pick_3rd: b.pick_3rd,
        pick_4th: b.pick_4th,
        total_points: b.total_points,
        status: b.status,
        prize_won: Number(b.prize_won),
      })),
      pending_users: pendingUsers,
    };
  }
}
