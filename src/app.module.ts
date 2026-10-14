import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config';
import { AppCacheModule } from './core/cache/app-cache.module';
import { RequestContextModule } from './core/cls';
import { CrudLogModule } from './core/crud-log';
import { LoggingModule } from './core/logging/logging.module';
import { DatabaseModule } from './database';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    // ── โครงสร้างพื้นฐาน (global) ──
    AppConfigModule,
    RequestContextModule,
    LoggingModule,
    AppCacheModule,
    DatabaseModule,
    CrudLogModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => [
        { ttl: cfg.get('THROTTLE_TTL_SEC') * 1000, limit: cfg.get('THROTTLE_LIMIT') },
      ],
    }),
    HealthModule,

    // ── module ธุรกิจ (แยก service ตาม module) ──
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
