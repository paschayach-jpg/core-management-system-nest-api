/** ตัวช่วยแปลงค่าใน DTO ของ KMS (ใช้กับ @Transform ของ class-transformer) */

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** "true"/"1" → true · "false"/"0" → false · อย่างอื่นปล่อยให้ validator ปฏิเสธ */
export const toBool = ({ value }: { value: unknown }) => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
};

/** "1,2,3" หรือ ?ids=1&ids=2 → [1,2,3] (ค่าที่ไม่ใช่ตัวเลขกลายเป็น NaN เพื่อให้ @IsInt ปฏิเสธ) */
export const csvToInts = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((p) => Number(String(p).trim()));
};

/**
 * วันที่จาก JSON: "2020-06-30" (วันที่ล้วน) → เที่ยงคืนตามเวลาท้องถิ่น (DB เก็บเวลาท้องถิ่น ไม่ให้เลื่อนวันตาม timezone) ·
 * สตริงเวลา ISO เต็ม → ตามนั้น · null/'' → null (= ไม่มีวันที่/ไม่มีวันหมดอายุ) · ค่าที่แปลงไม่ได้ → Invalid Date ให้ @IsDate ปฏิเสธ
 */
export const dateInput = ({ value }: { value: unknown }) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) {
      const d = new Date(2000, 0, 1);
      d.setFullYear(+m[1], +m[2] - 1, +m[3]);
      d.setHours(0, 0, 0, 0);
      return d.getMonth() === +m[2] - 1 ? d : new Date(NaN);
    }
    return new Date(value);
  }
  return new Date(NaN);
};
