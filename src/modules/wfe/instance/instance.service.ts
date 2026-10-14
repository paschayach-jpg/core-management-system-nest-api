import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  SlaStatus,
  WorkflowInstanceStatus as IS,
  WorkflowStepInstanceStatus as SS,
  WorkflowStepType,
  WorkflowTemplateStatus,
} from '../../../common/constants/enums';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import {
  TransactionRunner,
  type TransactionScope,
} from '../../../database/transaction-runner.service';
import { AuditLogsService } from '../../shared/audit/audit.service';
import { SystemConfigService } from '../../shared/system-config/system-config.service';
import { OPEN_STEP_STATUSES, WFE_ENTITY, WFE_OP } from '../common/wfe.constants';
import {
  canControlInstance,
  canViewInstance,
  isManagerOrAbove,
  sameUser,
} from '../common/wfe-access';
import {
  noticeText,
  WorkflowNotificationsService,
  type WfeNotice,
} from '../common/wfe-notifications.service';
import { withDeadlockRetry } from '../common/wfe-retry';
import { loadWfeSettings } from '../common/wfe-settings';
import { WfeUserDirectory } from '../common/wfe-user-directory';
import type { WfConnection } from '../entities/wf-connection.entity';
import type { WfStep } from '../entities/wf-step.entity';
import { computeSlaDeadline, evaluateSlaStatus } from '../sla/sla-calculator';
import { canInstantiate } from '../template/template-status';
import { TemplateStore } from '../template/template.store';
import { TemplateStructureService } from '../template/template-structure.service';
import type {
  CancelInstanceDto,
  CompleteStepDto,
  CompleteStepResultDto,
  CreateInstanceDto,
  InstanceAllowedAction,
  InstanceDetailDto,
  InstanceHistoryDto,
  InstanceListQueryDto,
  InstanceSummaryDto,
  MyTasksQueryDto,
  RejectStepDto,
  StepInstanceDto,
  TaskDto,
  TaskSummaryDto,
} from './dto/instance.dto';
import {
  canDeleteInstance,
  canStartStep,
  instanceTransitionError,
  INSTANCE_STATUS_LABEL,
  isInstanceActionable,
  isStepActionable,
  nextInstanceStatus,
  type InstanceAction,
} from './instance-rules';
import { toInstanceSummary, toStepInstanceDto, toTaskDto } from './instance.mapper';
import { InstanceStore, type InstanceRow, type StepInstanceRow } from './instance.store';
import {
  decideAssignee,
  planCompletion,
  resolveNextSteps,
  type ConnectionLite,
  type StepLite,
} from './step-resolver';

const isOpenStep = (status: number) => OPEN_STEP_STATUSES.includes(status);

const toLite = (s: WfStep): StepLite => ({
  stepId: s.wfStepId,
  stepName: s.stepName,
  stepType: s.stepType as WorkflowStepType,
  sequenceNumber: s.sequenceNumber,
  assignedUser: s.assignedUser ?? null,
  assignedRole: s.assignedRole ?? null,
  assignedOrgUnit: s.assignedOrgUnit ?? null,
  slaHours: s.slaHours ?? null,
  slaDays: s.slaDays ?? null,
  allowDelegation: Boolean(s.allowDelegation),
});

const toConn = (c: WfConnection): ConnectionLite => ({
  connectionId: c.wfConnectionId,
  fromStepId: c.fromStepId,
  toStepId: c.toStepId,
  conditionExpression: c.conditionExpression ?? null,
});

/**
 * Workflow instance และ step instance — พอร์ตจาก WorkflowService
 *
 * - สร้าง instance/step instance **ผ่าน SP เท่านั้น** (WFE.sp_CreateWFInstance → sp_CreateWFStepInstance) ใน transaction เดียวกับ
 *   งานที่ต่อเนื่อง (ตรวจ template, สร้างแถว step จาก definition ถ้ายังไม่มี, ตั้งสถานะ InProgress + CurrentStepId)
 *   — ระบบเดิมแต่ละคำสั่งคอมมิตแยกกัน ถ้าพลาดกลางทางจะเหลือ instance สถานะ 0 ค้าง
 * - รหัส step instance ในทุก API คือ WFStepInstanceId (IDENTITY) ไม่ใช่คอลัมน์ WorkflowStepInstanceId (MAX+1 ที่ SP คำนวณ)
 * - แจ้งเตือนส่งหลัง commit เท่านั้น
 */
