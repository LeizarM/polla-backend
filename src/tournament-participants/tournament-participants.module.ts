import { Module } from '@nestjs/common';
import { TournamentParticipantsController } from './tournament-participants.controller';
import { TournamentParticipantsService } from './tournament-participants.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TournamentParticipantsController],
  providers: [TournamentParticipantsService],
  exports: [TournamentParticipantsService],
})
export class TournamentParticipantsModule {}
