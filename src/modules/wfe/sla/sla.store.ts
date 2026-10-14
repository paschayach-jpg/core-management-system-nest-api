import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { camelizeKeys } from '../../../common/utils/camelize';
import { LIKE_ESCAPE, likeContains } from '../../../common/utils/query.util';

export interface ReportFilter {
  definitionId?: number;
  fromDate?: Date;
  toDate?: Date;
}

export interface OpenSlaRow {
  wfStepInstanceId: number;
  wfInstanceId: number;
  wfStepId: number;
  status: number;
  assignedTo: string | null;
  assignedDate: Date | null;
  slaDeadline: Date | null;
  slaStatus: number | null;
  initiatedBy: string;
  templateName: string | null;
  stepName: string | null;
}

export interface OverdueRow {
  wfStepInstanceId: number;
  wfInstanceId: number;
  templateName: string | null;
  stepName: string | null;
  assignedTo: string | null;
  initiatedBy: string | null;
  assignedDate: Date | null;
  slaDeadline: Date;
}

export interface TemplateSlaRow {
  wfDefinitionId: number;
  templateName: string;
  total: number;
  onTime: number;
  atRisk: number;
  overdue: number;
}

export interface TrendRow {
  yr: number;
  wk: number;
  total: number;
  onTime: number;
}

export interface CycleRow {
  label: string;
  sortKey: number;
  cnt: number;
}

export interface JobLock {
  release(): Promise<void>;
}

const JOB_LOCK_RESOURCE = 'WFE_SLA_JOB';
const IN_CHUNK = 500;

/** SQL ของรายงาน SLA + งานอัปเดตสถานะ SLA (WFE.t_WFStepInstance) */
@Injectable()
export class SlaStore {
  /** SLA ต่อ template — พอร์ตจาก WFReportRepository.GetSLAByTemplate */
  async byTemplate(m: EntityManager, f: ReportFilter): Promise<TemplateSlaRow[]> {
    const rows = (await m.query(
      `SELECT wd.WFDefinitionId, wd.WFName AS TemplateName, COUNT(*) AS Total,
              SUM(CASE WHEN wsi.SLAStatus = 1 THEN 1 ELSE 0 END) AS OnTime,
              SUM(CASE WHEN wsi.SLAStatus = 2 THEN 1 ELSE 0 END) AS AtRisk,
              SUM(CASE WHEN wsi.SLAStatus = 3 THEN 1 ELSE 0 END) AS Overdue
         FROM WFE.s_WFDefinition wd
         JOIN WFE.t_WFInstance wi ON wi.WFDefinitionId = wd.WFDefinitionId AND wi.IsDeleted = 0
         JOIN WFE.t_WFStepInstance wsi ON wsi.WFInstanceId = wi.WFInstanceId AND wsi.IsDeleted = 0
        WHERE wd.IsDeleted = 0
          AND (@0 IS NULL OR wd.WFDefinitionId = @0)
          AND (@1 IS NULL OR wsi.AssignedDate >= @1)
          AND (@2 IS NULL OR wsi.AssignedDate <= @2)
        GROUP BY wd.WFDefinitionId, wd.WFName
        ORDER BY Total DESC`,
      [f.definitionId ?? null, f.fromDate ?? null, f.toDate ?? null],
    )) as Record<string, unknown>[];
    return rows.map((r) => {
      const c = camelizeKeys<TemplateSlaRow>(r);
      return {
        wfDefinitionId: Number(c.wfDefinitionId),
        templateName: String(c.templateName ?? ''),
        total: Number(c.total ?? 0),
        onTime: Number(c.onTime ?? 0),
        atRisk: Number(c.atRisk ?? 0),
        overdue: Number(c.overdue ?? 0),
      };
    });
  }

