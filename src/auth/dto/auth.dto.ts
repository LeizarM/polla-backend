import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({ example: 'johndoe' })
  @IsString()
  @IsNotEmpty()
  username: string;

  // ⚠️ Validación de complejidad en AuthService.signup (min 8 + letra + número).
  // No usamos @MinLength aquí para que el mensaje de error sea el de "contraseña
  // débil" que es más útil al usuario (vs "longer than 6").
  @ApiProperty({ example: 'password123', description: 'min 8 chars + letras + números' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @ApiProperty({ example: '1234567890' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  // CI obligatorio, NO único — varios usuarios pueden compartir el mismo CI
  // (familiares, etc.). El único campo único es `username`.
  @ApiProperty({ example: '12345678', description: 'Cédula de Identidad (obligatoria, puede repetirse)' })
  @IsString()
  @IsNotEmpty()
  ci: string;
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
