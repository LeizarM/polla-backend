import { Module } from '@nestjs/common';
import { GroupBetsController } from './group-bets.controller';
import { GroupBetsService } from './group-bets.service';

@Module({
  controllers: [GroupBetsController],
  providers: [GroupBetsService],
})
export class GroupBetsModule {}
