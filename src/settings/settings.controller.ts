import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/settings.dto';

@ApiTags('Settings')
@Controller('api/settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all app settings (public)' })
  async getAll() {
    return this.service.getAll();
  }

  @Patch()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Update app settings (admin only)' })
  async update(@Body() dto: UpdateSettingsDto) {
    await this.service.setMany(dto.settings);
    return { success: true };
  }
}
