import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LastSeenInterceptor } from './auth/interceptors/last-seen.interceptor';
import { GeoFenceMiddleware } from './auth/middleware/geo-fence.middleware';
import { MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TeamsModule } from './teams/teams.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { MatchdaysModule } from './matchdays/matchdays.module';
import { MatchesModule } from './matches/matches.module';
import { TicketsModule } from './tickets/tickets.module';
import { AdminModule } from './admin/admin.module';
import { GroupsModule } from './groups/groups.module';
import { GroupBetsModule } from './group-bets/group-bets.module';
import { FinalBetsModule } from './final-bets/final-bets.module';
import { TournamentParticipantsModule } from './tournament-participants/tournament-participants.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Habilita @Cron / @Interval / @Timeout en TODA la app. El scheduler de
    // notificaciones (notifications/schedules.service.ts) corre cada minuto.
    ScheduleModule.forRoot(),
    // ─── Rate limiting (anti brute-force, anti-DDoS soft) ─────────────────
    // Three time-windows running in parallel:
    //  - "short":  10 req / second   (burst)
    //  - "medium": 100 req / 10 sec
    //  - "long":   500 req / minute  (per IP, taking X-Forwarded-For)
    // Override per-route with @Throttle({...}) — e.g. login = 5/min.
    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 1000,  limit: 10 },
      { name: 'medium', ttl: 10000, limit: 100 },
      { name: 'long',   ttl: 60000, limit: 500 },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    TournamentsModule,
    MatchdaysModule,
    MatchesModule,
    TicketsModule,
    AdminModule,
    GroupsModule,
    GroupBetsModule,
    FinalBetsModule,
    TournamentParticipantsModule,
    ReportsModule,
    SettingsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply throttler globally — every controller respects the limits above.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Track last_seen_at on every authenticated request (throttled internally).
    { provide: APP_INTERCEPTOR, useClass: LastSeenInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // GeoFence solo en login + signup. Otras rutas (que requieren JWT) ya
    // están protegidas por JwtAuthGuard.
    consumer
      .apply(GeoFenceMiddleware)
      .forRoutes(
        { path: 'api/auth/login', method: RequestMethod.POST },
        { path: 'api/signup',     method: RequestMethod.POST },
      );
  }
}
