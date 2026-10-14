import { IsNull, type EntityManager } from 'typeorm';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import { Project } from '../entities/project.entity';
import { ProjectDocWorkflow } from '../entities/project-doc-workflow.entity';
import { ProjectProgress } from '../entities/project-progress.entity';
import { ProjectState } from '../entities/project-state.entity';
import { ProjectTask } from '../entities/project-task.entity';
import {
  averageTaskPct,
  computeProjectStatus,
  fromYesNo,
  nextSeqNo,
  stateStatusFromPct,
  toYesNo,
  type ProjectStatus,
  type StateStatus,
} from './rgp-rules';

/**
 * ชุดคำสั่งระดับ "ปฏิบัติการบนฐานข้อมูล" ของ RGP ที่หลาย service ใช้ร่วมกัน — ทุกฟังก์ชันรับ `EntityManager`
 * เพื่อให้รันใน transaction ของผู้เรียกได้ (เช่น เปลี่ยนสถานะ Task → sync % ของ state → คำนวณสถานะโครงการ ต้องอยู่ transaction เดียว)
 * ไม่ใช่ service (ไม่มี CRUD-log ของตัวเอง) — ผู้เรียกห่อด้วย `logged()` ของตนแล้ว
 */

/** ค่าที่ให้ฐานข้อมูลใส่เวลาเอง (GETDATE() ตรงกับระบบเดิมที่เก็บเวลาท้องถิ่นของ SQL Server) */
export const NOW_SQL = (): string => 'GETDATE()';

// ───────────────────────── โหลด/ตรวจ ─────────────────────────

/** โครงการที่ยังใช้งาน (f_active='Y') — ไม่พบ = 404 */
export async function requireActiveProject(
  manager: EntityManager,
  projectId: number,
): Promise<Project> {
  const project = await manager.findOneBy(Project, { projectId, active: 'Y' });
  if (!project) throw new ResourceNotFoundException('โครงการ', projectId);
  return project;
}

export async function requireState(
  manager: EntityManager,
  projStateId: number,
): Promise<ProjectState> {
  const state = await manager.findOneBy(ProjectState, { projStateId });
  if (!state) throw new ResourceNotFoundException('ขั้นตอน (state)', projStateId);
  return state;
}

// ───────────────────────── สถานะโครงการ ─────────────────────────

/**
 * คำนวณสถานะโครงการใหม่จากสถานะ state (พอร์ตจาก ProjectProgressService.RecalculateProjectStatus)
 * - เขียนเฉพาะเมื่อสถานะเปลี่ยน · เมื่อเข้าสถานะ Completed ตั้ง d_close_date (ถ้าเป็น Completed อยู่แล้วคงวันเดิม)
 * - โครงการที่ถูกลบ (f_active='N') ไม่ถูกแตะ — คืน null
 */
export async function recalculateProjectStatus(
  manager: EntityManager,
  projectId: number,
  actor: string,
): Promise<ProjectStatus | null> {
  const project = await manager.findOneBy(Project, { projectId, active: 'Y' });
  if (!project) return null;
  const states = await manager.find(ProjectState, { where: { projectId } });
  const next = computeProjectStatus(
    states.map((s) => ({ required: fromYesNo(s.required), status: s.status ?? 'Pending' })),
  );
  if (next === project.status) return next;
  await manager.update(
    Project,
    { projectId },
    {
      status: next,
      ...(next === 'Completed' ? { closeDate: NOW_SQL } : {}),
      updateUser: actor,
      updateDate: NOW_SQL,
    },
  );
  return next;
}

// ───────────────────────── ความคืบหน้า ─────────────────────────

export interface ApplyProgressInput {
  projStateId: number;
  /** 0–100 (ผู้เรียกตรวจแล้ว) */
  pctComplete: number;
  remark?: string | null;
  /** ชื่อผู้ใช้ (ตัดเหลือ 20 ตัวอักษรแล้ว) */
  actor: string;
}

export interface ApplyProgressResult {
  progressId: number;
  projectId: number;
  projStateId: number;
  pctComplete: number;
  stateStatus: StateStatus;
  projectStatus: ProjectStatus | null;
}

/**
 * บันทึกความคืบหน้าของ state (พอร์ตจาก ProjectProgressService.UpdateStateProgress) ทั้งหมดใน transaction ของผู้เรียก:
 *   1) เพิ่มแถว t_project_progress  2) ตั้งสถานะ state ตาม % (0=Pending, 100=Completed, อื่นๆ=InProgress)
 *   3) คำนวณสถานะโครงการใหม่
 * ต่างจากเดิม: ระบบเดิมแยกเป็นหลายคำสั่งคนละ connection และกลืน exception — ที่นี่ล้มแล้ว rollback ทั้งหมด
 */
export async function applyStateProgress(
  manager: EntityManager,
  input: ApplyProgressInput,
): Promise<ApplyProgressResult> {
  const state = await requireState(manager, input.projStateId);
  const stateStatus = stateStatusFromPct(input.pctComplete);

  const progress = await manager.save(ProjectProgress, {
    projStateId: state.projStateId,
    projectId: state.projectId,
    status: stateStatus,
    remark: input.remark?.trim() ? input.remark.trim() : null,
    pctComplete: input.pctComplete,
    actionUser: input.actor,
  });

  await manager.update(
    ProjectState,
    { projStateId: state.projStateId },
    { status: stateStatus, updateUser: input.actor, updateDate: NOW_SQL },
  );

  const projectStatus = await recalculateProjectStatus(manager, state.projectId, input.actor);
  return {
    progressId: progress.progressId,
    projectId: state.projectId,
    projStateId: state.projStateId,
    pctComplete: input.pctComplete,
    stateStatus,
    projectStatus,
  };
}

