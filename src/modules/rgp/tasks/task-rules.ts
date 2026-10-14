import { toDateOnly, todayDateOnly } from '../common/rgp-rules';

/**
 * กฎของ Task ที่เป็นฟังก์ชันล้วน (ธง SLA/เลยกำหนด, ต้นไม้ sub task, การเรียงลำดับ) — พอร์ตจาก SQL ของ ProjectTaskRepository
 * ทำใน TypeScript เพื่อเทสต์ได้โดยไม่ต้องมี SQL Server (จำนวน task ต่อโครงการหลักสิบ–ร้อยแถว)
 */

const DAY_MS = 86_400_000;
/** สถานะที่ถือว่า "ไม่ต้องไล่งานแล้ว" — ไม่ติดธงเลยกำหนด/SLA (ระบบเดิมยกเว้น Done, OnHold; เพิ่ม Cancelled ที่ระบบเดิมไม่มี) */
const NOT_CHASED = new Set(['Done', 'OnHold', 'Cancelled']);

function dayNumber(dateOnly: string): number {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** จำนวนวันตามขอบเขตวัน (เหมือน `DATEDIFF(DAY, a, b)` ของ SQL Server) */
export function dateDiffDays(a: string, b: string): number {
  return Math.round((dayNumber(b) - dayNumber(a)) / DAY_MS);
}

export interface TaskFlagInput {
  dueDate?: Date | string | null;
  createDate?: Date | string | null;
  status?: string | null;
}

export interface TaskFlags {
  overdue: boolean;
  slaWarning: boolean;
}

/**
 * ธงของ Task:
 *  - overdue    : มีวันกำหนดเสร็จ ผ่านมาแล้ว (< วันนี้) และสถานะยังไม่ปิด
 *  - slaWarning : เวลาตั้งแต่สร้างผ่านไป ≥ 80% ของช่วง (สร้าง → กำหนดเสร็จ)
 */
export function computeTaskFlags(task: TaskFlagInput, now: Date = new Date()): TaskFlags {
  const due = toDateOnly(task.dueDate);
  if (!due || NOT_CHASED.has(task.status ?? '')) return { overdue: false, slaWarning: false };
  const today = todayDateOnly(now);
  const created = toDateOnly(task.createDate) ?? today;
  const total = dateDiffDays(created, due);
  const elapsed = dateDiffDays(created, today);
  return {
    overdue: due < today,
    slaWarning: total !== 0 && elapsed / total >= 0.8,
  };
}

export interface TreeTask {
  taskId: number;
  parentTaskId?: number | null;
}

export interface TreeNode<T extends TreeTask> {
  task: T;
  depth: number;
}

/**
 * เรียง task เป็นต้นไม้แบบ depth-first (พี่น้องเรียงตาม taskId) พร้อมระดับ — เทียบเท่า recursive CTE `GetAllTasksForProject`
 * รับเฉพาะ task ที่ใช้งานอยู่ · sub task ที่ parent ไม่อยู่ในชุด (ถูกลบ) จะไม่ปรากฏ เหมือนเดิม
 */
export function buildTaskTree<T extends TreeTask>(tasks: T[], maxDepth = 50): TreeNode<T>[] {
  const children = new Map<number | null, T[]>();
  for (const t of tasks) {
    const key = t.parentTaskId ?? null;
    const list = children.get(key);
    if (list) list.push(t);
    else children.set(key, [t]);
  }
  for (const list of children.values()) list.sort((a, b) => a.taskId - b.taskId);

  const out: TreeNode<T>[] = [];
  const walk = (parent: number | null, depth: number): void => {
    if (depth > maxDepth) return;
    for (const t of children.get(parent) ?? []) {
      out.push({ task: t, depth });
      walk(t.taskId, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export interface SortableTask {
  taskId: number;
  priority?: number | null;
  dueDate?: Date | string | null;
  createDate?: Date | string | null;
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** เรียง task หลักของ state: priority มากก่อน → วันกำหนดเสร็จ (ไม่มีวัน = ก่อน เหมือน SQL Server) → วันที่สร้าง */
export function sortStateTasks<T extends SortableTask>(tasks: T[]): T[] {
  const key = (v: Date | string | null | undefined): string => toDateOnly(v) ?? '';
  const time = (v: Date | string | null | undefined): number =>
    v instanceof Date ? v.getTime() : v ? new Date(v).getTime() : 0;
  return [...tasks].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      cmp(key(a.dueDate), key(b.dueDate)) ||
      time(a.createDate) - time(b.createDate) ||
      a.taskId - b.taskId,
  );
}
