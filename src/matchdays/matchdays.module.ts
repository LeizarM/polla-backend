import { Module } from '@nestjs/common';
import { MatchdaysController } from './matchdays.controller';
import { MatchdaysService } from './matchdays.service';

@Module({
  controllers: [MatchdaysController],
  providers: [MatchdaysService],
  exports: [MatchdaysService],
})
export class MatchdaysModule {}
