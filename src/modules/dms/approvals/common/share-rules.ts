import { AppRole, PrincipalType } from '../../../../common/constants/enums';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import { EXTERNAL_SHARE_MAX_DAYS, INTERNAL_SHARE_MAX_YEARS } from './approval.constants';

/**
 * กฎการแชร์ (ฟังก์ชันล้วน) — พอร์ตจาก ShareService / ShareAccessService (04-business-rules §2.6)
 */

export const SHARE_STATUS = {
  Pending: 'Pending',
  Active: 'Active',
  Disabled: 'Disabled',
  Expired: 'Expired',
  Revoked: 'Revoked',
} as const;
export type ShareStatus = (typeof SHARE_STATUS)[keyof typeof SHARE_STATUS];

const DAY_MS = 86_400_000;

/** ตัดเวลาออก (เที่ยงคืนของวันเดียวกัน ตามเวลาท้องถิ่นของ process) */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addYears(d: Date, years: number): Date {
  const r = new Date(d.getTime());
  r.setFullYear(r.getFullYear() + years);
  return r;
}

// ── Internal share ───────────────────────────────────────────

/**
 * วันหมดอายุของการแชร์ภายใน: ห้ามย้อนหลัง และไม่เกิน 1 ปีนับจากวันนี้ (เทียบระดับ "วัน" เหมือน .Date เดิม)
 * ไม่ระบุ = ไม่หมดอายุ (พฤติกรรมเดิม)
 */
export function assertInternalShareExpiry(expiry: Date | null | undefined, now = new Date()): void {
  if (!expiry) return;
  const today = startOfDay(now);
  const day = startOfDay(expiry);
  if (day < today) {
    throw new BusinessException('ไม่สามารถกำหนดวันหมดอายุย้อนหลังได้', 'SHARE_EXPIRY_IN_PAST');
  }
  if (day > addYears(today, INTERNAL_SHARE_MAX_YEARS)) {
    throw new BusinessException('ไม่สามารถกำหนดอายุเกิน 1 ปีได้', 'SHARE_EXPIRY_TOO_LONG');
  }
}

/**
 * ต้องผ่านอนุมัติหรือไม่: ผู้แชร์ AppRole < 3 (Officer/SrOfficer) หรือแชร์ให้ทั้งแผนก (PrincipalType=3)
 * — แผนกทั้งหน่วยเห็นไฟล์ได้ จึงเสี่ยงเกินกว่าจะข้ามการอนุมัติ
 */
export function internalShareNeedsApproval(appRole: number, principalType: number): boolean {
  return principalType === PrincipalType.Department || appRole < AppRole.Manager;
}

// ── External share ───────────────────────────────────────────

/**
 * วันหมดอายุของการแชร์ภายนอก: ต้องอยู่ในอนาคตและไม่เกิน 90 วัน
 *  - ไม่ระบุ → คืนค่าสูงสุด (now + 90 วัน) แทน "ไม่หมดอายุ" เพื่อไม่ให้ลิงก์สาธารณะอยู่ตลอดไป (ต่างจากระบบเดิม — docs ข้อ 3)
 *  - ระบบเดิมไม่ตรวจว่าอยู่ในอดีต (ลิงก์หมดอายุตั้งแต่เกิด) ที่นี่ปฏิเสธ
 */
export function resolveExternalShareExpiry(
  expiry: Date | null | undefined,
  now = new Date(),
): Date {
  if (!expiry) return new Date(now.getTime() + EXTERNAL_SHARE_MAX_DAYS * DAY_MS);
  if (expiry.getTime() <= now.getTime()) {
    throw new BusinessException('วันหมดอายุของลิงก์ต้องอยู่ในอนาคต', 'SHARE_EXPIRY_IN_PAST');
  }
  const days = (expiry.getTime() - now.getTime()) / DAY_MS;
  if (days > EXTERNAL_SHARE_MAX_DAYS) {
    throw new BusinessException(
      `อายุลิงก์แชร์ภายนอกต้องไม่เกิน ${EXTERNAL_SHARE_MAX_DAYS} วัน`,
      'SHARE_EXPIRY_TOO_LONG',
    );
  }
  return expiry;
}

/**
 * แชร์ภายนอกห้ามเป็นข้อมูลชั้น HC (level 1) — ไฟล์ไม่มีคอลัมน์ ConfidentialityLevel ในฐานจริง (OPEN_QUESTIONS C2)
 * จึงใช้ระดับของโฟลเดอร์ที่ไฟล์อยู่ · โฟลเดอร์ต้องไม่เป็น HC และไม่มีไฟล์ HC
 * (ไฟล์ในโฟลเดอร์เดียวกันมีระดับเท่าโฟลเดอร์ จึงเทียบเท่ากับ "โฟลเดอร์ไม่ใช่ HC")
 */
