import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import type { DataSource } from 'typeorm';
import { Public } from '../common/decorators/auth.decorators';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @InjectDataSource() private readonly mainDs: DataSource,
    @InjectDataSource('project') private readonly projectDs: DataSource,
  ) {}

  /** process ยังทำงานอยู่ (liveness) — ไม่แตะ DB */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** พร้อมรับงาน (readiness) — ping ฐานข้อมูลทั้งสอง */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('cms_db', { connection: this.mainDs, timeout: 3000 }),
      () => this.db.pingCheck('project_db', { connection: this.projectDs, timeout: 3000 }),
    ]);
  }
}
