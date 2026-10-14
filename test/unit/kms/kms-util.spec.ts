import { csvToInts, dateInput, toBool, trim } from '../../../src/modules/kms/kms-dto.util';
import { requireDms } from '../../../src/modules/kms/kms-dms';
import {
  chunkArray,
  isConstraintViolation,
  isUniqueViolation,
} from '../../../src/modules/kms/kms-sql';
import { kmsMulterOptions } from '../../../src/modules/kms/import/import-upload';

describe('kms-sql', () => {
  it('isUniqueViolation: 2627/2601 ทั้งแบบ driverError ของ TypeORM และ error ตรง', () => {
    expect(isUniqueViolation({ driverError: { number: 2627 } })).toBe(true);
    expect(isUniqueViolation({ number: 2601 })).toBe(true);
    expect(isUniqueViolation({ number: 547 })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isConstraintViolation({ driverError: { number: 547 } })).toBe(true);
    expect(isConstraintViolation(new Error('x'))).toBe(false);
  });

  it('chunkArray: แบ่งชุดไม่เกินขนาดที่กำหนด (SQL Server จำกัด 2100 parameter)', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 2)).toEqual([]);
    expect(chunkArray(Array.from({ length: 2500 }, (_, i) => i)).map((c) => c.length)).toEqual([
      1000, 1000, 500,
    ]);
  });
});

describe('kms-dto.util', () => {
  it('trim / toBool / csvToInts', () => {
    expect(trim({ value: '  ก ' })).toBe('ก');
    expect(trim({ value: 5 })).toBe(5);
    expect(toBool({ value: 'true' })).toBe(true);
    expect(toBool({ value: '0' })).toBe(false);
    expect(toBool({ value: 'yes' })).toBe('yes'); // ให้ validator ปฏิเสธ
    expect(csvToInts({ value: '1, 2,3' })).toEqual([1, 2, 3]);
    expect(csvToInts({ value: ['4', '5'] })).toEqual([4, 5]);
    expect(csvToInts({ value: '' })).toBeUndefined();
    expect(csvToInts({ value: '1,x' })).toEqual([1, NaN]);
  });

  it('dateInput: วันที่ล้วน = เที่ยงคืนเวลาท้องถิ่น (ไม่เลื่อนวัน) · null/ว่าง = null · วันที่ไม่มีจริง = Invalid', () => {
    const d = dateInput({ value: '2020-06-30' }) as Date;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2020, 5, 30, 0]);
    expect(dateInput({ value: null })).toBeNull();
    expect(dateInput({ value: '' })).toBeNull();
    expect(dateInput({ value: undefined })).toBeUndefined();
    expect(Number.isNaN((dateInput({ value: '2021-02-30' }) as Date).getTime())).toBe(true);
    expect(Number.isNaN((dateInput({ value: 12 }) as Date).getTime())).toBe(true);
    expect((dateInput({ value: '2020-06-30T10:00:00Z' }) as Date).toISOString()).toBe(
      '2020-06-30T10:00:00.000Z',
    );
  });
});

describe('kms-dms / upload options', () => {
  it('requireDms: ไม่มี provider = 503 DMS_UNAVAILABLE · มีแล้วคืนตัวเดิม', () => {
    expect(() => requireDms(undefined)).toThrow(
      expect.objectContaining({
        status: 503,
        response: expect.objectContaining({ code: 'DMS_UNAVAILABLE' }),
      }),
    );
    expect(() => requireDms(null)).toThrow();
    const port = {} as never;
    expect(requireDms(port)).toBe(port);
  });

  it('kmsMulterOptions: จำกัดขนาดตาม MB และอ่านชื่อไฟล์เป็น UTF-8', () => {
    const o = kmsMulterOptions(20);
    expect(o.limits?.fileSize).toBe(20 * 1024 * 1024);
    expect((o as { defParamCharset?: string }).defParamCharset).toBe('utf8');
  });
});
