import { IsString, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// Quita espacios al inicio/fin al guardar (un " José" rompía el orden alfabético).
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateProfileDto {
  @ApiProperty({ required: false })
  @Transform(trim)
  @IsString()
  @IsOptional()
  full_name?: string;

  @ApiProperty({ required: false })
  @Transform(trim)
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ required: false, description: 'Username (unique)' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  username?: string;

  // CI obligatorio en signup, opcional aquí porque update puede tocar otros campos
  // sin re-enviar CI. Si lo manda, lo valida como string. NO es único.
  @ApiProperty({ required: false, description: 'Cédula de identidad (obligatoria; puede repetirse)' })
  @Transform(trim)
  @IsString()
  @IsOptional()
  ci?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  fcm_token?: string;
}
