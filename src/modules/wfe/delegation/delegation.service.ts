import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { WorkflowStepInstanceStatus as SS } from '../../../common/constants/enums';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import {
  TransactionRunner,
  type TransactionScope,
} from '../../../database/transaction-runner.service';
import { MAX_DELEGATION_DEPTH, WFE_ENTITY, WFE_OP } from '../common/wfe.constants';
import { isManagerOrAbove, sameUser } from '../common/wfe-access';
import { withDeadlockRetry } from '../common/wfe-retry';
import { noticeText, WorkflowNotificationsService } from '../common/wfe-notifications.service';
import { WfeUserDirectory } from '../common/wfe-user-directory';
import type { WfDelegation } from '../entities/wf-delegation.entity';
import { InstanceStore } from '../instance/instance.store';
import { TemplateStore } from '../template/template.store';
import { checkDelegation, deactivationKind, type DelegationCheckInput } from './delegation-rules';
import type { DelegateTaskDto, DelegationDto, DelegationListQueryDto } from './dto/delegation.dto';
import { toDelegationDto, toHistoryItem } from './delegation.mapper';
import { DelegationStore } from './delegation.store';

/**
 * การมอบหมายงาน (dbo.WFDelegation) — พอร์ตจาก WorkflowDelegationService
 *
 * - สร้างผ่าน SP `dbo.sp_WF_CreateDelegation` (ปิด delegation ที่ active เดิม, คำนวณความลึก = MAX+1, เกิน 3 → RAISERROR)
 *   ใน transaction เดียวกับการเปลี่ยนผู้รับผิดชอบของ step (ระบบเดิมแยกเป็นสองคำสั่งที่คอมมิตแยกกัน)
 * - ต่างจากเดิม: ตรวจ AllowDelegation ของ step ที่ฝั่ง server, ห้ามมอบให้ตัวเอง/วนกลับหาคนที่เคยอยู่ในสาย,
 *   ผู้รับต้องเป็นผู้ใช้ที่ใช้งานอยู่, ยกเลิก/คืนงานแล้วคืนผู้รับผิดชอบให้ผู้มอบจริง (เดิม DeactivateDelegation แค่ปิดธง)
 * - audit ผูกกับ WorkflowStepInstance (รหัส step instance) เพื่อให้หน้าประวัติของ workflow ค้นเจอ
 */
@Injectable()
export class WorkflowDelegationsService extends CrudLoggedService {
  protected readonly logModule = 'WFE' as const;
  protected readonly logEntity = WFE_ENTITY.stepInstance;

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly sp: SpExecutor,
    private readonly store: DelegationStore,
    private readonly instances: InstanceStore,
    private readonly templates: TemplateStore,
    private readonly directory: WfeUserDirectory,
    private readonly notifier: WorkflowNotificationsService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ─────────────────────────────────────────────────

  async get(id: number, user: UserContext): Promise<DelegationDto> {
    const d = await this.require(this.ds.manager, id);
    await this.assertCanView(d, user);
    return toDelegationDto(d);
  }

  /** ประวัติการมอบหมายของงาน (เรียงตามระดับ) — sp_WF_GetDelegationHistory */
  async history(stepInstanceId: number, user: UserContext): Promise<DelegationDto[]> {
    const si = await this.instances.findStepInstance(this.ds.manager, stepInstanceId);
    if (!si) throw new ResourceNotFoundException('Step instance', stepInstanceId);
    const rows = await this.historyRows(stepInstanceId);
    const involved = rows.some(
      (d) => sameUser(d.delegatedFrom, user.adUserName) || sameUser(d.delegatedTo, user.adUserName),
    );
    if (!involved && !sameUser(si.assignedTo, user.adUserName) && !isManagerOrAbove(user))
      throw new PermissionDeniedException(
        'คุณไม่มีสิทธิ์ดูประวัติการมอบหมายของงานนี้',
        'DELEGATION_FORBIDDEN',
      );
    return rows.map(toDelegationDto);
  }

  async mine(q: DelegationListQueryDto, user: UserContext): Promise<Paginated<DelegationDto>> {
    const { rows, total } = await this.store.listForUser(this.ds.manager, {
      userName: user.adUserName,
      direction: q.direction ?? 'any',
      activeOnly: q.activeOnly ?? false,
      page: q.page,
      pageSize: q.pageSize,
    });
    return paginated(rows.map(toDelegationDto), total, q);
  }

  // ── มอบหมาย ──────────────────────────────────────────────

