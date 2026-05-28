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

  @ApiProperty({ required: false, description: 'Cédula de identidad (unique)' })
  @IsString()
  @IsOptional()
  ci?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  fcm_token?: string;
}
