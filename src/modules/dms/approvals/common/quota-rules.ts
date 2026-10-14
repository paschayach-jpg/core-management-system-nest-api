import { BusinessException } from '../../../../common/exceptions/business.exception';

/**
 * กฎโควตา (ฟังก์ชันล้วน) — พอร์ตจาก FolderQuotaService (04-business-rules §2.7)
 */

/** ระดับการแจ้งเตือน (QuotaAlertLevel เดิม: 0=Normal, 1=Warning, 2=Critical, 3=Full) */
export enum QuotaAlertLevel {
  Normal = 0,
  Warning = 1,
  Critical = 2,
  Full = 3,
}

export const DEFAULT_WARN_PCT = 80;
export const DEFAULT_CRITICAL_PCT = 95;

/** key ใน dbo.SystemConfig ที่ใช้ปรับเกณฑ์ (ยังไม่มีในฐานเดิม — ถ้าไม่ตั้งใช้ 80/95; ดู docs คำถามเปิด) */
export const QUOTA_WARN_CONFIG_KEY = 'DmsQuotaWarnThresholdPct';
export const QUOTA_CRITICAL_CONFIG_KEY = 'DmsQuotaCriticalThresholdPct';

export const BYTES_PER_GB = 1_073_741_824;

export interface QuotaThresholds {
  warnPct: number;
  criticalPct: number;
}

export const DEFAULT_THRESHOLDS: QuotaThresholds = {
  warnPct: DEFAULT_WARN_PCT,
  criticalPct: DEFAULT_CRITICAL_PCT,
};

/** 0 < warn < critical < 100 — ค่าที่ไม่ผ่านถือว่าตั้งผิด (ผู้เรียกใช้ค่าเริ่มต้นแทน) */
export function areThresholdsValid(t: QuotaThresholds): boolean {
  return (
    Number.isFinite(t.warnPct) &&
    Number.isFinite(t.criticalPct) &&
    t.warnPct > 0 &&
    t.warnPct < t.criticalPct &&
    t.criticalPct < 100
  );
}

export function resolveThresholds(
  warn: number | null | undefined,
  critical: number | null | undefined,
): QuotaThresholds {
  const t = {
    warnPct: warn ?? DEFAULT_WARN_PCT,
    criticalPct: critical ?? DEFAULT_CRITICAL_PCT,
  };
  return areThresholdsValid(t) ? t : DEFAULT_THRESHOLDS;
}

export interface QuotaEvaluation {
  usedBytes: number;
  quotaBytes: number;
  /** ร้อยละการใช้งาน ปัดทศนิยม 2 ตำแหน่ง (0 เมื่อยังไม่ตั้งโควตา) */
  usedPercent: number;
  alert: QuotaAlertLevel;
}

/**
 * คำนวณระดับ: โควตา <= 0 = ยังไม่ได้ตั้ง → Normal เสมอ (ไม่จำกัด) เหมือน config == null เดิม
 * ลำดับ: >=100 Full → >=critical Critical → >=warn Warning → Normal
 */
export function evaluateQuota(
  usedBytes: number,
  quotaBytes: number,
  thresholds: QuotaThresholds = DEFAULT_THRESHOLDS,
): QuotaEvaluation {
  if (!(quotaBytes > 0))
    return { usedBytes, quotaBytes: 0, usedPercent: 0, alert: QuotaAlertLevel.Normal };
  const pct = (usedBytes / quotaBytes) * 100;
  let alert = QuotaAlertLevel.Normal;
  if (pct >= 100) alert = QuotaAlertLevel.Full;
  else if (pct >= thresholds.criticalPct) alert = QuotaAlertLevel.Critical;
  else if (pct >= thresholds.warnPct) alert = QuotaAlertLevel.Warning;
  return { usedBytes, quotaBytes, usedPercent: Math.round(pct * 100) / 100, alert };
}

