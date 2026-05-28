import { Module } from '@nestjs/common';
import { TicketsController, MatchdayTicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [TicketsController, MatchdayTicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
