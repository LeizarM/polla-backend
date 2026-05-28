import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('api')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Strict: 3 signups / minute / IP — stops mass-registration bots.
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  // Strict: 5 login attempts / minute / IP — stops brute-force.
  // After 5 wrong tries the next attempt returns 429 Too Many Requests.
  // Pair with fail2ban (configured below) to also ban the IP at firewall level.
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('auth/login')
  @ApiOperation({ summary: 'Login with username and password' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('auth/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.userId);
  }
}
