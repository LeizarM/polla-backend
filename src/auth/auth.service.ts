import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { SignupDto, LoginDto } from './dto/auth.dto';
import { sanitizeUser } from '../common/sanitize-user';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    // ── Username debe ser único ─────────────────────────────────────────
    const username = dto.username?.trim();
    if (!username) {
      throw new ConflictException('El nombre de usuario es obligatorio');
    }
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new ConflictException('El nombre de usuario ya existe');
    }

    // ── CI obligatorio pero NO único (varios users pueden compartir) ───
    // BadRequest (400), NO Conflict (409): el 409 lo reserva el frontend para
    // "usuario en uso". Antes esto daba 409 → mensaje equivocado.
    const ci = dto.ci?.trim();
    if (!ci) {
      throw new BadRequestException('La cédula de identidad es obligatoria');
    }

    // ── Política de password: min 8, al menos 1 letra y 1 número ───────
    if (!this.isPasswordStrong(dto.password)) {
      throw new BadRequestException(
        'Contraseña débil: mínimo 8 caracteres, debe incluir letras y números',
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        full_name: dto.full_name,
        phone: dto.phone,
        ci,
        role: 'user',
        balance: 0,
        status: 'active',
      },
    });

    // Generate token
    const token = this.generateToken(user.id, user.username, user.role);

    return {
      access_token: token,
      user: this.sanitizeUser(user),
    };
  }

  async login(dto: LoginDto) {
    const username = dto.username?.trim();
    if (!username || !dto.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Anti brute-force a NIVEL DE CUENTA (complementa el rate-limit por IP).
    // 5 intentos fallidos consecutivos → 15 min de bloqueo para esa cuenta.
    if (this.isAccountLocked(username)) {
      throw new UnauthorizedException(
        'Demasiados intentos. Espera 15 minutos antes de intentar de nuevo.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Registra fallido aunque el usuario no exista — evita enumeration de users
      this.registerFailedAttempt(username);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'blocked') {
      throw new UnauthorizedException('Account is blocked');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      this.registerFailedAttempt(username);
      throw new UnauthorizedException('Invalid credentials');
    }

    // ── 2FA: si está activado, requerimos código TOTP válido ──────────
    if (user.totp_enabled && user.totp_secret) {
      if (!dto.totp_code) {
        // Cliente no mandó el código. Devolvemos signal especial sin token.
        return {
          requires_2fa: true,
          message: 'Ingresa el código de tu app authenticator',
        } as any;
      }
      // Verificación TOTP inline para no acoplar con TwoFAService
      const { authenticator } = require('otplib');
      authenticator.options = { window: 1 };
      const totpOk = authenticator.verify({
        token: String(dto.totp_code).trim(),
        secret: user.totp_secret,
      });
      if (!totpOk) {
        this.registerFailedAttempt(username);
        throw new UnauthorizedException('Código 2FA incorrecto');
      }
    }

    // Login OK: limpia el contador
    this.clearFailedAttempts(username);

    const token = this.generateToken(user.id, user.username, user.role);
    return {
      access_token: token,
      user: this.sanitizeUser(user),
    };
  }

  // ─── Anti-brute-force por cuenta ──────────────────────────────────────────
  private readonly failedAttempts = new Map<string, { count: number; lockedUntil: number }>();
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly LOCK_DURATION_MS = 15 * 60_000; // 15 min

  private isAccountLocked(username: string): boolean {
    const entry = this.failedAttempts.get(username.toLowerCase());
    if (!entry) return false;
    if (Date.now() < entry.lockedUntil) return true;
    // Expirado → limpiar
    if (entry.lockedUntil > 0 && Date.now() >= entry.lockedUntil) {
      this.failedAttempts.delete(username.toLowerCase());
    }
    return false;
  }

  private registerFailedAttempt(username: string) {
    const key = username.toLowerCase();
    const entry = this.failedAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
    entry.count++;
    if (entry.count >= AuthService.MAX_ATTEMPTS) {
      entry.lockedUntil = Date.now() + AuthService.LOCK_DURATION_MS;
    }
    this.failedAttempts.set(key, entry);
  }

  private clearFailedAttempts(username: string) {
    this.failedAttempts.delete(username.toLowerCase());
  }

  // ─── Política de contraseña ──────────────────────────────────────────────
  // Mínimo 8 chars + al menos 1 letra + al menos 1 número.
  // Sin requerimiento de caracter especial (UX trade-off).
  isPasswordStrong(pwd: string | undefined | null): boolean {
    if (!pwd || pwd.length < 8) return false;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    return hasLetter && hasNumber;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.sanitizeUser(user);
  }

  private generateToken(userId: string, username: string, role: string) {
    return this.jwt.sign({
      sub: userId,
      username,
      role,
    });
  }

  // Delega en el helper compartido — ver src/common/sanitize-user.ts para
  // la lista completa de campos sensibles excluidos.
  private sanitizeUser(user: any) {
    return sanitizeUser(user);
  }
}
