import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { camelizeKeys } from '../../../common/utils/camelize';
import { LIKE_ESCAPE, likeContains } from '../../../common/utils/query.util';
import { OPEN_STEP_STATUSES } from '../common/wfe.constants';

// ───────────────────────── แถวที่ store คืน ─────────────────────────

export interface InstanceRow {
  wfInstanceId: number;
  wfDefinitionId: number;
  templateVersion: number;
  status: number;
  initiatedBy: string;
  initiatedDate: Date;
  currentStepId: number | null;
  completedDate: Date | null;
  inputParameters: string | null;
  isDeleted: boolean;
}

/** step instance — `wfStepInstanceId` คือ IDENTITY (WFStepInstanceId) ซึ่งเป็น "รหัส step instance" ของ API ทุกจุด */
export interface StepInstanceRow {
  wfStepInstanceId: number;
  wfInstanceId: number;
  wfStepId: number;
  status: number;
  assignedTo: string | null;
  assignedDate: Date | null;
  startedDate: Date | null;
  completedDate: Date | null;
  completedBy: string | null;
  outputData: string | null;
  remarks: string | null;
  slaDeadline: Date | null;
  slaStatus: number | null;
  // จาก join s_WFStep (เฉพาะ listStepInstances)
  stepName?: string | null;
  stepType?: number | null;
  stepSequence?: number | null;
}

export interface InstanceListRow extends InstanceRow {
  templateName: string | null;
  currentStepName: string | null;
  totalStepCount: number;
  completedStepCount: number;
}

export interface TaskRow extends StepInstanceRow {
  wfDefinitionId: number;
  instanceStatus: number;
  initiatedBy: string;
  templateName: string | null;
  stepDescription: string | null;
  allowDelegation: boolean;
  maxDelegationDepth: number;
  stepSequence: number | null;
  totalSteps: number;
}

export interface InstanceListFilter {
  definitionId?: number;
  status?: number;
  initiatedBy?: string;
  fromDate?: Date;
  toDate?: Date;
  q?: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  /** ผู้ที่ดูรายการ — ถ้าไม่ใช่ Manager ขึ้นไปจะเห็นเฉพาะ instance ที่ตนเริ่มหรือมี step ของตน */
  viewer: { userName: string; seesAll: boolean };
}

export interface InstancePatch {
  status?: number;
  currentStepId?: number | null;
  completedDate?: Date | null;
}

export interface StepInstancePatch {
  status?: number;
  assignedTo?: string | null;
  assignedDate?: Date | null;
  startedDate?: Date | null;
  completedDate?: Date | null;
  completedBy?: string | null;
  outputData?: string | null;
  remarks?: string | null;
  slaDeadline?: Date | null;
  slaStatus?: number | null;
}

export const INSTANCE_SORT: Record<string, string> = {
  initiatedDate: 'wi.InitiatedDate',
  completedDate: 'wi.CompletedDate',
  status: 'wi.Status',
  workflowInstanceId: 'wi.WFInstanceId',
  templateName: 'wd.WFName',
  initiatedBy: 'wi.InitiatedBy',
};

const STEP_COLUMNS: Record<keyof StepInstancePatch, string> = {
  status: 'Status',
  assignedTo: 'AssignedTo',
  assignedDate: 'AssignedDate',
  startedDate: 'StartedDate',
  completedDate: 'CompletedDate',
  completedBy: 'CompletedBy',
  outputData: 'OutputData',
  remarks: 'Remarks',
  slaDeadline: 'SLADeadline',
  slaStatus: 'SLAStatus',
};

const INSTANCE_COLUMNS: Record<keyof InstancePatch, string> = {
  status: 'Status',
  currentStepId: 'CurrentStepId',
  completedDate: 'CompletedDate',
};

const OPEN = OPEN_STEP_STATUSES.join(',');

const STEP_SELECT = `si.WFStepInstanceId, si.WFInstanceId, si.WFStepId, si.Status, si.AssignedTo, si.AssignedDate,
  si.StartedDate, si.CompletedDate, si.CompletedBy, si.OutputData, si.Remarks, si.SLADeadline, si.SLAStatus`;

/** รัน DML แล้วคืนจำนวนแถวที่ถูกแก้ (TypeORM.query ไม่คืน rowsAffected จึงต่อ SELECT @@ROWCOUNT ในแบตช์เดียวกัน) */
async function execAffected(m: EntityManager, sql: string, params: unknown[]): Promise<number> {
  const rows = (await m.query(`${sql}; SELECT @@ROWCOUNT AS n;`, params)) as { n: number }[];
  return Number(rows?.[0]?.n ?? 0);
}

