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
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const ISSUER = 'Mundial 2026';

@Injectable()
export class TwoFAService {
  constructor(private prisma: PrismaService) {}

  /** Genera un secret nuevo + QR code (data URL) sin habilitar todavía. */
  async setup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.totp_enabled) {
      throw new ConflictException('Ya tienes 2FA activado');
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.username, ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

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
    if (!this.verifyCode(user.totp_secret, code)) {
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
      // Ventana de ±1 step (30s) para tolerar drift del reloj del cliente
      authenticator.options = { window: 1 };
      return authenticator.verify({ token: code?.trim(), secret });
    } catch {
      return false;
    }
  }
}