export function assertExternalShareAllowedLevel(level: number, kind: 'file' | 'folder'): void {
  if (level === 1) {
    throw new BusinessException(
      kind === 'file'
        ? 'ไฟล์ชั้นความลับสูงสุด (HC) แชร์ภายนอกไม่ได้'
        : 'โฟลเดอร์นี้เป็น HC หรือมีไฟล์ HC แชร์ภายนอกไม่ได้',
      'SHARE_HC_FORBIDDEN',
    );
  }
}

export function assertDownloadLimit(limit: number | null | undefined): void {
  if (limit === null || limit === undefined) return;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new BusinessException(
      'จำนวนครั้งที่ดาวน์โหลดได้ต้องเป็นจำนวนเต็มบวก',
      'SHARE_LIMIT_INVALID',
    );
  }
}

// ── สถานะ ─────────────────────────────────────────────────────

/** อนุมัติ/ปฏิเสธได้เฉพาะ Pending */
export const canDecideShare = (status: string): boolean => status === SHARE_STATUS.Pending;
/** เปิด/ปิดชั่วคราวได้เฉพาะ Active ↔ Disabled */
export const canToggleShare = (status: string): boolean =>
  status === SHARE_STATUS.Active || status === SHARE_STATUS.Disabled;
/** ยกเลิกถาวรได้เมื่อยังไม่จบชีวิต (Pending/Active/Disabled) — ระบบเดิมไม่ตรวจ จึงเขียนทับ Revoked/Expired ได้ */
export const canRevokeShare = (status: string): boolean =>
  status === SHARE_STATUS.Pending ||
  status === SHARE_STATUS.Active ||
  status === SHARE_STATUS.Disabled;

/** สถานะที่ใช้งานจริง: Active ที่เลยวันหมดอายุแล้วถือเป็น Expired (ระบบเดิมตรวจตอนเข้าถึงเท่านั้น ไม่มี job เปลี่ยนสถานะ) */
export function effectiveShareStatus(
  status: string,
  expiryDate: Date | null,
  now = new Date(),
): string {
  return status === SHARE_STATUS.Active && expiryDate && expiryDate.getTime() < now.getTime()
    ? SHARE_STATUS.Expired
    : status;
}

// ── การเข้าถึงด้วย token (ShareAccessService.ValidateAndGrantAccess) ──

/** เหตุผลที่ปฏิเสธ — ค่าที่บันทึกลง ShareAccessLog.FailureReason (ภายใน) แยกจากข้อความที่ตอบผู้ใช้ภายนอก */
export type AccessDenyReason =
  | 'TokenNotFound'
  | 'Pending'
  | 'Expired'
  | 'Disabled'
  | 'Revoked'
  | 'InvalidStatus'
  | 'WrongPassword'
  | 'LimitReached'
  | 'TargetUnavailable';

export interface ShareAccessInput {
  status: string;
  expiryDate: Date | null;
  hasPassword: boolean;
  passwordOk: boolean;
  downloadLimit: number | null;
  currentDownloadCount: number;
}

/**
 * ตรวจเงื่อนไขเข้าถึงตามลำดับเดียวกับระบบเดิม: สถานะ → วันหมดอายุ → รหัสผ่าน → จำนวนดาวน์โหลด
 * คืน null = ผ่าน, ไม่ผ่าน = เหตุผลภายใน (ห้ามส่งให้ผู้ใช้ภายนอกตรงๆ — ตอบข้อความทั่วไปเท่านั้น)
 */
export function evaluateShareAccess(
  input: ShareAccessInput,
  now = new Date(),
): AccessDenyReason | null {
  switch (input.status) {
    case SHARE_STATUS.Active:
      break;
    case SHARE_STATUS.Pending:
      return 'Pending';
    case SHARE_STATUS.Expired:
      return 'Expired';
    case SHARE_STATUS.Disabled:
      return 'Disabled';
    case SHARE_STATUS.Revoked:
      return 'Revoked';
    default:
      return 'InvalidStatus';
  }
  if (input.expiryDate && now.getTime() > input.expiryDate.getTime()) return 'Expired';
  if (input.hasPassword && !input.passwordOk) return 'WrongPassword';
  if (input.downloadLimit !== null && input.currentDownloadCount >= input.downloadLimit) {
    return 'LimitReached';
  }
  return null;
}

/** จำนวนดาวน์โหลดที่เหลือหลังการดาวน์โหลดครั้งนี้ (-1 = ไม่จำกัด) */
export function remainingDownloadsAfter(limit: number | null, currentCount: number): number {
  return limit === null ? -1 : Math.max(0, limit - currentCount - 1);
}

/** ข้อความเดียวที่ตอบผู้ใช้ภายนอกเมื่อเข้าลิงก์ไม่ได้ (ไม่บอกว่าผิดตรงไหน — กันการเดา token/รหัสผ่าน) */
export const PUBLIC_SHARE_DENIED_MESSAGE = 'ไม่สามารถเข้าถึงลิงก์นี้ได้';
