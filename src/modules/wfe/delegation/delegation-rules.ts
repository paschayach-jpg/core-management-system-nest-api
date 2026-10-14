import { MAX_DELEGATION_DEPTH } from '../common/wfe.constants';
import { sameUser } from '../common/wfe-access';
import { isInstanceActionable, isStepActionable } from '../instance/instance-rules';

/**
 * Pure rules ของการมอบหมายงาน (dbo.WFDelegation) — พอร์ตจาก WorkflowDelegationService.ValidateDelegation
 * + sp_WF_CreateDelegation และเพิ่ม 3 ข้อที่ผู้ใช้กำหนด: ห้ามมอบให้ตัวเอง, ห้ามวนกลับหาคนที่เคยอยู่ในสายมอบหมาย,
 * ห้ามมอบเมื่อ step ไม่เปิดให้ทำ
 */

export interface DelegationHistoryItem {
  delegationId: number;
  delegatedFrom: string;
  delegatedTo: string;
  delegationDepth: number;
  isActive: boolean;
}

export type DelegationViolationCode =
  | 'DELEGATE_REQUIRED'
  | 'NOT_ASSIGNEE'
  | 'INSTANCE_NOT_ACTIVE'
  | 'STEP_NOT_ACTIVE'
  | 'DELEGATION_NOT_ALLOWED'
  | 'SELF_DELEGATION'
  | 'DELEGATION_CYCLE'
  | 'MAX_DEPTH_EXCEEDED'
  | 'DATE_RANGE_INVALID';

export interface DelegationViolation {
  code: DelegationViolationCode;
  message: string;
}

export interface DelegationCheckInput {
  caller: string;
  delegateTo: string | null | undefined;
  assignedTo: string | null | undefined;
  stepStatus: number;
  instanceStatus: number;
  /** AllowDelegation ของ step (UI เดิมเปิดปุ่มมอบหมายเฉพาะ step ที่ true) */
  stepAllowsDelegation: boolean;
  /** ประวัติการมอบหมายของ step instance นี้ (IsDeleted = 0) */
  history: readonly DelegationHistoryItem[];
  startDate?: Date | null;
  endDate?: Date | null;
}

/** ความลึกที่จะเป็นของการมอบหมายครั้งถัดไป = MAX(DelegationDepth) + 1 (เหมือน sp_WF_CreateDelegation) */
export function nextDelegationDepth(history: readonly DelegationHistoryItem[]): number {
  return history.reduce((m, h) => Math.max(m, h.delegationDepth), 0) + 1;
}

/** ผู้ใช้ทุกคนที่เคยอยู่ในสายมอบหมาย (ทั้งผู้มอบและผู้รับ) */
export function usersInChain(history: readonly DelegationHistoryItem[]): string[] {
  return history.flatMap((h) => [h.delegatedFrom, h.delegatedTo]);
}

/** ตรวจการมอบหมาย — คืนข้อผิดพลาดข้อแรกที่พบ หรือ null ถ้าทำได้ (ลำดับตรวจเหมือน ValidateDelegation เดิมแล้วต่อด้วยกฎใหม่) */
export function checkDelegation(input: DelegationCheckInput): DelegationViolation | null {
  const to = input.delegateTo?.trim();
  if (!to) return { code: 'DELEGATE_REQUIRED', message: 'ต้องระบุผู้รับมอบหมาย' };

  if (!sameUser(input.assignedTo, input.caller))
    return { code: 'NOT_ASSIGNEE', message: 'คุณไม่ใช่ผู้รับผิดชอบงานนี้' };

  if (!isInstanceActionable(input.instanceStatus))
    return {
      code: 'INSTANCE_NOT_ACTIVE',
      message: 'workflow นี้ไม่ได้อยู่ระหว่างดำเนินการ จึงมอบหมายงานไม่ได้',
    };

  if (!isStepActionable(input.stepStatus))
    return {
      code: 'STEP_NOT_ACTIVE',
      message: 'งานนี้เสร็จสิ้นหรือถูกปฏิเสธไปแล้ว จึงมอบหมายไม่ได้',
    };

  if (!input.stepAllowsDelegation)
    return { code: 'DELEGATION_NOT_ALLOWED', message: 'ขั้นตอนนี้ไม่อนุญาตให้มอบหมายงานต่อ' };

  if (sameUser(to, input.caller))
    return { code: 'SELF_DELEGATION', message: 'ไม่สามารถมอบหมายงานให้ตัวเองได้' };

  if (usersInChain(input.history).some((u) => sameUser(u, to)))
    return {
      code: 'DELEGATION_CYCLE',
      message: `ไม่สามารถมอบหมายให้ '${to}' ได้ เพราะเป็นผู้ที่เคยอยู่ในสายการมอบหมายของงานนี้แล้ว (วนกลับ)`,
    };

  if (nextDelegationDepth(input.history) > MAX_DELEGATION_DEPTH)
    return {
      code: 'MAX_DEPTH_EXCEEDED',
      message: `มอบหมายงานต่อได้สูงสุด ${MAX_DELEGATION_DEPTH} ระดับ`,
    };

  if (input.startDate && input.endDate && input.endDate.getTime() <= input.startDate.getTime())
    return { code: 'DATE_RANGE_INVALID', message: 'วันสิ้นสุดต้องมากกว่าวันเริ่มต้น' };

  return null;
}

/**
 * ผู้ที่ยกเลิก/ปิด delegation ได้: ผู้มอบ (DelegatedFrom), ผู้รับ (DelegatedTo — "คืนงาน") หรือ Manager ขึ้นไป
 * คืน 'RETURN' เมื่อผู้รับเป็นคนทำ (คืนงานให้ผู้มอบ), 'CANCEL' เมื่อผู้มอบ/ผู้จัดการเป็นคนทำ
 */
export function deactivationKind(
  caller: string,
  isManager: boolean,
  delegation: Pick<DelegationHistoryItem, 'delegatedFrom' | 'delegatedTo'>,
): 'RETURN' | 'CANCEL' | null {
  if (sameUser(caller, delegation.delegatedFrom)) return 'CANCEL';
  if (sameUser(caller, delegation.delegatedTo)) return 'RETURN';
  return isManager ? 'CANCEL' : null;
}
