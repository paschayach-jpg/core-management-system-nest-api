import {
  applyAdYearCorrection,
  formatExcelDateText,
  fromExcelDate,
  isSqlDatetimeRange,
  tryParseDateText,
} from '../../../src/modules/kms/import/kb-dates';

const ymd = (d: Date | null) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null);

describe('tryParseDateText', () => {
  it.each([
    ['9/4/2535', [1992, 4, 9]], // พ.ศ. → ค.ศ. (-543)
    ['09/04/2535', [1992, 4, 9]],
    ['9/4/1992', [1992, 4, 9]],
    ['1992-04-09', [1992, 4, 9]],
    ['1992/04/09', [1992, 4, 9]],
    ['  15/12/2020 ', [2020, 12, 15]],
  ])('%s', (text, expected) => {
    expect(ymd(tryParseDateText(text))).toEqual(expected);
  });

  it('วันที่ไทยแบบยาวและย่อ', () => {
    expect(ymd(tryParseDateText('9 เมษายน 2535'))).toEqual([1992, 4, 9]);
    expect(ymd(tryParseDateText('09 เม.ย. 2535'))).toEqual([1992, 4, 9]);
    expect(ymd(tryParseDateText('1 ม.ค. 2564'))).toEqual([2021, 1, 1]);
  });

  it('ว่าง → null · รูปแบบไม่รู้จัก → null · ปฏิทินไม่ถูก (31/2) → null', () => {
    expect(tryParseDateText('')).toBeNull();
    expect(tryParseDateText(null)).toBeNull();
    expect(tryParseDateText('พรุ่งนี้')).toBeNull();
    expect(tryParseDateText('31/2/2020')).toBeNull();
    expect(tryParseDateText('2020-13-01')).toBeNull();
    expect(tryParseDateText('5 เดือนอะไร 2535')).toBeNull();
  });

  it('ปี 2400 ลงไปถือเป็น ค.ศ. (ไม่ลบ 543)', () => {
    expect(ymd(tryParseDateText('1/1/2400'))).toEqual([2400, 1, 1]);
    expect(ymd(tryParseDateText('1/1/2401'))).toEqual([1858, 1, 1]);
  });
});

describe('วันที่จาก cell ของ exceljs', () => {
  it('Date (UTC ของ serial) → วันที่ท้องถิ่นเดียวกัน ไม่เลื่อนวันตาม timezone', () => {
    const cellDate = new Date(Date.UTC(2020, 5, 30, 0, 0, 0)); // 30 มิ.ย. 2020
    expect(ymd(fromExcelDate(cellDate))).toEqual([2020, 6, 30]);
  });

  it('เซลล์ที่พิมพ์ปี พ.ศ. ลงในช่องวันที่ (ปี 2535 ค.ศ.) ถูกแก้เป็น 1992', () => {
    const cellDate = new Date(Date.UTC(2535, 3, 9));
    expect(ymd(fromExcelDate(cellDate))).toEqual([1992, 4, 9]);
  });

  it('formatExcelDateText = dd/MM/yyyy', () => {
    expect(formatExcelDateText(new Date(Date.UTC(1992, 3, 9)))).toBe('09/04/1992');
    expect(formatExcelDateText(new Date(Date.UTC(535, 0, 5)))).toBe('05/01/0535');
  });

  it('Invalid Date → null', () => {
    expect(fromExcelDate(new Date('x'))).toBeNull();
  });
});

describe('ช่วงวันที่ของ SQL Server datetime', () => {
  it('ก่อน 1753 อยู่นอกช่วง', () => {
    expect(isSqlDatetimeRange(new Date(1992, 0, 1))).toBe(true);
    const old = new Date(2000, 0, 1);
    old.setFullYear(1500);
    expect(isSqlDatetimeRange(old)).toBe(false);
  });
  it('applyAdYearCorrection ไม่แก้ปี ≤ 2400', () => {
    const d = new Date(2000, 0, 1);
    expect(applyAdYearCorrection(d)).toBe(d);
  });
});
