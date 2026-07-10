import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MatchesService } from './matches.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('matches')
@Controller('api/matches')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MatchesController {
  constructor(private matchesService: MatchesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all matches' })
  async findAll(
    @Query('matchday_id') matchday_id?: string,
    @Query('status') status?: string,
  ) {
    return this.matchesService.findAll(matchday_id, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get match details' })
  async findOne(@Param('id') id: string) {
    return this.matchesService.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create match (admin)' })
  async create(@Body() data: any) {
    return this.matchesService.create(data);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update match (admin)' })
  async update(@Param('id') id: string, @Body() data: any) {
    return this.matchesService.update(id, data);
  }

  @Patch(':id/scores')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update match scores (admin)' })
  async updateScores(@Param('id') id: string, @Body() data: { score_a: number; score_b: number; advanced_team_id?: string | null }) {
    return this.matchesService.updateScores(id, data.score_a, data.score_b, data.advanced_team_id);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Delete a match — blocked if bets exist (admin)' })
  async delete(@Param('id') id: string) {
    return this.matchesService.delete(id);
  }
}
