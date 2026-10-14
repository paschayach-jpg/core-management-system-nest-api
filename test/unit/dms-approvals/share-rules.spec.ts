import {
  assertDownloadLimit,
  assertExternalShareAllowedLevel,
  assertInternalShareExpiry,
  canDecideShare,
  canRevokeShare,
  canToggleShare,
  effectiveShareStatus,
  evaluateShareAccess,
  internalShareNeedsApproval,
  resolveExternalShareExpiry,
  ShareAccessInput,
} from '../../../src/modules/dms/approvals/common/share-rules';

const NOW = new Date('2026-10-14T10:00:00');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('แชร์ภายใน — อายุ', () => {
  it('ไม่ระบุ = ไม่หมดอายุ · วันนี้ผ่าน · พรุ่งนี้ผ่าน', () => {
    expect(() => assertInternalShareExpiry(undefined, NOW)).not.toThrow();
    expect(() => assertInternalShareExpiry(new Date('2026-10-14T00:00:00'), NOW)).not.toThrow();
    expect(() => assertInternalShareExpiry(day(1), NOW)).not.toThrow();
  });

  it('ย้อนหลัง → SHARE_EXPIRY_IN_PAST', () => {
    expect(() => assertInternalShareExpiry(new Date('2026-10-13T23:00:00'), NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'SHARE_EXPIRY_IN_PAST' }),
      }),
    );
  });

  it('เกิน 1 ปี → SHARE_EXPIRY_TOO_LONG (พอดี 1 ปีผ่าน)', () => {
    expect(() => assertInternalShareExpiry(new Date('2027-10-14T00:00:00'), NOW)).not.toThrow();
    expect(() => assertInternalShareExpiry(new Date('2027-10-15T00:00:00'), NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'SHARE_EXPIRY_TOO_LONG' }),
      }),
    );
  });
});

describe('แชร์ภายใน — ต้องอนุมัติเมื่อ', () => {
  it.each([
    [1, 1, true], // Officer แชร์ให้ User
    [2, 1, true], // SrOfficer
    [3, 1, false], // Manager แชร์ให้ User → มีผลทันที
    [4, 4, false], // Admin แชร์ให้ Division
    [3, 3, true], // Manager แชร์ให้ Department → ต้องอนุมัติ
    [4, 3, true], // Admin แชร์ให้ Department ก็ต้องอนุมัติ
  ])('appRole=%i principalType=%i → %s', (role, ptype, expected) => {
    expect(internalShareNeedsApproval(role, ptype)).toBe(expected);
  });
});

describe('แชร์ภายนอก', () => {
  it('ไม่ระบุวันหมดอายุ → ใช้ค่าสูงสุด 90 วัน (ไม่ใช่ไม่หมดอายุ)', () => {
    expect(resolveExternalShareExpiry(undefined, NOW).getTime()).toBe(day(90).getTime());
  });

  it('90 วันพอดีผ่าน · เกิน 90 วันไม่ผ่าน · อดีตไม่ผ่าน', () => {
    expect(resolveExternalShareExpiry(day(90), NOW)).toEqual(day(90));
    expect(() => resolveExternalShareExpiry(new Date(day(90).getTime() + 1000), NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'SHARE_EXPIRY_TOO_LONG' }),
      }),
    );
    expect(() => resolveExternalShareExpiry(day(-1), NOW)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'SHARE_EXPIRY_IN_PAST' }),
      }),
    );
  });

  it('ห้ามชั้น HC (level 1) ทั้งไฟล์และโฟลเดอร์ — ชั้นอื่นผ่าน', () => {
    expect(() => assertExternalShareAllowedLevel(1, 'file')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'SHARE_HC_FORBIDDEN' }),
      }),
    );
    expect(() => assertExternalShareAllowedLevel(1, 'folder')).toThrow();
    for (const lv of [2, 3, 4])
      expect(() => assertExternalShareAllowedLevel(lv, 'folder')).not.toThrow();
  });

  it('จำนวนดาวน์โหลดต้องเป็นจำนวนเต็มบวก (ไม่ระบุ = ไม่จำกัด)', () => {
    expect(() => assertDownloadLimit(undefined)).not.toThrow();
    expect(() => assertDownloadLimit(5)).not.toThrow();
    expect(() => assertDownloadLimit(0)).toThrow();
    expect(() => assertDownloadLimit(2.5)).toThrow();
  });

  it('การเปลี่ยนสถานะที่อนุญาต', () => {
    expect(canDecideShare('Pending')).toBe(true);
    expect(canDecideShare('Active')).toBe(false);
    expect(canToggleShare('Active')).toBe(true);
    expect(canToggleShare('Disabled')).toBe(true);
    expect(canToggleShare('Pending')).toBe(false);
    expect(
      canRevokeShare('Pending') && canRevokeShare('Active') && canRevokeShare('Disabled'),
    ).toBe(true);
    expect(canRevokeShare('Revoked')).toBe(false);
    expect(canRevokeShare('Expired')).toBe(false);
  });

  it('effectiveShareStatus: Active ที่เลยกำหนดเป็น Expired', () => {
    expect(effectiveShareStatus('Active', new Date('2026-10-01T00:00:00'), NOW)).toBe('Expired');
    expect(effectiveShareStatus('Active', null, NOW)).toBe('Active');
    expect(effectiveShareStatus('Revoked', new Date('2020-01-01'), NOW)).toBe('Revoked');
  });
});

