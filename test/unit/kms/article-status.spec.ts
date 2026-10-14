import { AppRole } from '../../../src/common/constants/enums';
import {
  assertTransition,
  canTransition,
  isEditableStatus,
  minRoleForTransition,
  statusOperation,
} from '../../../src/modules/kms/articles/article-status';

describe('วงจรสถานะบทความ', () => {
  it('เดินหน้าทีละขั้น Draft→Review→Published→Archived เท่านั้น', () => {
    expect(canTransition(1, 2)).toBe(true);
    expect(canTransition(2, 3)).toBe(true);
    expect(canTransition(3, 4)).toBe(true);
    for (const [from, to] of [
      [1, 3],
      [1, 4],
      [2, 4],
      [2, 1],
      [3, 2],
      [3, 1],
      [2, 2],
    ] as const) {
      expect(canTransition(from, to)).toBe(false);
    }
  });

  it('Archived แล้วเปลี่ยนไม่ได้อีก (code ARTICLE_ARCHIVED)', () => {
    for (const to of [1, 2, 3, 4]) {
      expect(() => assertTransition(4, to)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ARTICLE_ARCHIVED' }),
        }),
      );
    }
  });

  it('ข้ามขั้น → INVALID_STATUS_TRANSITION พร้อมข้อความไทยบอกลำดับที่ถูก', () => {
    try {
      assertTransition(1, 3);
      fail('ต้อง throw');
    } catch (e) {
      const r = (e as { response: { code: string; message: string } }).response;
      expect(r.code).toBe('INVALID_STATUS_TRANSITION');
      expect(r.message).toContain('Draft → Review → Published → Archived');
    }
  });

  it('ชื่อ audit เดิม', () => {
    expect(statusOperation(2)).toBe('SUBMIT_REVIEW');
    expect(statusOperation(3)).toBe('PUBLISH');
    expect(statusOperation(4)).toBe('ARCHIVE');
    expect(statusOperation(1)).toBe('CHANGE_STATUS');
  });

  it('บทบาท: ส่งขอ Review ได้ทุกคน · เผยแพร่/Archive ต้อง Manager', () => {
    expect(minRoleForTransition(2)).toBeNull();
    expect(minRoleForTransition(3)).toBe(AppRole.Manager);
    expect(minRoleForTransition(4)).toBe(AppRole.Manager);
  });

  it('Archived แก้ไขไม่ได้', () => {
    expect(isEditableStatus(1)).toBe(true);
    expect(isEditableStatus(3)).toBe(true);
    expect(isEditableStatus(4)).toBe(false);
  });
});
