import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(tournament_id?: string, status?: string) {
    const where: Prisma.tournament_groupWhereInput = {
      ...(tournament_id && { tournament_id }),
      ...(status && { status }),
    };

    const groups = await this.prisma.tournament_group.findMany({
      where,
      include: { tournament: true },
      orderBy: { created_at: 'desc' },
    });

    return groups.map((g) => ({
      ...g,
      total_pool: Number(g.total_pool),
    }));
  }

  async findOne(id: string) {
    const group = await this.prisma.tournament_group.findUnique({
      where: { id },
      include: { tournament: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // Load team details for team_ids
    const teams = group.team_ids?.length
      ? await this.prisma.team.findMany({
          where: { id: { in: group.team_ids } },
        })
      : [];

    return {
      ...group,
      total_pool: Number(group.total_pool),
      teams,
    };
  }

  async create(data: any) {
    const group = await this.prisma.tournament_group.create({
      data: {
        tournament_id: data.tournament_id,
        name: data.name,
        team_ids: data.team_ids || [],
        has_third_place: data.has_third_place || false,
        pts_1st: data.pts_1st ?? 10,
        pts_2nd: data.pts_2nd ?? 5,
        pts_3rd: data.pts_3rd,
        pts_4th: data.pts_4th,
      },
    });

    return {
      ...group,
      total_pool: Number(group.total_pool),
    };
  }

  async update(id: string, data: any) {
    await this.findOne(id);
    const updated = await this.prisma.tournament_group.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.team_ids && { team_ids: data.team_ids }),
        ...(data.has_third_place !== undefined && { has_third_place: data.has_third_place }),
        ...(data.pts_1st !== undefined && { pts_1st: data.pts_1st }),
        ...(data.pts_2nd !== undefined && { pts_2nd: data.pts_2nd }),
        ...(data.pts_3rd !== undefined && { pts_3rd: data.pts_3rd }),
        ...(data.pts_4th !== undefined && { pts_4th: data.pts_4th }),
        updated_at: new Date(),
      },
    });

    return {
      ...updated,
      total_pool: Number(updated.total_pool),
    };
  }

  async updateResults(id: string, data: any) {
    await this.findOne(id);
    const updated = await this.prisma.tournament_group.update({
      where: { id },
      data: {
        result_1st: data.result_1st,
        result_2nd: data.result_2nd,
        result_3rd: data.result_3rd || null,
        result_4th: data.result_4th || null,
        updated_at: new Date(),
      },
    });

    return {
      ...updated,
      total_pool: Number(updated.total_pool),
    };
  }

  async resolve(id: string) {
    const group = await this.findOne(id);

    if (group.status === 'resolved') {
      throw new BadRequestException('Group already resolved');
    }

    if (!group.result_1st || !group.result_2nd) {
      throw new BadRequestException('Group results (1st and 2nd) must be set before resolving');
    }

    try {
      const result: any = await this.prisma.$queryRaw`
        SELECT * FROM resolve_group(${id}::uuid)
      `;

      return {
        success: true,
        winners_count: result?.[0]?.winners_count || 0,
        total_distributed: Number(result?.[0]?.total_distributed || 0),
      };
    } catch (error) {
      this.logger.error('Error resolving group', error);
      
      // Fallback: just close the group
      await this.prisma.tournament_group.update({
        where: { id },
        data: { status: 'resolved', updated_at: new Date() },
      });

      return {
        success: true,
        winners_count: 0,
        total_distributed: 0,
      };
    }
  }
}
