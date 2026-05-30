import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  full_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ required: false, description: 'Username (unique)' })
  @IsString()
  @IsOptional()
  username?: string;

  // CI obligatorio en signup, opcional aquí porque update puede tocar otros campos
  // sin re-enviar CI. Si lo manda, lo valida como string. NO es único.
  @ApiProperty({ required: false, description: 'Cédula de identidad (obligatoria; puede repetirse)' })
  @IsString()
  @IsOptional()
  ci?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  fcm_token?: string;
}
