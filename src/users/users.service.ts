import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/users.dto';
import { sanitizeUser } from '../common/sanitize-user';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return sanitizeUser(user);
  }

  // ── Avatar (foto de perfil) ─────────────────────────────────────────────────
  /** Guarda el avatar (data URI base64, ya comprimido en el cliente). Valida tipo
   *  y tamaño. Devuelve la URL nueva con cache-bust. */
  async setAvatar(userId: string, dataUri: string) {
    if (!dataUri || typeof dataUri !== 'string') {
      throw new BadRequestException('Imagen inválida');
    }
    const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(dataUri.trim());
    if (!m) throw new BadRequestException('Formato no soportado (usa JPG, PNG o WEBP)');
    const mime = m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) throw new BadRequestException('Imagen vacía');
    if (buf.length > 500 * 1024) throw new BadRequestException('La imagen es muy grande (máx 500KB)');
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: buf, avatar_mime: mime, avatar_updated_at: new Date() },
    });
    return { ok: true, avatar_url: `/api/users/${userId}/avatar?v=${Date.now()}` };
  }

  /** Lee el avatar binario para servirlo. null si no tiene. */
  async getAvatar(userId: string): Promise<{ data: Buffer; mime: string } | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, avatar_mime: true },
    });
    if (!u?.avatar || !u?.avatar_mime) return null;
    return { data: Buffer.from(u.avatar as any), mime: u.avatar_mime };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // ── Username SÍ debe ser único (incluso en update) ──────────────────
    if (dto.username) {
      const trimmed = dto.username.trim();
      if (!trimmed) throw new BadRequestException('El usuario no puede estar vacío');
      const existingUser = await this.prisma.user.findFirst({
        where: { username: trimmed, id: { not: userId } },
      });
      if (existingUser) throw new ConflictException('El nombre de usuario ya está en uso');
    }

    // ── CI NO es único (puede repetirse) pero sí obligatorio ────────────
    // En update, si lo envían debe ser no-vacío. Si NO lo envían, conserva
    // el valor actual.
    if (dto.ci !== undefined) {
      const trimmed = (dto.ci ?? '').trim();
      if (!trimmed) throw new BadRequestException('La cédula no puede estar vacía');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.full_name && { full_name: dto.full_name }),
        ...(dto.phone && { phone: dto.phone }),
        ...(dto.username && { username: dto.username.trim() }),
        ...(dto.ci !== undefined && { ci: dto.ci.trim() }),
        ...(dto.fcm_token !== undefined && { fcm_token: dto.fcm_token }),
        updated_at: new Date(),
      },
    });

    return sanitizeUser(updated);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Política igual que en signup: min 8 + letra + número
    const hasLetter = /[A-Za-z]/.test(newPassword ?? '');
    const hasNumber = /[0-9]/.test(newPassword ?? '');
    if (!newPassword || newPassword.length < 8 || !hasLetter || !hasNumber) {
      throw new BadRequestException(
        'Contraseña débil: mínimo 8 caracteres, debe incluir letras y números',
      );
    }
    // No permitir reutilizar la misma password
    if (await bcrypt.compare(newPassword, user.password)) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) throw new BadRequestException('La contraseña actual es incorrecta');
    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, updated_at: new Date() },
    });
    return { success: true, message: 'Contraseña actualizada correctamente' };
  }

  async getBalance(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { balance: Number(user.balance) };
  }

  async getTransactions(
    userId: string,
    type?: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const where = {
      user_id: userId,
      ...(type && { type }),
    };

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        amount: Number(t.amount),
      })),
      total,
      page,
    };
  }
}