/** ข้อความแจ้งเตือน (ตรงกับ BuildAlertMessage เดิม) */
export function buildQuotaAlertMessage(name: string, e: QuotaEvaluation): string {
  const used = (e.usedBytes / BYTES_PER_GB).toFixed(1);
  const total = (e.quotaBytes / BYTES_PER_GB).toFixed(1);
  switch (e.alert) {
    case QuotaAlertLevel.Full:
      return `[QUOTA FULL] ${name}: ใช้ ${used} GB / ${total} GB (100%)`;
    case QuotaAlertLevel.Critical:
      return `[QUOTA วิกฤต] ${name}: ใช้ ${used} GB / ${total} GB (${e.usedPercent.toFixed(1)}%)`;
    default:
      return `[QUOTA เตือน] ${name}: ใช้ ${used} GB / ${total} GB (${e.usedPercent.toFixed(1)}%)`;
  }
}

/** ข้อความเมื่อพื้นที่เต็ม (EnforceQuota เดิม) */
export function quotaFullMessage(e: QuotaEvaluation): string {
  return `พื้นที่ folder เต็ม (${(e.usedBytes / BYTES_PER_GB).toFixed(1)} GB จาก ${(e.quotaBytes / BYTES_PER_GB).toFixed(1)} GB) กรุณาขออนุมัติเพิ่ม quota`;
}

/**
 * อัปโหลดทั้งชุด: ล้มทั้งชุดถ้าผลรวมขนาดไฟล์ทำให้เกินโควตา (ValidateBatchAgainstOrgQuota)
 * โควตา <= 0 = ไม่จำกัด · "เกิน" = ใช้ไปแล้ว + ไฟล์ใหม่ > โควตา
 */
export function wouldExceedQuota(
  usedBytes: number,
  quotaBytes: number,
  incoming: number[],
): boolean {
  if (!(quotaBytes > 0)) return false;
  const add = incoming.reduce((s, n) => s + (Number.isFinite(n) && n > 0 ? n : 0), 0);
  return usedBytes + add > quotaBytes;
}

/** ขนาดไฟล์แบบอ่านง่าย (เหมือน FileService.FormatBytes เดิม) */
export function formatBytes(bytes: number): string {
  const n = (v: number, d: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (bytes >= 1024 ** 3) return `${n(bytes / 1024 ** 3, 2)} GB`;
  if (bytes >= 1024 ** 2) return `${n(bytes / 1024 ** 2, 1)} MB`;
  if (bytes >= 1024) return `${n(bytes / 1024, 1)} KB`;
  return `${n(bytes, 0)} bytes`;
}

/** ข้อความเมื่ออัปโหลดทั้งชุดแล้วเกินโควตา (ValidateBatchAgainstOrgQuota เดิม) */
export function quotaBatchExceededMessage(
  usedBytes: number,
  quotaBytes: number,
  incoming: number[],
): string {
  const delta = incoming.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0);
  return (
    `ไม่สามารถอัปโหลดได้ เนื่องจากพื้นที่คงเหลือ ${formatBytes(Math.max(0, quotaBytes - usedBytes))} ` +
    `แต่ไฟล์ที่เลือกมีขนาดรวม ${formatBytes(delta)} ` +
    `(ใช้ไป ${formatBytes(usedBytes)} จาก quota ${formatBytes(quotaBytes)})`
  );
}

/** ตรวจคำขอเพิ่มโควตา: ขนาดที่ขอ > 0 และ > ปัจจุบัน, ต้องมีเหตุผล */
export function assertValidQuotaChangeRequest(
  requestedBytes: number,
  currentBytes: number,
  reason: string | null | undefined,
): void {
  if (!(requestedBytes > 0)) {
    throw new BusinessException('ขนาด quota ที่ขอต้องมากกว่า 0', 'QUOTA_REQUEST_INVALID');
  }
  if (requestedBytes <= currentBytes) {
    throw new BusinessException(
      'ขนาด quota ที่ขอต้องมากกว่า quota ปัจจุบัน',
      'QUOTA_REQUEST_NOT_GREATER',
    );
  }
  if (!reason || reason.trim() === '') {
    throw new BusinessException('กรุณาระบุเหตุผลในการขอเพิ่ม quota', 'QUOTA_REASON_REQUIRED');
  }
}

/** ชื่อประเภทหน่วยงานของตารางหลัก (1=SubCommittee, 2=Division, 3=Department) */
export const QUOTA_UNIT_TYPE_LABEL: Record<number, string> = {
  1: 'Sub Committee',
  2: 'Division',
  3: 'Department',
};
