import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchdaysModule } from '../matchdays/matchdays.module';
import { FinalBetsModule } from '../final-bets/final-bets.module';

@Module({
  imports: [PrismaModule, MatchdaysModule, FinalBetsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
