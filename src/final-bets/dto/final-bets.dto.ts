import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFinalBetDto {
  @ApiProperty()
  @IsUUID()
  tournament_id: string;

  @ApiProperty({ description: 'Team ID predicted as 1st place (12 pts)' })
  @IsUUID()
  pick_1st: string;

  @ApiProperty({ description: 'Team ID predicted as 2nd place (8 pts)' })
  @IsUUID()
  pick_2nd: string;

  @ApiProperty({ description: 'Team ID predicted as 3rd place (4 pts)' })
  @IsUUID()
  pick_3rd: string;

  @ApiProperty({ description: 'Team ID predicted as 4th place (2 pts)' })
  @IsUUID()
  pick_4th: string;
}

export class UpdateFinalBetDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  pick_1st?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  pick_2nd?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  pick_3rd?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  pick_4th?: string;
}
