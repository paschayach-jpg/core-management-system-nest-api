import { AppRole } from '../../../common/constants/enums';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { KB_STATUS, KMS_OP, KMS_ROLE } from '../kms.constants';

/** ชื่อสถานะบทความ (KMS.t_KBArticle.Status) */
export const KB_STATUS_NAME: Record<number, string> = {
  1: 'Draft',
  2: 'Review',
  3: 'Published',
  4: 'Archived',
};

/**
 * วงจรบทความ: Draft(1) → Review(2) → Published(3) → Archived(4) · Archived แล้วเปลี่ยนสถานะไม่ได้อีก
 * ระบบเดิมบังคับเฉพาะ "Archived แล้วห้ามเปลี่ยน" แต่ปุ่มบนหน้าจอเดินได้ทีละขั้นเท่านั้น (ส่งขอ Review / เผยแพร่ / Archive)
 * API บังคับตามที่หน้าจอทำ (ไม่ข้ามขั้น) — บทความที่ import เข้ามาเริ่มที่ Review จึงเผยแพร่ได้ทันที
 */
export const STATUS_TRANSITIONS: Readonly<Record<number, readonly number[]>> = {
  [KB_STATUS.draft]: [KB_STATUS.review],
  [KB_STATUS.review]: [KB_STATUS.published],
  [KB_STATUS.published]: [KB_STATUS.archived],
  [KB_STATUS.archived]: [],
};

export function canTransition(from: number, to: number): boolean {
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** บทความที่ Archive แล้วแก้ไขไม่ได้ (editor เดิมเปิดแบบอ่านอย่างเดียว) */
export function isEditableStatus(status: number): boolean {
  return status !== KB_STATUS.archived;
}

/** ชื่อ audit เดิม: SUBMIT_REVIEW | PUBLISH | ARCHIVE | CHANGE_STATUS */
export function statusOperation(to: number): string {
  switch (to) {
    case KB_STATUS.review:
      return KMS_OP.submitReview;
    case KB_STATUS.published:
      return KMS_OP.publish;
    case KB_STATUS.archived:
      return KMS_OP.archive;
    default:
      return 'CHANGE_STATUS';
  }
}

/** บทบาทขั้นต่ำที่เปลี่ยนไปสถานะนั้นได้: ส่งขอ Review ได้ทุกคน · เผยแพร่/Archive ต้อง Manager ขึ้นไป (comment ใน ChangeStatus เดิม) */
export function minRoleForTransition(to: number): AppRole | null {
  return to === KB_STATUS.published || to === KB_STATUS.archived ? KMS_ROLE.publish : null;
}

/** ตรวจการเปลี่ยนสถานะ — โยน 422 พร้อม code คงที่เมื่อผิดกฎ */
export function assertTransition(from: number, to: number): void {
  if (from === KB_STATUS.archived) {
    throw new BusinessException(
      'บทความที่ Archive แล้วไม่สามารถเปลี่ยนสถานะได้',
      'ARTICLE_ARCHIVED',
    );
  }
  if (!canTransition(from, to)) {
    throw new BusinessException(
      `เปลี่ยนสถานะจาก ${KB_STATUS_NAME[from] ?? from} เป็น ${KB_STATUS_NAME[to] ?? to} ไม่ได้ (ลำดับที่ถูกต้อง: Draft → Review → Published → Archived)`,
      'INVALID_STATUS_TRANSITION',
      { from, to },
    );
  }
}
