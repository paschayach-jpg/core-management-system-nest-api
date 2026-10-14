import {
  decodeRemark,
  effectiveRequestType,
  encodeRemark,
  parseLegacyExternalShareId,
  REMARK_JSON_PREFIX,
} from '../../../src/modules/dms/approvals/common/approval-remark';

describe('Remark — เขียนรูปแบบใหม่ (JSON + prefix)', () => {
  it('มี payload → ขึ้นต้นด้วย prefix และอ่านกลับได้ครบ', () => {
    const text = encodeRemark({ reason: 'ขอสิทธิ์', payload: { principalId: 5, canRead: true } });
    expect(text?.startsWith(REMARK_JSON_PREFIX)).toBe(true);
    expect(decodeRemark('CHANGE_PERMISSION', text)).toMatchObject({
      format: 'json',
      reason: 'ขอสิทธิ์',
      payload: { principalId: 5, canRead: true },
    });
  });

  it('มีแต่เหตุผล → เก็บเป็นข้อความล้วนเหมือนระบบเดิม (DELETE_FOLDER / DOWNLOAD_FILE)', () => {
    expect(encodeRemark({ reason: '  ต้องใช้ตรวจสอบ ' })).toBe('ต้องใช้ตรวจสอบ');
    expect(decodeRemark('DOWNLOAD_FILE', 'ต้องใช้ตรวจสอบ')).toMatchObject({
      format: 'text',
      reason: 'ต้องใช้ตรวจสอบ',
      payload: null,
    });
  });

  it('ไม่มีอะไรเลย → null / empty', () => {
    expect(encodeRemark({})).toBeNull();
    expect(decodeRemark('X', null).format).toBe('empty');
    expect(decodeRemark('X', '   ').format).toBe('empty');
  });

  it('JSON เสียหลัง prefix → ถือเป็นข้อความ ไม่ throw', () => {
    expect(decodeRemark('X', `${REMARK_JSON_PREFIX}{ไม่ใช่ json`).format).toBe('text');
  });
});

describe('Remark — อ่านรูปแบบเก่า (มีข้อมูลจริงในฐาน)', () => {
  it('EXTERNAL_SHARE: ExternalShareID:<n>', () => {
    expect(decodeRemark('EXTERNAL_SHARE', 'ExternalShareID:42')).toMatchObject({
      format: 'legacy',
      payload: { externalShareId: 42 },
      inferredType: 'EXTERNAL_SHARE',
    });
    expect(parseLegacyExternalShareId('ExternalShareID:7 อื่นๆ')).toBe(7);
    expect(parseLegacyExternalShareId('ExternalShareID:abc')).toBe(0);
  });

  it('DB รุ่นเก่าที่บันทึกแชร์ภายนอกเป็น CHANGE_PERMISSION → ตีความเป็น EXTERNAL_SHARE', () => {
    const d = decodeRemark('CHANGE_PERMISSION', 'ExternalShareID:5');
    expect(effectiveRequestType('CHANGE_PERMISSION', d)).toBe('EXTERNAL_SHARE');
    expect(effectiveRequestType('DELETE_FOLDER', decodeRemark('DELETE_FOLDER', 'เหตุผล'))).toBe(
      'DELETE_FOLDER',
    );
  });

  it('INTERNAL_SHARE: InternalShareFile FileID:… Expiry:…', () => {
    const d = decodeRemark(
      'INTERNAL_SHARE',
      'InternalShareFile FileID:12 PrincipalType:3 PrincipalID:7 Read:True Write:False Delete:True Expiry:2026-12-31',
    );
    expect(d.payload).toEqual({
      fileId: 12,
      principalType: 3,
      principalId: 7,
      canRead: true,
      canWrite: false,
      canDelete: true,
      expiryDate: '2026-12-31',
    });
    expect(d.inferredType).toBe('INTERNAL_SHARE');
  });

  it('INTERNAL_SHARE ที่ไม่ตั้งวันหมดอายุ (Expiry: ว่าง) → expiryDate เป็น null', () => {
    const d = decodeRemark(
      'CHANGE_PERMISSION',
      'InternalShareFile FileID:1 PrincipalType:1 PrincipalID:2 Read:True Write:False Delete:False Expiry:',
    );
    expect(d.payload).toMatchObject({ fileId: 1, expiryDate: null });
    expect(d.inferredType).toBe('INTERNAL_SHARE');
  });

  it('CHANGE_PERMISSION: FolderID:… PrincipalType:… (ตัวพิมพ์ไม่สำคัญ)', () => {
    const d = decodeRemark(
      'CHANGE_PERMISSION',
      'FolderID:9 PrincipalType:2 PrincipalID:3 Read:True Write:true Delete:False Modify:False FullControl:False IsDeny:True',
    );
    expect(d.payload).toEqual({
      folderId: 9,
      principalType: 2,
      principalId: 3,
      canRead: true,
      canWrite: true,
      canDelete: false,
      canModify: false,
      canFullControl: false,
      isDeny: true,
    });
  });

  it('CREATE_HC: ParentFolderId=…|OrgUnitId=…|FolderName=… (ชื่อมี = ได้)', () => {
    const d = decodeRemark(
      'CREATE_HC',
      'ParentFolderId=0|OrgUnitId=5|FolderName=1HC-ลับ=พิเศษ|FolderDepth=1|ConfidentialityLevel=1|InheritPermission=False',
    );
    expect(d.payload).toEqual({
      parentFolderId: null,
      orgUnitId: 5,
      folderName: '1HC-ลับ=พิเศษ',
      folderDepth: 1,
      confidentialityLevel: 1,
      inheritPermission: false,
    });
  });
});
