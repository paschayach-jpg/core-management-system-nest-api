import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import {
  BusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { ProjectAuditService } from '../audit/project-audit.service';
import {
  NOW_SQL,
  requireActiveProject,
  requireState,
  syncStatePctFromTasks,
} from '../common/project-ops';
import { ACTOR_LONG, rgpActor } from '../common/rgp-actor';
import {
  MAX_COMMENT_DEPTH,
  MAX_SUBTASK_DEPTH,
  parseDateOnly,
  resolveTaskStatusChange,
  toDateOnly,
  todayDateOnly,
  type TaskStatus,
} from '../common/rgp-rules';
import { Project } from '../entities/project.entity';
import { ProjectState } from '../entities/project-state.entity';
import { ProjectTask } from '../entities/project-task.entity';
import { ProjectTaskComment } from '../entities/project-task-comment.entity';
import { ProjectTaskStatusLog } from '../entities/project-task-status-log.entity';
import { RunningNumberService } from '../running-number/running-number.service';
import type {
  CreateCommentDto,
  CreateTaskDto,
  TaskCommentDto,
  TaskDto,
  TaskStatusLogDto,
  TaskStatusResultDto,
  TaskTreeItemDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';
import { buildTaskTree, computeTaskFlags, sortStateTasks } from './task-rules';

/**
 * งาน (Task) ภายใต้ขั้นตอนของโครงการ + comment — พอร์ตจาก ProjectTaskService
 *
 * หลักการสำคัญ (ต่างจากเดิม: ทุกขั้นตอนอยู่ transaction เดียว ระบบเดิมแยกเป็นหลาย connection และกลืน error)
 *  - รหัส Task ออกจาก RunningNumber (running_type='TK') ฐาน BUI_RG และถือล็อกไว้จนสร้าง Task สำเร็จ
 *  - เปลี่ยนสถานะ: OnHold ตรึง % · บันทึก status log ทุกครั้ง · sync % ของ state = ค่าเฉลี่ย task หลัก แล้วคำนวณสถานะโครงการใหม่
 */
@Injectable()
export class ProjectTasksService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectTask';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(ProjectTask) private readonly repo: Repository<ProjectTask>,
    @InjectRepository(ProjectTaskComment) private readonly comments: Repository<ProjectTaskComment>,
    @InjectRepository(ProjectTaskStatusLog) private readonly logs: Repository<ProjectTaskStatusLog>,
    @InjectRepository(ProjectState) private readonly states: Repository<ProjectState>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly tx: TransactionRunner,
    private readonly audit: ProjectAuditService,
    private readonly runningNumbers: RunningNumberService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** task ทั้งหมดของโครงการแบบต้นไม้ (depth-first) — ใช้กับ Kanban/Dashboard */
  async listByProject(projectId: number, now: Date = new Date()): Promise<TaskTreeItemDto[]> {
    if (!(await this.projects.existsBy({ projectId, active: 'Y' }))) {
      throw new ResourceNotFoundException('โครงการ', projectId);
    }
    const tasks = await this.repo.findBy({ projectId, active: 'Y' });
    const stateNames = await this.stateNames(projectId);
    const children = countChildren(tasks);
    return buildTaskTree(tasks).map(({ task, depth }) => ({
      ...toTaskDto(task, stateNames.get(task.projStateId), children.get(task.taskId), now),
      treeDepth: depth,
    }));
  }

  /** task หลักของขั้นตอน (ไม่รวม sub task — มีสรุปจำนวน sub task) เรียงตามความสำคัญ/กำหนดเสร็จ */
  async listByState(
    projStateId: number,
    includeDeleted = false,
    now: Date = new Date(),
  ): Promise<TaskDto[]> {
    const state = await this.states.findOneBy({ projStateId });
    if (!state) throw new ResourceNotFoundException('ขั้นตอน (state)', projStateId);
    const all = await this.repo.findBy({ projStateId });
    const children = countChildren(all.filter((t) => t.active === 'Y'));
    const roots = all.filter((t) => !t.parentTaskId && (includeDeleted || t.active === 'Y'));
    return sortStateTasks(roots).map((t) =>
      toTaskDto(t, state.stateName, children.get(t.taskId), now),
    );
  }

  async get(taskId: number, now: Date = new Date()): Promise<TaskDto> {
    const task = await this.repo.findOneBy({ taskId });
    if (!task) throw new ResourceNotFoundException('Task', taskId);
    const state = await this.states.findOneBy({ projStateId: task.projStateId });
    const subs = await this.repo.findBy({ parentTaskId: taskId, active: 'Y' });
    return toTaskDto(task, state?.stateName, countChildren(subs, taskId).get(taskId), now);
  }

  async statusLog(taskId: number): Promise<TaskStatusLogDto[]> {
    if (!(await this.repo.existsBy({ taskId })))
      throw new ResourceNotFoundException('Task', taskId);
    const rows = await this.logs.find({ where: { taskId }, order: { logId: 'DESC' } });
    return rows.map((l) => ({
      logId: l.logId,
      taskId: l.taskId,
      oldStatus: l.oldStatus ?? null,
      newStatus: l.newStatus,
      pctAtChange: l.pctAtChange,
      changeUser: l.changeUser ?? null,
      changeDate: l.changeDate as Date,
    }));
  }

  // ── เขียน ──────────────────────────────────────────────────

  /**
   * สร้าง Task (หรือ sub task ถ้าส่ง parentTaskId) — audit CREATE_PROJECT_TASK
   * ถ้าไม่มีแถว RunningNumber 'TK' จะล้มพร้อมข้อความชัดเจนและไม่สร้างอะไรเลย
   */
  create(projStateId: number, dto: CreateTaskDto, user: UserContext): Promise<TaskDto> {
    return this.logged(
      { action: 'CREATE', operation: 'CREATE_PROJECT_TASK', meta: { projStateId } },
      async () => {
        // เปิด transaction ฐาน BUI_RG ค้างไว้ (ล็อกแถว RunningNumber) จนกว่า Task จะ commit ในฐานหลัก —
        // งานล้ม = เลขไม่ถูกใช้ (ไม่เกิดช่องว่าง)
        const taskId = await this.tx.run(
          async ({ manager: numberManager }) => {
            const taskCode = await this.runningNumbers.next(numberManager, 'TK');
            return this.audit.withAudit(
              { user, action: 'CREATE_PROJECT_TASK', tableName: 't_project_task' },
              (scope) => this.insertTask(scope.manager, projStateId, taskCode, dto, user),
              (id) => id,
            );
          },
          { target: 'project' },
        );
        return this.get(taskId);
      },
      (t) => ({ recordId: t.taskId, after: { taskId: t.taskId, taskCode: t.taskCode } }),
    );
  }

  /** แก้ไขรายละเอียด Task (ไม่แตะสถานะ/%) */
  update(taskId: number, dto: UpdateTaskDto, user: UserContext): Promise<TaskDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_PROJECT_TASK',
        recordId: taskId,
        captureBefore: () => this.get(taskId),
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          const task = await manager.findOneBy(ProjectTask, { taskId, active: 'Y' });
          if (!task) {
            throw new ResourceNotFoundException('Task (อาจถูกลบไปแล้ว)', taskId);
          }
          await requireActiveProject(manager, task.projectId);
          await manager.update(
            ProjectTask,
            { taskId },
            {
              ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
              ...(dto.description !== undefined
                ? { description: blankToNull(dto.description) }
                : {}),
              ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
              ...(dto.assignee !== undefined ? { assignee: blankToNull(dto.assignee) } : {}),
              ...(dto.dueDate !== undefined ? { dueDate: parseDateOnly(dto.dueDate) } : {}),
              ...(dto.startDate !== undefined ? { startDate: parseDateOnly(dto.startDate) } : {}),
              ...(dto.estimatedHours !== undefined ? { estimatedHours: dto.estimatedHours } : {}),
              ...(dto.actualHours !== undefined ? { actualHours: dto.actualHours } : {}),
              ...(dto.extendReason !== undefined
                ? { extendReason: blankToNull(dto.extendReason) }
                : {}),
              updateUser: rgpActor(user),
              updateDate: NOW_SQL,
            },
          );
        });
        return this.get(taskId);
      },
      (t) => ({ after: t }),
    );
  }

  /**
   * เปลี่ยนสถานะ + % ของ Task (พอร์ตจาก ProjectTaskService.UpdateStatus) ใน transaction เดียว:
   *   1) OnHold ตรึง % เดิม · Done = 100 · Todo = 0   2) บันทึก task   3) sync % ของ state จากค่าเฉลี่ย task
   *   (progress "Auto-sync จาก Tasks" → สถานะ state → สถานะโครงการ)   4) status log   5) audit UPDATE_PROJECT_TASK_STATUS
   * ใช้ state/โครงการจากตัว Task เอง ไม่เชื่อค่าที่ client ส่ง
   */
  updateStatus(
    taskId: number,
    dto: UpdateTaskStatusDto,
    user: UserContext,
  ): Promise<TaskStatusResultDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_PROJECT_TASK_STATUS',
        recordId: taskId,
        captureBefore: () => this.get(taskId),
        meta: { status: dto.status, pctComplete: dto.pctComplete },
      },
      async () => {
        const synced = await this.audit.withAudit(
          {
            user,
            action: 'UPDATE_PROJECT_TASK_STATUS',
            tableName: 't_project_task',
            recordId: taskId,
          },
          async ({ manager }) => {
            const task = await manager.findOneBy(ProjectTask, { taskId, active: 'Y' });
            if (!task) throw new ResourceNotFoundException('Task (อาจถูกลบไปแล้ว)', taskId);
            await requireActiveProject(manager, task.projectId);

            const change = resolveTaskStatusChange(
              { status: task.status, pctComplete: task.pctComplete ?? 0 },
              { status: dto.status as TaskStatus, pctComplete: dto.pctComplete },
            );
            await manager.update(
              ProjectTask,
              { taskId },
              {
                status: change.status,
                pctComplete: change.pctComplete,
                updateUser: rgpActor(user),
                updateDate: NOW_SQL,
              },
            );
            const progress = await syncStatePctFromTasks(manager, task.projStateId, rgpActor(user));
            await manager.insert(ProjectTaskStatusLog, {
              taskId,
              oldStatus: task.status ?? null,
              newStatus: change.status,
              pctAtChange: change.pctComplete,
              changeUser: rgpActor(user, ACTOR_LONG),
            });
            return progress;
          },
        );
        return {
          task: await this.get(taskId),
          statePct: synced.pctComplete,
          stateStatus: synced.stateStatus,
          projectStatus: synced.projectStatus,
        };
      },
      (r) => ({ after: { status: r.task.status, pctComplete: r.task.pctComplete } }),
    );
  }

  /** ลบ Task (soft delete → ถังขยะ 30 วัน) — ไม่ลบ sub task / ไม่ sync % ของ state (พฤติกรรมเดิม) */
  remove(taskId: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_PROJECT_TASK',
        recordId: taskId,
        captureBefore: () => this.get(taskId),
      },
      async () => {
        const task = await this.repo.findOneBy({ taskId });
        if (!task) throw new ResourceNotFoundException('Task', taskId);
        if (task.active === 'N') return; // ลบไปแล้ว — idempotent
        await this.repo.update(
          { taskId },
          {
            active: 'N',
            deletedDate: NOW_SQL,
            recycleExpiry: () => 'DATEADD(DAY, 30, GETDATE())',
            updateUser: rgpActor(user),
            updateDate: NOW_SQL,
          },
        );
      },
    );
  }

  // ── Comment ────────────────────────────────────────────────

  /** comment ของ Task (เก่าสุดก่อน) — comment ที่ถูกลบไม่ส่งเนื้อหาออก */
  async listComments(taskId: number): Promise<TaskCommentDto[]> {
    if (!(await this.repo.existsBy({ taskId })))
      throw new ResourceNotFoundException('Task', taskId);
    const rows = await this.comments.find({ where: { taskId }, order: { commentId: 'ASC' } });
    return rows.map(toCommentDto);
  }

  /** เพิ่ม comment/ตอบกลับ — ความลึกคำนวณที่ server (ซ้อนได้ 3 ระดับ: 0,1,2) */
  addComment(taskId: number, dto: CreateCommentDto, user: UserContext): Promise<TaskCommentDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'ADD_TASK_COMMENT',
        entity: 'ProjectTaskComment',
        meta: { taskId },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          const task = await manager.findOneBy(ProjectTask, { taskId, active: 'Y' });
          if (!task) throw new ResourceNotFoundException('Task', taskId);
          await requireActiveProject(manager, task.projectId);

          let depth = 0;
          if (dto.parentCommentId) {
            const parent = await manager.findOneBy(ProjectTaskComment, {
              commentId: dto.parentCommentId,
              taskId,
            });
            if (!parent || parent.isDeleted === 'Y') {
              throw new BusinessException(
                'ไม่พบ comment ที่ต้องการตอบกลับ หรือถูกลบแล้ว',
                'PARENT_COMMENT_NOT_FOUND',
              );
            }
            depth = (parent.threadDepth ?? 0) + 1;
            if (depth > MAX_COMMENT_DEPTH) {
              throw new BusinessException('ตอบกลับซ้อนได้ไม่เกิน 3 ระดับ', 'COMMENT_TOO_DEEP');
            }
          }
          const saved = await manager.save(ProjectTaskComment, {
            taskId,
            parentCommentId: dto.parentCommentId ?? null,
            threadDepth: depth,
            content: dto.content.trim(),
            isEdited: 'N',
            isDeleted: 'N',
            createUser: rgpActor(user),
          });
          return toCommentDto(saved);
        }),
      (c) => ({ recordId: c.commentId }),
    );
  }

  /** ลบ comment (soft delete) — ลบได้เฉพาะ comment ของตัวเอง (ตามหน้าจอเดิม) */
  deleteComment(commentId: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_TASK_COMMENT',
        entity: 'ProjectTaskComment',
        recordId: commentId,
      },
      async () => {
        const comment = await this.comments.findOneBy({ commentId });
        if (!comment) throw new ResourceNotFoundException('Comment', commentId);
        if (comment.createUser !== rgpActor(user)) {
          throw new PermissionDeniedException('ลบได้เฉพาะ comment ของตัวเอง', 'COMMENT_NOT_OWNER');
        }
        if (comment.isDeleted === 'Y') return; // idempotent
        await this.comments.update({ commentId }, { isDeleted: 'Y' });
      },
    );
  }

  /** ตรวจกฎแล้วเพิ่มแถว Task — คืน taskId (ใช้ใน transaction ของผู้เรียก) */
  private async insertTask(
    manager: EntityManager,
    projStateId: number,
    taskCode: string,
    dto: CreateTaskDto,
    user: UserContext,
  ): Promise<number> {
    const state = await requireState(manager, projStateId);
    await requireActiveProject(manager, state.projectId);

    if (dto.dueDate && dto.dueDate < todayDateOnly()) {
      throw new BusinessException('วันกำหนดเสร็จต้องเป็นวันในอนาคต', 'TASK_DUE_DATE_PAST');
    }

    let depth = 0;
    if (dto.parentTaskId) {
      const parent = await manager.findOneBy(ProjectTask, {
        taskId: dto.parentTaskId,
        active: 'Y',
      });
      if (!parent) {
        throw new BusinessException(
          `ไม่พบ Task แม่ (${dto.parentTaskId}) หรือถูกลบแล้ว`,
          'PARENT_TASK_NOT_FOUND',
        );
      }
      if (parent.projStateId !== projStateId) {
        throw new BusinessException(
          'Sub task ต้องอยู่ในขั้นตอนเดียวกับ Task แม่',
          'PARENT_TASK_OTHER_STATE',
        );
      }
      depth = (parent.subtaskDepth ?? 0) + 1;
      if (depth > MAX_SUBTASK_DEPTH) {
        throw new BusinessException(
          `Sub task ซ้อนได้ไม่เกิน ${MAX_SUBTASK_DEPTH} ระดับ`,
          'SUBTASK_TOO_DEEP',
        );
      }
    }

    const saved = await manager.save(ProjectTask, {
      taskCode,
      projStateId,
      projectId: state.projectId,
      parentTaskId: dto.parentTaskId ?? null,
      subtaskDepth: depth,
      title: dto.title.trim(),
      description: blankToNull(dto.description),
      priority: dto.priority ?? 2,
      status: 'Todo',
      pctComplete: dto.pctComplete ?? 0,
      assignee: blankToNull(dto.assignee),
      dueDate: parseDateOnly(dto.dueDate),
      startDate: parseDateOnly(dto.startDate),
      estimatedHours: dto.estimatedHours ?? null,
      active: 'Y',
      createUser: rgpActor(user),
    });
    return saved.taskId;
  }

  // ── ภายใน ──────────────────────────────────────────────────

  private async stateNames(projectId: number): Promise<Map<number, string>> {
    const states = await this.states.findBy({ projectId });
    return new Map(states.map((s) => [s.projStateId, s.stateName]));
  }
}

