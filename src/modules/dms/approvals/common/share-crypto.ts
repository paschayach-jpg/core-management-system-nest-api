import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

/**
 * รหัสผ่านลิงก์แชร์ภายนอก — **ต้องเข้ากับ hash ที่ระบบเดิมสร้างไว้** (ShareTokenService.HashPassword):
 *   .NET `Rfc2898DeriveBytes(password, salt16, 10000)` → PBKDF2 ใช้ HMAC-SHA1 (คอนสตรักเตอร์ 3 อาร์กิวเมนต์ใน .NET Framework
 *   ไม่มีทางเลือก hash อื่น แม้คอมเมนต์ในโค้ดเดิมเขียนว่า SHA256) · `GetBytes(32)` · เก็บ Base64(salt[16] + hash[32])
 *   รหัสผ่านถูกแปลงเป็น UTF-8 ก่อน derive
 * จึงต้องใช้ pbkdf2(sha1, 10000 รอบ, 32 ไบต์) เพื่อให้ข้อมูลเก่ายังตรวจผ่านและข้อมูลใหม่ WinForms ยังตรวจได้
 */
export const SHARE_PWD_SALT_BYTES = 16;
export const SHARE_PWD_HASH_BYTES = 32;
export const SHARE_PWD_ITERATIONS = 10_000;
const DIGEST = 'sha1';

export async function hashSharePassword(password: string, salt?: Buffer): Promise<string> {
  if (!password) throw new Error('รหัสผ่านต้องไม่ว่าง');
  const s = salt ?? randomBytes(SHARE_PWD_SALT_BYTES);
  const hash = await pbkdf2Async(
    Buffer.from(password, 'utf8'),
    s,
    SHARE_PWD_ITERATIONS,
    SHARE_PWD_HASH_BYTES,
    DIGEST,
  );
  return Buffer.concat([s, hash]).toString('base64');
}

/** เทียบแบบ constant-time · hash ผิดรูป/ว่าง/รหัสว่าง → false (ไม่ throw) */
export async function verifySharePassword(
  password: string | null | undefined,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!password || !stored) return false;
  let raw: Buffer;
  try {
    raw = Buffer.from(stored, 'base64');
  } catch {
    return false;
  }
  if (raw.length !== SHARE_PWD_SALT_BYTES + SHARE_PWD_HASH_BYTES) return false;
  const salt = raw.subarray(0, SHARE_PWD_SALT_BYTES);
  const expected = raw.subarray(SHARE_PWD_SALT_BYTES);
  const actual = await pbkdf2Async(
    Buffer.from(password, 'utf8'),
    salt,
    SHARE_PWD_ITERATIONS,
    SHARE_PWD_HASH_BYTES,
    DIGEST,
  );
  return timingSafeEqual(actual, expected);
}

// ── token ──────────────────────────────────────────────────

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** รูปแบบ GUID (ไม่บังคับเวอร์ชัน — token เดิมสร้างจาก 16 ไบต์สุ่มจึงไม่ใช่ GUID v4 มาตรฐาน) */
export const isGuid = (s: unknown): s is string => typeof s === 'string' && GUID_RE.test(s);

/** token ใหม่: 128 บิตสุ่มจาก CSPRNG จัดรูปแบบเป็น GUID พิมพ์เล็ก (เหมือน `new Guid(randomBytes)` เดิม) */
export function generateShareToken(): string {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** SQL Server ส่ง uniqueidentifier เป็นตัวพิมพ์ใหญ่ — ทำให้เป็นพิมพ์เล็กเสมอเมื่อส่งออก/เทียบ */
export const normalizeGuid = (s: string): string => s.toLowerCase();