@Injectable()
export class WorkflowInstancesService extends CrudLoggedService {
  protected readonly logModule = 'WFE' as const;
  protected readonly logEntity = WFE_ENTITY.instance;
  private readonly logger = new Logger(WorkflowInstancesService.name);

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly sp: SpExecutor,
    private readonly store: InstanceStore,
    private readonly templates: TemplateStore,
    private readonly structure: TemplateStructureService,
    private readonly directory: WfeUserDirectory,
    private readonly cfg: SystemConfigService,
    private readonly notifier: WorkflowNotificationsService,
    private readonly audit: AuditLogsService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ─────────────────────────────────────────────────

  async get(id: number, user: UserContext): Promise<InstanceDetailDto> {
    const inst = await this.requireInstance(this.ds.manager, id);
    await this.assertCanView(this.ds.manager, inst, user);
    return this.buildDetail(this.ds.manager, inst, user);
  }

  async list(q: InstanceListQueryDto, user: UserContext): Promise<Paginated<InstanceSummaryDto>> {
    const { rows, total } = await this.store.listInstances(this.ds.manager, {
      definitionId: q.workflowDefinitionId,
      status: q.status,
      initiatedBy: q.initiatedBy,
      fromDate: q.fromDate,
      toDate: q.toDate,
      q: q.q,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
      page: q.page,
      pageSize: q.pageSize,
      viewer: { userName: user.adUserName, seesAll: isManagerOrAbove(user) },
    });
    return paginated(rows.map(toInstanceSummary), total, q);
  }

  /** ประวัติ: step instance ทั้งหมด + บันทึก audit (WorkflowInstance / WorkflowStepInstance) ของ instance นี้ */
  async history(id: number, user: UserContext): Promise<InstanceHistoryDto> {
    const inst = await this.requireInstance(this.ds.manager, id);
    await this.assertCanView(this.ds.manager, inst, user);
    const settings = await loadWfeSettings(this.cfg);
    const now = new Date();
    const [rows, audit] = await Promise.all([
      this.store.listStepInstances(this.ds.manager, id),
      this.audit.byWorkflowInstance(id),
    ]);
    return {
      steps: rows.map((r) => toStepInstanceDto(r, now, settings.slaWarningThresholdPercent)),
      audit,
    };
  }

  async myTasks(q: MyTasksQueryDto, user: UserContext): Promise<Paginated<TaskDto>> {
    const settings = await loadWfeSettings(this.cfg);
    const now = new Date();
    const { rows, total } = await this.store.myTasks(this.ds.manager, {
      userName: user.adUserName,
      onlyOpen: q.onlyOpen ?? false,
      page: q.page,
      pageSize: q.pageSize,
    });
    return paginated(
      rows.map((r) => toTaskDto(r, now, settings.slaWarningThresholdPercent)),
      total,
      q,
    );
  }

  /** สรุป KPI ของงานฉัน (ใช้แทนการดึงทุกหน้ามานับเอง) — SLA คำนวณสด */
  async taskSummary(user: UserContext): Promise<TaskSummaryDto> {
    const settings = await loadWfeSettings(this.cfg);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rows = await this.store.taskSlaRows(this.ds.manager, user.adUserName, startOfDay);
    let open = 0;
    let atRisk = 0;
    let overdue = 0;
    let completedToday = 0;
    for (const r of rows) {
      if (r.status === SS.Completed) {
        completedToday++;
        continue;
      }
      open++;
      const s = evaluateSlaStatus(r, now, settings.slaWarningThresholdPercent);
      if (s === SlaStatus.Overdue) overdue++;
      else if (s === SlaStatus.AtRisk) atRisk++;
    }
    return {
      openTasks: open,
      onTime: open - atRisk - overdue,
      atRisk,
      overdue,
      completedToday,
      slaCompliancePercent: open === 0 ? 100 : Math.round(((open - overdue) / open) * 100),
    };
  }

  async getStepInstance(id: number, user: UserContext): Promise<StepInstanceDto> {
    const si = await this.requireStepInstance(this.ds.manager, id);
    const inst = await this.requireInstance(this.ds.manager, si.wfInstanceId);
    await this.assertCanView(this.ds.manager, inst, user);
    const step = await this.templates.findStep(this.ds.manager, si.wfStepId);
    const settings = await loadWfeSettings(this.cfg);
    return toStepInstanceDto(
      { ...si, stepName: step?.stepName ?? null, stepType: step?.stepType ?? null },
      new Date(),
      settings.slaWarningThresholdPercent,
    );
  }

