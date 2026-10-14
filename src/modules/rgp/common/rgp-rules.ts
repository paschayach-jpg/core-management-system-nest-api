import type { YesNo } from '../../../common/constants/enums';

/**
 * กฎธุรกิจของ RGP ที่เป็นฟังก์ชันล้วน (ไม่แตะ DB) — แยกไว้เพื่อเทสต์ตรงๆ
 * ที่มา: docs/reference/legacy-analysis/04-business-rules.md §4 และ CMS.Services/Project*.cs
 */

// ───────────────────────── สถานะ ─────────────────────────

/** สถานะโครงการ — `Cancelled` เกิดจากการลบ (soft delete) เท่านั้น */
export const PROJECT_STATUSES = ['Open', 'InProgress', 'Completed', 'Cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATE_STATUSES = ['Pending', 'InProgress', 'Completed'] as const;
export type StateStatus = (typeof STATE_STATUSES)[number];

/**
 * สถานะ Task — เอกสารวิเคราะห์ระบุ Todo|InProgress|Done|OnHold|Cancelled แต่หน้าจอเดิม (Frm_Project_Task_Status,
 * Frm_Project_Task_List, Frm_Task_Dashboard) ใช้ `InReview` ด้วย จึงรับทั้ง 6 ค่า (ดู docs/modules/rgp.md)
 */
export const TASK_STATUSES = [
  'Todo',
  'InProgress',
  'InReview',
  'Done',
  'OnHold',
  'Cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** สถานะเอกสารใน workflow ของโครงการ (ตามรายการใน Frm_Doc_Workflow_Edit) */
export const DOC_STATUSES = ['Pending', 'Received', 'Verified', 'Rejected'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** ความลึกสูงสุดของ sub-task — ระบบเดิมไม่จำกัด แต่ query ต้นไม้ใช้ MAXRECURSION 50 จึงกันไว้ก่อนถึงขีดนั้น */
export const MAX_SUBTASK_DEPTH = 20;

/** thread ของ comment ลึกสุด 3 ระดับ (depth 0,1,2) — BR-011-05 */
export const MAX_COMMENT_DEPTH = 2;

// ───────────────────────── ธง Y/N ─────────────────────────

export const toYesNo = (value: boolean | undefined, fallback: YesNo = 'Y'): YesNo =>
  value === undefined ? fallback : value ? 'Y' : 'N';

export const fromYesNo = (value: string | null | undefined): boolean => value === 'Y';

// ───────────────────────── ความคืบหน้า / สถานะ ─────────────────────────

/** % ความคืบหน้าของ state → สถานะ state: 0=Pending, 100=Completed, อื่นๆ=InProgress */
export function stateStatusFromPct(pct: number): StateStatus {
  if (pct === 0) return 'Pending';
  if (pct === 100) return 'Completed';
  return 'InProgress';
}

export interface StateStatusView {
  required: boolean;
  status: string;
}

/**
 * คำนวณสถานะโครงการใหม่จากสถานะของ state ทั้งหมด (พอร์ตจาก ProjectProgressService.RecalculateProjectStatus)
 *  - ทุก required state เป็น Completed และมี progress (state ใดๆ เป็น InProgress/Completed) → Completed
 *  - มี progress อย่างน้อยหนึ่ง state → InProgress
 *  - ไม่มี → Open
 * หมายเหตุ: "ทุก required state" เป็นจริงโดยปริยายเมื่อโครงการไม่มี required state เลย (พฤติกรรมเดิม — ดู docs ข้อ 3)
 */
export function computeProjectStatus(
  states: StateStatusView[],
): 'Open' | 'InProgress' | 'Completed' {
  const hasAnyProgress = states.some((s) => s.status === 'InProgress' || s.status === 'Completed');
  const allRequiredCompleted = states.every((s) => !s.required || s.status === 'Completed');
  if (allRequiredCompleted && hasAnyProgress) return 'Completed';
  if (hasAnyProgress) return 'InProgress';
  return 'Open';
}

/** ตรวจก่อนปิดโครงการ: ไม่มี required state ที่ยังไม่ Completed (พอร์ตจาก AllRequiredStatesCompleted) */
export function allRequiredStatesCompleted(states: StateStatusView[]): boolean {
  return states.every((s) => !s.required || s.status === 'Completed');
}

/** โครงการมี state ที่เลย Pending ไปแล้วหรือไม่ — ใช้บล็อกการลบโครงการ (พอร์ตจาก HasActiveProgress) */
export function hasActiveProgress(states: Pick<StateStatusView, 'status'>[]): boolean {
  return states.some((s) => s.status !== 'Pending');
}

/** ตัดทศนิยมแบบ SQL Server `CAST(float AS INT)` (ปัดเข้าหาศูนย์) */
const sqlTruncate = (n: number): number => (Number.isFinite(n) ? Math.trunc(n) : 0);

export interface StateProgressView {
  /** % ล่าสุดของ state เอง (0 ถ้ายังไม่มี progress) */
  pct: number;
  /** ถ้า state อ้างโครงการอื่น (ref project) ให้ใช้ % รวมของโครงการนั้นแทน */
  refProjectId?: number | null;
  refPctOverall?: number | null;
}

/** % รวมของโครงการ = ค่าเฉลี่ย % ล่าสุดของทุก state (state ที่มี ref project ใช้ % รวมของ ref แทน) — CalculateOverallProgress */
export function overallProjectPct(states: StateProgressView[]): number {
  if (states.length === 0) return 0;
  const sum = states.reduce(
    (acc, s) => acc + (s.refProjectId ? (s.refPctOverall ?? 0) : (s.pct ?? 0)),
    0,
  );
  return sqlTruncate(sum / states.length);
}

// ───────────────────────── Task ─────────────────────────

export interface TaskPctView {
  pctComplete: number;
  status?: string | null;
}

/**
 * % ของ state จาก task หลัก (root, ใช้งานอยู่) = ค่าเฉลี่ย % — CalcStatePctFromTasks
 * task ที่ `Cancelled` ไม่นับ (ระบบเดิมไม่มีสถานะนี้ — ดู docs ข้อ 3) · ไม่มี task = 0
 */
export function averageTaskPct(tasks: TaskPctView[]): number {
  const counted = tasks.filter((t) => t.status !== 'Cancelled');
  if (counted.length === 0) return 0;
  return sqlTruncate(counted.reduce((a, t) => a + t.pctComplete, 0) / counted.length);
}

export interface TaskStatusChange {
  status: TaskStatus;
  pctComplete: number;
}

/**
 * ผลของการเปลี่ยนสถานะ Task:
 *  - OnHold  → ตรึง % ไว้ที่ค่าเดิม (ไม่สนใจ % ที่ส่งมา) — พฤติกรรมเดิมของ ProjectTaskService.UpdateStatus
 *  - Done    → 100 · Todo → 0 (หน้าจอเดิมบังคับ จึงบังคับที่ API ด้วย)
 *  - อื่นๆ   → ใช้ % ที่ส่งมา ถ้าไม่ส่งใช้ % เดิม
 */
export function resolveTaskStatusChange(
  current: { status?: string | null; pctComplete: number },
  requested: { status: TaskStatus; pctComplete?: number },
): TaskStatusChange {
  switch (requested.status) {
    case 'OnHold':
      return { status: 'OnHold', pctComplete: current.pctComplete };
    case 'Done':
      return { status: 'Done', pctComplete: 100 };
    case 'Todo':
      return { status: 'Todo', pctComplete: 0 };
    default:
      return {
        status: requested.status,
        pctComplete: requested.pctComplete ?? current.pctComplete,
      };
  }
}

// ───────────────────────── ลำดับ / วัน ─────────────────────────

/** ลำดับถัดไป = MAX + 1 (เริ่มที่ 1) */
export function nextSeqNo(existing: (number | null | undefined)[]): number {
  return existing.reduce<number>((max, v) => Math.max(max, v ?? 0), 0) + 1;
}

const DAY_MS = 86_400_000;

/** แยก 'YYYY-MM-DD' เป็นเวลาเที่ยงคืน UTC (กันปัญหา timezone เวลาลบวันที่) */
function dayNumber(dateOnly: string): number {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** จำนวนวันระหว่างวันเริ่มกับวันครบกำหนด (due − start) — ไม่ใช่ช่วงที่ถูกต้องคืน null */
export function projectTotalDays(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): number | null {
  if (!startDate || !dueDate) return null;
  const days = Math.round((dayNumber(dueDate) - dayNumber(startDate)) / DAY_MS);
  return days > 0 ? days : null;
}

export interface EstimatedDaysCheck {
  ok: boolean;
  totalDays?: number;
  usedDays?: number;
  remainingDays?: number;
}

/**
 * ผลรวมวันคาดการณ์ของขั้นตอนต้องไม่เกินช่วงวันของโครงการ (กฎที่เดิมตรวจเฉพาะหน้าจอ Frm_Project_State_Edit)
 * ตรวจเฉพาะเมื่อโครงการมีวันเริ่ม/ครบกำหนดที่ครบกำหนด > เริ่ม และ state นี้ระบุวัน > 0
 * @param usedByOthers ผลรวมวันของ state อื่นในโครงการ (ไม่รวม state ที่กำลังเพิ่ม/แก้)
 */
export function checkEstimatedDays(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
  usedByOthers: number,
  estimatedDays: number | null | undefined,
): EstimatedDaysCheck {
  const total = projectTotalDays(startDate, dueDate);
  if (total === null || !estimatedDays || estimatedDays <= 0) return { ok: true };
  const remaining = total - usedByOthers;
  return {
    ok: estimatedDays <= remaining,
    totalDays: total,
    usedDays: usedByOthers,
    remainingDays: remaining,
  };
}

// ───────────────────────── วันที่แบบ date-only ─────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * คอลัมน์ `date` ของ SQL Server ถูก TypeORM คืนเป็นสตริง 'YYYY-MM-DD' ที่ runtime แม้ entity จะประกาศเป็น Date
 * ฟังก์ชันนี้รับได้ทั้งสองแบบและคืนสตริงวันที่ (ท้องถิ่น) หรือ null
 */
export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

/** สตริง 'YYYY-MM-DD' → Date (เวลาท้องถิ่น 00:00) สำหรับเขียนลงคอลัมน์ `date` */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** วันนี้ในรูป 'YYYY-MM-DD' (เวลาท้องถิ่นของ process) */
export function todayDateOnly(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
