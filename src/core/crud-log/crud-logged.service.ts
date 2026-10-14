import { HttpException } from '@nestjs/common';
import { SpExecutionError } from '../../database/sp/sp-execution.error';
import { CrudLogService } from './crud-log.service';
import type { CrudAction, CrudModuleName } from './crud-log.types';

export interface LoggedSpec {
  /** ชื่อ entity (ถ้าไม่ระบุใช้ logEntity ของ service) */
  entity?: string;
  action: CrudAction;
  /** ชื่อการกระทำเชิงธุรกิจ เช่น 'MOVE_FOLDER' */
  operation?: string;
  recordId?: string | number;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  /**
   * ดึงค่า "ก่อนแก้" — รันก่อน work() และรันเฉพาะเมื่อ action นี้เปิดเก็บ log อยู่
   * (ไม่เสีย query เพิ่มเมื่อ CRUD_LOG_LEVEL=off)
   */
  captureBefore?: () => Promise<unknown>;
}

/**
 * คลาสแม่ของ **ทุก service** — ทำให้ทุก service รองรับ CRUD-log ในตัว
 *
 * ```ts
 * @Injectable()
 * export class FolderService extends CrudLoggedService {
 *   protected readonly logModule = 'DMS';
 *   protected readonly logEntity = 'Folder';
 *   constructor(crudLog: CrudLogService, ...) { super(crudLog); }
 *
 *   rename(id: number, name: string) {
 *     return this.logged({ action: 'UPDATE', recordId: id, captureBefore: () => this.repo.findOneBy({ folderId: id }) },
 *       async () => { ... }, (r) => ({ after: r }));
 *   }
 * }
 * ```
 * มี test/architecture/crud-log.spec.ts ตรวจว่า `*.service.ts` ใน src/modules ทุกไฟล์ extend คลาสนี้
 */
export abstract class CrudLoggedService {
  protected abstract readonly logModule: CrudModuleName;
  protected abstract readonly logEntity: string;

  constructor(protected readonly crudLog: CrudLogService) {}

  /**
   * รัน work() แล้วบันทึก event (สำเร็จ/ล้มเหลว + ระยะเวลา) — error ถูกโยนต่อโดยไม่เปลี่ยน
   * @param describe เติม recordId/after จากผลลัพธ์ เช่น id ที่เพิ่งสร้าง
   */
  protected async logged<T>(
    spec: LoggedSpec,
    work: () => Promise<T>,
    describe?: (
      result: T,
    ) => Partial<Pick<LoggedSpec, 'recordId' | 'after' | 'meta' | 'operation'>>,
  ): Promise<T> {
    const enabled = this.crudLog.isEnabled(spec.action);
    if (!enabled) return work();

    let before = spec.before;
    if (before === undefined && spec.captureBefore) {
      try {
        before = await spec.captureBefore();
      } catch {
        before = undefined; // ดึงค่าก่อนแก้ไม่ได้ ต้องไม่ทำให้งานหลักล้ม
      }
    }

    const started = Date.now();
    try {
      const result = await work();
      const extra = describe?.(result) ?? {};
      this.crudLog.record({
        module: this.logModule,
        entity: spec.entity ?? this.logEntity,
        action: spec.action,
        operation: extra.operation ?? spec.operation,
        recordId: extra.recordId ?? spec.recordId,
        before,
        after: extra.after ?? spec.after,
        meta: { ...spec.meta, ...extra.meta },
        success: true,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      this.crudLog.record({
        module: this.logModule,
        entity: spec.entity ?? this.logEntity,
        action: spec.action,
        operation: spec.operation,
        recordId: spec.recordId,
        before,
        after: spec.after,
        meta: spec.meta,
        success: false,
        errorCode: errorCodeOf(err),
        errorMessage: (err as Error)?.message ?? String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  /** บันทึก event โดยตรง (กรณีผลลัพธ์ไม่ได้มาจากการรันครอบ work เช่นงาน batch ที่สรุปท้ายสุด) */
  protected logEvent(
    spec: Omit<LoggedSpec, 'captureBefore'> & { success?: boolean; error?: unknown },
  ): void {
    this.crudLog.record({
      module: this.logModule,
      entity: spec.entity ?? this.logEntity,
      action: spec.action,
      operation: spec.operation,
      recordId: spec.recordId,
      before: spec.before,
      after: spec.after,
      meta: spec.meta,
      success: spec.success ?? spec.error === undefined,
      errorCode: spec.error ? errorCodeOf(spec.error) : undefined,
      errorMessage: spec.error ? ((spec.error as Error)?.message ?? String(spec.error)) : undefined,
    });
  }
}

function errorCodeOf(err: unknown): string {
  if (err instanceof HttpException) return `HTTP_${err.getStatus()}`;
  if (err instanceof SpExecutionError)
    return err.sqlNumber !== undefined ? `SQL_${err.sqlNumber}` : 'SP_ERROR';
  return (err as Error)?.name ?? 'ERROR';
}
