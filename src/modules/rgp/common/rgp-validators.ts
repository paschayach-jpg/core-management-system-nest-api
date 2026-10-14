import { registerDecorator, type ValidationOptions } from 'class-validator';

/** 'YYYY-MM-DD' ที่เป็นวันที่จริงตามปฏิทิน (กัน 2026-02-30) */
export function isValidDateOnly(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** ฟิลด์วันที่แบบไม่มีเวลา รูปแบบ `YYYY-MM-DD` (คอลัมน์ `date` ของ RGP) */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message: `${String(propertyKey)} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD`,
        ...options,
      },
      validator: { validate: (value: unknown) => isValidDateOnly(value) },
    });
}

/** ตัดช่องว่างหัวท้ายของสตริง (ค่าอื่นผ่านไปให้ validator จัดการ) */
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** query string 'true' / '1' → boolean */
export const toBool = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' || value === '1' || value === 1
    ? true
    : value === false || value === 'false' || value === '0' || value === 0
      ? false
      : value;