/**
 * SQL ของ instance / step instance (WFE.t_WFInstance, t_WFStepInstance)
 * **การ INSERT step instance/instance ต้องผ่าน SP เท่านั้น** (sp_CreateWFInstance, sp_CreateWFStepInstance) — store นี้จึงไม่มี insert
 * ทุกเมธอดรับ EntityManager เพื่อรันใน transaction เดียวกับผู้เรียก
 */
@Injectable()
export class InstanceStore {
  // ── instance ────────────────────────────────────────────────

  /** @param forUpdate true = ล็อกแถว (UPDLOCK) ไว้จนจบ transaction ผู้เรียกต้องอยู่ใน transaction */
  async findInstance(m: EntityManager, id: number, forUpdate = false): Promise<InstanceRow | null> {
    const rows = (await m.query(
      `SELECT WFInstanceId, WFDefinitionId, TemplateVersion, Status, InitiatedBy, InitiatedDate,
              CurrentStepId, CompletedDate, InputParameters, IsDeleted
         FROM WFE.t_WFInstance ${forUpdate ? 'WITH (UPDLOCK, ROWLOCK)' : ''}
        WHERE WFInstanceId = @0 AND IsDeleted = 0`,
      [id],
    )) as Record<string, unknown>[];
    return rows[0] ? camelizeKeys<InstanceRow>(rows[0]) : null;
  }