  /** แนวโน้มรายสัปดาห์ — พอร์ตจาก GetSLAWeeklyTrend (เทียบกับ GETDATE() เพราะ AssignedDate เป็นเวลาท้องถิ่น) */
  async weeklyTrend(m: EntityManager, weeks: number): Promise<TrendRow[]> {
    const rows = (await m.query(
      `SELECT YEAR(AssignedDate) AS yr, DATEPART(WEEK, AssignedDate) AS wk, COUNT(*) AS total,
              SUM(CASE WHEN SLAStatus = 1 THEN 1 ELSE 0 END) AS onTime
         FROM WFE.t_WFStepInstance
        WHERE IsDeleted = 0 AND AssignedDate >= DATEADD(WEEK, -@0, GETDATE())
        GROUP BY YEAR(AssignedDate), DATEPART(WEEK, AssignedDate)
        ORDER BY yr, wk`,
      [weeks],
    )) as Record<string, unknown>[];
    return rows.map((r) => ({
      yr: Number(r.yr),
      wk: Number(r.wk),
      total: Number(r.total ?? 0),
      onTime: Number(r.onTime ?? 0),
    }));
  }

  /** กระจายระยะเวลาจนจบ workflow (วัน) — พอร์ตจาก GetCycleTimeDistribution */
  async cycleTime(m: EntityManager, f: ReportFilter): Promise<CycleRow[]> {
    const rows = (await m.query(
      `SELECT BucketLabel AS Label, BucketOrder AS SortKey, COUNT(*) AS Cnt
         FROM (
           SELECT CASE WHEN ct < 1 THEN N'0–1' WHEN ct < 2 THEN N'1–2' WHEN ct < 3 THEN N'2–3'
                       WHEN ct < 4 THEN N'3–4' WHEN ct < 5 THEN N'4–5' WHEN ct < 7 THEN N'5–7'
                       WHEN ct < 10 THEN N'7–10' ELSE N'10+' END AS BucketLabel,
                  CASE WHEN ct < 1 THEN 0 WHEN ct < 2 THEN 1 WHEN ct < 3 THEN 2 WHEN ct < 4 THEN 3
                       WHEN ct < 5 THEN 4 WHEN ct < 7 THEN 5 WHEN ct < 10 THEN 6 ELSE 7 END AS BucketOrder
             FROM (
               SELECT DATEDIFF(MINUTE, wi.InitiatedDate, wi.CompletedDate) / 1440.0 AS ct
                 FROM WFE.t_WFInstance wi
                WHERE wi.IsDeleted = 0 AND wi.Status = 3 AND wi.CompletedDate IS NOT NULL
                  AND (@0 IS NULL OR wi.WFDefinitionId = @0)
                  AND (@1 IS NULL OR wi.InitiatedDate >= @1)
                  AND (@2 IS NULL OR wi.InitiatedDate <= @2)
             ) t WHERE ct >= 0
         ) b
        GROUP BY BucketLabel, BucketOrder
        ORDER BY BucketOrder`,
      [f.definitionId ?? null, f.fromDate ?? null, f.toDate ?? null],
    )) as Record<string, unknown>[];
    return rows.map((r) => ({
      label: String(r.Label),
      sortKey: Number(r.SortKey),
      cnt: Number(r.Cnt ?? 0),
    }));
  }

  /** รายการงานที่เลยกำหนดแบบสด (step ที่ยังเปิดอยู่ของ workflow ที่กำลังทำ, deadline < now) เรียงเลยนานสุดก่อน */
  async overdue(
    m: EntityManager,
    f: ReportFilter & { q?: string; now: Date; page: number; pageSize: number },
  ): Promise<{ rows: OverdueRow[]; total: number }> {
    const params: unknown[] = [f.now];
    const p = (v: unknown) => `@${params.push(v) - 1}`;
    const where = [
      'si.IsDeleted = 0',
      'si.Status IN (1,2,5)',
      'si.SLADeadline IS NOT NULL',
      'si.SLADeadline < @0',
      'wi.Status IN (0,1,2)',
    ];
    if (f.definitionId !== undefined) where.push(`wi.WFDefinitionId = ${p(f.definitionId)}`);
    if (f.fromDate) where.push(`si.AssignedDate >= ${p(f.fromDate)}`);
    if (f.toDate) where.push(`si.AssignedDate <= ${p(f.toDate)}`);
    if (f.q?.trim()) {
      const like = p(likeContains(f.q.trim()));
      where.push(
        `(si.AssignedTo LIKE ${like} ${LIKE_ESCAPE} OR wd.WFName LIKE ${like} ${LIKE_ESCAPE} OR st.StepName LIKE ${like} ${LIKE_ESCAPE})`,
      );
    }
    const offset = p((f.page - 1) * f.pageSize);
    const take = p(f.pageSize);
    const raw = (await m.query(
      `SELECT COUNT(*) OVER () AS Total, si.WFStepInstanceId, si.WFInstanceId, wd.WFName AS TemplateName,
              st.StepName, si.AssignedTo, wi.InitiatedBy, si.AssignedDate, si.SLADeadline
         FROM WFE.t_WFStepInstance si
         JOIN WFE.t_WFInstance wi ON wi.WFInstanceId = si.WFInstanceId AND wi.IsDeleted = 0
         LEFT JOIN WFE.s_WFDefinition wd ON wd.WFDefinitionId = wi.WFDefinitionId
         LEFT JOIN WFE.s_WFStep st ON st.WFStepId = si.WFStepId
        WHERE ${where.join(' AND ')}
        ORDER BY si.SLADeadline ASC, si.WFStepInstanceId ASC
       OFFSET ${offset} ROWS FETCH NEXT ${take} ROWS ONLY`,
      params,
    )) as Record<string, unknown>[];
    const total = raw.length ? Number(raw[0].Total) : 0;
    return {
      total,
      rows: raw.map((r) => {
        const { Total: _t, ...rest } = r;
        return camelizeKeys<OverdueRow>(rest);
      }),
    };
  }

