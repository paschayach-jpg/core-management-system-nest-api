import type { ApprovalRequestType } from '../../../../common/constants/enums';

/**
 * EventType + ข้อความแจ้งเตือน (EMS.Notification) ของงานอนุมัติ/แชร์ — ใช้ EventType ชุดเดียวกับระบบเดิม
 * เพื่อให้ผู้ที่อ่านตาราง/ระบบแจ้งเตือนภายนอกยังเข้าใจ
 */
export const EVENT = {
  requestCreated: 'ApprovalRequestCreated',
  requestPending: 'ApprovalRequestPending',
  requestApproved: 'ApprovalRequestApproved',
  requestRejected: 'ApprovalRequestRejected',
  escalation: 'ApprovalEscalation',
  deleteFolderRequested: 'DeleteFolderRequested',
  downloadRequested: 'DownloadFileRequested',
  createHcRequested: 'CreateHcRequested',
  folderShareRequested: 'FolderShareApprovalRequested',
  internalShareRequested: 'InternalShareApprovalRequested',
  internalShareCreated: 'InternalShareCreated',
  externalShareCreated: 'ExternalShareCreated',
  externalShareApproved: 'ExternalShareApproved',
  externalShareRejected: 'ExternalShareRejected',
  externalShareRevoked: 'ExternalShareRevoked',
  shareAccessed: 'ShareAccessed',
  shareDisabled: 'ShareDisabled',
  quotaAlert: 'QUOTA_ALERT',
  quotaRequestApproved: 'QUOTA_REQUEST_APPROVED',
  quotaRequestRejected: 'QUOTA_REQUEST_REJECTED',
} as const;

/** ข้อความถึงผู้ขอเมื่อคำขอได้รับอนุมัติ (ตามชนิดผลลัพธ์) */
export function approvedMessage(type: ApprovalRequestType | string, requestId: number): string {
  switch (type) {
    case 'CREATE_HC':
      return `คำขอสร้าง 1HC Folder (ID ${requestId}) ได้รับการอนุมัติและสร้างโฟลเดอร์เรียบร้อยแล้ว`;
    case 'EXTERNAL_SHARE':
      return `คำขอแชร์ภายนอก (ID ${requestId}) ได้รับการอนุมัติและเปิดใช้งานลิงก์แล้ว`;
    case 'INTERNAL_SHARE':
      return `คำขอแชร์ไฟล์ภายใน (ID ${requestId}) ได้รับการอนุมัติและมีผลแล้ว`;
    case 'DOWNLOAD_FILE':
      return `คำขอดาวน์โหลดไฟล์ (ID ${requestId}) ได้รับการอนุมัติแล้ว ดาวน์โหลดได้ 1 ครั้ง`;
    case 'DELETE_FOLDER':
      return `คำขอลบโฟลเดอร์ (ID ${requestId}) ได้รับการอนุมัติและลบเรียบร้อยแล้ว`;
    default:
      return `คำขอเปลี่ยนสิทธิ์ (ID ${requestId}) ได้รับการอนุมัติและมีผลแล้ว`;
  }
}

export const rejectedMessage = (requestId: number, reason: string | null): string =>
  `คำขอ (ID ${requestId}) ถูกปฏิเสธ เหตุผล: ${reason && reason.trim() ? reason : 'ไม่ระบุเหตุผล'}`;

export const stepPendingMessage = (requestId: number): string =>
  `คำขออนุมัติ (ID ${requestId}) รอการดำเนินการจากคุณ`;

export const escalatedToRequesterMessage = (requestId: number): string =>
  `คำขอ (ID ${requestId}) ถูกยกระดับเนื่องจากเกินเวลาที่กำหนด`;

export const escalatedToApproverMessage = (requestId: number): string =>
  `คำขออนุมัติ (ID ${requestId}) ถูกยกระดับมาที่ role ของคุณ`;
