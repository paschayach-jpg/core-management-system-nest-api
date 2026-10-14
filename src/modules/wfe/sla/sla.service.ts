import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { SlaStatus } from '../../../common/constants/enums';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { SystemConfigService } from '../../shared/system-config/system-config.service';
import { WFE_ENTITY, WFE_OP } from '../common/wfe.constants';
import { sameUser } from '../common/wfe-access';
import {
  noticeText,
  WorkflowNotificationsService,
  type WfeNotice,
} from '../common/wfe-notifications.service';
import { loadWfeSettings } from '../common/wfe-settings';
import type {
  SlaComplianceReportDto,
  SlaCycleBucketDto,
  SlaOverdueQueryDto,
  SlaOverdueRowDto,
  SlaRefreshResultDto,
  SlaReportQueryDto,
  SlaSummaryDto,
  SlaTaskDistributionQueryDto,
  SlaTemplateRowDto,
  SlaTrendPointDto,
  SlaUserRowDto,
} from './dto/sla.dto';
import { diffSlaStatus, hoursOverdue, percentOf } from './sla-calculator';
import { SlaStore, type OpenSlaRow, type ReportFilter } from './sla.store';

const BATCH = 1000;
/** ยอมให้รอบถัดไปเริ่มก่อนครบช่วงได้เล็กน้อย (cron ยิงทุกต้นนาที) */
const INTERVAL_SLACK_MS = 5_000;

/**
 * SLA ของ workflow — รายงาน (ภาพรวม/ตาม template/แนวโน้ม/เลยกำหนดแบบสด) + งานเบื้องหลังอัปเดต SLAStatus และ escalation
 *
 * งานเบื้องหลัง (`@Cron`) **ปิดเป็นค่าเริ่มต้น** — เปิดด้วย `WorkflowEscalationEnabled = true` ใน dbo.SystemConfig
 * (ระบบเดิม WFESLABackgroundJob ไม่เคยถูกเรียก) · ทำเท่าที่ระบบเดิมระบุว่าใช้จริง:
 *   - สถานะ OnTime/AtRisk/Overdue จาก deadline + `WorkflowSLAWarningThresholdPercent`
 *   - เลยกำหนด → audit `SLAEscalated` + แจ้งเตือน (CheckAndEscalateSLA เดิมทำแค่ audit; ส่วน escalate จริงเป็น TODO)
 * ยังไม่ทำ: `WorkflowAutoRejectOnOverdue` (ปฏิเสธอัตโนมัติ), การส่งต่อให้ผู้จัดการตามสายบังคับบัญชา — ระบบเดิมไม่มี
 */
