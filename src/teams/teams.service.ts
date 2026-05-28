import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.team.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateTeamDto) {
    return this.prisma.team.create({
      data: dto,
    });
  }

  async update(id: string, dto: UpdateTeamDto) {
    await this.findOne(id);
    return this.prisma.team.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.prisma.team.delete({
      where: { id },
    });
    return { success: true };
  }

  private async findOne(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }
}