export const AUTO_SYNC_REMARK = 'Auto-sync จาก Tasks';

/** % ของ state = ค่าเฉลี่ย % ของ task หลักที่ใช้งานอยู่ แล้วบันทึกเป็นความคืบหน้า "Auto-sync จาก Tasks" (SyncStatePct) */
export async function syncStatePctFromTasks(
  manager: EntityManager,
  projStateId: number,
  actor: string,
): Promise<ApplyProgressResult> {
  const tasks = await manager.find(ProjectTask, {
    where: { projStateId, active: 'Y', parentTaskId: IsNull() },
  });
  const pct = averageTaskPct(
    tasks.map((t) => ({ pctComplete: t.pctComplete ?? 0, status: t.status })),
  );
  return applyStateProgress(manager, {
    projStateId,
    pctComplete: pct,
    remark: AUTO_SYNC_REMARK,
    actor,
  });
}

// ───────────────────────── State ─────────────────────────

export async function nextStateSeq(manager: EntityManager, projectId: number): Promise<number> {
  const rows = await manager.find(ProjectState, { where: { projectId } });
  return nextSeqNo(rows.map((r) => r.seqNo));
}

export async function usedEstimatedDays(
  manager: EntityManager,
  projectId: number,
  excludeStateId = 0,
): Promise<number> {
  const rows = await manager.find(ProjectState, { where: { projectId } });
  return rows
    .filter((r) => r.projStateId !== excludeStateId)
    .reduce((sum, r) => sum + (r.estimatedDays ?? 0), 0);
}

export interface StateInput {
  name: string;
  description?: string | null;
  required?: boolean;
  estimatedDays?: number | null;
  refProjectId?: number | null;
  /** อ้างขั้นตอนของ template (m_template_state.i_state_id) ถ้าสร้างมาจาก template */
  templateStateId?: number | null;
}

/** โครงการอ้างอิง (ref project) ต้องเป็นโครงการที่ยังใช้งานอยู่และไม่ใช่โครงการตัวเอง */
export async function assertValidRefProject(
  manager: EntityManager,
  projectId: number | null,
  refProjectId: number | null | undefined,
): Promise<void> {
  if (!refProjectId) return;
  if (projectId !== null && refProjectId === projectId) {
    throw new BusinessException('ไม่สามารถอ้างอิงโครงการตัวเองได้', 'REF_PROJECT_SELF');
  }
  const ref = await manager.findOneBy(Project, { projectId: refProjectId, active: 'Y' });
  if (!ref) {
    throw new BusinessException(
      `ไม่พบโครงการอ้างอิง (${refProjectId}) หรือถูกลบแล้ว`,
      'REF_PROJECT_NOT_FOUND',
    );
  }
}

/** เพิ่ม state ต่อท้าย (i_seq_no = MAX+1 เหมือน AddState เดิม) สถานะเริ่ม Pending */
export async function insertProjectState(
  manager: EntityManager,
  projectId: number,
  input: StateInput,
  actor: string,
): Promise<ProjectState> {
  await assertValidRefProject(manager, projectId, input.refProjectId);
  return manager.save(ProjectState, {
    projectId,
    stateId: input.templateStateId ?? null,
    stateName: input.name.trim(),
    seqNo: await nextStateSeq(manager, projectId),
    description: input.description?.trim() ? input.description.trim() : null,
    required: toYesNo(input.required),
    status: 'Pending',
    estimatedDays: input.estimatedDays ?? null,
    refProjectId: input.refProjectId ?? null,
    createUser: actor,
  });
}

// ───────────────────────── เอกสารใน workflow ─────────────────────────

export async function nextDocSeq(manager: EntityManager, projStateId: number): Promise<number> {
  const rows = await manager.find(ProjectDocWorkflow, { where: { projStateId } });
  return nextSeqNo(rows.map((r) => r.seqNo));
}

export interface DocInput {
  name: string;
  docType?: string | null;
  required?: boolean;
  remark?: string | null;
  /** อ้าง BUI_RG.dbo.m_document.doc_id (null = กรอกเอง) */
  masterDocId?: number | null;
}

/** เพิ่มเอกสารต่อท้ายของ state (สถานะเริ่ม Pending) — ตรวจว่า state เป็นของโครงการนี้ */
export async function insertProjectDoc(
  manager: EntityManager,
  state: Pick<ProjectState, 'projStateId' | 'projectId'>,
  input: DocInput,
  actor: string,
): Promise<ProjectDocWorkflow> {
  return manager.save(ProjectDocWorkflow, {
    projStateId: state.projStateId,
    projectId: state.projectId,
    docId: input.masterDocId ?? null,
    docName: input.name.trim(),
    docType: input.docType?.trim() ? input.docType.trim() : null,
    required: toYesNo(input.required),
    docStatus: 'Pending',
    remark: input.remark?.trim() ? input.remark.trim() : null,
    seqNo: await nextDocSeq(manager, state.projStateId),
    createUser: actor,
  });
}
