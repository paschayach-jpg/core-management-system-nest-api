import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../../../config';
import { RequestContextService } from '../../../../core/cls/request-context.service';
import { SystemConfigService } from '../../../shared/system-config/system-config.service';
import { ApprovalsService } from './approvals.service';

/** key ใน dbo.SystemConfig (เดิมอ่านผ่าน ConfigManager) — ค่าเป็นวินาที ค่าเริ่มต้น 60 */
export const ESCALATION_INTERVAL_KEY = 'EscalationTimerIntervalSeconds';
export const DEFAULT_ESCALATION_INTERVAL_SEC = 60;
/** ความถี่ที่ cron "ตื่นมาเช็ก" — รอบจริงถูกกำหนดโดยค่าตั้งด้านบน (ไม่ใช่ค่านี้) */
const TICK = CronExpression.EVERY_10_SECONDS;
const APP_LOCK_RESOURCE = 'DMS_APPROVAL_ESCALATION';

/**
 * งานยกระดับคำขอที่เกินเวลา (ProcessEscalations) — เดิมเป็น timer ในโปรแกรม WinForms ทุกเครื่อง ทำซ้ำกันได้
 * ที่นี่เป็นงานเดียวของฝั่ง API และกันซ้ำ 2 ชั้น:
 *   1) flag ในโปรเซส (ไม่ทำซ้อนตัวเอง)
 *   2) SQL Server application lock (sp_getapplock) — หลาย instance ของ API รันพร้อมกันแล้วมีแค่ตัวเดียวที่ได้ทำงาน
 */
@Injectable()
export class ApprovalEscalationJob implements OnModuleDestroy {
  private readonly logger = new Logger(ApprovalEscalationJob.name);
  private running = false;
  private lastRun = 0;
  private stopped = false;

  constructor(
    private readonly approvals: ApprovalsService,
    private readonly sysConfig: SystemConfigService,
    private readonly cfg: AppConfigService,
    private readonly ctx: RequestContextService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  onModuleDestroy(): void {
    this.stopped = true;
  }

  @Cron(TICK, { name: 'dms-approval-escalation' })
  async tick(): Promise<void> {
    if (this.cfg.get('NODE_ENV') === 'test') return; // ไม่ให้งานเบื้องหลังรันระหว่างเทสต์
    await this.runIfDue();
  }

  /** แยกออกมาเพื่อให้เทสต์เรียกได้โดยไม่ต้องรอ cron */
  async runIfDue(now = Date.now()): Promise<'ran' | 'not-due' | 'busy' | 'locked' | 'stopped'> {
    if (this.stopped) return 'stopped';
    if (this.running) return 'busy';
    const intervalSec = await this.readIntervalSeconds();
    if (now - this.lastRun < intervalSec * 1000) return 'not-due';

    this.running = true;
    this.lastRun = now;
    try {
      return await this.withDbLock(async () => {
        const summary = await this.ctx.run(() => this.approvals.escalateExpired(new Date(now)), {});
        if (summary.checked > 0) {
          this.logger.log(
            `escalation: ตรวจ ${summary.checked} · ยกระดับ ${summary.escalated} · ข้าม ${summary.skipped} · ล้มเหลว ${summary.failed}`,
          );
        }
      });
    } catch (err) {
      this.logger.error(`escalation ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`);
      return 'ran';
    } finally {
      this.running = false;
    }
  }

  private async readIntervalSeconds(): Promise<number> {
    try {
      const n = await this.sysConfig.getNumber(
        ESCALATION_INTERVAL_KEY,
        DEFAULT_ESCALATION_INTERVAL_SEC,
      );
      return Number.isFinite(n) && n >= 10 ? n : DEFAULT_ESCALATION_INTERVAL_SEC;
    } catch {
      return DEFAULT_ESCALATION_INTERVAL_SEC;
    }
  }

  /**
   * รัน work ภายใต้ application lock ของ SQL Server (บน connection เฉพาะ) — ไม่ได้ lock = มี instance อื่นทำอยู่ → ข้าม
   * LockTimeout=0: ไม่รอ · LockOwner=Session: หลุดอัตโนมัติถ้า connection ตาย
   */
  private async withDbLock(work: () => Promise<void>): Promise<'ran' | 'locked'> {
    const runner = this.ds.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query(
        `DECLARE @r INT;
         EXEC @r = sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0;
         SELECT @r AS R;`,
        [APP_LOCK_RESOURCE],
      )) as { R: number }[] | undefined;
      if (!rows || Number(rows[0]?.R) < 0) return 'locked';
      try {
        await work();
      } finally {
        await runner.query(`EXEC sp_releaseapplock @Resource = @0, @LockOwner = 'Session';`, [
          APP_LOCK_RESOURCE,
        ]);
      }
      return 'ran';
    } finally {
      await runner.release();
    }
  }
}