  delegate(dto: DelegateTaskDto, user: UserContext): Promise<DelegationDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: WFE_OP.taskDelegated,
        recordId: dto.workflowStepInstanceId,
        meta: { delegateTo: dto.delegateToUserName },
        captureBefore: async () => {
          const s = await this.instances.findStepInstance(
            this.ds.manager,
            dto.workflowStepInstanceId,
          );
          return s ? { status: s.status, assignedTo: s.assignedTo } : undefined;
        },
      },
      async () => {
        const made = await this.runTx(async (scope) => {
          const m = scope.manager;
          const si = await this.instances.findStepInstance(m, dto.workflowStepInstanceId, true);
          if (!si) throw new ResourceNotFoundException('Step instance', dto.workflowStepInstanceId);
          const instance = await this.instances.findInstance(m, si.wfInstanceId, true);
          if (!instance) throw new ResourceNotFoundException('Workflow instance', si.wfInstanceId);
          const step = await this.templates.findStep(m, si.wfStepId);
          const history = (await this.historyRows(si.wfStepInstanceId, scope.sp)).map(
            toHistoryItem,
          );

          const input: DelegationCheckInput = {
            caller: user.adUserName,
            delegateTo: dto.delegateToUserName,
            assignedTo: si.assignedTo,
            stepStatus: si.status,
            instanceStatus: instance.status,
            stepAllowsDelegation: Boolean(step?.allowDelegation),
            history,
            startDate: dto.startDate,
            endDate: dto.endDate,
          };
          this.assertAllowed(input);

          // ผู้รับต้องเป็นผู้ใช้ที่ใช้งานอยู่ — ใช้ชื่อตามที่ระบบเก็บ แล้วตรวจกฎวน/ตัวเองซ้ำด้วยชื่อจริง
          const target = await this.directory.findByAdUserName(dto.delegateToUserName, m);
          if (!target?.isActive)
            throw new BusinessException(
              `ไม่พบผู้ใช้ที่ใช้งานอยู่ '${dto.delegateToUserName}'`,
              'DELEGATE_USER_NOT_FOUND',
            );
          this.assertAllowed({ ...input, delegateTo: target.adUserName });

          const created = await this.sp.call(Sp.dbo.wfCreateDelegation, scope.sp).execute({
            WorkflowStepInstanceId: si.wfStepInstanceId,
            DelegatedFrom: user.adUserName,
            DelegatedTo: target.adUserName,
            DelegationReason: dto.delegationReason ?? null,
            MaxDelegationDepth: MAX_DELEGATION_DEPTH,
            StartDate: dto.startDate ?? null,
            EndDate: dto.endDate ?? null,
            Remarks: dto.remarks ?? null,
          });
          const delegationId = Number(created.output.NewWFDelegationId);
          if (!Number.isInteger(delegationId) || delegationId <= 0)
            throw new Error('sp_WF_CreateDelegation ไม่คืนรหัส delegation');

          await this.instances.updateStepInstance(m, si.wfStepInstanceId, {
            assignedTo: target.adUserName,
            status: SS.Delegated,
          });

          const def = await this.templates.findDefinition(m, instance.wfDefinitionId);
          return {
            delegationId,
            recipient: target.adUserName,
            instanceId: instance.wfInstanceId,
            stepName: step?.stepName ?? `#${si.wfStepId}`,
            workflowName: def?.wfName ?? `#${instance.wfDefinitionId}`,
          };
        });

        await this.notifier.dispatch(
          [
            {
              kind: 'TASK_DELEGATED',
              recipient: made.recipient,
              instanceId: made.instanceId,
              messageText: noticeText.taskDelegated(
                user.displayName || user.adUserName,
                made.stepName,
                made.workflowName,
                made.instanceId,
              ),
            },
          ],
          user.adUserName,
        );
        return toDelegationDto(await this.require(this.ds.manager, made.delegationId));
      },
      (r) => ({
        after: {
          delegationId: r.wfDelegationId,
          delegatedFrom: r.delegatedFrom,
          delegatedTo: r.delegatedTo,
          depth: r.delegationDepth,
        },
      }),
    );
  }

  /** ผู้รับมอบ "คืนงาน" ให้ผู้มอบ */
  returnTask(delegationId: number, user: UserContext): Promise<DelegationDto> {
    return this.end(delegationId, user, 'RETURN');
  }

  /** ผู้มอบ (หรือ Manager ขึ้นไป) ยกเลิกการมอบหมาย — งานกลับไปอยู่กับผู้มอบ */
  deactivate(delegationId: number, user: UserContext): Promise<DelegationDto> {
    return this.end(delegationId, user, 'CANCEL');
  }

  // ── ภายใน ────────────────────────────────────────────────

  private end(
    delegationId: number,
    user: UserContext,
    intended: 'RETURN' | 'CANCEL',
  ): Promise<DelegationDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        operation: intended === 'RETURN' ? WFE_OP.delegationReturned : WFE_OP.delegationDeactivated,
        meta: { delegationId },
        captureBefore: async () => {
          const d = await this.store.findDelegation(this.ds.manager, delegationId);
          return d ? toDelegationDto(d) : undefined;
        },
      },
      async () => {
        const notice = await this.runTx(async ({ manager: m }) => {
          const d = await this.require(m, delegationId);
          if (!d.isActive)
            throw new ConflictBusinessException(
              'การมอบหมายนี้สิ้นสุดไปแล้ว',
              'DELEGATION_NOT_ACTIVE',
            );
          const kind = deactivationKind(user.adUserName, isManagerOrAbove(user), d);
          if (kind !== intended)
            throw new PermissionDeniedException(
              intended === 'RETURN'
                ? 'เฉพาะผู้รับมอบหมายเท่านั้นที่คืนงานได้'
                : 'เฉพาะผู้มอบหมายหรือผู้จัดการขึ้นไปเท่านั้นที่ยกเลิกการมอบหมายได้',
              'DELEGATION_FORBIDDEN',
            );

          if ((await this.store.deactivate(m, delegationId)) === 0)
            throw new ConflictBusinessException(
              'การมอบหมายนี้สิ้นสุดไปแล้ว',
              'DELEGATION_NOT_ACTIVE',
            );

          // งานยังค้างอยู่กับผู้รับ → คืนผู้รับผิดชอบให้ผู้มอบ (สถานะกลับเป็น Pending)
          const si = await this.instances.findStepInstance(m, d.workflowStepInstanceId, true);
          if (si && si.status === SS.Delegated && sameUser(si.assignedTo, d.delegatedTo)) {
            await this.instances.updateStepInstance(m, si.wfStepInstanceId, {
              assignedTo: d.delegatedFrom,
              status: SS.Pending,
            });
            const instance = await this.instances.findInstance(m, si.wfInstanceId);
            const step = await this.templates.findStep(m, si.wfStepId);
            const def = instance
              ? await this.templates.findDefinition(m, instance.wfDefinitionId)
              : null;
            return {
              kind: 'DELEGATION_ENDED' as const,
              recipient: d.delegatedFrom,
              instanceId: si.wfInstanceId,
              messageText: noticeText.delegationEnded(
                step?.stepName ?? `#${si.wfStepId}`,
                def?.wfName ?? '-',
                si.wfInstanceId,
              ),
            };
          }
          return null;
        });
        if (notice) await this.notifier.dispatch([notice], user.adUserName);
        return toDelegationDto(await this.require(this.ds.manager, delegationId));
      },
      (r) => ({ recordId: r.workflowStepInstanceId, after: { isActive: r.isActive } }),
    );
  }

  /** transaction เดียว + รันซ้ำเมื่อ deadlock (ดูเหตุผลใน wfe-retry.ts) */
  private runTx<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return withDeadlockRetry(() => this.tx.run(work));
  }

  private assertAllowed(input: DelegationCheckInput): void {
    const v = checkDelegation(input);
    if (!v) return;
    // ไม่ใช่ผู้รับผิดชอบ = 403 · ที่เหลือเป็นการละเมิดกฎ = 422
    if (v.code === 'NOT_ASSIGNEE') throw new PermissionDeniedException(v.message, 'NOT_ASSIGNEE');
    throw new BusinessException(v.message, v.code, { rule: v.code });
  }

  /** ประวัติของ step instance จาก sp_WF_GetDelegationHistory (เฉพาะ IsDeleted = 0 เรียงตามระดับ) */
  private async historyRows(stepInstanceId: number, spOptions?: object): Promise<WfDelegation[]> {
    const rows = await this.sp
      .call(Sp.dbo.wfGetDelegationHistory, spOptions ?? {})
      .rows<Record<string, unknown>>({ WorkflowStepInstanceId: stepInstanceId });
    return rows.map((r) => camelizeKeys<WfDelegation>(r));
  }

  private async require(m: EntityManager, id: number): Promise<WfDelegation> {
    const d = await this.store.findDelegation(m, id);
    if (!d) throw new ResourceNotFoundException('Delegation', id);
    return d;
  }

  private async assertCanView(d: WfDelegation, user: UserContext): Promise<void> {
    if (
      sameUser(d.delegatedFrom, user.adUserName) ||
      sameUser(d.delegatedTo, user.adUserName) ||
      isManagerOrAbove(user)
    )
      return;
    throw new PermissionDeniedException('คุณไม่มีสิทธิ์ดูการมอบหมายนี้', 'DELEGATION_FORBIDDEN');
  }
}
