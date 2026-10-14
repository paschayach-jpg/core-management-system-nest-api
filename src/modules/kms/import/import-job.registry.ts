import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserContext } from '../../../common/interfaces/user-context';
import type { KbLayoutType } from '../codes/kb-layout';
import type { ImportRowCounts, MissingCategorySummary } from './kb-import-pipeline';
import type { KbImportRow } from './kb-import-row';
import type { ImportRunSummary } from './kb-import-writer';
import type { StagedFiles } from './kb-staged-files';

export type ImportJobStatus = 'Validated' | 'Running' | 'Completed' | 'Cancelled' | 'Failed';

export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** เวลาที่งานถูกแตะล่าสุด (ใช้คำนวณอายุที่เก็บ) */
  touchedAt: number;
  ownerUserId: number;
  ownerName: string;
  /** ผู้ใช้ที่ใช้เรียก DMS ตอนนำเข้า (อัปเดตเป็นผู้กด execute) */
  user: UserContext;
  fileName: string;
  templateId: number;
  templateName: string;
  layoutType: KbLayoutType;
  articleType: number;
  requiresAttachment: boolean;
  dmsFolderId: number | null;
  rows: KbImportRow[];
  counts: ImportRowCounts;
  missingCategories: MissingCategorySummary[];
  stage: StagedFiles;
  rejectedFiles: string[];
  progress: { done: number; total: number };
  result: ImportRunSummary | null;
  cancelRequested: boolean;
  errorMessage: string | null;
}

/** อายุที่เก็บงานในหน่วยความจำ */
export const VALIDATED_TTL_MS = 2 * 60 * 60 * 1000; // ตรวจแล้วแต่ยังไม่กดนำเข้า — 2 ชั่วโมง
export const FINISHED_TTL_MS = 24 * 60 * 60 * 1000; // จบแล้ว — 24 ชั่วโมง
export const MAX_JOBS = 30;

/**
 * ทะเบียนงาน import ในหน่วยความจำของโปรเซสเดียว (in-memory job registry)
 *
 * ข้อจำกัด (ตั้งใจ — ดู docs/modules/kms.md):
 *  - restart ทำให้งานหายทั้งหมด (งานที่กำลังรันค้างครึ่งทาง: แถวที่นำเข้าไปแล้วอยู่ใน DB ครบเป็นบทความ ๆ ไป ส่งไฟล์เดิมนำเข้าซ้ำได้เพราะ re-upload = update)
 *  - ไม่รองรับหลาย instance: ต้อง sticky session หรือรัน API 1 instance; จะรองรับหลาย instance ได้ด้วยการเก็บงาน/ผลรายแถวในตาราง DB
 *    (เช่น KMS.t_KBImportJob) + คิวงาน — ต้องมีสคริปต์ SQL ใหม่จึงยังไม่ทำ
 *  - งานเก่าถูกกวาดทิ้งพร้อมไฟล์แนบชั่วคราวเมื่อเกินอายุ (ตรวจตอนสร้าง/ค้นงาน ไม่ใช้ timer)
 */
@Injectable()
export class ImportJobRegistry {
  private readonly jobs = new Map<string, ImportJob>();
  private readonly logger = new Logger(ImportJobRegistry.name);

  newId(): string {
    return randomUUID();
  }

  add(job: ImportJob): void {
    this.sweep();
    this.jobs.set(job.id, job);
  }

  get(id: string): ImportJob | undefined {
    this.sweep();
    return this.jobs.get(id);
  }

  list(): ImportJob[] {
    this.sweep();
    return [...this.jobs.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** งานที่กำลังรันอยู่ (มีได้ทีละงาน กันสองงานแก้บทความชุดเดียวกันพร้อมกัน) */
  running(): ImportJob | undefined {
    return [...this.jobs.values()].find((j) => j.status === 'Running');
  }

  async remove(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    await job.stage.dispose().catch(() => undefined);
  }

  /** กวาดงานที่เกินอายุ และจำกัดจำนวนงานทั้งหมด (ทิ้งงานเก่าที่ไม่ได้รันก่อน) */
  sweep(now = Date.now()): void {
    for (const job of [...this.jobs.values()]) {
      if (job.status === 'Running') continue;
      const ttl = job.status === 'Validated' ? VALIDATED_TTL_MS : FINISHED_TTL_MS;
      if (now - job.touchedAt > ttl) this.drop(job);
    }
    if (this.jobs.size > MAX_JOBS) {
      const evictable = [...this.jobs.values()]
        .filter((j) => j.status !== 'Running')
        .sort((a, b) => a.touchedAt - b.touchedAt);
      for (const job of evictable) {
        if (this.jobs.size <= MAX_JOBS) break;
        this.drop(job);
      }
    }
  }

  private drop(job: ImportJob): void {
    this.jobs.delete(job.id);
    job.stage
      .dispose()
      .catch((e: Error) =>
        this.logger.warn(`ลบไฟล์ชั่วคราวของงาน ${job.id} ไม่สำเร็จ: ${e.message}`),
      );
  }
}
