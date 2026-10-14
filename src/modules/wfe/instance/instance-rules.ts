import {
  WorkflowInstanceStatus as IS,
  WorkflowStepInstanceStatus as SS,
} from '../../../common/constants/enums';
import { SP_INITIAL_INSTANCE_STATUS, TERMINAL_INSTANCE_STATUSES } from '../common/wfe.constants';

/** การกระทำระดับ instance */
export type InstanceAction = 'SUSPEND' | 'RESUME' | 'CANCEL';

interface InstanceRule {
  from: readonly number[];
  to: IS;
  requirement: string;
}

/**
 * สถานะที่เปลี่ยนได้ของ instance — ตรงกับปุ่มใน WorkflowInstanceDetailPresenter.UpdateActionButtons:
 *   canSuspend = InProgress · canResume = Suspended · canCancel = InProgress | Suspended
 * ต่างจาก service เดิม (ไม่ตรวจอะไรเลยสำหรับ Suspend/Resume; Cancel เดิมแค่กัน Completed/Cancelled):
 * Cancel เพิ่มให้ยกเลิกได้ตอน Created (และ 0 ที่ SP ใส่ — กรณีค้างจากระบบเดิม) แต่ไม่ให้ยกเลิก Rejected
 */
export const INSTANCE_TRANSITIONS: Record<InstanceAction, InstanceRule> = {
  SUSPEND: {
    from: [IS.InProgress],
    to: IS.Suspended,
    requirement: 'ระงับได้เฉพาะ workflow ที่กำลังดำเนินการ',
  },
  RESUME: {
    from: [IS.Suspended],
    to: IS.InProgress,
    requirement: 'ทำต่อได้เฉพาะ workflow ที่ถูกระงับ',
  },
  CANCEL: {
    from: [SP_INITIAL_INSTANCE_STATUS, IS.Created, IS.InProgress, IS.Suspended],
    to: IS.Cancelled,
    requirement: 'ยกเลิกได้เฉพาะ workflow ที่ยังไม่เสร็จสิ้น (กำลังดำเนินการ/ถูกระงับ)',
  },
};

export const INSTANCE_STATUS_LABEL: Record<number, string> = {
  0: 'Created(SP)',
  [IS.Created]: 'Created',
  [IS.InProgress]: 'InProgress',
  [IS.Completed]: 'Completed',
  [IS.Rejected]: 'Rejected',
  [IS.Suspended]: 'Suspended',
  [IS.Cancelled]: 'Cancelled',
};

export function nextInstanceStatus(current: number, action: InstanceAction): IS | null {
  const rule = INSTANCE_TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}

export function instanceTransitionError(current: number, action: InstanceAction): string {
  return `${INSTANCE_TRANSITIONS[action].requirement} (สถานะปัจจุบัน: ${INSTANCE_STATUS_LABEL[current] ?? current})`;
}

/** ลบ instance (soft delete) ได้เฉพาะที่จบแล้ว — พอร์ตจาก WorkflowRepository.SoftDeleteWorkflowInstance (Status IN 3,4; เพิ่ม 6=Cancelled) */
export function canDeleteInstance(status: number): boolean {
  return TERMINAL_INSTANCE_STATUSES.includes(status);
}

/** ทำงานกับ step (เริ่ม/เสร็จ/ปฏิเสธ/มอบหมาย) ได้เฉพาะเมื่อ instance กำลังดำเนินการ (ระบบเดิมไม่ตรวจ — Suspend จึงไม่มีผลจริง) */
export function isInstanceActionable(status: number): boolean {
  return status === IS.InProgress;
}

/** step instance ที่ผู้รับผิดชอบยังกระทำได้: Pending, InProgress, Delegated */
export function isStepActionable(status: number): boolean {
  return status === SS.Pending || status === SS.InProgress || status === SS.Delegated;
}

export function canStartStep(status: number): boolean {
  return status === SS.Pending || status === SS.Delegated;
}

export const STEP_STATUS_LABEL: Record<number, string> = {
  [SS.Pending]: 'Pending',
  [SS.InProgress]: 'InProgress',
  [SS.Completed]: 'Completed',
  [SS.Rejected]: 'Rejected',
  [SS.Delegated]: 'Delegated',
};
