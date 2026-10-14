import { AppRole } from '../../common/constants/enums';

/**
 * สิทธิ์ขั้นต่ำของแต่ละกลุ่มงาน KMS
 *
 * ระบบเดิม (WinForms) ไม่ตรวจ role ใน service เลย — เชื่อเมนู/ปุ่มบนหน้าจอ (ดู 04-business-rules.md §3.1, OPEN_QUESTIONS C13)
 * API ต้องบังคับเอง จึงเลือกทางที่ปลอดภัยกว่า: งานแก้ master / เผยแพร่ / ลบ / ย้าย / import ต้องเป็น Manager ขึ้นไป
 * การอ่าน, สร้าง/แก้บทความ, ส่งขอ Review ทำได้ทุกคนที่ login · ปรับระดับได้ที่เดียวนี้ (บันทึกเป็นคำถามเปิดใน docs/modules/kms.md)
 */
export const KMS_ROLE = {
  /** สร้าง/แก้/ปิดใช้งาน หมวด · Import Template · Display Profile */
  masterWrite: AppRole.Manager,
  /** Review → Published และ Published → Archived */
  publish: AppRole.Manager,
  /** ลบบทความ (soft delete) */
  deleteArticle: AppRole.Manager,
  /** ย้ายบทความข้ามหมวด */
  move: AppRole.Manager,
  /** ตรวจ/นำเข้าบทความจาก Excel */
  import: AppRole.Manager,
} as const;

/** ชื่อ key ใน dbo.SystemConfig ที่ KMS อ่าน (ระบบเดิมฝังเลขโฟลเดอร์ 437 / 1 ไว้ในโค้ด) */
export const KMS_CONFIG_KEY = {
  /** โฟลเดอร์ DMS ปลายทางเริ่มต้นของไฟล์แนบที่ import (ใช้เมื่อคำขอไม่ระบุ dmsFolderId) */
  importAttachmentFolderId: 'KMS_IMPORT_ATTACHMENT_FOLDER_ID',
  /** โฟลเดอร์ DMS ปลายทางเริ่มต้นของไฟล์แนบที่อัปโหลดจากหน้าแก้ไขบทความ */
  articleAttachmentFolderId: 'KMS_ARTICLE_ATTACHMENT_FOLDER_ID',
} as const;

/** ชื่อการกระทำ (audit/CRUD-log operation) — ตรงกับ AuditEntry.Action ของระบบเดิม */
export const KMS_OP = {
  createArticle: 'CREATE_KB_ARTICLE',
  updateArticle: 'UPDATE_KB_ARTICLE',
  deleteArticle: 'DELETE_KB_ARTICLE',
  submitReview: 'SUBMIT_REVIEW',
  publish: 'PUBLISH',
  archive: 'ARCHIVE',
  attachFile: 'ATTACH_FILE',
  moveArticle: 'MOVE_KB_ARTICLE',
  createCategory: 'CREATE_KB_CATEGORY',
  updateCategory: 'UPDATE_KB_CATEGORY',
  deactivateCategory: 'DEACTIVATE_KB_CATEGORY',
  createTemplate: 'CREATE_KB_IMPORT_TEMPLATE',
  updateTemplate: 'UPDATE_KB_IMPORT_TEMPLATE',
  deactivateTemplate: 'DEACTIVATE_KB_IMPORT_TEMPLATE',
  activateTemplate: 'ACTIVATE_KB_IMPORT_TEMPLATE',
  createProfile: 'CREATE_KB_ARTICLE_DISPLAY_PROFILE',
  updateProfile: 'UPDATE_KB_ARTICLE_DISPLAY_PROFILE',
  deactivateProfile: 'DEACTIVATE_KB_ARTICLE_DISPLAY_PROFILE',
  activateProfile: 'ACTIVATE_KB_ARTICLE_DISPLAY_PROFILE',
  assignProfile: 'ASSIGN_KB_ARTICLE_DISPLAY_PROFILE',
} as const;

/** ค่าสถานะบทความ (KMS.t_KBArticle.Status) */
export const KB_STATUS = { draft: 1, review: 2, published: 3, archived: 4 } as const;

/** ชั้นความลับที่ใช้ได้จากหน้าแก้ไขบทความ (1=HC 2=SC 3=NC 4=PC) — import ใส่ 0 ตามระบบเดิม */
export const KB_MAX_CONFIDENTIALITY = 4;
