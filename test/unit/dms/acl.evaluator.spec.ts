import { PrincipalType } from '../../../src/common/constants/enums';
import {
  evaluateAcl,
  isApplicable,
  matchesFlag,
} from '../../../src/modules/dms/permissions/acl.evaluator';
import { canAddToLevel, canViewLevel } from '../../../src/modules/dms/permissions/authority.util';
import type { AclEntry, FolderLink } from '../../../src/modules/dms/permissions/permission.types';
import { fakeUser } from '../../helpers/stubs';

const entry = (folderId: number, over: Partial<AclEntry>): AclEntry => ({
  folderId,
  principalType: PrincipalType.User,
  principalId: 7,
  canRead: false,
  canWrite: false,
  canDelete: false,
  canModify: false,
  canFullControl: false,
  isDeny: false,
  ...over,
});
// โฟลเดอร์ 3 → 2 → 1 (ราก)
const chain: FolderLink[] = [
  { folderId: 3, parentFolderId: 2 },
  { folderId: 2, parentFolderId: 1 },
  { folderId: 1, parentFolderId: null },
];
const acl = (...es: AclEntry[]) => {
  const m = new Map<number, AclEntry[]>();
  for (const e of es) m.set(e.folderId, [...(m.get(e.folderId) ?? []), e]);
  return m;
};
const officer = { userId: 7, appRole: 1, departmentId: 10, divisionId: 20 };

describe('matchesFlag', () => {
  it('Write/Delete ผ่านด้วย CanModify · FullControl ผ่านทุกสิทธิ์ · Read ไม่ผ่านด้วย Write', () => {
    expect(matchesFlag(entry(1, { canModify: true }), 'Write')).toBe(true);
    expect(matchesFlag(entry(1, { canModify: true }), 'Delete')).toBe(true);
    expect(matchesFlag(entry(1, { canModify: true }), 'Read')).toBe(false);
    expect(matchesFlag(entry(1, { canFullControl: true }), 'Modify')).toBe(true);
    expect(matchesFlag(entry(1, { canWrite: true }), 'Read')).toBe(false);
    expect(matchesFlag(entry(1, { canRead: true }), 'Read')).toBe(true);
  });
});

describe('isApplicable', () => {
  it('จับคู่ตามประเภทผู้ถือสิทธิ์ (User/Role/Department/Division)', () => {
    expect(
      isApplicable(entry(1, { principalType: PrincipalType.User, principalId: 7 }), officer),
    ).toBe(true);
    expect(
      isApplicable(entry(1, { principalType: PrincipalType.User, principalId: 8 }), officer),
    ).toBe(false);
    expect(
      isApplicable(entry(1, { principalType: PrincipalType.Role, principalId: 1 }), officer),
    ).toBe(true);
    expect(
      isApplicable(entry(1, { principalType: PrincipalType.Department, principalId: 10 }), officer),
    ).toBe(true);
    expect(
      isApplicable(entry(1, { principalType: PrincipalType.Division, principalId: 20 }), officer),
    ).toBe(true);
  });

  it('ผู้ใช้ที่ไม่มี department/division จับคู่ ACL ระดับแผนก/ฝ่ายไม่ได้', () => {
    const u = { userId: 7, appRole: 1 };
    expect(
      isApplicable(entry(1, { principalType: PrincipalType.Department, principalId: 10 }), u),
    ).toBe(false);
    expect(
      isApplicable(entry(1, { principalType: PrincipalType.Division, principalId: 20 }), u),
    ).toBe(false);
  });
});

