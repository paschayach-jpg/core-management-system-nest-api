/** ตัวช่วยสำหรับ DTO ของ DMS core */

/** ตัดช่องว่างหัวท้ายของ string (ใช้กับ @Transform) */
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** แปลง 'true'/'1' จาก query string เป็น boolean */
export const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' || value === '1'
    ? true
    : value === false || value === 'false' || value === '0'
      ? false
      : value;
