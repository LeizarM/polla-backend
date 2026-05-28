import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('admin')
@Controller('api/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'Get all users (admin)' })
  async getUsers(@Query('search') search?: string) {
    return this.adminService.getUsers(search);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get single user detail (admin)' })
  async getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard stats (admin)' })
  async getStats() {
    return this.adminService.getStats();
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Update user status (admin)' })
  async updateUserStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.adminService.updateUserStatus(id, body.status);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update user role (admin)' })
  async updateUserRole(
    @Param('id') id: string,
    @Body() body: { role: string },
  ) {
    return this.adminService.updateUserRole(id, body.role);
  }

  @Patch('users/:id/password')
  @ApiOperation({ summary: 'Reset user password (admin)' })
  async resetPassword(
    @Param('id') id: string,
    @Body() body: { new_password: string },
  ) {
    return this.adminService.resetPassword(id, body.new_password);
  }
}