// ───────────────────────── mapping ─────────────────────────

const blankToNull = (v: string | null | undefined): string | null =>
  v === undefined || v === null || v.trim() === '' ? null : v.trim();

function countChildren(
  tasks: ProjectTask[],
  onlyParent?: number,
): Map<number, { count: number; done: number }> {
  const map = new Map<number, { count: number; done: number }>();
  for (const t of tasks) {
    if (!t.parentTaskId || t.active !== 'Y') continue;
    if (onlyParent !== undefined && t.parentTaskId !== onlyParent) continue;
    const c = map.get(t.parentTaskId) ?? { count: 0, done: 0 };
    c.count += 1;
    if (t.status === 'Done') c.done += 1;
    map.set(t.parentTaskId, c);
  }
  return map;
}

function toTaskDto(
  t: ProjectTask,
  stateName: string | undefined | null,
  sub: { count: number; done: number } | undefined,
  now: Date,
): TaskDto {
  const flags = computeTaskFlags(
    { dueDate: t.dueDate, createDate: t.createDate, status: t.status },
    now,
  );
  return {
    taskId: t.taskId,
    taskCode: t.taskCode,
    projStateId: t.projStateId,
    stateName: stateName ?? null,
    projectId: t.projectId,
    parentTaskId: t.parentTaskId ?? null,
    subtaskDepth: t.subtaskDepth ?? 0,
    title: t.title,
    description: t.description ?? null,
    priority: t.priority ?? 2,
    status: t.status ?? 'Todo',
    pctComplete: t.pctComplete ?? 0,
    assignee: t.assignee ?? null,
    dueDate: toDateOnly(t.dueDate),
    startDate: toDateOnly(t.startDate),
    estimatedHours: t.estimatedHours ?? null,
    actualHours: t.actualHours ?? null,
    extendReason: t.extendReason ?? null,
    active: t.active === 'Y',
    deletedDate: t.deletedDate ?? null,
    createUser: t.createUser,
    createDate: t.createDate as Date,
    updateUser: t.updateUser ?? null,
    updateDate: t.updateDate ?? null,
    overdue: flags.overdue,
    slaWarning: flags.slaWarning,
    subtaskCount: sub?.count ?? 0,
    subtaskDone: sub?.done ?? 0,
  };
}

function toCommentDto(c: ProjectTaskComment): TaskCommentDto {
  const deleted = c.isDeleted === 'Y';
  return {
    commentId: c.commentId,
    taskId: c.taskId,
    parentCommentId: c.parentCommentId ?? null,
    threadDepth: c.threadDepth ?? 0,
    content: deleted ? null : c.content,
    isEdited: c.isEdited === 'Y',
    isDeleted: deleted,
    createUser: c.createUser,
    createDate: c.createDate as Date,
    editedDate: c.editedDate ?? null,
  };
}
