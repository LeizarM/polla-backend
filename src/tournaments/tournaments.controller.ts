import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CreateTournamentDto, UpdateTournamentDto, AddTeamsDto, UpdateStatusDto, UpdateTeamQuartersDto } from './dto/tournaments.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('tournaments')
@Controller('api/tournaments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TournamentsController {
  constructor(private tournamentsService: TournamentsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tournaments' })
  async findAll(@Query('status') status?: string) {
    return this.tournamentsService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tournament details with teams' })
  async findOne(@Param('id') id: string) {
    return this.tournamentsService.findOne(id);
  }

  @Get(':id/quarter-teams')
  @ApiOperation({ summary: 'Get teams that advanced to quarters' })
  async getQuarterTeams(@Param('id') id: string) {
    return this.tournamentsService.getQuarterTeams(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create tournament (admin)' })
  async create(@Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update tournament (admin)' })
  async update(@Param('id') id: string, @Body() dto: UpdateTournamentDto) {
    return this.tournamentsService.update(id, dto);
  }

  @Post(':id/teams')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Add teams to tournament (admin)' })
  async addTeams(@Param('id') id: string, @Body() dto: AddTeamsDto) {
    return this.tournamentsService.addTeams(id, dto);
  }

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update tournament status (admin)' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.tournamentsService.updateStatus(id, dto);
  }

  @Patch(':id/team-quarters')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Mark team as advanced to quarters (admin)' })
  async updateTeamQuarters(@Param('id') id: string, @Body() dto: UpdateTeamQuartersDto) {
    return this.tournamentsService.updateTeamQuarters(id, dto);
  }
}
