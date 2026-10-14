/**
 * แปลงวันที่จาก Excel/ข้อความ — พอร์ตจาก KBExcelReader (TryParseDateText / TryParseThaiLongDate / ApplyAdYearCorrection)
 * ผลเป็น ค.ศ. เสมอ (ปีมากกว่า 2400 ถือเป็น พ.ศ. จึงลบ 543) · วันที่ที่ได้เป็น "เวลาท้องถิ่น" ตามที่ DB เก็บ (TypeORM ตั้ง useUTC=false)
 */

const THAI_MONTHS: Record<string, number> = {
  มกราคม: 1,
  'ม.ค.': 1,
  กุมภาพันธ์: 2,
  'ก.พ.': 2,
  มีนาคม: 3,
  'มี.ค.': 3,
  เมษายน: 4,
  'เม.ย.': 4,
  พฤษภาคม: 5,
  'พ.ค.': 5,
  มิถุนายน: 6,
  'มิ.ย.': 6,
  กรกฎาคม: 7,
  'ก.ค.': 7,
  สิงหาคม: 8,
  'ส.ค.': 8,
  กันยายน: 9,
  'ก.ย.': 9,
  ตุลาคม: 10,
  'ต.ค.': 10,
  พฤศจิกายน: 11,
  'พ.ย.': 11,
  ธันวาคม: 12,
  'ธ.ค.': 12,
};

/** ช่วงที่ SQL Server `datetime` เก็บได้ (1753-01-01 ถึง 9999-12-31) */
export const SQL_DATETIME_MIN_YEAR = 1753;

/** สร้างวันที่ท้องถิ่นแบบตรวจความถูกต้องของปฏิทิน (31/2 → null) */
function makeDate(year: number, month: number, day: number): Date | null {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(2000, 0, 1);
  d.setFullYear(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/** ปีมากกว่า 2400 ถือว่าเป็น พ.ศ. จึงลบ 543 ให้เป็น ค.ศ. */
export function applyAdYearCorrection(d: Date): Date {
  if (d.getFullYear() <= 2400) return d;
  const r = new Date(d.getTime());
  r.setFullYear(d.getFullYear() - 543);
  return r;
}

function tryParseThaiLongDate(raw: string): Date | null {
  const parts = raw.trim().split(/ +/).filter(Boolean);
  if (parts.length < 3) return null;
  if (!/^-?\d+$/.test(parts[0]) || !/^-?\d+$/.test(parts[parts.length - 1])) return null;
  const day = parseInt(parts[0], 10);
  const year = parseInt(parts[parts.length - 1], 10);
  const monthToken = parts.slice(1, -1).join(' ').trim();
  const month = THAI_MONTHS[monthToken];
  if (!month) return null;
  const d = makeDate(year, month, day);
  return d ? applyAdYearCorrection(d) : null;
}

/**
 * แปลงข้อความเป็นวันที่ รองรับ d/M/yyyy, dd/MM/yyyy, yyyy-MM-dd, yyyy/MM/dd และวันที่ไทย ("9 เมษายน 2535", "09 เม.ย. 2535")
 * คืน null เมื่อว่างหรือแปลงไม่ได้ (ผู้เรียกแยกด้วยว่าข้อความว่างหรือไม่)
 */
export function tryParseDateText(raw: string | null | undefined): Date | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) {
    const d = makeDate(+m[3], +m[2], +m[1]);
    if (d) return applyAdYearCorrection(d);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) ?? /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  if (m) {
    const d = makeDate(+m[1], +m[2], +m[3]);
    if (d) return applyAdYearCorrection(d);
  }
  return tryParseThaiLongDate(text);
}

/** วันที่ใน cell แบบ Date ของ exceljs (เป็น UTC ของวันที่ใน serial) → วันที่ท้องถิ่นที่ปฏิทินตรงกัน + แก้ปี พ.ศ. */
export function fromExcelDate(d: Date): Date | null {
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(2000, 0, 1);
  local.setFullYear(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  local.setHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), 0);
  return applyAdYearCorrection(local);
}

/** "dd/MM/yyyy" จากวันที่ใน cell (UTC components) — ข้อความดิบที่เก็บใน RawPublishedDate เมื่อเซลล์เป็นวันที่ */
export function formatExcelDateText(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCFullYear(), 4)}`;
}

/** วันที่อยู่ในช่วงที่ SQL Server datetime เก็บได้หรือไม่ */
export function isSqlDatetimeRange(d: Date): boolean {
  return d.getFullYear() >= SQL_DATETIME_MIN_YEAR && d.getFullYear() <= 9999;
}
