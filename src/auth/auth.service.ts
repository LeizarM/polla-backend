import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
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

    const user = await this.prisma.user.findUnique({ where: { username } });

    // Lockout a NIVEL DE CUENTA, PERSISTIDO en DB (sobrevive reinicios y es
    // compartido entre instancias — complementa el rate-limit por IP).
    if (user?.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException(
        'Demasiados intentos. Espera unos minutos antes de intentar de nuevo.',
      );
    }

    if (!user) {
      // Compare contra un hash dummy para IGUALAR el timing con el caso
      // "user existe, pass mala" → evita enumeration de usuarios por tiempo.
      await bcrypt.compare(dto.password, AuthService.DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'blocked') {
      throw new UnauthorizedException('Account is blocked');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failed_login_attempts);
      throw new UnauthorizedException('Invalid credentials');
    }

    // ── 2FA: si está activado, requerimos código TOTP válido (uso único) ──
    if (user.totp_enabled && user.totp_secret) {
      if (!dto.totp_code) {
        // Cliente no mandó el código. Devolvemos signal especial sin token.
        return {
          requires_2fa: true,
          message: 'Ingresa el código de tu app authenticator',
        } as any;
      }
      const totpOk = await this.verifyTotpOnce(
        user.id, user.totp_secret, dto.totp_code, user.totp_last_step ?? null,
      );
      if (!totpOk) {
        await this.registerFailedAttempt(user.id, user.failed_login_attempts);
        throw new UnauthorizedException('Código 2FA incorrecto o ya usado');
      }
    }

    // Login OK: resetea contador/lock si hacía falta.
    if (user.failed_login_attempts > 0 || user.locked_until) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failed_login_attempts: 0, locked_until: null },
      });
    }

    const token = this.generateToken(user.id, user.username, user.role);
    return {
      access_token: token,
      user: this.sanitizeUser(user),
    };
  }

  // ─── Anti-brute-force PERSISTIDO (DB) ─────────────────────────────────────
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly LOCK_DURATION_MS = 15 * 60_000; // 15 min
  // Hash dummy (cost 12) para igualar el timing cuando el usuario NO existe
  // (anti-enumeration). Se computa una vez al cargar el módulo.
  private static readonly DUMMY_HASH = bcrypt.hashSync('timing-equalizer-no-user', 12);

  private async registerFailedAttempt(userId: string, current: number) {
    const attempts = (current ?? 0) + 1;
    const data: any = { failed_login_attempts: attempts };
    if (attempts >= AuthService.MAX_ATTEMPTS) {
      data.locked_until = new Date(Date.now() + AuthService.LOCK_DURATION_MS);
      data.failed_login_attempts = 0; // reset tras bloquear
    }
    await this.prisma.user.update({ where: { id: userId }, data });
  }

  /**
   * Verifica TOTP con USO ÚNICO (anti-replay). Calcula el "step" (contador de
   * 30s) que matcheó y lo guarda; un código de un step ya usado (o anterior)
   * se rechaza → un código capturado no se puede reusar dentro de su ventana.
   */
  private async verifyTotpOnce(
    userId: string,
    secret: string,
    code: string,
    lastStep: number | null,
  ): Promise<boolean> {
    const token = String(code ?? '').trim().replace(/\s+/g, '');
    if (token.length !== 6) return false;
    authenticator.options = { window: 1, digits: 6, step: 30 };
    const delta = authenticator.checkDelta(token, secret); // null si es inválido
    if (delta === null || delta === undefined) return false;
    const step = Math.floor(Date.now() / 1000 / 30) + delta;
    if (lastStep != null && step <= lastStep) return false; // replay
    await this.prisma.user.update({
      where: { id: userId },
      data: { totp_last_step: step },
    });
    return true;
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
