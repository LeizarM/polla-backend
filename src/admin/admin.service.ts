import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  async getUsers(search?: string) {
    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { full_name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    return this.prisma.user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        username: true,
        full_name: true,
        phone: true,
        role: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async getStats() {
    try {
      const [totalUsers, activeTournaments, totalFinalBets, totalPoolRaw] =
        await Promise.all([
          this.prisma.user.count({ where: { role: 'user' } }),
          this.prisma.tournament.count({ where: { status: 'active' } }),
          this.prisma.final_bet.count(),
          this.prisma.matchday.aggregate({
            _sum: { total_pool: true },
            where: { status: { in: ['open', 'locked'] } },
          }),
        ]);

      const totalPool = Number(totalPoolRaw._sum?.total_pool ?? 0);

      return {
        total_users: totalUsers,
        active_tournaments: activeTournaments,
        total_pool: totalPool,
        total_final_bets: totalFinalBets,
      };
    } catch (error) {
      this.logger.error('Error fetching admin stats', error);
      return {
        total_users: 0,
        active_tournaments: 0,
        total_pool: 0,
        total_final_bets: 0,
      };
    }
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        full_name: true,
        phone: true,
        role: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUserStatus(userId: string, status: string) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status, updated_at: new Date() },
    });
    const { password, ...rest } = updated;
    return rest;
  }

  async updateUserRole(userId: string, role: string) {
    if (!['user', 'admin'].includes(role)) {
      throw new BadRequestException('Rol invalido. Debe ser "user" o "admin"');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role, updated_at: new Date() },
    });
    const { password, ...rest } = updated;
    return rest;
  }

  async resetPassword(userId: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, updated_at: new Date() },
    });
    const { password, ...rest } = updated;
    return { ...rest, message: 'Password updated' };
  }
}
