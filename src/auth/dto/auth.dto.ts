import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  // Solo requerido si el usuario tiene 2FA activado. Si lo manda y no aplica,
  // se ignora. Si NO lo manda y el user tiene 2FA, login devuelve flag para
  // que el cliente pida el código.
  @ApiPropertyOptional({ example: '123456', description: 'TOTP 6-dígitos si tienes 2FA activo' })
  @IsString()
  @IsOptional()
  totp_code?: string;
}

export class TwoFAEnableDto {
  @ApiProperty({ example: '123456', description: 'Código TOTP de 6 dígitos' })
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class TwoFADisableDto {
  @ApiProperty({ example: '123456', description: 'Código TOTP' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'YourPassword', description: 'Tu password (re-auth)' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
