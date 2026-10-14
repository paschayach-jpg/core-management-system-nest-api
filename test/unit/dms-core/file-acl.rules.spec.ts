import { PrincipalType } from '../../../src/common/constants/enums';
import {
  decideDownload,
  fileAclDecision,
  fileOverrideBlocks,
  type FileAclEntry,
} from '../../../src/modules/dms/core/rules/file-acl.rules';

const me = { userId: 7, appRole: 1, departmentId: 30, divisionId: 20 };
const entry = (over: Partial<FileAclEntry>): FileAclEntry => ({
  fileId: 100,
  principalType: PrincipalType.User,
  principalId: 7,
  canRead: false,
  canWrite: false,
  canDelete: false,
  canModify: false,
  canFullControl: false,
  canDownload: false,
  isDeny: false,
  ...over,
});

describe('file-acl.rules — สิทธิ์ระดับไฟล์ทับสิทธิ์โฟลเดอร์', () => {
  it('ไม่มี entry ที่ใช้กับผู้ใช้ → ไม่ยุ่ง (สิทธิ์โฟลเดอร์ตัดสิน)', () => {
    const d = fileAclDecision({
      subject: me,
      perm: 'Delete',
      entries: [entry({ principalId: 99, canDelete: true })],
    });
    expect(d).toEqual({ applicable: 0, denied: false, allowed: false });
    expect(fileOverrideBlocks(d)).toBe(false);
  });

  it('มี entry ของผู้ใช้แต่ไม่ให้สิทธิ์ลบ → บล็อก', () => {
    const d = fileAclDecision({ subject: me, perm: 'Delete', entries: [entry({ canRead: true })] });
    expect(fileOverrideBlocks(d)).toBe(true);
  });

  it('มี entry ที่ให้สิทธิ์ลบ (หรือ Modify/FullControl) → ผ่าน', () => {
    for (const over of [{ canDelete: true }, { canModify: true }, { canFullControl: true }]) {
      expect(
        fileOverrideBlocks(
          fileAclDecision({ subject: me, perm: 'Delete', entries: [entry(over)] }),
        ),
      ).toBe(false);
    }
  });

  it('Deny ชนะ Allow เสมอ', () => {
    const d = fileAclDecision({
      subject: me,
      perm: 'Delete',
      entries: [entry({ canDelete: true }), entry({ isDeny: true, canDelete: true })],
    });
    expect(d.denied).toBe(true);
    expect(fileOverrideBlocks(d)).toBe(true);
  });

  it('จับคู่ผู้ถือสิทธิ์ทั้ง User / Role / Department / Division', () => {
    const entries = [
      entry({ principalType: PrincipalType.Role, principalId: 1, canRead: true }),
      entry({ principalType: PrincipalType.Department, principalId: 30, canDelete: true }),
      entry({ principalType: PrincipalType.Division, principalId: 21, canDelete: true }), // ฝ่ายอื่น
    ];
    expect(fileAclDecision({ subject: me, perm: 'Read', entries }).allowed).toBe(true);
    expect(fileAclDecision({ subject: me, perm: 'Delete', entries }).allowed).toBe(true);
    expect(
      fileAclDecision({ subject: { ...me, departmentId: null }, perm: 'Delete', entries }).allowed,
    ).toBe(false);
  });
});

describe('file-acl.rules — ตัดสินสิทธิ์ดาวน์โหลด', () => {
  const base = {
    isPrivileged: false,
    folderCanRead: true,
    authorityCanDownload: false,
    subject: me,
    entries: [] as FileAclEntry[],
  };

  it('Manager/Admin ผ่านทันที (ถ้าอ่านได้)', () => {
    expect(decideDownload({ ...base, isPrivileged: true })).toEqual({
      allowed: true,
      via: 'PRIVILEGED',
    });
  });

  it('Authority.CanDownload ผ่าน', () => {
    expect(decideDownload({ ...base, authorityCanDownload: true })).toEqual({
      allowed: true,
      via: 'AUTHORITY',
    });
  });

  it('อ่านโฟลเดอร์ได้แต่ไม่มีสิทธิ์ดาวน์โหลด → ต้องขออนุมัติ', () => {
    expect(decideDownload(base)).toEqual({ allowed: false, reason: 'NEED_APPROVAL' });
  });

  it('สิทธิ์ไฟล์ที่ให้ CanDownload ผ่าน (แม้โฟลเดอร์อ่านไม่ได้ แต่ไฟล์ถูกแชร์ให้)', () => {
    const entries = [entry({ canRead: true, canDownload: true })];
    expect(decideDownload({ ...base, folderCanRead: false, entries })).toEqual({
      allowed: true,
      via: 'FILE_SHARE',
    });
  });

  it('แชร์ให้อ่านอย่างเดียว (ไม่มี CanDownload) → ต้องขออนุมัติ', () => {
    expect(decideDownload({ ...base, entries: [entry({ canRead: true })] })).toEqual({
      allowed: false,
      reason: 'NEED_APPROVAL',
    });
  });

  it('อ่านไม่ได้เลย (ไม่เห็นโฟลเดอร์ ไม่ได้ถูกแชร์) → NO_READ ต่อให้ Authority อนุญาต', () => {
    expect(decideDownload({ ...base, folderCanRead: false, authorityCanDownload: true })).toEqual({
      allowed: false,
      reason: 'NO_READ',
    });
  });

  it('Deny อ่านระดับไฟล์ชนะทุกอย่างรวมถึง Manager/Admin', () => {
    expect(
      decideDownload({
        ...base,
        isPrivileged: true,
        authorityCanDownload: true,
        entries: [entry({ isDeny: true, canRead: true })],
      }),
    ).toEqual({ allowed: false, reason: 'FILE_DENIED' });
  });
});
