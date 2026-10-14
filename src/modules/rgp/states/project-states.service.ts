import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { ProjectAuditService } from '../audit/project-audit.service';
import {
  NOW_SQL,
  assertValidRefProject,
  insertProjectState,
  requireActiveProject,
  requireState,
  usedEstimatedDays,
} from '../common/project-ops';
import { stateEntityToDto, stateRowToDto, type StateRow } from '../common/rgp-mappers';
import { rgpActor } from '../common/rgp-actor';
import { checkEstimatedDays, projectTotalDays, toDateOnly, toYesNo } from '../common/rgp-rules';
import { STATES_WITH_PROGRESS_SQL } from '../common/rgp-sql';
import { Project } from '../entities/project.entity';
import { ProjectDocWorkflow } from '../entities/project-doc-workflow.entity';
import { ProjectNotifyLog } from '../entities/project-notify-log.entity';
import { ProjectProgress } from '../entities/project-progress.entity';
import { ProjectState } from '../entities/project-state.entity';
import { ProjectStateMember } from '../entities/project-state-member.entity';
import { ProjectTask } from '../entities/project-task.entity';
import type {
  CreateStateDto,
  EstimatedDaysDto,
  ProjectStateDto,
  ReorderStatesDto,
  UpdateStateDto,
} from './dto/state.dto';

/**
 * ขั้นตอน (state) ของโครงการ — พอร์ตจาก ProjectStateService
 * การเปลี่ยนแปลงสถานะ/ความคืบหน้าของ state อยู่ที่ ProjectProgressService
 */
