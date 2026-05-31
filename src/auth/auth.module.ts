import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { TwoFAService } from './twofa.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { CronAuthGuard } from './guards/cron-auth.guard';
import { FreshAuthGuard } from './guards/fresh-auth.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [
    PassportModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TwoFAService, JwtStrategy, JwtAuthGuard, AdminGuard, CronAuthGuard, FreshAuthGuard],
  // Exportamos JwtModule también para que cualquier guard que dependa de
  // JwtService (como FreshAuthGuard) pueda inyectarlo desde otros módulos.
  exports: [AuthService, TwoFAService, JwtAuthGuard, AdminGuard, CronAuthGuard, FreshAuthGuard, JwtModule],
})
export class AuthModule {}