  /** step ที่ยังเปิดอยู่ของ workflow ที่กำลังทำ (ไม่รวมที่ถูกระงับ) และมี deadline — แบ่งอ่านทีละชุดด้วย keyset */
  async openSlaRows(m: EntityManager, afterId: number, limit: number): Promise<OpenSlaRow[]> {
    const raw = (await m.query(
      `SELECT TOP (@1) si.WFStepInstanceId, si.WFInstanceId, si.WFStepId, si.Status, si.AssignedTo, si.AssignedDate,
              si.SLADeadline, si.SLAStatus, wi.InitiatedBy, wd.WFName AS TemplateName, st.StepName
         FROM WFE.t_WFStepInstance si
         JOIN WFE.t_WFInstance wi ON wi.WFInstanceId = si.WFInstanceId AND wi.IsDeleted = 0 AND wi.Status IN (0,1,2)
         LEFT JOIN WFE.s_WFDefinition wd ON wd.WFDefinitionId = wi.WFDefinitionId
         LEFT JOIN WFE.s_WFStep st ON st.WFStepId = si.WFStepId
        WHERE si.IsDeleted = 0 AND si.Status IN (1,2,5) AND si.SLADeadline IS NOT NULL
          AND si.WFStepInstanceId > @0
        ORDER BY si.WFStepInstanceId ASC`,
      [afterId, limit],
    )) as Record<string, unknown>[];
    return raw.map((r) => camelizeKeys<OpenSlaRow>(r));
  }

  /** ตั้ง SLAStatus ให้ step instance หลายรายการพร้อมกัน */
  async setSlaStatus(m: EntityManager, ids: readonly number[], status: number): Promise<void> {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const part = ids.slice(i, i + IN_CHUNK);
      const marks = part.map((_, idx) => `@${idx + 1}`).join(',');
      await m.query(
        `UPDATE WFE.t_WFStepInstance SET SLAStatus = @0 WHERE WFStepInstanceId IN (${marks}) AND IsDeleted = 0`,
        [status, ...part],
      );
    }
  }

  /**
   * ล็อกกันงาน SLA ซ้ำเมื่อรันหลาย instance (sp_getapplock แบบ session) — คืน null ถ้ามีคนถืออยู่
   * ล็อกอยู่กับ connection เฉพาะที่เปิดไว้จนกว่าจะ release()
   */
  async tryAcquireJobLock(ds: DataSource): Promise<JobLock | null> {
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      const rows = (await qr.query(
        `DECLARE @rc INT;
         EXEC @rc = sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0;
         SELECT @rc AS rc;`,
        [JOB_LOCK_RESOURCE],
      )) as { rc: number }[];
      if (Number(rows?.[0]?.rc ?? -1) < 0) {
        await qr.release();
        return null;
      }
    } catch (err) {
      await qr.release();
      throw err;
    }
    return {
      release: async () => {
        try {
          await qr.query(`EXEC sp_releaseapplock @Resource = @0, @LockOwner = 'Session'`, [
            JOB_LOCK_RESOURCE,
          ]);
        } finally {
          await qr.release();
        }
      },
    };
  }
}
