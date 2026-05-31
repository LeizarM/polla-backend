import {
  Controller, Post, Delete, Get, Patch, Param, Body, Req, UseGuards, HttpCode, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CronAuthGuard } from '../auth/guards/cron-auth.guard';
import { NotificationsService } from './notifications.service';
import { SchedulesService } from './schedules.service';
import { RegisterPushTokenDto, SendNotificationDto } from './dto/notifications.dto';

@ApiTags('Push Notifications')
@Controller('api')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly schedulesService: SchedulesService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Programadas (admin)
  // ──────────────────────────────────────────────────────────────────────
  @Get('admin/notifications/schedules')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  listSchedules() { return this.schedulesService.list(); }

  @Post('admin/notifications/schedules')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  createSchedule(@Body() dto: any) { return this.schedulesService.create(dto); }

  @Patch('admin/notifications/schedules/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  updateSchedule(@Param('id') id: string, @Body() dto: any) {
    return this.schedulesService.update(id, dto);
  }

  @Post('admin/notifications/schedules/:id/toggle')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  toggleSchedule(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.schedulesService.toggle(id, !!body.enabled);
  }

  @Delete('admin/notifications/schedules/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  removeSchedule(@Param('id') id: string) { return this.schedulesService.remove(id); }

  @Get('admin/notifications/stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  stats() { return this.schedulesService.stats(); }

  @Get('push/vapid-public-key')
  @ApiOperation({ summary: 'Get the VAPID public key for Web Push subscription' })
  getVapidPublicKey() {
    return { publicKey: this.notificationsService.getVapidPublicKey() };
  }

  @Post('push-tokens')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register an Expo Push Token for the authenticated user' })
  async registerToken(@Req() req: any, @Body() dto: RegisterPushTokenDto) {
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.sub;
    this.logger.log(`Registering push token for user ${userId}`);
    const result = await this.notificationsService.registerToken(userId, dto.token, dto.device_type);
    return { message: 'Token registrado', id: result.id };
  }

  @Delete('push-tokens')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a push token' })
  @HttpCode(200)
  async removeToken(@Body() dto: { token: string }) {
    await this.notificationsService.removeToken(dto.token);
    return { message: 'Token eliminado' };
  }

  @Post('admin/notifications/send')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Send push notification to specific users' })
  async sendNotification(@Body() dto: SendNotificationDto) {
    return this.notificationsService.sendToUsers(dto.user_ids, dto.title, dto.body, dto.data);
  }

  @Post('admin/notifications/broadcast')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Broadcast push notification to all users' })
  async broadcastNotification(@Body() dto: { title: string; body: string; data?: Record<string, any> }) {
    return this.notificationsService.sendToAll(dto.title, dto.body, dto.data);
  }

  /** Cron endpoint: Send reminders to users who haven't bet on upcoming matchdays.
   *  PROTEGIDO con CronAuthGuard — requiere header X-Cron-Secret. */
  @Post('cron/matchday-reminders')
  @UseGuards(CronAuthGuard)
  @ApiOperation({ summary: 'Cron: Send matchday bet reminders (internal)' })
  @HttpCode(200)
  async cronMatchdayReminders() {
    this.logger.log('Cron: Sending matchday reminders');
    return this.notificationsService.sendMatchdayReminders();
  }

  /** Cron endpoint: Send reminders for final bet deadline */
  @Post('cron/final-bet-reminders')
  @UseGuards(CronAuthGuard)
  @ApiOperation({ summary: 'Cron: Send final bet deadline reminders (internal)' })
  @HttpCode(200)
  async cronFinalBetReminders() {
    this.logger.log('Cron: Sending final bet reminders');
    return this.notificationsService.sendFinalBetReminders();
  }
}
