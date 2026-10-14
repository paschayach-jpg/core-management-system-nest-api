/**
 * สัญญาของ payload (ApprovalRecord.payload) ที่ส่งให้ handler / ใช้ภายใน — key เป็น camelCase เหมือนกันทั้งคำขอรูปแบบเก่า
 * (Remark ข้อความ) และรูปแบบใหม่ (JSON prefix) · ดู approval-remark.ts สำหรับวิธีอ่าน/เขียน
 *
 * DMS-core ที่ลงทะเบียน handler ของ CREATE_HC / DELETE_FOLDER / CHANGE_PERMISSION ควรอ่าน payload ตามรูปทรงด้านล่าง
 * (ไฟล์นี้เป็นเพียงชนิดข้อมูล ไม่มีโค้ดที่ทำงาน — module อื่น import เฉพาะ type ได้โดยไม่เกิดการพึ่งพาแบบวน)
 */

/** CREATE_HC — ApprovalRecord.folderId ไม่ใช้ (สร้างโฟลเดอร์ใหม่) */
export interface CreateHcPayload {
  /** โฟลเดอร์แม่ (null = ราก) */
  parentFolderId: number | null;
  orgUnitId: number;
  folderName: string;
  folderDepth: number;
  /** ระดับความลับของโฟลเดอร์ใหม่ (1HC = 1) */
  confidentialityLevel: number;
  inheritPermission: boolean;
}

/** CHANGE_PERMISSION — โฟลเดอร์อยู่ที่ ApprovalRecord.folderId (และ payload.folderId ในคำขอรูปแบบเก่า) */
export interface ChangePermissionPayload {
  folderId?: number | null;
  /** 1=User, 2=Role, 3=Department, 4=Division (DB CHECK ของ FolderPermission อนุญาตแค่ 1–4) */
  principalType: number;
  principalId: number;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModify: boolean;
  canFullControl: boolean;
  isDeny: boolean;
  /** วันหมดอายุของสิทธิ์ (yyyy-MM-dd) ถ้ามี */
  expiryDate?: string | null;
}

/** DELETE_FOLDER — โฟลเดอร์ที่จะลบอยู่ที่ ApprovalRecord.folderId · ไม่มี payload (เหตุผลอยู่ที่ reason) */
export type DeleteFolderPayload = Record<string, never>;

/** EXTERNAL_SHARE — Approvals จัดการเอง (ไม่ผ่าน handler) */
export interface ExternalSharePayload {
  externalShareId: number;
}

/** INTERNAL_SHARE — Approvals จัดการเอง (ไม่ผ่าน handler) */
export interface InternalSharePayload {
  fileId: number;
  principalType: number;
  principalId: number;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  /** yyyy-MM-dd หรือ null */
  expiryDate: string | null;
}
