import { WorkflowTemplateStatus } from '../../../common/constants/enums';

/** การกระทำที่เปลี่ยนวงจรชีวิตของ template */
export type TemplateAction =
  'SUBMIT' | 'APPROVE' | 'REJECT' | 'PUBLISH' | 'DEACTIVATE' | 'DEPRECATE';

interface TransitionRule {
  from: readonly WorkflowTemplateStatus[];
  to: WorkflowTemplateStatus;
  /** ข้อความ error ภาษาไทยเมื่อสถานะปัจจุบันไม่อยู่ใน `from` */
  requirement: string;
}

const S = WorkflowTemplateStatus;

/**
 * ตารางการเปลี่ยนสถานะ template (04-business-rules.md §5.1)
 *
 *   Draft ──SUBMIT──▶ PendingApproval ──APPROVE──▶ Active ──DEACTIVATE──▶ Inactive ──PUBLISH──▶ Active
 *     ▲                     │ REJECT                  │                        │
 *     └─────────────────────┘                         └──────DEPRECATE────────▶ Deprecated (สิ้นสุด)
 *   Draft ──PUBLISH (ตรง)──▶ Active
 *
 * ต่างจากระบบเดิม: เดิม PublishTemplate/DeactivateTemplate ไม่ตรวจสถานะก่อนเลย (ทำได้จากทุกสถานะ)
 */
export const TEMPLATE_TRANSITIONS: Record<TemplateAction, TransitionRule> = {
  SUBMIT: {
    from: [S.Draft],
    to: S.PendingApproval,
    requirement: 'เฉพาะ Template ที่เป็น Draft เท่านั้นที่สามารถส่งอนุมัติได้',
  },
  APPROVE: {
    from: [S.PendingApproval],
    to: S.Active,
    requirement: 'เฉพาะ Template ที่รออนุมัติเท่านั้นที่สามารถอนุมัติได้',
  },
  REJECT: {
    from: [S.PendingApproval],
    to: S.Draft,
    requirement: 'เฉพาะ Template ที่รออนุมัติเท่านั้นที่สามารถปฏิเสธได้',
  },
  PUBLISH: {
    from: [S.Draft, S.Inactive],
    to: S.Active,
    requirement: 'เผยแพร่ตรงได้เฉพาะ Template ที่เป็น Draft หรือ Inactive',
  },
  DEACTIVATE: {
    from: [S.Active],
    to: S.Inactive,
    requirement: 'ปิดใช้งานได้เฉพาะ Template ที่เป็น Active',
  },
  DEPRECATE: {
    from: [S.Active, S.Inactive],
    to: S.Deprecated,
    requirement: 'ยกเลิกเวอร์ชันได้เฉพาะ Template ที่เป็น Active หรือ Inactive',
  },
};

export interface TemplateStateResult {
  approvalStatus: WorkflowTemplateStatus;
  /** `IsActive` ต้องคู่กับสถานะเสมอ: true เฉพาะ Active */
  isActive: boolean;
}

export const TEMPLATE_STATUS_LABEL: Record<WorkflowTemplateStatus, string> = {
  [S.Draft]: 'Draft',
  [S.PendingApproval]: 'PendingApproval',
  [S.Active]: 'Active',
  [S.Inactive]: 'Inactive',
  [S.Deprecated]: 'Deprecated',
};

export function templateIsActiveFor(status: WorkflowTemplateStatus): boolean {
  return status === S.Active;
}

/** ตรวจว่า action ทำได้จากสถานะปัจจุบันไหม — คืนผลลัพธ์ หรือ null ถ้าทำไม่ได้ */
export function nextTemplateState(
  current: WorkflowTemplateStatus,
  action: TemplateAction,
): TemplateStateResult | null {
  const rule = TEMPLATE_TRANSITIONS[action];
  if (!rule.from.includes(current)) return null;
  return { approvalStatus: rule.to, isActive: templateIsActiveFor(rule.to) };
}

/** ข้อความ error ภาษาไทยของการเปลี่ยนสถานะที่ไม่ได้ (รวมสถานะปัจจุบัน เหมือนข้อความเดิม) */
export function transitionErrorMessage(
  current: WorkflowTemplateStatus,
  action: TemplateAction,
): string {
  return `${TEMPLATE_TRANSITIONS[action].requirement} (สถานะปัจจุบัน: ${TEMPLATE_STATUS_LABEL[current] ?? current})`;
}

/**
 * แก้ไขข้อมูล template (ชื่อ/คำอธิบาย/หมวด/definition) ได้เมื่อใด
 * - Draft, Active, Inactive: ได้ (ระบบเดิมแก้ได้ทุกสถานะ แม้มี instance ทำงานอยู่ — ตั้งใจ bypass ไว้)
 * - PendingApproval: ห้าม (ผู้อนุมัติกำลังพิจารณาฉบับนี้ — ต้อง Reject กลับ Draft ก่อน)
 * - Deprecated: ห้าม (สิ้นสุดแล้ว)
 */
export function isTemplateEditable(status: WorkflowTemplateStatus): boolean {
  return status === S.Draft || status === S.Active || status === S.Inactive;
}

/** แก้ step/connection (โครงสร้าง) ได้เฉพาะ Draft — Active/Inactive มี instance อ้างอิง step อยู่ */
export function isStructureEditable(status: WorkflowTemplateStatus): boolean {
  return status === S.Draft;
}

/** สถานะที่รับ "สร้าง instance" ได้: ต้อง Active (และ IsActive) */
export function canInstantiate(status: WorkflowTemplateStatus, isActive: boolean): boolean {
  return status === S.Active && isActive;
}
