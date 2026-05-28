import { IsString, IsNotEmpty, IsOptional, IsEnum, IsISO8601, IsNumber, IsArray, IsUUID, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTournamentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ['matchday', 'group_stage'] })
  @IsEnum(['matchday', 'group_stage'])
  type: string;

  @ApiProperty()
  @IsISO8601()
  start_date: string;

  @ApiProperty()
  @IsISO8601()
  end_date: string;

  @ApiProperty({ description: 'Monto por jornada en Bs (X)' })
  @IsNumber()
  bet_per_matchday: number;

  @ApiProperty({ description: 'Monto para polla final (Y)' })
  @IsNumber()
  bet_final: number;

  @ApiProperty({ required: false, description: 'Moneda (ej: Bs, USD, EUR)', default: 'Bs' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ required: false, description: 'Fecha límite para apuesta final (ISO8601)' })
  @IsISO8601()
  @IsOptional()
  final_bet_deadline?: string;
}

export class UpdateTournamentDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsEnum(['matchday', 'group_stage'])
  @IsOptional()
  type?: string;

  @ApiProperty({ required: false })
  @IsISO8601()
  @IsOptional()
  start_date?: string;

  @ApiProperty({ required: false })
  @IsISO8601()
  @IsOptional()
  end_date?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  bet_per_matchday?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  bet_final?: number;

  @ApiProperty({ required: false, description: 'Moneda (ej: Bs, USD, EUR)' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ required: false, description: 'Fecha límite para apuesta final (ISO8601)' })
  @IsISO8601()
  @IsOptional()
  final_bet_deadline?: string;
}

export class AddTeamsDto {
  @ApiProperty()
  @IsArray()
  @IsUUID('4', { each: true })
  team_ids: string[];
}

export class UpdateStatusDto {
  @ApiProperty({ enum: ['draft', 'active', 'finished'] })
  @IsEnum(['draft', 'active', 'finished'])
  status: string;
}

export class UpdateTeamQuartersDto {
  @ApiProperty()
  @IsUUID()
  team_id: string;

  @ApiProperty()
  @IsBoolean()
  advanced_to_quarters: boolean;
}
