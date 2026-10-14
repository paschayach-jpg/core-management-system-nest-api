import { pbkdf2Sync } from 'node:crypto';
import {
  generateShareToken,
  hashSharePassword,
  isGuid,
  verifySharePassword,
} from '../../../src/modules/dms/approvals/common/share-crypto';

describe('รหัสผ่านลิงก์ — เข้ากับ hash ของระบบเดิม (.NET Rfc2898DeriveBytes = PBKDF2-HMAC-SHA1)', () => {
  it('อัลกอริทึมตรงกับเวกเตอร์ทดสอบมาตรฐาน RFC 6070 (SHA-1) → เป็น PBKDF2-SHA1 จริง', () => {
    // RFC 6070: P="password", S="salt", c=4096, dkLen=20
    expect(pbkdf2Sync('password', 'salt', 4096, 20, 'sha1').toString('hex')).toBe(
      '4b007901b765489abead49d926f721d065a429c1',
    );
  });

  it('รูปแบบที่เก็บ = Base64(salt 16 ไบต์ + hash 32 ไบต์) · 10,000 รอบ', async () => {
    const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const stored = await hashSharePassword('p@ss', salt);
    const raw = Buffer.from(stored, 'base64');
    expect(raw.length).toBe(48);
    expect(raw.subarray(0, 16).equals(salt)).toBe(true);
    expect(raw.subarray(16).equals(pbkdf2Sync(Buffer.from('p@ss'), salt, 10_000, 32, 'sha1'))).toBe(
      true,
    );
  });

  it('hash ที่ "ระบบเดิมสร้าง" (ประกอบตามสูตร .NET ด้วยมือ) ตรวจผ่านได้ — ข้อมูลเก่ายังใช้ได้', async () => {
    const salt = Buffer.alloc(16, 7);
    const legacy = Buffer.concat([
      salt,
      pbkdf2Sync(Buffer.from('ลับสุดยอด', 'utf8'), salt, 10_000, 32, 'sha1'),
    ]).toString('base64');
    await expect(verifySharePassword('ลับสุดยอด', legacy)).resolves.toBe(true); // UTF-8 ภาษาไทย
    await expect(verifySharePassword('ลับสุดยอด!', legacy)).resolves.toBe(false);
  });

  it('รหัสผิด / ว่าง / hash ว่างหรือผิดรูป → false (ไม่ throw)', async () => {
    const stored = await hashSharePassword('correct');
    await expect(verifySharePassword('correct', stored)).resolves.toBe(true);
    await expect(verifySharePassword('wrong', stored)).resolves.toBe(false);
    await expect(verifySharePassword('', stored)).resolves.toBe(false);
    await expect(verifySharePassword(undefined, stored)).resolves.toBe(false);
    await expect(verifySharePassword('correct', null)).resolves.toBe(false);
    await expect(verifySharePassword('correct', 'not-base64-@@')).resolves.toBe(false);
    await expect(verifySharePassword('correct', Buffer.alloc(10).toString('base64'))).resolves.toBe(
      false,
    );
  });

  it('salt สุ่มทุกครั้ง → hash ของรหัสเดียวกันไม่ซ้ำ แต่ตรวจผ่านทั้งคู่', async () => {
    const a = await hashSharePassword('same');
    const b = await hashSharePassword('same');
    expect(a).not.toBe(b);
    await expect(verifySharePassword('same', a)).resolves.toBe(true);
    await expect(verifySharePassword('same', b)).resolves.toBe(true);
  });

  it('ห้ามรหัสผ่านว่างตอนสร้าง', async () => {
    await expect(hashSharePassword('')).rejects.toThrow();
  });
});

describe('token', () => {
  it('เป็นรูปแบบ GUID พิมพ์เล็ก 128 บิตสุ่ม ไม่ซ้ำ', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateShareToken()));
    expect(set.size).toBe(200);
    for (const t of set) {
      expect(isGuid(t)).toBe(true);
      expect(t).toBe(t.toLowerCase());
    }
  });

  it('isGuid ปฏิเสธสิ่งที่ไม่ใช่ GUID (กัน SQL Server error 8169 จากการแปลงชนิด)', () => {
    expect(isGuid('ไม่ใช่')).toBe(false);
    expect(isGuid("11111111-2222-3333-4444-55555555555'; DROP")).toBe(false);
    expect(isGuid(undefined)).toBe(false);
    expect(isGuid('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true); // รับตัวพิมพ์ใหญ่ที่ SQL Server ส่งออก
  });
});