  updateInstance(m: EntityManager, id: number, patch: InstancePatch): Promise<number> {
    const params: unknown[] = [];
    const sets: string[] = [];
    for (const key of Object.keys(INSTANCE_COLUMNS) as (keyof InstancePatch)[]) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${INSTANCE_COLUMNS[key]} = @${params.length - 1}`);
    }
    if (sets.length === 0) return Promise.resolve(0);
    params.push(id);
    return execAffected(
      m,
      `UPDATE WFE.t_WFInstance SET ${sets.join(', ')} WHERE WFInstanceId = @${params.length - 1} AND IsDeleted = 0`,
      params,
    );
  }

  softDeleteInstance(m: EntityManager, id: number): Promise<number> {
    return execAffected(
      m,
      'UPDATE WFE.t_WFInstance SET IsDeleted = 1, DeletedDate = GETUTCDATE() WHERE WFInstanceId = @0 AND IsDeleted = 0',
      [id],
    );
  }

  /** ชื่อผู้ใช้ที่เคยถูกมอบหมาย step ใน instance นี้ (ใช้ตรวจสิทธิ์ดู) */
  async participants(m: EntityManager, instanceId: number): Promise<string[]> {
    const rows = (await m.query(
      `SELECT DISTINCT AssignedTo FROM WFE.t_WFStepInstance
        WHERE WFInstanceId = @0 AND IsDeleted = 0 AND AssignedTo IS NOT NULL`,
      [instanceId],
    )) as { AssignedTo: string }[];
    return rows.map((r) => r.AssignedTo);
  }

  async listInstances(
    m: EntityManager,
    f: InstanceListFilter,
  ): Promise<{ rows: InstanceListRow[]; total: number }> {
    const where: string[] = ['wi.IsDeleted = 0'];
    const params: unknown[] = [];
    const p = (v: unknown) => `@${params.push(v) - 1}`;

    if (f.definitionId !== undefined) where.push(`wi.WFDefinitionId = ${p(f.definitionId)}`);
    if (f.status !== undefined) where.push(`wi.Status = ${p(f.status)}`);
    if (f.initiatedBy) where.push(`wi.InitiatedBy = ${p(f.initiatedBy)}`);
    if (f.fromDate) where.push(`wi.InitiatedDate >= ${p(f.fromDate)}`);
    if (f.toDate) where.push(`wi.InitiatedDate <= ${p(f.toDate)}`);
    if (f.q?.trim()) {
      const like = p(likeContains(f.q.trim()));
      where.push(
        `(wd.WFName LIKE ${like} ${LIKE_ESCAPE} OR wi.InitiatedBy LIKE ${like} ${LIKE_ESCAPE})`,
      );
    }
    if (!f.viewer.seesAll) {
      const me = p(f.viewer.userName);
      where.push(
        `(wi.InitiatedBy = ${me} OR EXISTS (SELECT 1 FROM WFE.t_WFStepInstance v
            WHERE v.WFInstanceId = wi.WFInstanceId AND v.IsDeleted = 0 AND v.AssignedTo = ${me}))`,
      );
    }

    // sortBy ที่ไม่อยู่ใน whitelist ถือว่าไม่ได้เลือกเรียง → ค่าเริ่มต้น "ใหม่สุดก่อน"
    const custom = !!f.sortBy && Object.hasOwn(INSTANCE_SORT, f.sortBy);
    const sortCol = custom ? INSTANCE_SORT[f.sortBy as string] : 'wi.InitiatedDate';
    const dir = custom ? (f.sortDir === 'desc' ? 'DESC' : 'ASC') : 'DESC';
    const offset = p((f.page - 1) * f.pageSize);
    const take = p(f.pageSize);

    const raw = (await m.query(
      `SELECT COUNT(*) OVER () AS Total,
              wi.WFInstanceId, wi.WFDefinitionId, wi.TemplateVersion, wi.Status, wi.InitiatedBy, wi.InitiatedDate,
              wi.CurrentStepId, wi.CompletedDate, wi.InputParameters, wi.IsDeleted,
              wd.WFName AS TemplateName, cs.StepName AS CurrentStepName,
              (SELECT COUNT(*) FROM WFE.s_WFStep s WHERE s.WFDefinitionId = wi.WFDefinitionId AND s.IsDeleted = 0) AS TotalStepCount,
              (SELECT COUNT(*) FROM WFE.t_WFStepInstance x WHERE x.WFInstanceId = wi.WFInstanceId AND x.IsDeleted = 0 AND x.Status = 3) AS CompletedStepCount
         FROM WFE.t_WFInstance wi
         LEFT JOIN WFE.s_WFDefinition wd ON wd.WFDefinitionId = wi.WFDefinitionId
         LEFT JOIN WFE.s_WFStep cs ON cs.WFStepId = wi.CurrentStepId
        WHERE ${where.join(' AND ')}
        ORDER BY ${sortCol} ${dir}, wi.WFInstanceId DESC
       OFFSET ${offset} ROWS FETCH NEXT ${take} ROWS ONLY`,
      params,
    )) as Record<string, unknown>[];
    const total = raw.length ? Number(raw[0].Total) : 0;
    return {
      total,
      rows: raw.map((r) => {
        const { Total: _t, ...rest } = r;
        return camelizeKeys<InstanceListRow>(rest);
      }),
    };
  }

  // ── step instance ───────────────────────────────────────────

  async findStepInstance(
    m: EntityManager,
    id: number,
    forUpdate = false,
  ): Promise<StepInstanceRow | null> {
    const rows = (await m.query(
      `SELECT ${STEP_SELECT}
         FROM WFE.t_WFStepInstance si ${forUpdate ? 'WITH (UPDLOCK, ROWLOCK)' : ''}
        WHERE si.WFStepInstanceId = @0 AND si.IsDeleted = 0`,
      [id],
    )) as Record<string, unknown>[];
    return rows[0] ? camelizeKeys<StepInstanceRow>(rows[0]) : null;
  }

  /** step instance ทั้งหมดของ instance เรียงแบบเดิม: ลำดับ step ก่อน แล้วเวลามอบหมาย (พร้อมชื่อ/ชนิด step) */
  async listStepInstances(m: EntityManager, instanceId: number): Promise<StepInstanceRow[]> {
    const rows = (await m.query(
      `SELECT ${STEP_SELECT}, st.StepName, st.StepType, st.SequenceNumber AS StepSequence
         FROM WFE.t_WFStepInstance si
         LEFT JOIN WFE.s_WFStep st ON st.WFStepId = si.WFStepId
        WHERE si.WFInstanceId = @0 AND si.IsDeleted = 0
        ORDER BY COALESCE(st.SequenceNumber, 999) ASC, si.AssignedDate ASC, si.WFStepInstanceId ASC`,
      [instanceId],
    )) as Record<string, unknown>[];
    return rows.map((r) => camelizeKeys<StepInstanceRow>(r));
  }

  updateStepInstance(m: EntityManager, id: number, patch: StepInstancePatch): Promise<number> {
    const params: unknown[] = [];
    const sets: string[] = [];
    for (const key of Object.keys(STEP_COLUMNS) as (keyof StepInstancePatch)[]) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${STEP_COLUMNS[key]} = @${params.length - 1}`);
    }
    if (sets.length === 0) return Promise.resolve(0);
    params.push(id);
    return execAffected(
      m,
      `UPDATE WFE.t_WFStepInstance SET ${sets.join(', ')} WHERE WFStepInstanceId = @${params.length - 1} AND IsDeleted = 0`,
      params,
    );
  }

  /**
   * ข้อมูลย่อของงานของผู้ใช้สำหรับสรุป KPI: งานที่ยังต้องทำของ workflow ที่กำลังดำเนินการ + งานที่เสร็จตั้งแต่ `completedSince`
   * (ผู้เรียกคำนวณสถานะ SLA สดด้วย sla-calculator)
   */
  async taskSlaRows(
    m: EntityManager,
    userName: string,
    completedSince: Date,
  ): Promise<
    {
      status: number;
      assignedDate: Date | null;
      slaDeadline: Date | null;
      completedDate: Date | null;
    }[]
  > {
    const rows = (await m.query(
      `SELECT si.Status, si.AssignedDate, si.SLADeadline, si.CompletedDate
         FROM WFE.t_WFStepInstance si
         JOIN WFE.t_WFInstance wi ON wi.WFInstanceId = si.WFInstanceId AND wi.IsDeleted = 0
        WHERE si.AssignedTo = @0 AND si.IsDeleted = 0
          AND ((si.Status IN (${OPEN}) AND wi.Status IN (0,1,2))
               OR (si.Status = 3 AND si.CompletedDate >= @1))`,
      [userName, completedSince],
    )) as Record<string, unknown>[];
    return rows.map((r) => {
      const c = camelizeKeys<Record<string, unknown>>(r);
      return {
        status: Number(c.status),
        assignedDate: (c.assignedDate as Date | null) ?? null,
        slaDeadline: (c.slaDeadline as Date | null) ?? null,
        completedDate: (c.completedDate as Date | null) ?? null,
      };
    });
  }

  /**
   * งานของฉัน (แบ่งหน้า) — พอร์ตจาก GetMyTasks: step ที่ Pending/InProgress/Completed ของผู้ใช้ (เพิ่ม Delegated เพราะระบบเดิมทำให้
   * งานที่ถูกมอบหมายหายจากทุกคน) เหลือหนึ่งแถวต่อ instance โดยเลือกแถวที่ต้องทำก่อน (InProgress > Pending/Delegated > Completed)
   * แล้วเรียงงานที่ยังไม่เสร็จก่อน ตามกำหนดส่ง
   */
  async myTasks(
    m: EntityManager,
    opts: { userName: string; onlyOpen: boolean; page: number; pageSize: number },
  ): Promise<{ rows: TaskRow[]; total: number }> {
    const raw = (await m.query(
      `WITH t AS (
         SELECT ${STEP_SELECT},
                wi.WFDefinitionId, wi.Status AS InstanceStatus, wi.InitiatedBy,
                wd.WFName AS TemplateName, st.StepName, st.StepType, st.Description AS StepDescription,
                st.AllowDelegation, st.MaxDelegationDepth, st.SequenceNumber AS StepSequence,
                (SELECT COUNT(*) FROM WFE.s_WFStep s WHERE s.WFDefinitionId = wi.WFDefinitionId AND s.IsDeleted = 0) AS TotalSteps,
                ROW_NUMBER() OVER (
                  PARTITION BY si.WFInstanceId
                  ORDER BY CASE si.Status WHEN 2 THEN 0 WHEN 1 THEN 1 WHEN 5 THEN 1 WHEN 3 THEN 3 ELSE 4 END,
                           si.SLADeadline ASC, si.WFStepInstanceId ASC) AS rn
           FROM WFE.t_WFStepInstance si
           JOIN WFE.t_WFInstance wi ON wi.WFInstanceId = si.WFInstanceId AND wi.IsDeleted = 0
           LEFT JOIN WFE.s_WFStep st ON st.WFStepId = si.WFStepId
           LEFT JOIN WFE.s_WFDefinition wd ON wd.WFDefinitionId = wi.WFDefinitionId
          WHERE si.AssignedTo = @0 AND si.IsDeleted = 0
            AND si.Status IN (${opts.onlyOpen ? OPEN : `${OPEN},3`})
       )
       SELECT COUNT(*) OVER () AS Total, t.*
         FROM t WHERE rn = 1
        ORDER BY CASE WHEN Status = 3 THEN 1 ELSE 0 END, SLADeadline ASC, WFStepInstanceId ASC
       OFFSET @1 ROWS FETCH NEXT @2 ROWS ONLY`,
      [opts.userName, (opts.page - 1) * opts.pageSize, opts.pageSize],
    )) as Record<string, unknown>[];
    const total = raw.length ? Number(raw[0].Total) : 0;
    return {
      total,
      rows: raw.map((r) => {
        const { Total: _t, rn: _rn, ...rest } = r;
        return camelizeKeys<TaskRow>(rest);
      }),
    };
  }
}
