import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestParticipationDto {
  @ApiProperty({ description: 'ID del torneo' })
  @IsString()
  @IsNotEmpty()
  tournament_id: string;
}

export class UpdateParticipationStatusDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsString()
  @IsIn(['approved', 'rejected'])
  status: string;
}
