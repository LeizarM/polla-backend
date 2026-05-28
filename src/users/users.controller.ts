import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/users.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('users')
@Controller('api/users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser() user: any) {
    return this.usersService.getProfile(user.userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Change current user password' })
  async changePassword(
    @CurrentUser() user: any,
    @Body() body: { old_password: string; new_password: string },
  ) {
    return this.usersService.changePassword(user.userId, body.old_password, body.new_password);
  }

  @Get('me/balance')
  @ApiOperation({ summary: 'Get current user balance' })
  async getBalance(@CurrentUser() user: any) {
    return this.usersService.getBalance(user.userId);
  }

  @Get('me/transactions')
  @ApiOperation({ summary: 'Get current user transactions' })
  async getTransactions(
    @CurrentUser() user: any,
    @Query('type') type?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.usersService.getTransactions(user.userId, type, page, limit);
  }
}
