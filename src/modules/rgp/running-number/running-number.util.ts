/**
 * ตรรกะออกเลขที่รัน (เลขที่โครงการ `PRJ`, รหัส Task `TK`) แบบฟังก์ชันล้วน — พอร์ตจาก
 * ProjectRepository.GenerateProjectNo / ProjectTaskRepository.GenerateTaskCode
 *
 * กฎ:
 *  - เลขล่าสุดเก็บใน `RunningNumber.current_number`, ปีที่ใช้ล่าสุดเก็บใน `Year_UW`
 *  - ถ้าปีปัจจุบัน ≠ Year_UW → เริ่มนับใหม่ที่ 1 (รีเซ็ตรายปี)
 *  - format เช่น `PPP-YY-######` : PPP = prefix, YY = ปี ค.ศ. 2 หลัก, YYMM = ปี+เดือน, YYYY = ปี 4 หลัก,
 *    ชุด `#` = เลขรันเติมศูนย์ให้ครบ `digit_number` หลัก
 */

export type RunningType = 'PRJ' | 'TK';

export const RUNNING_DEFAULTS: Record<
  RunningType,
  { prefix: string; format: string; digits: number }
> = {
  PRJ: { prefix: 'PRJ', format: 'PPP-YY-######', digits: 6 },
  TK: { prefix: 'TK', format: 'PPP-YY-######', digits: 6 },
};

export interface RunningNumberRow {
  id: number;
  /** bigint ในฐานข้อมูล — driver คืนเป็นสตริง */
  currentNumber: number | string | null;
  prefix?: string | null;
  format?: string | null;
  digitNumber?: number | string | null;
  yearUw?: number | string | null;
}

export interface NextRunningNumber {
  /** ค่าที่ต้องเขียนกลับ `current_number` */
  next: number;
  /** ค่าที่ต้องเขียนกลับ `Year_UW` */
  year: number;
  /** เลขที่จัดรูปแบบแล้ว */
  formatted: string;
  /** true เมื่อรีเซ็ตเพราะขึ้นปีใหม่ */
  reset: boolean;
}

const toInt = (v: number | string | null | undefined, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** จัดรูปแบบเลขที่ตาม format (ผ่านรอบเดียว กัน prefix ที่มีตัวอักษรตรงกับ token ถูกแทนซ้ำ) */
export function formatRunningNumber(
  format: string,
  prefix: string,
  now: Date,
  runNumber: number,
  digits: number,
): string {
  const year = now.getFullYear();
  const yyyy = String(year);
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return format.replace(/YYYY|YYMM|YY|PPP|#+/g, (token) => {
    switch (token) {
      case 'YYYY':
        return yyyy;
      case 'YYMM':
        return yy + mm;
      case 'YY':
        return yy;
      case 'PPP':
        return prefix;
      default:
        return String(runNumber).padStart(digits, '0');
    }
  });
}

/**
 * คำนวณเลขถัดไปจากแถวใน RunningNumber (ไม่แตะ DB)
 * @param now เวลาปัจจุบัน (ส่งเข้ามาเพื่อให้เทสต์กำหนดปีได้)
 */
export function computeNextRunningNumber(
  row: RunningNumberRow,
  now: Date,
  type: RunningType,
): NextRunningNumber {
  const defaults = RUNNING_DEFAULTS[type];
  const year = now.getFullYear();
  const storedYear = toInt(row.yearUw, 0);
  const reset = storedYear !== year;
  const current = reset ? 0 : toInt(row.currentNumber, 0);
  const next = current + 1;
  const digits = toInt(row.digitNumber, defaults.digits);
  const formatted = formatRunningNumber(
    row.format?.trim() || defaults.format,
    row.prefix?.trim() || defaults.prefix,
    now,
    next,
    digits,
  );
  return { next, year, formatted, reset };
}
