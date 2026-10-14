import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestContextService } from '../../../../core/cls/request-context.service';
import { SystemConfigService } from '../../../shared/system-config/system-config.service';
import { RecycleBinService } from './recycle-bin.service';

/** คีย์ใน dbo.SystemConfig ที่เปิด/ปิดการลบถาวรอัตโนมัติ (ค่าเริ่มต้น = ปิด เพราะลบไฟล์จริง) */
export const AUTO_PURGE_CONFIG_KEY = 'Dms.RecycleBin.AutoPurge';
/** จำนวนโฟลเดอร์สูงสุดที่ลบต่อรอบ (ค่าเริ่มต้น 20) */
export const PURGE_BATCH_CONFIG_KEY = 'Dms.RecycleBin.PurgeBatchSize';

/**
 * งานลบถาวรของถังขยะที่หมดอายุ (RecycleBinExpiry) — ระบบเดิมไม่มีงานนี้ (ตรวจแค่ตอนกู้คืน)
 * ปิดเป็นค่าเริ่มต้น: เปิดด้วยค่าตั้งระบบ `Dms.RecycleBin.AutoPurge` = true เพราะเป็นการลบไฟล์จริงที่ย้อนไม่ได้
 * รันทุกวัน 02:30 · ถ้ารอบก่อนยังไม่จบจะข้าม · หลาย instance รันพร้อมกันได้ (การลบเป็น idempotent) แต่ควรเปิดเพียง instance เดียว
 */
@Injectable()
export class RecycleBinPurgeJob {
  private readonly logger = new Logger(RecycleBinPurgeJob.name);
  private running = false;

  constructor(
    private readonly bin: RecycleBinService,
    private readonly config: SystemConfigService,
    private readonly ctx: RequestContextService,
  ) {}

  @Cron('0 30 2 * * *', { name: 'dms-recycle-bin-purge' })
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  /** รันหนึ่งรอบ (แยกออกมาเพื่อเทสต์) — คืนสรุป หรือ null ถ้าปิด/ข้าม */
  async runOnce(): Promise<Awaited<ReturnType<RecycleBinService['purgeExpired']>> | null> {
    if (this.running) {
      this.logger.warn('รอบก่อนหน้ายังไม่จบ ข้ามรอบนี้');
      return null;
    }
    this.running = true;
    try {
      if (!(await this.config.getBool(AUTO_PURGE_CONFIG_KEY, false))) return null;
      const batch = Math.max(
        1,
        Math.min(200, await this.config.getNumber(PURGE_BATCH_CONFIG_KEY, 20)),
      );
      const summary = await this.ctx.run(() => this.bin.purgeExpired(batch));
      this.logger.log(
        `ลบถาวรถังขยะหมดอายุ: พยายาม ${summary.attempted} สำเร็จ ${summary.purged} ล้มเหลว ${summary.failed.length}`,
      );
      return summary;
    } catch (err) {
      this.logger.error(`งานลบถาวรถังขยะล้มเหลว: ${(err as Error).message}`, (err as Error).stack);
      return null;
    } finally {
      this.running = false;
    }
  }
}
