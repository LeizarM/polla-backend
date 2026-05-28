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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    // Check if user exists
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('El nombre de usuario ya existe');
    }

    // Check CI uniqueness if provided
    if (dto.ci?.trim()) {
      const ciExists = await this.prisma.user.findFirst({
        where: { ci: dto.ci.trim() },
      });
      if (ciExists) {
        throw new ConflictException('Ya existe un usuario con este CI');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password: hashedPassword,
        full_name: dto.full_name,
        phone: dto.phone,
        ci: dto.ci?.trim() || null,
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
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is blocked
    if (user.status === 'blocked') {
      throw new UnauthorizedException('Account is blocked');
    }

    // Verify password
    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate token
    const token = this.generateToken(user.id, user.username, user.role);

    return {
      access_token: token,
      user: this.sanitizeUser(user),
    };
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

  private sanitizeUser(user: any) {
    const { password, ...rest } = user;
    return {
      ...rest,
      balance: Number(rest.balance),
    };
  }
}
