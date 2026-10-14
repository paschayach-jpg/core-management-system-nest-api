import { PrincipalType } from '../../../src/common/constants/enums';
import {
  buildChangePermissionPayload,
  buildCreateHcPayload,
  parseChangePermissionPayload,
  parseCreateHcPayload,
  parseLegacyRemark,
} from '../../../src/modules/dms/core/rules/approval-payload';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { getResponse(): { code: string } }).getResponse().code;
  }
  return undefined;
};

describe('approval-payload — CREATE_HC', () => {
  it('JSON ที่ยื่นเองอ่านกลับได้ครบ (round-trip)', () => {
    const p = {
      parentFolderId: null,
      orgUnitId: 12,
      folderName: '1HC - ลับมาก',
      confidentialityLevel: 1,
      inheritPermission: false,
    };
    expect(parseCreateHcPayload(buildCreateHcPayload(p))).toEqual(p);
  });

  it('รูปแบบ Remark เดิมแบบ k=v|k=v (ผ่านคีย์ remark)', () => {
    const r = parseCreateHcPayload({
      remark:
        'ParentFolderId=0|OrgUnitId=5|FolderName=1HC - A [1HC]|FolderDepth=1|ConfidentialityLevel=1|InheritPermission=False',
    });
    expect(r).toEqual({
      parentFolderId: null,
      orgUnitId: 5,
      folderName: '1HC - A [1HC]',
      confidentialityLevel: 1,
      inheritPermission: false,
    });
  });

  it('คีย์ PascalCase อ่านได้ (ไม่สนตัวพิมพ์)', () => {
    const r = parseCreateHcPayload({ OrgUnitId: '7', FolderName: 'X', ParentFolderId: '33' });
    expect(r.orgUnitId).toBe(7);
    expect(r.parentFolderId).toBe(33);
  });

  it('ขาด OrgUnitId หรือชื่อ → APPROVAL_PAYLOAD_INVALID', () => {
    expect(code(() => parseCreateHcPayload({ folderName: 'X' }))).toBe('APPROVAL_PAYLOAD_INVALID');
    expect(code(() => parseCreateHcPayload({ orgUnitId: 3 }))).toBe('APPROVAL_PAYLOAD_INVALID');
    expect(code(() => parseCreateHcPayload(null))).toBe('APPROVAL_PAYLOAD_INVALID');
  });
});

describe('approval-payload — CHANGE_PERMISSION', () => {
  it('JSON round-trip', () => {
    const p = {
      principalType: PrincipalType.Department,
      principalId: 30,
      canRead: true,
      canWrite: true,
      canDelete: false,
      canModify: false,
      canFullControl: false,
      isDeny: false,
      expiryDate: new Date('2027-01-01T00:00:00.000Z'),
    };
    expect(parseChangePermissionPayload(buildChangePermissionPayload(p))).toEqual(p);
  });

  it('รูปแบบ Remark เดิมแบบ "Key:Value Key:Value"', () => {
    const r = parseLegacyRemark('PrincipalType:1 PrincipalID:5 Read:True Write:False IsDeny:False');
    expect(r).toEqual({
      PrincipalType: '1',
      PrincipalID: '5',
      Read: 'True',
      Write: 'False',
      IsDeny: 'False',
    });
    const p = parseChangePermissionPayload({
      remark:
        'PrincipalType:1 PrincipalID:5 Read:True Write:True Delete:False Modify:False FullControl:False IsDeny:True',
    });
    expect(p).toMatchObject({
      principalType: PrincipalType.User,
      principalId: 5,
      canRead: true,
      canWrite: true,
      canDelete: false,
      isDeny: true,
      expiryDate: null,
    });
  });

  it('ผู้ถือสิทธิ์ไม่ถูกต้อง (ประเภท 5/6 ที่ DB ไม่รองรับ, ขาด id) → APPROVAL_PAYLOAD_INVALID', () => {
    expect(code(() => parseChangePermissionPayload({ principalType: 5, principalId: 1 }))).toBe(
      'APPROVAL_PAYLOAD_INVALID',
    );
    expect(code(() => parseChangePermissionPayload({ principalType: 1 }))).toBe(
      'APPROVAL_PAYLOAD_INVALID',
    );
    expect(code(() => parseChangePermissionPayload(undefined))).toBe('APPROVAL_PAYLOAD_INVALID');
  });
});
