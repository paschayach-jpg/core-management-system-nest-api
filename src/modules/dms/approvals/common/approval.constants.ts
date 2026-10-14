import { ApprovalRequestStatus, ApprovalStepStatus } from '../../../../common/constants/enums';

/**
 * ค่าคงที่ของงานอนุมัติ/แชร์ — ตัวเลขทั้งหมดมาจาก ApprovalService / ShareService เดิม
 * (enum กลางใน src/common/constants/enums.ts แก้ไม่ได้จาก module นี้ จึงเก็บค่าที่ขาดไว้ที่นี่)
 */

/**
 * RequestStatus = 5: "ดาวน์โหลดแล้ว" (ใช้สิทธิ์ครบแล้ว) — ApprovalService.ConsumeDownloadApproval เขียนค่านี้
 * และ CHECK ใน DB อนุญาต 1–5 · enum กลางไม่มีค่านี้ (ตอบข้อสงสัย A5 ใน OPEN_QUESTIONS)
 */
export const REQUEST_STATUS_CONSUMED = 5;

/**
 * หมายเหตุสถานะ 4 ที่ความหมายซ้อน (ห้ามเปลี่ยนความหมาย — OPEN_QUESTIONS C5):
 *  - Request 4 = Expired ใช้กับ "ถอนคำขอ" ด้วย (WithdrawRequest เดิม)
 *  - Step 4 = Delegated ใช้กับ "ถูกยกระดับ (escalate)" และ "ปิดอัตโนมัติ (CREATE_HC)" ด้วย
 */
export const REQUEST_PENDING = ApprovalRequestStatus.Pending;
export const REQUEST_APPROVED = ApprovalRequestStatus.Approved;
export const REQUEST_REJECTED = ApprovalRequestStatus.Rejected;
export const REQUEST_EXPIRED_OR_WITHDRAWN = ApprovalRequestStatus.Expired;

export const STEP_PENDING = ApprovalStepStatus.Pending;
export const STEP_APPROVED = ApprovalStepStatus.Approved;
export const STEP_REJECTED = ApprovalStepStatus.Rejected;
export const STEP_DELEGATED_OR_AUTOCLOSED = ApprovalStepStatus.Delegated;

/** อายุคำขอ (วัน) ตามชนิด — นับจากเวลายื่น */
export const REQUEST_EXPIRY_DAYS = {
  /** SubmitPermissionRequest */
  permission: 1,
  /** RequestFolderDelete */
  deleteFolder: 7,
  /** SubmitDownloadRequest */
  download: 3,
  /** ShareService.PendingApprovalExpiryDays (internal/external share และขอแชร์โฟลเดอร์) */
  share: 7,
} as const;

/** ช่วงเลื่อน ExpiryDate หลัง escalate (วัน) — กันไม่ให้ cron ยก request เดิมซ้ำทุกรอบ (ดู docs ข้อ 3.6) */
export const ESCALATION_EXTENSION_DAYS = 1;

export const EXTERNAL_SHARE_MAX_DAYS = 90;
export const INTERNAL_SHARE_MAX_YEARS = 1;

/** ActionRemark / ResolveRemark ใน DB เป็น nvarchar(500) */
export const MAX_REMARK_COLUMN = 500;

/** ตัดข้อความให้พอดีคอลัมน์ nvarchar(n) (ไม่ตัดกลางคำสำคัญ — แค่ตัดท้ายและใส่ …) */
export function clip(text: string | null | undefined, max = MAX_REMARK_COLUMN): string | null {
  if (text === null || text === undefined) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
