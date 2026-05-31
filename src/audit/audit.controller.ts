/**
 * AuditController — endpoint admin para consultar audit_log con filtros.
 *
 *   GET /api/admin/audit-log?action=auth.login&user_id=...&from=...&to=...&page=1&limit=50
 *
 * Sin auth admin → 403. Con auth admin → JSON paginado.
 */
import {
  Controller, Get, Query, UseGuards, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('audit')
@Controller('api/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get('audit-log')
  @ApiOperation({ summary: 'Admin: query audit log with filters' })
  async list(
    @Query('action')   action?: string,
    @Query('user_id')  userId?: string,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('page')     page = '1',
    @Query('limit')    limit = '50',
  ) {
    const p = Math.max(1, parseInt(page,  10) || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const where: any = {};

    if (action)  where.action = { contains: action };
    if (userId)  where.user_id = userId;
    if (from || to) {
      where.created_at = {};
      if (from) {
        const d = new Date(from);
        if (isNaN(d.getTime())) throw new BadRequestException('from inválido');
        where.created_at.gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (isNaN(d.getTime())) throw new BadRequestException('to inválido');
        where.created_at.lte = d;
      }
    }

    const [total, rows] = await Promise.all([
      this.prisma.audit_log.count({ where }),
      this.prisma.audit_log.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
    ]);

    // Enriquecer con username del user_id (si está)
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean) as string[])];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, full_name: true },
        })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));

    return {
      total,
      page: p,
      limit: l,
      pages: Math.ceil(total / l),
      rows: rows.map(r => ({
        ...r,
        user: r.user_id ? userMap.get(r.user_id) ?? null : null,
      })),
    };
  }

  @Get('audit-log/actions')
  @ApiOperation({ summary: 'Admin: get distinct action types for the filter dropdown' })
  async actions() {
    const result = await this.prisma.audit_log.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 50,
    });
    return result.map(r => ({ action: r.action, count: r._count.action }));
  }
}
