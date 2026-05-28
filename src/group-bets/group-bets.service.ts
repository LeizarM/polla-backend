import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GroupBetsService {
  constructor(private prisma: PrismaService) {}

  async findMyBets(userId: string) {
    const bets = await this.prisma.group_bet.findMany({
      where: { user_id: userId },
      include: {
        group: {
          include: { tournament: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return bets.map((b) => ({
      ...b,
      amount_bet: Number(b.amount_bet),
      pool_contribution: Number(b.pool_contribution),
      prize_won: b.prize_won ? Number(b.prize_won) : null,
    }));
  }

  async findOne(userId: string, id: string) {
    const bet = await this.prisma.group_bet.findFirst({
      where: { id, user_id: userId },
      include: {
        group: {
          include: { tournament: true },
        },
      },
    });

    if (!bet) throw new NotFoundException('Group bet not found');

    // Get team details for picks
    const teamIds = [bet.pick_1st, bet.pick_2nd, bet.pick_3rd, bet.pick_4th].filter(Boolean) as string[];
    const teams = await this.prisma.team.findMany({ where: { id: { in: teamIds } } });
    const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

    return {
      ...bet,
      amount_bet: Number(bet.amount_bet),
      pool_contribution: Number(bet.pool_contribution),
      prize_won: bet.prize_won ? Number(bet.prize_won) : null,
      picks_teams: {
        first: teamMap[bet.pick_1st] ?? null,
        second: teamMap[bet.pick_2nd] ?? null,
        third: bet.pick_3rd ? teamMap[bet.pick_3rd] ?? null : null,
        fourth: bet.pick_4th ? teamMap[bet.pick_4th] ?? null : null,
      },
    };
  }

  async create(userId: string, dto: any) {
    const { group_id, amount_bet, pick_1st, pick_2nd, pick_3rd, pick_4th } = dto;

    const group = await this.prisma.tournament_group.findUnique({
      where: { id: group_id },
      include: { tournament: true },
    });

    if (!group) throw new NotFoundException('Group not found');
    if (group.status !== 'open') throw new BadRequestException('Group is not open for betting');

    const minBet = Number(group.tournament.min_bet);
    const maxBet = Number(group.tournament.max_bet);

    if (amount_bet < minBet || amount_bet > maxBet) {
      throw new BadRequestException(`Bet amount must be between ${minBet} and ${maxBet}`);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (Number(user.balance) < amount_bet) throw new BadRequestException('Insufficient balance');

    const houseCutPct = Number(group.tournament.house_cut_pct);
    const houseCut = amount_bet * (houseCutPct / 100);
    const poolContribution = amount_bet - houseCut;

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { balance: { decrement: amount_bet } } });
      await tx.tournament_group.update({ where: { id: group_id }, data: { total_pool: { increment: poolContribution } } });

      const bet = await tx.group_bet.create({
        data: {
          user_id: userId,
          group_id,
          pick_1st,
          pick_2nd,
          pick_3rd: pick_3rd || null,
          pick_4th: pick_4th || null,
          amount_bet,
          pool_contribution: poolContribution,
        },
      });

      await tx.transaction.create({
        data: {
          user_id: userId,
          type: 'bet',
          amount: amount_bet,
          status: 'completed',
          notes: `Group bet: ${group_id}`,
        },
      });

      return this.findOne(userId, bet.id);
    });
  }
}
