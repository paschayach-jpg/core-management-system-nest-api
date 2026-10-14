import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import type { AuditQueryDto } from './dto/audit.dto';

export interface AuditLogRow {
  auditId: string;
  auditDate: Date;
  userId: number;
  userName: string;
  userRole: number | null;
  module: string;
  action: string;
  tableName: string | null;
  recordId: number | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  machineName: string | null;
  sessionId: string | null;
  result: number;
  errorMessage: string | null;
}

/** อ่านบันทึก audit.AuditLog (การเขียนทำผ่าน CRUD-log → AuditDbCrudLogSink) — ผู้เรียกต้องเป็น Manager ขึ้นไป (ตั้งที่ controller) */
@Injectable()
export class AuditLogsService extends CrudLoggedService {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'AuditLog';

  constructor(
    crudLog: CrudLogService,
    private readonly sp: SpExecutor,
    @InjectDataSource() private readonly ds: DataSource,
  ) {
    super(crudLog);
  }

  async query(q: AuditQueryDto): Promise<Paginated<AuditLogRow>> {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 7 * 24 * 3600 * 1000);
    const rows = await this.logged(
      { action: 'READ', operation: 'QUERY_AUDIT_LOG', meta: { ...q } },
      () =>
        this.sp.call(Sp.audit.queryAuditLog).rows<Record<string, unknown>>({
          FromDate: from,
          ToDate: to,
          UserID: q.userId ?? null,
          UserName: q.userName ?? null,
          Module: q.module ?? null,
          Action: q.action ?? null,
          Result: q.result ?? null,
          PageNumber: q.page,
          PageSize: q.pageSize,
        }),
    );
    const total = rows.length > 0 ? Number(rows[0].TotalCount) : 0;
    const items = rows.map((r) => {
      const { TotalCount: _t, ...rest } = r;
      return camelizeKeys<AuditLogRow>(rest);
    });
    return paginated(items, total, q);
  }

  /** ประวัติของ workflow instance + step instance ของมัน (เรียงเก่าสุดก่อน) */
  async byWorkflowInstance(instanceId: number): Promise<AuditLogRow[]> {
    const rows: Record<string, unknown>[] = await this.ds.query(
      `SELECT AuditID, AuditDate, UserID, UserName, UserRole, Module, Action, TableName, RecordID,
              OldValue, NewValue, IPAddress, MachineName, SessionID, Result, ErrorMessage
         FROM audit.AuditLog
        WHERE (TableName = 'WorkflowInstance' AND RecordID = @0)
           OR (TableName = 'WorkflowStepInstance' AND RecordID IN
                 (SELECT WFStepInstanceId FROM WFE.t_WFStepInstance WHERE WFInstanceId = @0))
        ORDER BY AuditDate ASC`,
      [instanceId],
    );
    return rows.map((r) => camelizeKeys<AuditLogRow>(r));
  }
}
