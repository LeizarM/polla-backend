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
import { TicketsService } from './tickets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('tickets')
@Controller('api/tickets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my tickets' })
  async findMyTickets(
    @CurrentUser() user: any,
    @Query('matchday_id') matchday_id?: string,
    @Query('status') status?: string,
  ) {
    return this.ticketsService.findMyTickets(user.userId, matchday_id, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket details' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.ticketsService.findOne(user.userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a ticket (place bet)' })
  async create(@CurrentUser() user: any, @Body() dto: any) {
    return this.ticketsService.create(user.userId, dto);
  }

  @Patch(':id/picks')
  @ApiOperation({ summary: 'Update picks on an existing ticket' })
  async updatePicks(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { picks: any[] },
  ) {
    return this.ticketsService.updatePicks(user.userId, id, body.picks);
  }
}

@Controller('api/matchdays/:matchday_id/tickets')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
@ApiTags('matchdays')
export class MatchdayTicketsController {
  constructor(private ticketsService: TicketsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tickets for a matchday (admin)' })
  async findMatchdayTickets(@Param('matchday_id') matchday_id: string) {
    return this.ticketsService.findMatchdayTickets(matchday_id);
  }
}
