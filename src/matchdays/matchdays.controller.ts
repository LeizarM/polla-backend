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
import { MatchdaysService } from './matchdays.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('matchdays')
@Controller('api/matchdays')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MatchdaysController {
  constructor(private matchdaysService: MatchdaysService) {}

  @Get()
  @ApiOperation({ summary: 'Get all matchdays' })
  async findAll(
    @CurrentUser() user: any,
    @Query('tournament_id') tournament_id?: string,
    @Query('status') status?: string,
  ) {
    return this.matchdaysService.findAll(user.userId, user.role, tournament_id, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get matchday with matches' })
  async findOne(@Param('id') id: string) {
    return this.matchdaysService.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create matchday (admin)' })
  async create(@Body() data: any) {
    return this.matchdaysService.create(data);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update matchday (admin)' })
  async update(@Param('id') id: string, @Body() data: any) {
    return this.matchdaysService.update(id, data);
  }

  @Post(':id/resolve')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Resolve matchday and distribute prizes (admin)' })
  async resolve(@Param('id') id: string) {
    return this.matchdaysService.resolve(id);
  }

  @Get(':id/ranking')
  @ApiOperation({ summary: 'Get matchday ranking' })
  async ranking(@Param('id') id: string) {
    return this.matchdaysService.getRanking(id);
  }

  @Get(':id/report')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get matchday report: who bet and who is pending (admin)' })
  async report(@Param('id') id: string) {
    return this.matchdaysService.getReport(id);
  }

  @Get(':id/winners')
  @ApiOperation({ summary: 'Get matchday winners and full results' })
  async winners(@Param('id') id: string) {
    return this.matchdaysService.getWinners(id);
  }

  @Get(':id/bet-log')
  @ApiOperation({ summary: 'Get bet activity log for a matchday (public for participants)' })
  async betLog(@Param('id') id: string) {
    return this.matchdaysService.getBetLog(id);
  }
}