@Injectable()
export class WorkflowSlaService extends CrudLoggedService {
  protected readonly logModule = 'WFE' as const;
  protected readonly logEntity = WFE_ENTITY.stepInstance;
  private readonly logger = new Logger(WorkflowSlaService.name);
  private running = false;
  private lastRunAt = 0;

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly sp: SpExecutor,
    private readonly store: SlaStore,
    private readonly cfg: SystemConfigService,
    private readonly notifier: WorkflowNotificationsService,
  ) {
    super(crudLog);
  }

  // ── รายงาน ───────────────────────────────────────────────

  async compliance(q: SlaReportQueryDto): Promise<SlaComplianceReportDto> {
    const f = toFilter(q);
    const spInput = {
      WorkflowDefinitionId: q.workflowDefinitionId ?? null,
      FromDate: q.fromDate ?? null,
      ToDate: q.toDate ?? null,
    };
    const [agg, templates, dist, trend, cycle] = await Promise.all([
      this.sp.call(Sp.dbo.wfGetSlaComplianceMetrics).one<Record<string, unknown>>(spInput),
      this.store.byTemplate(this.ds.manager, f),
      this.sp.call(Sp.dbo.wfGetTaskDistribution).rows<Record<string, unknown>>(spInput),
      this.store.weeklyTrend(this.ds.manager, q.weeks ?? 12),
      this.store.cycleTime(this.ds.manager, f),
    ]);

    const a = camelizeKeys<Record<string, unknown>>(agg ?? {});
    const summary: SlaSummaryDto = {
      totalTasks: Number(a.totalSteps ?? 0),
      onTimeCount: Number(a.onTimeCount ?? 0),
      atRiskCount: Number(a.atRiskCount ?? 0),
      overdueCount: Number(a.overdueCount ?? 0),
      onTimePercent: round1(Number(a.onTimePercent ?? 0)),
      averageCompletionHours: round1(Number(a.avgCompletionHours ?? 0)),
    };
    const byTemplate: SlaTemplateRowDto[] = templates.map((t) => ({
      workflowDefinitionId: t.wfDefinitionId,
      templateName: t.templateName,
      totalTasks: t.total,
      onTimeCount: t.onTime,
      atRiskCount: t.atRisk,
      overdueCount: t.overdue,
      compliancePercent: percentOf(t.onTime + t.atRisk, t.total),
    }));
    const topOverdueUsers = dist
      .map(toUserRow)
      .filter((u) => u.overdue > 0)
      .sort((x, y) => y.overdue - x.overdue)
      .slice(0, 5);
    const weeklyTrend: SlaTrendPointDto[] = trend.map((t, i) => ({
      year: t.yr,
      week: t.wk,
      weekLabel: `W${i + 1}`,
      compliancePercent: percentOf(t.onTime, t.total),
      totalTasks: t.total,
    }));
    const cycleTimeDistribution: SlaCycleBucketDto[] = cycle.map((c) => ({
      label: c.label,
      count: c.cnt,
      category: c.sortKey <= 2 ? 'pass' : c.sortKey <= 4 ? 'near' : 'over',
    }));
    return {
      summary,
      byTemplate,
      topOverdueUsers,
      weeklyTrend,
      cycleTimeDistribution,
      fromDate: q.fromDate ?? null,
      toDate: q.toDate ?? null,
    };
  }

  /** การกระจายงานต่อผู้รับผิดชอบ (SP คืนทั้งหมด แบ่งหน้าในหน่วยความจำเหมือนเดิม) */
  async taskDistribution(q: SlaTaskDistributionQueryDto): Promise<Paginated<SlaUserRowDto>> {
    const rows = await this.sp.call(Sp.dbo.wfGetTaskDistribution).rows<Record<string, unknown>>({
      WorkflowDefinitionId: q.workflowDefinitionId ?? null,
      FromDate: q.fromDate ?? null,
      ToDate: q.toDate ?? null,
    });
    const all = rows.map(toUserRow);
    const start = (q.page - 1) * q.pageSize;
    return paginated(all.slice(start, start + q.pageSize), all.length, q);
  }

  /** งานที่เลยกำหนดแบบสด — ไม่พึ่งค่า SLAStatus ที่เก็บไว้ (ซึ่งล้าสมัยถ้างานเบื้องหลังปิดอยู่) */
  async overdue(q: SlaOverdueQueryDto): Promise<Paginated<SlaOverdueRowDto>> {
    const now = new Date();
    const { rows, total } = await this.store.overdue(this.ds.manager, {
      ...toFilter(q),
      q: q.q,
      now,
      page: q.page,
      pageSize: q.pageSize,
    });
    return paginated(
      rows.map((r) => ({
        workflowStepInstanceId: r.wfStepInstanceId,
        workflowInstanceId: r.wfInstanceId,
        templateName: r.templateName ?? null,
        stepName: r.stepName ?? null,
        assignedTo: r.assignedTo ?? null,
        initiatedBy: r.initiatedBy ?? null,
        assignedDate: r.assignedDate ?? null,
        slaDeadline: r.slaDeadline,
        hoursOverdue: hoursOverdue(r.slaDeadline, now),
      })),
      total,
      q,
    );
  }

  // ── งานเบื้องหลัง ────────────────────────────────────────

  /** ตั้งเวลาทุกนาที แต่ทำงานจริงเมื่อเปิด WorkflowEscalationEnabled และครบ WorkflowSLAJobIntervalMinutes */
  @Cron('0 * * * * *', { name: 'wfe-sla-refresh' })
  async scheduledRefresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await loadWfeSettings(this.cfg);
      if (!settings.escalationEnabled) return;
      const intervalMs = settings.slaJobIntervalMinutes * 60_000;
      if (this.lastRunAt && Date.now() - this.lastRunAt < intervalMs - INTERVAL_SLACK_MS) return;

      const lock = await this.store.tryAcquireJobLock(this.ds);
      if (!lock) return; // instance อื่นกำลังทำอยู่
      try {
        this.lastRunAt = Date.now();
        if (settings.autoRejectOnOverdue)
          this.logger.warn(
            'WorkflowAutoRejectOnOverdue เปิดอยู่ แต่ API ยังไม่รองรับการปฏิเสธอัตโนมัติ',
          );
        await this.refresh({ escalate: true });
      } finally {
        await lock.release();
      }
    } catch (err) {
      this.logger.error(`งานอัปเดต SLA ล้มเหลว: ${(err as Error)?.message ?? err}`);
    } finally {
      this.running = false;
    }
  }

  /** สั่งอัปเดตสถานะ SLA ทันที (Admin) — escalation (แจ้งเตือน/audit) ทำเฉพาะเมื่อเปิด WorkflowEscalationEnabled */
  async refreshNow(): Promise<SlaRefreshResultDto> {
    const settings = await loadWfeSettings(this.cfg);
    return this.refresh({ escalate: settings.escalationEnabled });
  }

  /**
   * ตรวจ step ที่ยังเปิดอยู่ทั้งหมด → อัปเดต SLAStatus ที่เปลี่ยน
   * แล้ว (ถ้า escalate) บันทึก SLAEscalated และแจ้งเตือนเมื่อเปลี่ยนเป็น AtRisk/Overdue (เฉพาะตอนเปลี่ยน ไม่แจ้งซ้ำทุกรอบ)
   */
  async refresh(opts: { escalate: boolean }): Promise<SlaRefreshResultDto> {
    const settings = await loadWfeSettings(this.cfg);
    const now = new Date();
    let checked = 0;
    let updated = 0;
    let becameAtRisk = 0;
    let becameOverdue = 0;
    const notices: WfeNotice[] = [];
    const escalations: { row: OpenSlaRow; overdueHours: number }[] = [];

    let afterId = 0;
    for (;;) {
      const rows = await this.store.openSlaRows(this.ds.manager, afterId, BATCH);
      if (rows.length === 0) break;
      afterId = rows[rows.length - 1].wfStepInstanceId;
      checked += rows.length;

      const byId = new Map(rows.map((r) => [r.wfStepInstanceId, r]));
      const changes = diffSlaStatus(
        rows.map((r) => ({
          stepInstanceId: r.wfStepInstanceId,
          status: r.status,
          assignedDate: r.assignedDate,
          slaDeadline: r.slaDeadline,
          slaStatus: r.slaStatus,
        })),
        now,
        settings.slaWarningThresholdPercent,
      );
      if (changes.length > 0) {
        await this.tx.run(async ({ manager }) => {
          for (const status of [SlaStatus.OnTime, SlaStatus.AtRisk, SlaStatus.Overdue]) {
            const ids = changes.filter((c) => c.to === status).map((c) => c.stepInstanceId);
            if (ids.length) await this.store.setSlaStatus(manager, ids, status);
          }
        });
        updated += changes.length;
      }

      for (const c of changes) {
        const row = byId.get(c.stepInstanceId) as OpenSlaRow;
        const name = row.stepName ?? `#${row.wfStepId}`;
        const wf = row.templateName ?? `#${row.wfInstanceId}`;
        if (c.to === SlaStatus.AtRisk) {
          becameAtRisk++;
          if (row.assignedTo)
            notices.push({
              kind: 'SLA_WARNING',
              recipient: row.assignedTo,
              instanceId: row.wfInstanceId,
              messageText: noticeText.slaWarning(name, wf, row.wfInstanceId),
            });
        } else if (c.to === SlaStatus.Overdue) {
          becameOverdue++;
          escalations.push({ row, overdueHours: hoursOverdue(row.slaDeadline, now) });
          const text = noticeText.slaEscalated(name, wf, row.wfInstanceId);
          if (row.assignedTo)
            notices.push({
              kind: 'SLA_ESCALATED',
              recipient: row.assignedTo,
              instanceId: row.wfInstanceId,
              messageText: text,
            });
          if (row.initiatedBy && !sameUser(row.initiatedBy, row.assignedTo))
            notices.push({
              kind: 'SLA_ESCALATED',
              recipient: row.initiatedBy,
              instanceId: row.wfInstanceId,
              messageText: text,
            });
        }
      }
      if (rows.length < BATCH) break;
    }

    if (opts.escalate) {
      for (const e of escalations) {
        // เหมือน CheckAndEscalateSLA เดิม: audit "SLAEscalated" ผูกกับ step instance โดยผู้ทำคือ system
        this.crudLog.record({
          module: this.logModule,
          entity: WFE_ENTITY.stepInstance,
          action: 'EXECUTE',
          operation: WFE_OP.slaEscalated,
          recordId: e.row.wfStepInstanceId,
          success: true,
          meta: {
            workflowInstanceId: e.row.wfInstanceId,
            assignedTo: e.row.assignedTo,
            hoursOverdue: e.overdueHours,
            reason: 'SLA deadline exceeded',
          },
          actor: { userName: 'system' },
        });
      }
      await this.notifier.dispatch(notices);
    }

    if (updated > 0)
      this.logEvent({
        action: 'UPDATE',
        operation: WFE_OP.slaRefreshed,
        meta: { checked, updated, becameAtRisk, becameOverdue, escalated: opts.escalate },
      });
    return { checked, updated, becameAtRisk, becameOverdue, escalated: opts.escalate };
  }
}

function toFilter(q: {
  workflowDefinitionId?: number;
  fromDate?: Date;
  toDate?: Date;
}): ReportFilter {
  return { definitionId: q.workflowDefinitionId, fromDate: q.fromDate, toDate: q.toDate };
}

function toUserRow(r: Record<string, unknown>): SlaUserRowDto {
  const c = camelizeKeys<Record<string, unknown>>(r);
  return {
    userName: String(c.assignedTo ?? ''),
    totalAssigned: Number(c.totalAssigned ?? 0),
    completed: Number(c.completed ?? 0),
    pending: Number(c.pending ?? 0),
    rejected: Number(c.rejected ?? 0),
    overdue: Number(c.overdue ?? 0),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
