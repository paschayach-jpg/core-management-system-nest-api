import { Injectable } from '@nestjs/common';
import { hostname } from 'node:os';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { safeStringify } from '../crud-log.sanitizer';
import type { CrudLogEvent, CrudLogSink } from '../crud-log.types';

const INT_MAX = 2_147_483_647;

/**
 * เขียนลงตาราง audit.AuditLog เดิมผ่าน audit.sp_InsertAuditLog (เปิดด้วย CRUD_LOG_AUDIT_DB=true)
 *
 * การแมป: Module=event.module · Action=operation ?? action · TableName=entity · Result 1=สำเร็จ 2=ล้มเหลว
 * หมายเหตุ: event จาก API ใหม่ใช้ชื่อ Module/Action ชุดใหม่ ไม่ใช่ชุดเดียวกับโปรแกรม WinForms เดิม
 * (รายงาน audit เดิมที่กรองตามชื่อ Module เดิมจะไม่เห็นรายการเหล่านี้)
 */
@Injectable()
export class AuditDbCrudLogSink implements CrudLogSink {
  readonly name = 'audit-db';
  private readonly machine = hostname();

  constructor(private readonly sp: SpExecutor) {}

  async write(e: CrudLogEvent): Promise<void> {
    const numericId = typeof e.recordId === 'number' ? e.recordId : Number(e.recordId);
    const idIsInt =
      e.recordId !== undefined && Number.isInteger(numericId) && Math.abs(numericId) <= INT_MAX;

    const extra: Record<string, unknown> = { ...(e.meta ?? {}) };
    if (e.recordId !== undefined && !idIsInt) extra.recordId = e.recordId;
    if (e.requestId) extra.requestId = e.requestId;
    if (e.durationMs !== undefined) extra.durationMs = e.durationMs;
    const newValue =
      e.after !== undefined
        ? safeStringify({ value: e.after, ...extra })
        : Object.keys(extra).length
          ? safeStringify(extra)
          : null;

    await this.sp.call(Sp.audit.insertAuditLog).exec({
      UserID: e.actor.userId ?? 0,
      UserName: (e.actor.userName ?? 'anonymous').slice(0, 100),
      UserRole: e.actor.appRole ?? null,
      Module: e.module.slice(0, 50),
      Action: (e.operation ?? e.action).slice(0, 50),
      TableName: e.entity.slice(0, 100),
      RecordID: idIsInt ? numericId : null,
      OldValue: e.before !== undefined ? (safeStringify(e.before) ?? null) : null,
      NewValue: newValue ?? null,
      IPAddress: e.actor.ip ? e.actor.ip.slice(0, 45) : null,
      MachineName: this.machine.slice(0, 100),
      SessionID: (e.actor.sessionId ?? e.requestId ?? null)?.slice(0, 100) ?? null,
      Result: e.success ? 1 : 2,
      ErrorMessage: e.errorMessage ? e.errorMessage.slice(0, 500) : null,
    });
  }
}