@Injectable()
export class ProjectStatesService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectState';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ProjectState) private readonly repo: Repository<ProjectState>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly tx: TransactionRunner,
    private readonly audit: ProjectAuditService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** ขั้นตอนของโครงการพร้อม % ล่าสุดและข้อมูลโครงการอ้างอิง (เรียงตามลำดับ) */
  async listByProject(projectId: number): Promise<ProjectStateDto[]> {
    if (!(await this.projects.existsBy({ projectId, active: 'Y' }))) {
      throw new ResourceNotFoundException('โครงการ', projectId);
    }
    return this.loadByProject(projectId);
  }

  /** เหมือน listByProject แต่ไม่ตรวจว่ามีโครงการ (ผู้เรียกตรวจแล้ว) */
  async loadByProject(projectId: number): Promise<ProjectStateDto[]> {
    const rows: StateRow[] = await this.ds.query(STATES_WITH_PROGRESS_SQL, [projectId]);
    return rows.map(stateRowToDto);
  }

  async get(projStateId: number): Promise<ProjectStateDto> {
    const state = await this.repo.findOneBy({ projStateId });
    if (!state) throw new ResourceNotFoundException('ขั้นตอน (state)', projStateId);
    const all = await this.loadByProject(state.projectId);
    return all.find((s) => s.projStateId === projStateId) ?? stateEntityToDto(state);
  }

  /** วันที่ใช้ไป/เหลือ (GetTotalEstimatedDays) สำหรับหน้าจอกำหนดจำนวนวันคาดการณ์ */
  async estimatedDays(projectId: number, excludeStateId = 0): Promise<EstimatedDaysDto> {
    const project = await this.projects.findOneBy({ projectId, active: 'Y' });
    if (!project) throw new ResourceNotFoundException('โครงการ', projectId);
    const states = await this.repo.findBy({ projectId });
    const usedDays = states
      .filter((s) => s.projStateId !== excludeStateId)
      .reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0);
    const totalDays = projectTotalDays(toDateOnly(project.startDate), toDateOnly(project.dueDate));
    return {
      totalDays,
      usedDays,
      remainingDays: totalDays === null ? null : totalDays - usedDays,
    };
  }

  // ── เขียน ──────────────────────────────────────────────────

  /** เพิ่มขั้นตอนต่อท้ายโครงการ (สถานะเริ่ม Pending) — audit CREATE_PROJECT_STATE */
  create(projectId: number, dto: CreateStateDto, user: UserContext): Promise<ProjectStateDto> {
    return this.logged(
      { action: 'CREATE', operation: 'CREATE_PROJECT_STATE', meta: { projectId } },
      () =>
        this.audit.withAudit(
          { user, action: 'CREATE_PROJECT_STATE', tableName: 't_project_state' },
          async ({ manager }) => {
            const project = await requireActiveProject(manager, projectId);
            const used = await usedEstimatedDays(manager, projectId);
            assertDaysWithin(project, used, dto.estimatedDays);
            const state = await insertProjectState(manager, projectId, dto, rgpActor(user));
            return stateEntityToDto(state);
          },
          (s) => s.projStateId,
        ),
      (s) => ({ recordId: s.projStateId, after: s }),
    );
  }

  /** แก้ไขขั้นตอน (ชื่อ/ลำดับ/คำอธิบาย/จำเป็นหรือไม่/จำนวนวัน/โครงการอ้างอิง) — ไม่แตะสถานะและความคืบหน้า */
  update(projStateId: number, dto: UpdateStateDto, user: UserContext): Promise<ProjectStateDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_PROJECT_STATE',
        recordId: projStateId,
        captureBefore: () => this.get(projStateId),
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          const state = await requireState(manager, projStateId);
          const project = await requireActiveProject(manager, state.projectId);

          if (dto.estimatedDays) {
            const used = await usedEstimatedDays(manager, state.projectId, projStateId);
            assertDaysWithin(project, used, dto.estimatedDays);
          }
          if (dto.refProjectId !== undefined) {
            await assertValidRefProject(manager, state.projectId, dto.refProjectId);
          }

          await manager.update(
            ProjectState,
            { projStateId },
            {
              ...(dto.name !== undefined ? { stateName: dto.name.trim() } : {}),
              ...(dto.seqNo !== undefined ? { seqNo: dto.seqNo } : {}),
              ...(dto.description !== undefined
                ? { description: dto.description?.trim() ? dto.description.trim() : null }
                : {}),
              ...(dto.required !== undefined ? { required: toYesNo(dto.required) } : {}),
              ...(dto.estimatedDays !== undefined ? { estimatedDays: dto.estimatedDays } : {}),
              ...(dto.refProjectId !== undefined ? { refProjectId: dto.refProjectId } : {}),
              updateUser: rgpActor(user),
              updateDate: NOW_SQL,
            },
          );
        });
        return this.get(projStateId);
      },
      (s) => ({ after: s }),
    );
  }

  /**
   * ลบขั้นตอน (ลบจริง) — ถูกบล็อกถ้ามีประวัติความคืบหน้า (พฤติกรรมเดิม) หรือมี task/ประวัติแจ้งเตือนอ้างอยู่
   * เอกสาร workflow และผู้เกี่ยวข้องของขั้นตอน: ต้องลบก่อน หรือส่ง cascade=true (ระบบเดิมชนข้อจำกัด FK แล้ว error)
   */
  remove(projStateId: number, user: UserContext, cascade = false): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_PROJECT_STATE',
        recordId: projStateId,
        captureBefore: () => this.get(projStateId),
        meta: { cascade },
      },
      () =>
        this.audit.withAudit(
          {
            user,
            action: 'DELETE_PROJECT_STATE',
            tableName: 't_project_state',
            recordId: projStateId,
          },
          async ({ manager }) => {
            await requireState(manager, projStateId);

            if ((await manager.countBy(ProjectProgress, { projStateId })) > 0) {
              throw new BusinessException(
                'ไม่สามารถลบขั้นตอนได้ เนื่องจากมีประวัติการอัปเดตความคืบหน้าแล้ว',
                'STATE_HAS_PROGRESS',
              );
            }
            const tasks = await manager.countBy(ProjectTask, { projStateId });
            const notifies = await manager.countBy(ProjectNotifyLog, { projStateId });
            const docs = await manager.countBy(ProjectDocWorkflow, { projStateId });
            const members = await manager.countBy(ProjectStateMember, { projStateId });
            if (tasks > 0 || notifies > 0) {
              throw new ConflictBusinessException(
                'ไม่สามารถลบขั้นตอนได้ เนื่องจากมี Task หรือประวัติการแจ้งเตือนอ้างอิงอยู่',
                'STATE_IN_USE',
                { tasks, notifies },
              );
            }
            if ((docs > 0 || members > 0) && !cascade) {
              throw new ConflictBusinessException(
                `ขั้นตอนนี้มีเอกสาร ${docs} รายการและผู้เกี่ยวข้อง ${members} คน — ลบออกก่อน หรือส่ง cascade=true`,
                'STATE_IN_USE',
                { docs, members },
              );
            }
            if (cascade) {
              await manager.delete(ProjectDocWorkflow, { projStateId });
              await manager.delete(ProjectStateMember, { projStateId });
            }
            await manager.delete(ProjectState, { projStateId });
          },
        ),
    );
  }

  /** จัดลำดับขั้นตอนใหม่ (ReorderStates) — ต้องเป็นขั้นตอนของโครงการนี้เท่านั้น ทั้งชุดอยู่ใน transaction เดียว */
  reorder(projectId: number, dto: ReorderStatesDto, user: UserContext): Promise<ProjectStateDto[]> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'REORDER_PROJECT_STATES',
        recordId: projectId,
        captureBefore: () => this.loadByProject(projectId),
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          await requireActiveProject(manager, projectId);
          const own = await manager.findBy(ProjectState, { projectId });
          const ownIds = new Set(own.map((s) => s.projStateId));
          const seen = new Set<number>();
          for (const item of dto.items) {
            if (!ownIds.has(item.stateId)) {
              throw new BusinessException(
                `ขั้นตอน ${item.stateId} ไม่ใช่ของโครงการ ${projectId}`,
                'STATE_NOT_IN_PROJECT',
              );
            }
            if (seen.has(item.stateId)) {
              throw new BusinessException(`ขั้นตอน ${item.stateId} ซ้ำในรายการ`, 'STATE_DUPLICATE');
            }
            seen.add(item.stateId);
          }
          for (const item of dto.items) {
            await manager.update(
              ProjectState,
              { projStateId: item.stateId },
              { seqNo: item.seqNo, updateUser: rgpActor(user), updateDate: NOW_SQL },
            );
          }
        });
        return this.loadByProject(projectId);
      },
      (states) => ({ after: states.map((s) => ({ id: s.projStateId, seqNo: s.seqNo })) }),
    );
  }
}

/** กฎ "ผลรวมวันคาดการณ์ต้องไม่เกินช่วงวันของโครงการ" (เดิมตรวจที่หน้าจอ Frm_Project_State_Edit) */
function assertDaysWithin(
  project: Pick<Project, 'startDate' | 'dueDate'>,
  usedByOthers: number,
  estimatedDays: number | null | undefined,
): void {
  const check = checkEstimatedDays(
    toDateOnly(project.startDate),
    toDateOnly(project.dueDate),
    usedByOthers,
    estimatedDays,
  );
  if (!check.ok) {
    throw new BusinessException(
      `จำนวนวันที่กำหนด (${estimatedDays} วัน) เกินวันที่เหลือ (${check.remainingDays} วัน) — ` +
        `รวมทั้งหมด ${check.totalDays} วัน ใช้ไปแล้ว ${check.usedDays} วัน`,
      'STATE_DAYS_EXCEEDED',
      check,
    );
  }
}
