import { SlaStatus, WorkflowStepInstanceStatus as SS } from '../../../common/constants/enums';
import { WFE_DEFAULTS } from '../common/wfe.constants';

/**
 * Pure functions ของ SLA (พอร์ตจาก SLACalculator.cs — ส่วนที่ไม่แตะ DB)
 *
 * กฎ (04-business-rules.md §5.4):
 *  - ครบกำหนดแล้ว = Overdue
 *  - ใช้เวลาไปแล้ว ≥ threshold% ของช่วง [AssignedDate, SLADeadline] = AtRisk
 *  - อื่นๆ = OnTime
 *  - step ที่เสร็จแล้ว: เสร็จภายใน deadline = OnTime, เกิน = Overdue (ไม่มี AtRisk)
 */

export interface SlaInput {
  /** สถานะ step instance (1=Pending … 5=Delegated) */
  status: number;
  assignedDate: Date | null;
  slaDeadline: Date | null;
  completedDate?: Date | null;
}

/** ค่าที่ใช้กำหนด deadline ของ step: SLAHours มาก่อน, รองลงมา SLADays×24, ไม่มีก็ใช้ค่าเริ่มต้นจาก SystemConfig */
export interface SlaWindowSource {
  slaHours: number | null | undefined;
  slaDays: number | null | undefined;
}

export function clampThreshold(percent: number): number {
  if (!Number.isFinite(percent)) return WFE_DEFAULTS.slaWarningThresholdPercent;
  return Math.min(100, Math.max(0, percent));
}

/**
 * ชั่วโมงของ SLA ของ step — ต่างจากระบบเดิมที่ฝัง `now + 24 ชม.` ทุก step (ไม่อ่าน SLAHours/SLADays ที่ designer ตั้ง)
 */
export function slaHoursFor(step: SlaWindowSource, defaultHours: number): number {
  if (step.slaHours && step.slaHours > 0) return step.slaHours;
  if (step.slaDays && step.slaDays > 0) return step.slaDays * 24;
  return defaultHours > 0 ? defaultHours : WFE_DEFAULTS.slaDefaultHours;
}

export function computeSlaDeadline(
  assignedDate: Date,
  step: SlaWindowSource,
  defaultHours: number,
): Date {
  return new Date(assignedDate.getTime() + slaHoursFor(step, defaultHours) * 3_600_000);
}

/**
 * สถานะ SLA ของ step instance ณ เวลา `now`
 * @param warningThresholdPercent WorkflowSLAWarningThresholdPercent (ค่าเริ่มต้น 75)
 */
export function evaluateSlaStatus(
  input: SlaInput,
  now: Date,
  warningThresholdPercent: number = WFE_DEFAULTS.slaWarningThresholdPercent,
): SlaStatus {
  const { status, assignedDate, slaDeadline } = input;
  // ไม่มี deadline = ไม่มีอะไรให้เลยกำหนด
  if (!slaDeadline) return SlaStatus.OnTime;

  if (status === SS.Completed) {
    const done = input.completedDate ?? now;
    return done.getTime() <= slaDeadline.getTime() ? SlaStatus.OnTime : SlaStatus.Overdue;
  }

  if (now.getTime() > slaDeadline.getTime()) return SlaStatus.Overdue;

  const threshold = clampThreshold(warningThresholdPercent);
  const start = assignedDate?.getTime();
  if (start === undefined || Number.isNaN(start)) return SlaStatus.OnTime;
  const total = slaDeadline.getTime() - start;
  // ช่วงเวลาเป็นศูนย์/ติดลบ (deadline ไม่เกินเวลามอบหมาย) แต่ยังไม่เลยกำหนด → ถือว่าเสี่ยง
  if (total <= 0) return SlaStatus.AtRisk;
  const usedPercent = ((now.getTime() - start) / total) * 100;
  return usedPercent >= threshold ? SlaStatus.AtRisk : SlaStatus.OnTime;
}

/** นาทีที่เหลือถึง deadline (ติดลบ = เลยกำหนด) — null ถ้าไม่มี deadline */
export function minutesRemaining(deadline: Date | null | undefined, now: Date): number | null {
  if (!deadline) return null;
  return Math.trunc((deadline.getTime() - now.getTime()) / 60_000);
}

/** ชั่วโมงที่เลยกำหนด (0 ถ้ายังไม่เลย) ปัดทศนิยม 1 ตำแหน่ง */
export function hoursOverdue(deadline: Date | null | undefined, now: Date): number {
  if (!deadline || now.getTime() <= deadline.getTime()) return 0;
  return Math.round(((now.getTime() - deadline.getTime()) / 3_600_000) * 10) / 10;
}

/** เปอร์เซ็นต์ปัดทศนิยม 1 ตำแหน่ง; ตัวหารเป็น 0 → 0 */
export function percentOf(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export interface SlaTransition {
  stepInstanceId: number;
  from: SlaStatus | null;
  to: SlaStatus;
}

/**
 * หา step instance ที่สถานะ SLA เปลี่ยน (ใช้ใน cron) — คืนเฉพาะที่ต่างจากค่าที่เก็บอยู่
 * `stored` เป็น null/0 (ยังไม่เคยตั้ง) ถือว่าเปลี่ยนเมื่อค่าใหม่ไม่ใช่ OnTime
 */
export function diffSlaStatus(
  rows: readonly (SlaInput & { stepInstanceId: number; slaStatus: number | null })[],
  now: Date,
  warningThresholdPercent: number,
): SlaTransition[] {
  const out: SlaTransition[] = [];
  for (const r of rows) {
    const next = evaluateSlaStatus(r, now, warningThresholdPercent);
    const stored =
      r.slaStatus && r.slaStatus >= 1 && r.slaStatus <= 3 ? (r.slaStatus as SlaStatus) : null;
    if (stored === next) continue;
    if (stored === null && next === SlaStatus.OnTime) continue;
    out.push({ stepInstanceId: r.stepInstanceId, from: stored, to: next });
  }
  return out;
}
