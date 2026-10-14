import {
  computeNextRunningNumber,
  formatRunningNumber,
} from '../../../src/modules/rgp/running-number/running-number.util';

const d = (y: number, m = 1, day = 15) => new Date(y, m - 1, day);

describe('formatRunningNumber', () => {
  it('PPP-YY-###### : แทน prefix, ปี 2 หลัก และเลขรันเติมศูนย์', () => {
    expect(formatRunningNumber('PPP-YY-######', 'PRJ', d(2026), 7, 6)).toBe('PRJ-26-000007');
  });

  it('YYMM ใช้ปี+เดือน 2 หลัก, YYYY ใช้ปี 4 หลัก', () => {
    expect(formatRunningNumber('PPP/YYMM/####', 'TK', d(2026, 3), 12, 4)).toBe('TK/2603/0012');
    expect(formatRunningNumber('PPP-YYYY-###', 'PRJ', d(2026, 11), 5, 3)).toBe('PRJ-2026-005');
  });

  it('จำนวน # ไม่ต้องตรงกับ digit_number — ใช้ digit_number เป็นตัวกำหนดความกว้าง', () => {
    expect(formatRunningNumber('PPP-######', 'PRJ', d(2026), 3, 4)).toBe('PRJ-0003');
  });

  it('prefix ที่มีตัวอักษรเหมือน token ไม่ถูกแทนซ้ำ (YY ใน prefix)', () => {
    expect(formatRunningNumber('PPP-YY-###', 'YYX', d(2026), 1, 3)).toBe('YYX-26-001');
  });

  it('เลขเกินจำนวนหลักไม่ถูกตัดทิ้ง', () => {
    expect(formatRunningNumber('PPP-YY-###', 'PRJ', d(2026), 1234, 3)).toBe('PRJ-26-1234');
  });
});

describe('computeNextRunningNumber — รีเซ็ตรายปี', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    currentNumber: '41', // bigint จาก driver เป็นสตริง
    prefix: 'PRJ',
    format: 'PPP-YY-######',
    digitNumber: 6,
    yearUw: 2026,
    ...over,
  });

  it('ปีเดิม → นับต่อ (41 → 42) และไม่รีเซ็ต', () => {
    const r = computeNextRunningNumber(row(), d(2026, 6), 'PRJ');
    expect(r).toEqual({ next: 42, year: 2026, formatted: 'PRJ-26-000042', reset: false });
  });

  it('ขึ้นปีใหม่ → เริ่มที่ 1 และเขียนปีใหม่กลับ', () => {
    const r = computeNextRunningNumber(
      row({ yearUw: 2025, currentNumber: '999' }),
      d(2026, 1, 2),
      'PRJ',
    );
    expect(r).toEqual({ next: 1, year: 2026, formatted: 'PRJ-26-000001', reset: true });
  });

  it('Year_UW เป็น NULL ถือว่าเป็นปีใหม่ (ระบบเดิมโยน error) → เริ่มที่ 1', () => {
    const r = computeNextRunningNumber(row({ yearUw: null }), d(2026), 'PRJ');
    expect(r.next).toBe(1);
    expect(r.reset).toBe(true);
  });

  it('prefix/format ว่าง ใช้ค่าเริ่มต้นของชนิดนั้น (TK)', () => {
    const r = computeNextRunningNumber(
      row({ prefix: null, format: null, digitNumber: null, currentNumber: 0 }),
      d(2026),
      'TK',
    );
    expect(r.formatted).toBe('TK-26-000001');
  });

  it('คืนค่า next เป็นตัวเลขเสมอ แม้ current_number เป็นสตริงจากฐานข้อมูล', () => {
    const r = computeNextRunningNumber(row({ currentNumber: '9' }), d(2026), 'PRJ');
    expect(typeof r.next).toBe('number');
    expect(r.next).toBe(10);
  });
});
