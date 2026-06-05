/**
 * TwoFAService — TOTP (compatible Google Authenticator, Authy, 1Password).
 *
 *  Flow del usuario:
 *    1. POST /api/auth/2fa/setup        → devuelve secret + URL QR
 *    2. El user escanea QR con su app authenticator
 *    3. POST /api/auth/2fa/enable {code} → verifica código → habilita
 *    4. Login normal pide ahora {username, password, totp_code}
 *    5. POST /api/auth/2fa/disable {code, password} → deshabilita
 */
import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const ISSUER = 'Mundial2026';   // sin espacios para mejor compat con Google Authenticator

// Configuración GLOBAL de otplib — se aplica una vez al cargar el módulo.
// window: 2 = tolera ±60 segundos de drift entre reloj del cliente y servidor.
// digits: 6, step: 30 — defaults estándar compatibles con Google Authenticator.
authenticator.options = {
  window: 1,  // ±30s (antes ±60s) — menor ventana de replay del código TOTP
  digits: 6,
  step: 30,
};

@Injectable()
export class TwoFAService {
  private readonly logger = new Logger(TwoFAService.name);
  constructor(private prisma: PrismaService) {}

  /** Genera un secret nuevo + QR code (data URL) sin habilitar todavía. */
  async setup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.totp_enabled) {
      throw new ConflictException('Ya tienes 2FA activado');
    }

    // Secret de 32 chars (160 bits) — el estándar recomendado RFC 6238
    // (otplib default es 16 chars = 80 bits, válido pero menos común).
    const secret = authenticator.generateSecret(20); // 20 bytes → 32 chars base32
    const otpauthUrl = authenticator.keyuri(user.username, ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    // NO loguear el current_code (sería leak). Solo info de tamaño.
    this.logger.log(
      `[2fa.setup] user=${user.username} secret_len=${secret.length}`,
    );

    // Guardamos el secret pero no lo "habilitamos" hasta que verifique código
    await this.prisma.user.update({
      where: { id: userId },
      data: { totp_secret: secret, totp_enabled: false },
    });

    return {
      secret,        // por si el user prefiere copiarlo manualmente
      qr: qrDataUrl, // png base64
      otpauth: otpauthUrl,
    };
  }

  /** Verifica el código de la app y activa 2FA. */
  async enable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totp_secret) {
      throw new BadRequestException('Primero ejecuta /2fa/setup');
    }
    const trimmed = (code ?? '').toString().trim().replace(/\s+/g, '');
    const ok = this.verifyCode(user.totp_secret, trimmed);
    // Solo logueamos el resultado, NUNCA el código esperado (sería leak)
    this.logger.log(
      `[2fa.enable] user=${user.username} code_len=${trimmed.length} valid=${ok}`,
    );
    if (!ok) {
      throw new BadRequestException('Código incorrecto');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totp_enabled: true },
    });
    return { success: true, message: '2FA activado correctamente' };
  }

  /** Desactiva 2FA. Requiere código TOTP + password (re-auth). */
  async disable(userId: string, code: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totp_enabled || !user.totp_secret) {
      throw new BadRequestException('No tienes 2FA activado');
    }
    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) throw new BadRequestException('Contraseña incorrecta');
    if (!this.verifyCode(user.totp_secret, code)) {
      throw new BadRequestException('Código TOTP incorrecto');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totp_secret: null, totp_enabled: false },
    });
    return { success: true, message: '2FA desactivado' };
  }

  /** Verifica código TOTP — usado por login también. */
  verifyCode(secret: string, code: string): boolean {
    try {
      const token = (code ?? '').toString().trim().replace(/\s+/g, '');
      if (!secret || !token || token.length !== 6) return false;
      return authenticator.verify({ token, secret });
    } catch (e) {
      this.logger.warn(`[2fa.verifyCode] error: ${(e as Error).message}`);
      return false;
    }
  }
}