  // ── สร้าง instance ───────────────────────────────────────

  create(dto: CreateInstanceDto, user: UserContext): Promise<InstanceDetailDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: WFE_ENTITY.instance,
        operation: WFE_OP.instanceCreated,
        meta: { definitionId: dto.workflowDefinitionId },
      },
      async () => {
        const settings = await loadWfeSettings(this.cfg);
        const now = new Date();
        const made = await this.runTx(async (scope) => {
          const m = scope.manager;
          // 1) template ต้องมีและ Active
          const def = await this.templates.findDefinition(m, dto.workflowDefinitionId);
          if (!def) throw new ResourceNotFoundException('Template', dto.workflowDefinitionId);
          if (
            !canInstantiate(
              (def.approvalStatus ?? 0) as WorkflowTemplateStatus,
              Boolean(def.isActive),
            )
          )
            throw new BusinessException(
              `Template '${def.wfName}' ยังไม่เปิดใช้งาน (ต้องอยู่ในสถานะ Active)`,
              'TEMPLATE_NOT_ACTIVE',
            );

          // 2) ต้องมีขั้นตอน Start (ไม่มีแถว → สร้างจาก TemplateDefinition เหมือน SyncStepsFromTemplateDefinition เดิม)
          const steps = await this.structure.ensureStepsForInstance(m, def);
          const first = steps.find((s) => s.stepType === WorkflowStepType.Start);
          if (!first)
            throw new BusinessException(
              'Template ไม่มีขั้นตอนเริ่มต้น (Start)',
              'TEMPLATE_NO_START_STEP',
            );
          const firstLite = toLite(first);
          const assignee = await this.resolveAssignee(m, firstLite, user.adUserName);

          // 3) sp_CreateWFInstance — ใส่ Status = 0 (ไม่อยู่ใน enum)
          const created = await this.sp.call(Sp.wfe.createWfInstance, scope.sp).execute({
            WFDefinitionId: def.wfDefinitionId,
            TemplateVersion: def.version ?? 1,
            InitiatedBy: user.adUserName,
            InputParameters: dto.inputParameters ?? null,
          });
          const instanceId = Number(created.output.NewWFInstanceId);
          if (!Number.isInteger(instanceId) || instanceId <= 0)
            throw new Error('sp_CreateWFInstance ไม่คืนรหัส instance');

          // 4) sp_CreateWFStepInstance — step instance แรก (Pending, SLAStatus = OnTime)
          const si = await this.createStepInstance(
            scope,
            instanceId,
            firstLite,
            assignee,
            now,
            settings.slaDefaultHours,
          );

          // 5) ปรับ instance จาก 0 เป็น InProgress พร้อม CurrentStepId (ขั้นตอนที่ service เดิมทำหลังเรียก SP)
          await this.store.updateInstance(m, instanceId, {
            status: IS.InProgress,
            currentStepId: first.wfStepId,
          });
          return { instanceId, stepInstanceId: si, templateName: def.wfName, first, assignee };
        });

        await this.notifier.dispatch(
          [
            {
              kind: 'TASK_ASSIGNED',
              recipient: made.assignee,
              instanceId: made.instanceId,
              messageText: noticeText.taskAssigned(
                made.first.stepName,
                made.templateName,
                made.instanceId,
              ),
            },
          ],
          user.adUserName,
        );
        return this.get(made.instanceId, user);
      },
      (r) => ({
        recordId: r.workflowInstanceId,
        after: {
          workflowInstanceId: r.workflowInstanceId,
          workflowDefinitionId: r.workflowDefinitionId,
          status: r.status,
          currentStepId: r.currentStepId,
        },
      }),
    );
  }

  // ── ระงับ / ทำต่อ / ยกเลิก / ลบ ──────────────────────────

  suspend(id: number, user: UserContext): Promise<InstanceDetailDto> {
    return this.changeStatus(id, 'SUSPEND', WFE_OP.instanceSuspended, user);
  }

  resume(id: number, user: UserContext): Promise<InstanceDetailDto> {
    return this.changeStatus(id, 'RESUME', WFE_OP.instanceResumed, user);
  }

  cancel(id: number, dto: CancelInstanceDto, user: UserContext): Promise<InstanceDetailDto> {
    return this.changeStatus(id, 'CANCEL', WFE_OP.instanceCancelled, user, dto.reason);
  }

  /** ลบ (soft delete) instance ที่จบแล้ว — Manager ขึ้นไป (ตั้งที่ controller) */
  remove(id: number, reason: string, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        entity: WFE_ENTITY.instance,
        operation: WFE_OP.instanceDeleted,
        recordId: id,
        meta: { reason },
        captureBefore: () => this.beforeInstance(id),
      },
      () =>
        this.runTx(async ({ manager: m }) => {
          if (!isManagerOrAbove(user))
            throw new PermissionDeniedException(
              'เฉพาะผู้จัดการขึ้นไปเท่านั้นที่ลบ workflow ได้',
              'INSTANCE_FORBIDDEN',
            );
          const inst = await this.requireInstance(m, id, true);
          if (!canDeleteInstance(inst.status))
            throw new BusinessException(
              `ลบได้เฉพาะ workflow ที่จบแล้ว (Completed/Rejected/Cancelled) — สถานะปัจจุบัน: ${INSTANCE_STATUS_LABEL[inst.status] ?? inst.status}`,
              'INSTANCE_NOT_TERMINAL',
            );
          if ((await this.store.softDeleteInstance(m, id)) === 0)
            throw new ResourceNotFoundException('Workflow instance', id);
        }),
    );
  }

  // ── step instance ────────────────────────────────────────

  /** กดเริ่มทำงาน (Pending/Delegated → InProgress) — ใหม่: ระบบเดิมไม่มีขั้นตอนนี้ (สถานะ InProgress ของ step ไม่เคยถูกตั้ง) */
  startStep(stepInstanceId: number, user: UserContext): Promise<StepInstanceDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: WFE_ENTITY.stepInstance,
        operation: WFE_OP.stepStarted,
        recordId: stepInstanceId,
        captureBefore: () => this.beforeStep(stepInstanceId),
      },
      async () => {
        await this.runTx(async ({ manager: m }) => {
          const si = await this.requireStepInstance(m, stepInstanceId, true);
          this.assertAssignee(si, user);
          if (!canStartStep(si.status))
            throw new ConflictBusinessException(
              'เริ่มงานได้เฉพาะขั้นตอนที่รอดำเนินการ (Pending) หรือที่ได้รับมอบหมายมา',
              'STEP_CANNOT_START',
            );
          await this.assertInstanceActionable(m, si.wfInstanceId);
          await this.store.updateStepInstance(m, stepInstanceId, {
            status: SS.InProgress,
            startedDate: new Date(),
          });
        });
        return this.getStepInstance(stepInstanceId, user);
      },
      (r) => ({ after: { status: r.status } }),
    );
  }

  completeStep(
    stepInstanceId: number,
    dto: CompleteStepDto,
    user: UserContext,
  ): Promise<CompleteStepResultDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: WFE_ENTITY.stepInstance,
        operation: WFE_OP.stepCompleted,
        recordId: stepInstanceId,
        captureBefore: () => this.beforeStep(stepInstanceId),
      },
      async () => {
        const settings = await loadWfeSettings(this.cfg);
        const done = await this.runTx(async (scope) => {
          const m = scope.manager;
          const now = new Date();
          const si = await this.requireStepInstance(m, stepInstanceId, true);
          this.assertAssignee(si, user);
          this.assertStepOpen(si);
          const instance = await this.requireInstance(m, si.wfInstanceId, true);
          this.assertInstanceActive(instance);

          const currentRow = await this.templates.findStep(m, si.wfStepId);
          if (!currentRow) throw new ResourceNotFoundException('Step', si.wfStepId);
          const def = await this.templates.findDefinition(m, instance.wfDefinitionId);
          if (!def) throw new ResourceNotFoundException('Template', instance.wfDefinitionId);

          const ordered = (await this.templates.findSteps(m, instance.wfDefinitionId)).map(toLite);
          const stepsById = new Map(ordered.map((s) => [s.stepId, s]));
          const current = toLite(currentRow);
          const outgoing = (await this.templates.findConnectionsFrom(m, current.stepId)).map(
            toConn,
          );
          const resolved = resolveNextSteps(outgoing, stepsById, dto.outputData);
          for (const missing of resolved.missingTargets)
            this.logger.error(
              `เส้นเชื่อมจากขั้นตอน ${current.stepId} ชี้ไปยังขั้นตอน ${missing} ซึ่งไม่มีอยู่`,
            );

          // ปิด step นี้: OutputData = outputData ถ้ามี ไม่งั้นใช้ remarks (เหมือนเดิม) · SLAStatus ประเมินตอนเสร็จ
          const outputData = dto.outputData ? dto.outputData : (dto.remarks ?? null);
          await this.store.updateStepInstance(m, stepInstanceId, {
            status: SS.Completed,
            completedDate: now,
            completedBy: user.adUserName,
            outputData,
            remarks: dto.remarks ?? null,
            slaStatus: evaluateSlaStatus(
              {
                status: SS.Completed,
                assignedDate: si.assignedDate,
                slaDeadline: si.slaDeadline,
                completedDate: now,
              },
              now,
              settings.slaWarningThresholdPercent,
            ),
          });

          const otherOpen = (await this.store.listStepInstances(m, instance.wfInstanceId))
            .filter((x) => x.wfStepInstanceId !== stepInstanceId && isOpenStep(x.status))
            .map((x) => ({ stepInstanceId: x.wfStepInstanceId, stepId: x.wfStepId }));
          const plan = planCompletion({
            currentStep: current,
            nextSteps: resolved.steps,
            orderedSteps: ordered,
            otherOpen,
          });

          const notices: WfeNotice[] = [];
          const createdIds: number[] = [];
          let instanceStatus = instance.status;
          switch (plan.kind) {
            case 'COMPLETE_INSTANCE':
              await this.store.updateInstance(m, instance.wfInstanceId, {
                status: IS.Completed,
                completedDate: now,
                currentStepId: plan.currentStepId,
              });
              instanceStatus = IS.Completed;
              notices.push({
                kind: 'WORKFLOW_COMPLETED',
                recipient: instance.initiatedBy,
                instanceId: instance.wfInstanceId,
                messageText: noticeText.workflowCompleted(def.wfName, instance.wfInstanceId),
              });
              break;
            case 'KEEP_OPEN':
              await this.store.updateInstance(m, instance.wfInstanceId, {
                currentStepId: plan.currentStepId,
              });
              break;
            case 'ADVANCE':
              for (const next of plan.next) {
                const assignee = await this.resolveAssignee(m, next, user.adUserName);
                createdIds.push(
                  await this.createStepInstance(
                    scope,
                    instance.wfInstanceId,
                    next,
                    assignee,
                    now,
                    settings.slaDefaultHours,
                  ),
                );
                notices.push({
                  kind: 'TASK_ASSIGNED',
                  recipient: assignee,
                  instanceId: instance.wfInstanceId,
                  messageText: noticeText.taskAssigned(
                    next.stepName,
                    def.wfName,
                    instance.wfInstanceId,
                  ),
                });
              }
              await this.store.updateInstance(m, instance.wfInstanceId, {
                currentStepId: plan.currentStepId,
              });
              break;
          }
          return {
            instanceId: instance.wfInstanceId,
            instanceStatus,
            currentStepId: plan.currentStepId,
            createdIds,
            notices,
            reason: plan.reason,
          };
        });

        await this.notifier.dispatch(done.notices, user.adUserName);

        const rows = await this.store.listStepInstances(this.ds.manager, done.instanceId);
        const now = new Date();
        const dtoOf = (r: StepInstanceRow) =>
          toStepInstanceDto(r, now, settings.slaWarningThresholdPercent);
        const self = rows.find((r) => r.wfStepInstanceId === stepInstanceId);
        return {
          stepInstance: dtoOf(self as StepInstanceRow),
          instanceStatus: done.instanceStatus as IS,
          currentStepId: done.currentStepId,
          createdStepInstances: rows
            .filter((r) => done.createdIds.includes(r.wfStepInstanceId))
            .map(dtoOf),
        };
      },
      (r) => ({
        meta: {
          workflowInstanceId: r.stepInstance.workflowInstanceId,
          instanceStatus: r.instanceStatus,
          createdStepInstances: r.createdStepInstances.map((c) => c.workflowStepInstanceId),
        },
        after: { status: r.stepInstance.status, slaStatus: r.stepInstance.slaStatus },
      }),
    );
  }

  /**
   * ปฏิเสธ step — instance จบเป็น Rejected (พฤติกรรมเดิม: ปฏิเสธครั้งเดียวจบทั้ง workflow)
   * ต่างจากเดิม: step อื่นของ instance ที่ยังเปิดอยู่ (สาขา Parallel) ถูกปิดด้วย ไม่ปล่อยค้างเป็นงานผี
   */
  rejectStep(
    stepInstanceId: number,
    dto: RejectStepDto,
    user: UserContext,
  ): Promise<StepInstanceDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: WFE_ENTITY.stepInstance,
        operation: WFE_OP.stepRejected,
        recordId: stepInstanceId,
        meta: { reason: dto.reason },
        captureBefore: () => this.beforeStep(stepInstanceId),
      },
      async () => {
        const notices = await this.runTx(async ({ manager: m }) => {
          const now = new Date();
          const si = await this.requireStepInstance(m, stepInstanceId, true);
          this.assertAssignee(si, user);
          this.assertStepOpen(si);
          const instance = await this.requireInstance(m, si.wfInstanceId, true);
          this.assertInstanceActive(instance);

          await this.store.updateStepInstance(m, stepInstanceId, {
            status: SS.Rejected,
            completedDate: now,
            completedBy: user.adUserName,
            outputData: dto.reason,
            remarks: dto.remarks ?? null,
          });
          await this.closeOpenSteps(
            m,
            instance.wfInstanceId,
            stepInstanceId,
            now,
            user,
            'ยกเลิก: workflow ถูกปฏิเสธ',
          );
          await this.store.updateInstance(m, instance.wfInstanceId, {
            status: IS.Rejected,
            completedDate: now,
          });

          const def = await this.templates.findDefinition(m, instance.wfDefinitionId);
          const step = await this.templates.findStep(m, si.wfStepId);
          return [
            {
              kind: 'TASK_REJECTED',
              recipient: instance.initiatedBy,
              instanceId: instance.wfInstanceId,
              messageText: noticeText.taskRejected(
                step?.stepName ?? `#${si.wfStepId}`,
                def?.wfName ?? `#${instance.wfDefinitionId}`,
                instance.wfInstanceId,
                dto.reason,
              ),
            },
          ] satisfies WfeNotice[];
        });
        await this.notifier.dispatch(notices, user.adUserName);
        return this.getStepInstance(stepInstanceId, user);
      },
      (r) => ({ after: { status: r.status } }),
    );
  }

  // ── ภายใน ────────────────────────────────────────────────

  private changeStatus(
    id: number,
    action: InstanceAction,
    operation: string,
    user: UserContext,
    reason?: string,
  ): Promise<InstanceDetailDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: WFE_ENTITY.instance,
        operation,
        recordId: id,
        meta: reason ? { reason } : undefined,
        captureBefore: () => this.beforeInstance(id),
      },
      async () => {
        await this.runTx(async ({ manager: m }) => {
          const inst = await this.requireInstance(m, id, true);
          if (!canControlInstance(user, inst.initiatedBy))
            throw new PermissionDeniedException(
              'เฉพาะผู้เริ่ม workflow หรือผู้จัดการขึ้นไปเท่านั้นที่ทำรายการนี้ได้',
              'INSTANCE_FORBIDDEN',
            );
          const next = nextInstanceStatus(inst.status, action);
          if (next === null)
            throw new BusinessException(
              instanceTransitionError(inst.status, action),
              'INSTANCE_INVALID_TRANSITION',
              { current: inst.status, action },
            );
          const now = new Date();
          if (action === 'CANCEL') {
            await this.closeOpenSteps(
              m,
              id,
              null,
              now,
              user,
              reason ? `ยกเลิก: ${reason}` : 'ยกเลิกโดยผู้ใช้',
            );
          }
          await this.store.updateInstance(m, id, {
            status: next,
            ...(action === 'CANCEL' ? { completedDate: now } : {}),
          });
        });
        return this.get(id, user);
      },
      (r) => ({ after: { status: r.status } }),
    );
  }

  /** transaction เดียว + รันซ้ำเมื่อ deadlock (ดูเหตุผลใน wfe-retry.ts) */
  private runTx<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return withDeadlockRetry(() => this.tx.run(work));
  }

  /** ปิด step instance ที่ยังเปิดอยู่ทั้งหมดของ instance (สถานะ Rejected + ข้อความ) ยกเว้น `exceptId` */
  private async closeOpenSteps(
    m: EntityManager,
    instanceId: number,
    exceptId: number | null,
    now: Date,
    user: UserContext,
    message: string,
  ): Promise<number[]> {
    const closed: number[] = [];
    for (const s of await this.store.listStepInstances(m, instanceId)) {
      if (!isOpenStep(s.status) || s.wfStepInstanceId === exceptId) continue;
      await this.store.updateStepInstance(m, s.wfStepInstanceId, {
        status: SS.Rejected,
        completedDate: now,
        completedBy: user.adUserName,
        outputData: message,
      });
      closed.push(s.wfStepInstanceId);
    }
    return closed;
  }

  /** เรียก WFE.sp_CreateWFStepInstance แล้วคืน WFStepInstanceId — SP คำนวณ WorkflowStepInstanceId = MAX+1 ภายใต้ TABLOCKX เอง */
  private async createStepInstance(
    scope: TransactionScope,
    instanceId: number,
    step: StepLite,
    assignedTo: string,
    now: Date,
    defaultHours: number,
  ): Promise<number> {
    const res = await this.sp.call(Sp.wfe.createWfStepInstance, scope.sp).execute({
      WFInstanceId: instanceId,
      WFStepId: step.stepId,
      AssignedTo: assignedTo,
      // ส่งเป็นตัวเลข/วันที่ — SP เดิมแปลงเป็นสตริง ISO ก่อน INSERT ลงคอลัมน์ datetime เอง
      SLADeadline: computeSlaDeadline(now, step, defaultHours),
    });
    const id = Number(res.output.NewWFStepInstanceId ?? res.output.NewWorkflowStepInstanceId);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error('sp_CreateWFStepInstance ไม่คืนรหัส step instance');
    return id;
  }

  /** ผู้รับผิดชอบของ step instance ใหม่ — ดู decideAssignee; ผู้ใช้ที่ระบุต้องมีอยู่และใช้งานอยู่ */
  private async resolveAssignee(
    m: EntityManager,
    step: StepLite,
    actingUser: string,
  ): Promise<string> {
    const d = decideAssignee(step, actingUser);
    switch (d.kind) {
      case 'ACTING_USER':
        return d.userName;
      case 'UNSUPPORTED':
        throw new BusinessException(
          `ขั้นตอน '${step.stepName}' ระบุผู้รับผิดชอบเป็นบทบาท/หน่วยงาน ซึ่งระบบยังไม่รองรับ — ต้องระบุชื่อผู้ใช้ในขั้นตอนนั้น`,
          'STEP_ASSIGNEE_UNSUPPORTED',
          { stepId: step.stepId, reason: d.reason },
        );
      case 'EXPLICIT': {
        const u = await this.directory.findByAdUserName(d.userName, m);
        if (!u?.isActive)
          throw new BusinessException(
            `ไม่พบผู้ใช้ที่ใช้งานอยู่ '${d.userName}' ซึ่งระบุเป็นผู้รับผิดชอบขั้นตอน '${step.stepName}' (กลุ่ม AD ยังไม่รองรับ)`,
            'STEP_ASSIGNEE_NOT_FOUND',
            { stepId: step.stepId, assignedUser: d.userName },
          );
        return u.adUserName;
      }
    }
  }

  private async buildDetail(
    m: EntityManager,
    inst: InstanceRow,
    user: UserContext,
  ): Promise<InstanceDetailDto> {
    const settings = await loadWfeSettings(this.cfg);
    const now = new Date();
    const [def, steps, rows] = await Promise.all([
      this.templates.findDefinition(m, inst.wfDefinitionId),
      this.templates.findSteps(m, inst.wfDefinitionId),
      this.store.listStepInstances(m, inst.wfInstanceId),
    ]);
    // step ปัจจุบัน: ยึด step instance ที่ยังรอ/กำลังทำ (CurrentStepId อาจล้าสมัย — ตามที่ MapToResult เดิมทำ)
    const active = rows.find((r) => r.status === SS.Pending || r.status === SS.InProgress);
    const currentStepId = active?.wfStepId ?? inst.currentStepId ?? null;
    const currentStepName =
      steps.find((s) => s.wfStepId === currentStepId)?.stepName ??
      rows.find((r) => r.wfStepId === currentStepId)?.stepName ??
      null;

    const status = inst.status;
    const allowed: InstanceAllowedAction[] = [];
    const canControl = canControlInstance(user, inst.initiatedBy);
    if (canControl && nextInstanceStatus(status, 'SUSPEND') !== null) allowed.push('SUSPEND');
    if (canControl && nextInstanceStatus(status, 'RESUME') !== null) allowed.push('RESUME');
    if (canControl && nextInstanceStatus(status, 'CANCEL') !== null) allowed.push('CANCEL');
    if (isManagerOrAbove(user) && canDeleteInstance(status)) allowed.push('DELETE');

    return {
      workflowInstanceId: inst.wfInstanceId,
      workflowDefinitionId: inst.wfDefinitionId,
      templateName: def?.wfName ?? null,
      templateVersion: inst.templateVersion,
      initiatedBy: inst.initiatedBy,
      initiatedDate: inst.initiatedDate,
      status: status as IS,
      currentStepId,
      currentStepName,
      totalStepCount: steps.length,
      completedStepCount: rows.filter((r) => r.status === SS.Completed).length,
      completedDate: inst.completedDate ?? null,
      inputParameters: inst.inputParameters ?? null,
      stepHistory: rows.map((r) => toStepInstanceDto(r, now, settings.slaWarningThresholdPercent)),
      allowedActions: allowed,
    };
  }

  private async requireInstance(
    m: EntityManager,
    id: number,
    forUpdate = false,
  ): Promise<InstanceRow> {
    const inst = await this.store.findInstance(m, id, forUpdate);
    if (!inst) throw new ResourceNotFoundException('Workflow instance', id);
    return inst;
  }

  private async requireStepInstance(
    m: EntityManager,
    id: number,
    forUpdate = false,
  ): Promise<StepInstanceRow> {
    const si = await this.store.findStepInstance(m, id, forUpdate);
    if (!si) throw new ResourceNotFoundException('Step instance', id);
    return si;
  }

  private async assertCanView(
    m: EntityManager,
    inst: InstanceRow,
    user: UserContext,
  ): Promise<void> {
    if (isManagerOrAbove(user) || sameUser(user.adUserName, inst.initiatedBy)) return;
    const assignees = await this.store.participants(m, inst.wfInstanceId);
    if (!canViewInstance(user, { initiatedBy: inst.initiatedBy, assignees }))
      throw new PermissionDeniedException(
        'คุณไม่มีสิทธิ์ดู workflow นี้ (ต้องเป็นผู้เริ่ม ผู้รับผิดชอบ หรือผู้จัดการขึ้นไป)',
        'INSTANCE_FORBIDDEN',
      );
  }

  private assertAssignee(si: StepInstanceRow, user: UserContext): void {
    if (!sameUser(si.assignedTo, user.adUserName))
      throw new PermissionDeniedException('คุณไม่ได้เป็นผู้รับผิดชอบขั้นตอนนี้', 'NOT_ASSIGNEE');
  }

  private assertStepOpen(si: StepInstanceRow): void {
    if (!isStepActionable(si.status))
      throw new ConflictBusinessException(
        `ขั้นตอนนี้ถูกดำเนินการไปแล้ว (${si.status === SS.Completed ? 'เสร็จสิ้น' : 'ถูกปฏิเสธ'})`,
        'STEP_ALREADY_CLOSED',
      );
  }

  private assertInstanceActive(inst: InstanceRow): void {
    if (!isInstanceActionable(inst.status))
      throw new BusinessException(
        `workflow อยู่ในสถานะ ${INSTANCE_STATUS_LABEL[inst.status] ?? inst.status} จึงดำเนินการขั้นตอนนี้ไม่ได้`,
        'INSTANCE_NOT_ACTIVE',
        { status: inst.status },
      );
  }

  private async assertInstanceActionable(m: EntityManager, instanceId: number): Promise<void> {
    this.assertInstanceActive(await this.requireInstance(m, instanceId, true));
  }

  private async beforeInstance(id: number): Promise<unknown> {
    const i = await this.store.findInstance(this.ds.manager, id);
    return i ? { status: i.status, currentStepId: i.currentStepId } : undefined;
  }

  private async beforeStep(id: number): Promise<unknown> {
    const s = await this.store.findStepInstance(this.ds.manager, id);
    return s
      ? {
          status: s.status,
          assignedTo: s.assignedTo,
          slaStatus: s.slaStatus,
          slaDeadline: s.slaDeadline,
        }
      : undefined;
  }
}
