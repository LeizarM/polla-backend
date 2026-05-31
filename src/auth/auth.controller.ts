import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';

@ApiTags('auth')
@Controller('api')
export class AuthController {
  constructor(
    private authService: AuthService,
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
  // After 5 wrong tries the next attempt returns 429 Too Many Requests.
  // Pair with fail2ban (configured below) to also ban the IP at firewall level.
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('auth/login')
  @ApiOperation({ summary: 'Login with username and password' })
  async login(@Body() dto: LoginDto, @Req() req: any) {
    try {
      const result = await this.authService.login(dto);
      this.audit.log({
        action: 'auth.login.success',
        user_id: result.user?.id,
        ip: AuditService.getIp(req),
        ua: req.headers?.['user-agent'],
        metadata: { username: dto.username },
      });
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
}