describe('evaluateAcl — ผู้ใช้ทั่วไป', () => {
  it('ไม่มี ACL เลย → ปฏิเสธ (default deny)', () => {
    expect(evaluateAcl({ subject: officer, perm: 'Read', chain, aclByFolder: acl() })).toBe(false);
  });

  it('Allow บนโฟลเดอร์ตัวเองผ่าน', () => {
    expect(
      evaluateAcl({
        subject: officer,
        perm: 'Read',
        chain,
        aclByFolder: acl(entry(3, { canRead: true })),
      }),
    ).toBe(true);
  });

  it('สืบทอดสิทธิ์จาก parent/ราก', () => {
    expect(
      evaluateAcl({
        subject: officer,
        perm: 'Read',
        chain,
        aclByFolder: acl(entry(1, { canRead: true })),
      }),
    ).toBe(true);
  });

  it('Deny บนโฟลเดอร์ตัวเองชนะ Allow ที่ parent', () => {
    const a = acl(entry(1, { canRead: true }), entry(3, { canRead: true, isDeny: true }));
    expect(evaluateAcl({ subject: officer, perm: 'Read', chain, aclByFolder: a })).toBe(false);
  });

  it('Deny บนโฟลเดอร์เดียวกับ Allow → Deny ชนะ', () => {
    const a = acl(
      entry(3, { canRead: true }),
      entry(3, { canRead: true, isDeny: true, principalType: PrincipalType.Role, principalId: 1 }),
    );
    expect(evaluateAcl({ subject: officer, perm: 'Read', chain, aclByFolder: a })).toBe(false);
  });

  it('Allow ที่โฟลเดอร์ลูกชนะ Deny ที่ parent (ไล่จากลูกขึ้นไป เจอ Allow ก่อน)', () => {
    const a = acl(entry(3, { canRead: true }), entry(1, { canRead: true, isDeny: true }));
    expect(evaluateAcl({ subject: officer, perm: 'Read', chain, aclByFolder: a })).toBe(true);
  });

  it('ACL ของคนอื่นไม่มีผล', () => {
    const a = acl(entry(3, { canRead: true, principalId: 99 }));
    expect(evaluateAcl({ subject: officer, perm: 'Read', chain, aclByFolder: a })).toBe(false);
  });

  it('chain ว่าง (ไม่พบโฟลเดอร์) → ปฏิเสธ', () => {
    expect(evaluateAcl({ subject: officer, perm: 'Read', chain: [], aclByFolder: acl() })).toBe(
      false,
    );
  });

  it('parent วนกลับตัวเอง → ไม่วนไม่รู้จบและปฏิเสธ', () => {
    const loop: FolderLink[] = [
      { folderId: 3, parentFolderId: 2 },
      { folderId: 2, parentFolderId: 3 },
      { folderId: 3, parentFolderId: 2 },
    ];
    expect(evaluateAcl({ subject: officer, perm: 'Read', chain: loop, aclByFolder: acl() })).toBe(
      false,
    );
  });
});

describe('evaluateAcl — Manager/Admin', () => {
  const manager = { userId: 7, appRole: 3, departmentId: null, divisionId: null };

  it('ผ่านโดยไม่ต้องมี ACL', () => {
    expect(evaluateAcl({ subject: manager, perm: 'Delete', chain, aclByFolder: acl() })).toBe(true);
  });

  it('Explicit Deny บนโฟลเดอร์นี้ยังบล็อก', () => {
    expect(
      evaluateAcl({
        subject: manager,
        perm: 'Read',
        chain,
        aclByFolder: acl(entry(3, { canRead: true, isDeny: true })),
      }),
    ).toBe(false);
  });

  it('Deny ที่ parent ไม่ส่งผลกับ Manager (ตรวจเฉพาะโฟลเดอร์ตัวเอง)', () => {
    expect(
      evaluateAcl({
        subject: manager,
        perm: 'Read',
        chain,
        aclByFolder: acl(entry(1, { canRead: true, isDeny: true })),
      }),
    ).toBe(true);
  });

  it('ไม่พบโฟลเดอร์ → ปฏิเสธแม้เป็น Admin', () => {
    expect(
      evaluateAcl({
        subject: { ...manager, appRole: 4 },
        perm: 'Read',
        chain: [],
        aclByFolder: acl(),
      }),
    ).toBe(false);
  });
});

describe('authority helpers (พอร์ตจาก UserContext)', () => {
  it('ไม่มีแถวสิทธิ์: ดูได้เฉพาะ PC (4), เพิ่มไม่ได้', () => {
    const u = fakeUser({ authority: {} });
    expect(canViewLevel(u, 4)).toBe(true);
    expect(canViewLevel(u, 1)).toBe(false);
    expect(canAddToLevel(u, 4)).toBe(false);
  });

  it('มีแถวสิทธิ์: ใช้ค่าในแถว', () => {
    const row = {
      configId: 1,
      configLabel: 'x',
      confidentialityLevel: 2,
      levelCode: '2SC',
      canView: true,
      canAdd: true,
      canEdit: false,
      canApprove: false,
      canDownload: false,
    };
    const u = fakeUser({ authority: { 2: row } });
    expect(canViewLevel(u, 2)).toBe(true);
    expect(canAddToLevel(u, 2)).toBe(true);
    expect(canViewLevel(u, 4)).toBe(true); // ไม่มีแถว PC → ผ่าน
    expect(
      canViewLevel(
        fakeUser({ authority: { 4: { ...row, confidentialityLevel: 4, canView: false } } }),
        4,
      ),
    ).toBe(false);
  });
});
