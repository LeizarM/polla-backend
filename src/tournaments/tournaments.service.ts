import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTournamentDto, UpdateTournamentDto, AddTeamsDto, UpdateStatusDto, UpdateTeamQuartersDto } from './dto/tournaments.dto';

@Injectable()
export class TournamentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(status?: string) {
    const where = status ? { status } : {};
    const tournaments = await this.prisma.tournament.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { matchdays: true, tournament_teams: true, final_bets: true, participants: true } },
      },
    });
    return tournaments.map(t => ({
      ...t,
      bet_per_matchday: Number(t.bet_per_matchday),
      bet_final: Number(t.bet_final),
      house_cut_pct: Number(t.house_cut_pct),
      min_bet: Number(t.min_bet),
      max_bet: Number(t.max_bet),
    }));
  }

  async findOne(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        tournament_teams: {
          include: { team: true },
        },
        _count: { select: { matchdays: true, final_bets: true, participants: true } },
      },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }
    return {
      ...tournament,
      teams: tournament.tournament_teams.map(tt => ({
        ...tt.team,
        advanced_to_quarters: tt.advanced_to_quarters,
      })),
      bet_per_matchday: Number(tournament.bet_per_matchday),
      bet_final: Number(tournament.bet_final),
      house_cut_pct: Number(tournament.house_cut_pct),
      min_bet: Number(tournament.min_bet),
      max_bet: Number(tournament.max_bet),
    };
  }

  async create(dto: CreateTournamentDto) {
    const tournament = await this.prisma.tournament.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
        bet_per_matchday: dto.bet_per_matchday,
        bet_final: dto.bet_final,
        ...(dto.final_bet_deadline && { final_bet_deadline: new Date(dto.final_bet_deadline) }),
      },
    });
    return {
      ...tournament,
      bet_per_matchday: Number(tournament.bet_per_matchday),
      bet_final: Number(tournament.bet_final),
    };
  }

  async update(id: string, dto: UpdateTournamentDto) {
    await this.findOne(id);
    const { start_date, end_date, final_bet_deadline, ...rest } = dto;
    const updated = await this.prisma.tournament.update({
      where: { id },
      data: {
        ...rest,
        ...(start_date && { start_date: new Date(start_date) }),
        ...(end_date && { end_date: new Date(end_date) }),
        ...(final_bet_deadline !== undefined && { final_bet_deadline: final_bet_deadline ? new Date(final_bet_deadline) : null }),
        updated_at: new Date(),
      },
    });
    return {
      ...updated,
      bet_per_matchday: Number(updated.bet_per_matchday),
      bet_final: Number(updated.bet_final),
    };
  }

  async addTeams(id: string, dto: AddTeamsDto) {
    await this.findOne(id);
    // Preserve existing advanced_to_quarters flags
    const existing = await this.prisma.tournament_team.findMany({
      where: { tournament_id: id },
    });
    const quartersMap = new Map<string, boolean>();
    for (const e of existing) {
      quartersMap.set(e.team_id, e.advanced_to_quarters);
    }
    // Remove teams no longer selected
    await this.prisma.tournament_team.deleteMany({ where: { tournament_id: id } });
    // Re-create preserving quarter flags
    await this.prisma.tournament_team.createMany({
      data: dto.team_ids.map(team_id => ({
        tournament_id: id,
        team_id,
        advanced_to_quarters: quartersMap.get(team_id) ?? false,
      })),
    });
    const teams = await this.prisma.team.findMany({ where: { id: { in: dto.team_ids } } });
    return { success: true, teams };
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    return this.update(id, dto as any);
  }

  async updateTeamQuarters(id: string, dto: UpdateTeamQuartersDto) {
    const tt = await this.prisma.tournament_team.findFirst({
      where: { tournament_id: id, team_id: dto.team_id },
    });
    if (!tt) throw new NotFoundException('Team not in tournament');
    await this.prisma.tournament_team.update({
      where: { id: tt.id },
      data: { advanced_to_quarters: dto.advanced_to_quarters },
    });
    return { success: true };
  }

  async getQuarterTeams(id: string) {
    const teams = await this.prisma.tournament_team.findMany({
      where: { tournament_id: id, advanced_to_quarters: true },
      include: { team: true },
    });
    return teams.map(tt => tt.team);
  }
}
