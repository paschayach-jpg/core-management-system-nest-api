/**
 * enum กลางของระบบ — ค่าตัวเลขต้องตรงกับที่เก็บใน DB (ดู docs/reference/legacy-analysis/03-enums-lookups.md)
 * หมายเหตุ: ใช้ `enum` (ไม่ใช่ const enum) เพื่อให้ Swagger/class-validator อ่านค่าได้ตอนรัน
 */

/** บทบาทในแอป (EMS.UserAccount.AppRole) */
export enum AppRole {
  Officer = 1,
  SrOfficer = 2,
  Manager = 3,
  Admin = 4,
}

/** ชั้นความลับของโฟลเดอร์/บทความ */
export enum Confidentiality {
  HC = 1,
  SC = 2,
  NC = 3,
  PC = 4,
}

export const CONFIDENTIALITY_ROOT_CODE = { 1: '1HC', 2: '2SC', 3: '3NC', 4: '4PC' } as const;

export enum ApprovalRequestStatus {
  Pending = 1,
  Approved = 2,
  Rejected = 3,
  /** โค้ดเดิมใช้ 4 สำหรับ Withdraw ด้วย (OPEN_QUESTIONS) */
  Expired = 4,
}

export enum ApprovalStepStatus {
  Pending = 1,
  Approved = 2,
  Rejected = 3,
  Delegated = 4,
}

export const APPROVAL_REQUEST_TYPES = [
  'CREATE_HC',
  'UPLOAD_HC',
  'DELETE_FOLDER',
  'CHANGE_PERMISSION',
  'DOWNLOAD_FILE',
  'EXTERNAL_SHARE',
  'INTERNAL_SHARE',
  'SHARE_PERMISSION_CHANGE',
] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

/** ผู้ถือสิทธิ์ (FolderPermission.PrincipalType: DB อนุญาตเฉพาะ 1–4) */
export enum PrincipalType {
  User = 1,
  Role = 2,
  Department = 3,
  Division = 4,
}

export enum OrgUnitType {
  SubCommittee = 1,
  Division = 2,
  Department = 3,
}

export enum QuotaRequestStatus {
  Pending = 1,
  Approved = 2,
  Rejected = 3,
  Cancelled = 4,
}

export enum KbEntityType {
  Folder = 1,
  Task = 2,
  Program = 3,
  Law = 4,
  Project = 5,
  Department = 6,
}

export enum KbStatus {
  Draft = 1,
  Review = 2,
  Published = 3,
  Archived = 4,
}

export enum KbArticleType {
  Procedure = 1,
  Faq = 2,
  Guideline = 3,
  Template = 4,
  Policy = 5,
}

export enum FileStatus {
  Active = 1,
  Archived = 2,
  Deleted = 3,
}

export enum WorkflowStepType {
  Start = 1,
  Approval = 2,
  Review = 3,
  Notification = 4,
  Parallel = 5,
  Decision = 6,
  Merge = 7,
  End = 8,
}

export enum WorkflowInstanceStatus {
  Created = 1,
  InProgress = 2,
  Completed = 3,
  Rejected = 4,
  Suspended = 5,
  Cancelled = 6,
}

export enum WorkflowStepInstanceStatus {
  Pending = 1,
  InProgress = 2,
  Completed = 3,
  Rejected = 4,
  Delegated = 5,
}

export enum WorkflowTemplateStatus {
  Draft = 0,
  PendingApproval = 1,
  Active = 2,
  Inactive = 3,
  Deprecated = 4,
}

export enum SlaStatus {
  OnTime = 1,
  AtRisk = 2,
  Overdue = 3,
}

/** RGP เก็บธงเป็น char(1) */
export type YesNo = 'Y' | 'N';
