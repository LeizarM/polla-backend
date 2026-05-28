import { Module } from '@nestjs/common';
import { FinalBetsController } from './final-bets.controller';
import { FinalBetsService } from './final-bets.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinalBetsController],
  providers: [FinalBetsService],
  exports: [FinalBetsService],
})
export class FinalBetsModule {}
