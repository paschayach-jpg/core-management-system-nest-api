import type { ApprovalRequestType } from '../../../common/constants/enums';
import type { UserContext } from '../../../common/interfaces/user-context';

/**
 * สัญญากลางระหว่างงานอนุมัติ (DmsApprovalsModule) กับแกน DMS (DmsCoreModule)
 *  - Core "ยื่นคำขอ" ผ่าน DMS_APPROVAL_PORT (เช่น สร้างโฟลเดอร์ 1HC, ลบโฟลเดอร์ที่มีไฟล์, ขอดาวน์โหลด)
 *  - เมื่อคำขออนุมัติ Approvals เรียก handler ที่ Core ลงทะเบียนไว้ใน DMS_APPROVAL_HANDLERS (กลับด้านการพึ่งพา เพื่อไม่ให้ module วนกัน)
 * DmsApprovalsModule เป็น @Global() และ export ทั้งสอง token
 */
export const DMS_APPROVAL_PORT = Symbol('DMS_APPROVAL_PORT');
export const DMS_APPROVAL_HANDLERS = Symbol('DMS_APPROVAL_HANDLERS');

export interface SubmitApprovalInput {
  requestType: ApprovalRequestType;
  /** หัวข้อคำขอ (บังคับ) */
  subject: string;
  folderId?: number | null;
  fileId?: number | null;
  /** เหตุผลของผู้ขอ */
  reason?: string;
  /**
   * ข้อมูลที่ handler ต้องใช้ตอนอนุมัติ (เช่น ชื่อ/ระดับของโฟลเดอร์ 1HC ที่จะสร้าง) — เก็บเป็น JSON ในคอลัมน์ Remark
   * (ระบบเดิมใช้ Remark เป็นพื้นที่ payload แบบข้อความ; API นี้เก็บเป็น JSON ที่มี prefix ชัดเจน และอ่านรูปแบบเก่าได้)
   */
  payload?: Record<string, unknown>;
  /** ผู้อนุมัติที่เลือกเอง (เช่น คำขอดาวน์โหลด) — ถ้าไม่ระบุใช้กฎ StepResolver เดิม (Manager/Admin) */
  approverUserIds?: number[];
}

export interface ApprovalRef {
  requestId: number;
  requestStatus: number;
}

export interface ApprovalRecord {
  requestId: number;
  requestType: ApprovalRequestType;
  folderId: number | null;
  fileId: number | null;
  requestedBy: number;
  subject: string | null;
  payload: Record<string, unknown> | null;
}

export interface DmsApprovalPort {
  submit(user: UserContext, input: SubmitApprovalInput): Promise<ApprovalRef>;
  /** คำขอดาวน์โหลดที่อนุมัติแล้วและยังไม่ถูกใช้ (null ถ้าไม่มี) */
  findApprovedDownload(user: UserContext, fileId: number): Promise<ApprovalRef | null>;
  /** ใช้สิทธิ์ดาวน์โหลดจากคำขอที่อนุมัติแล้ว (ใช้ได้ครั้งเดียว) */
  consumeDownload(user: UserContext, requestId: number): Promise<void>;
}

/** ผลข้างเคียงเมื่อคำขอชนิดหนึ่งได้รับอนุมัติ — Core ลงทะเบียนสำหรับ CREATE_HC, DELETE_FOLDER, CHANGE_PERMISSION */
export interface ApprovalOutcomeHandler {
  readonly requestType: ApprovalRequestType;
  /** รันใน transaction เดียวกับการเปลี่ยนสถานะคำขอ — โยน error = rollback ทั้งคำขอ */
  onApproved(request: ApprovalRecord, approver: UserContext): Promise<void>;
  onRejected?(request: ApprovalRecord, rejector: UserContext): Promise<void>;
}

export interface ApprovalHandlerRegistry {
  register(handler: ApprovalOutcomeHandler): void;
  get(type: ApprovalRequestType): ApprovalOutcomeHandler | undefined;
}
