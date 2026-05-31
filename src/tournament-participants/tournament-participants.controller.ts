import { Controller, Post, Get, Patch, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { TournamentParticipantsService } from './tournament-participants.service';
import { RequestParticipationDto, UpdateParticipationStatusDto } from './dto/tournament-participants.dto';

@ApiTags('Tournament Participants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/tournament-participants')
export class TournamentParticipantsController {
  constructor(private service: TournamentParticipantsService) {}

  @Post()
  @ApiOperation({ summary: 'Solicitar participación en un torneo (admin: auto-aprobado)' })
  async requestParticipation(@Req() req: any, @Body() dto: RequestParticipationDto) {
    return this.service.requestParticipation(req.user.userId, dto.tournament_id, req.user.role);
  }

  @Get('me')
  @ApiOperation({ summary: 'Mis inscripciones' })
  async myParticipations(@Req() req: any) {
    return this.service.findMyParticipations(req.user.userId);
  }

  @Get('tournament/:tournamentId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Admin: solicitudes por torneo (incluye PII)' })
  @ApiQuery({ name: 'status', required: false })
  async findByTournament(@Param('tournamentId') tournamentId: string, @Query('status') status?: string) {
    return this.service.findByTournament(tournamentId, status);
  }

  // Roster público (sin PII) — usado por bet-log compartido para "quién no apostó".
  // Solo participantes aprobados, solo id/username/full_name.
  @Get('tournament/:tournamentId/roster')
  @ApiOperation({ summary: 'Roster aprobado del torneo (sin datos sensibles)' })
  async findRoster(@Param('tournamentId') tournamentId: string) {
    return this.service.findRoster(tournamentId);
  }

  // ⚠️ SOLO ADMIN — aprobar/rechazar inscripciones. Sin este guard, cualquier
  // usuario autenticado podría auto-aprobar su solicitud o manipular las de
  // otros (privilege escalation).
  @Patch(':id/status')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Admin: aprobar o rechazar solicitud' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateParticipationStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }
}
