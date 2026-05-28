import { IsString, IsNotEmpty, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({ example: 'johndoe' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'password123', minimum: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @ApiProperty({ example: '1234567890' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: '12345678', description: 'Cédula de Identidad (único)' })
  @IsString()
  @IsOptional()
  ci?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'user1' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'user123' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
