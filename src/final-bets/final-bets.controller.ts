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
import { FinalBetsService } from './final-bets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateFinalBetDto, UpdateFinalBetDto } from './dto/final-bets.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('final-bets')
@Controller('api/final-bets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FinalBetsController {
  constructor(private finalBetsService: FinalBetsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my final bets' })
  async findMyBets(
    @CurrentUser() user: any,
    @Query('tournament_id') tournament_id?: string,
  ) {
    return this.finalBetsService.findMyBets(user.userId, tournament_id);
  }

  @Post()
  @ApiOperation({ summary: 'Create final bet (pick 1st-4th from quarter teams)' })
  async create(@CurrentUser() user: any, @Body() dto: CreateFinalBetDto) {
    return this.finalBetsService.create(user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update final bet picks' })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateFinalBetDto,
  ) {
    return this.finalBetsService.update(user.userId, id, dto);
  }

  @Get('tournament/:tournament_id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get all final bets for a tournament (admin)' })
  async findByTournament(@Param('tournament_id') tournament_id: string) {
    return this.finalBetsService.findByTournament(tournament_id);
  }

  @Get('tournament/:tournament_id/report')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get final bet report for a tournament (admin)' })
  async getReport(@Param('tournament_id') tournament_id: string) {
    return this.finalBetsService.getReport(tournament_id);
  }

  @Post('tournament/:tournament_id/resolve')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Resolve final bets for a tournament (admin)' })
  async resolve(
    @Param('tournament_id') tournament_id: string,
    @Body() body: { result_1st: string; result_2nd: string; result_3rd: string; result_4th: string },
  ) {
    return this.finalBetsService.resolve(tournament_id, body);
  }
}