describe('evaluateShareAccess — ตรวจ token', () => {
  const ok: ShareAccessInput = {
    status: 'Active',
    expiryDate: day(5),
    hasPassword: false,
    passwordOk: true,
    downloadLimit: null,
    currentDownloadCount: 0,
  };

  it('ผ่าน', () => {
    expect(evaluateShareAccess(ok, NOW)).toBeNull();
    expect(evaluateShareAccess({ ...ok, expiryDate: null }, NOW)).toBeNull();
  });

  it.each([
    ['Pending', 'Pending'],
    ['Disabled', 'Disabled'],
    ['Revoked', 'Revoked'],
    ['Expired', 'Expired'],
    ['Weird', 'InvalidStatus'],
  ])('สถานะ %s → %s', (status, reason) => {
    expect(evaluateShareAccess({ ...ok, status }, NOW)).toBe(reason);
  });

  it('เลยวันหมดอายุ → Expired', () => {
    expect(evaluateShareAccess({ ...ok, expiryDate: day(-1) }, NOW)).toBe('Expired');
  });

  it('มีรหัสผ่านแต่ผิด/ไม่ส่ง → WrongPassword; ถูก → ผ่าน', () => {
    expect(evaluateShareAccess({ ...ok, hasPassword: true, passwordOk: false }, NOW)).toBe(
      'WrongPassword',
    );
    expect(evaluateShareAccess({ ...ok, hasPassword: true, passwordOk: true }, NOW)).toBeNull();
  });

  it('ดาวน์โหลดครบเพดาน → LimitReached', () => {
    expect(evaluateShareAccess({ ...ok, downloadLimit: 3, currentDownloadCount: 3 }, NOW)).toBe(
      'LimitReached',
    );
    expect(
      evaluateShareAccess({ ...ok, downloadLimit: 3, currentDownloadCount: 2 }, NOW),
    ).toBeNull();
  });

  it('ลำดับการตรวจ: สถานะ → หมดอายุ → รหัสผ่าน → เพดาน', () => {
    const bad: ShareAccessInput = {
      status: 'Active',
      expiryDate: day(-1),
      hasPassword: true,
      passwordOk: false,
      downloadLimit: 1,
      currentDownloadCount: 1,
    };
    expect(evaluateShareAccess(bad, NOW)).toBe('Expired');
    expect(evaluateShareAccess({ ...bad, expiryDate: null }, NOW)).toBe('WrongPassword');
    expect(evaluateShareAccess({ ...bad, expiryDate: null, passwordOk: true }, NOW)).toBe(
      'LimitReached',
    );
  });
});
