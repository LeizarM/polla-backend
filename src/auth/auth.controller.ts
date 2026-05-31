import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { TwoFAService } from './twofa.service';
import { SignupDto, LoginDto, TwoFAEnableDto, TwoFADisableDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { FreshAuthGuard } from './guards/fresh-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';

@ApiTags('auth')
@Controller('api')
export class AuthController {
  constructor(
    private authService: AuthService,
    private twofa: TwoFAService,
    private audit: AuditService,
  ) {}

  // Strict: 3 signups / minute / IP — stops mass-registration bots.
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
  async signup(@Body() dto: SignupDto, @Req() req: any) {
    const result = await this.authService.signup(dto);
    this.audit.log({
      action: 'auth.signup',
      user_id: result.user?.id,
      ip: AuditService.getIp(req),
      ua: req.headers?.['user-agent'],
      metadata: { username: dto.username },
    });
    return result;
  }

  // Strict: 5 login attempts / minute / IP — stops brute-force.
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('auth/login')
  @ApiOperation({ summary: 'Login with username, password and optional 2FA code' })
  async login(@Body() dto: LoginDto, @Req() req: any) {
    try {
      const result = await this.authService.login(dto);
      // Si requires_2fa, NO logueamos como success (todavía falta el código)
      if (!(result as any).requires_2fa) {
        this.audit.log({
          action: 'auth.login.success',
          user_id: (result as any).user?.id,
          ip: AuditService.getIp(req),
          ua: req.headers?.['user-agent'],
          metadata: { username: dto.username },
        });
      }
      return result;
    } catch (err) {
      this.audit.log({
        action: 'auth.login.failed',
        ip: AuditService.getIp(req),
        ua: req.headers?.['user-agent'],
        metadata: { username: dto.username, reason: (err as Error)?.message },
      });
      throw err;
    }
  }

  @Get('auth/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.userId);
  }

  // ─── 2FA endpoints ──────────────────────────────────────────────────
  @Post('auth/2fa/setup')
  @UseGuards(JwtAuthGuard, FreshAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate TOTP secret + QR. Requires fresh auth.' })
  async setup2fa(@CurrentUser() user: any, @Req() req: any) {
    const result = await this.twofa.setup(user.userId);
    this.audit.log({
      action: 'auth.2fa.setup_initiated',
      user_id: user.userId,
      ip: AuditService.getIp(req),
      ua: req.headers?.['user-agent'],
    });
    return result;
  }

  @Post('auth/2fa/enable')
  @UseGuards(JwtAuthGuard, FreshAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable 2FA after verifying the first TOTP code.' })
  async enable2fa(@CurrentUser() user: any, @Body() dto: TwoFAEnableDto, @Req() req: any) {
    const result = await this.twofa.enable(user.userId, dto.code);
    this.audit.log({
      action: 'auth.2fa.enabled',
      user_id: user.userId,
      ip: AuditService.getIp(req),
      ua: req.headers?.['user-agent'],
    });
    return result;
  }

  @Post('auth/2fa/disable')
  @UseGuards(JwtAuthGuard, FreshAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable 2FA (requires password + TOTP code).' })
  async disable2fa(@CurrentUser() user: any, @Body() dto: TwoFADisableDto, @Req() req: any) {
    const result = await this.twofa.disable(user.userId, dto.code, dto.password);
    this.audit.log({
      action: 'auth.2fa.disabled',
      user_id: user.userId,
      ip: AuditService.getIp(req),
      ua: req.headers?.['user-agent'],
    });
    return result;
  }
}
