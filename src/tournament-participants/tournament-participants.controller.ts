import { Controller, Post, Get, Patch, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  @ApiOperation({ summary: 'Admin: solicitudes por torneo' })
  @ApiQuery({ name: 'status', required: false })
  async findByTournament(@Param('tournamentId') tournamentId: string, @Query('status') status?: string) {
    return this.service.findByTournament(tournamentId, status);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Admin: aprobar o rechazar solicitud' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateParticipationStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }
}
