import { readFile, unlink } from 'node:fs/promises';
import type { DmsUploadInput } from '../../dms/ports/dms-file.port';

/** ไฟล์ที่ multer (diskStorage) เก็บชั่วคราวบนดิสก์ — ใช้เฉพาะ field ที่ต้องการ */
export interface TempUploadedFile {
  originalname: string;
  path: string;
  mimetype?: string;
}

/**
 * busboy/multer รุ่นที่ถอดชื่อไฟล์เป็น latin1 ทำให้ชื่อที่ไม่ใช่ ASCII (เช่นภาษาไทย) เพี้ยน → แปลงกลับเป็น UTF-8
 * ทำเฉพาะเมื่อทุกตัวอักษรอยู่ในช่วง latin1 (0–255) และแปลงแล้ววนกลับได้ตรงเดิม — ชื่อที่ถูกถอดเป็น UTF-8 ถูกต้องอยู่แล้ว
 * (มีอักขระ > 255 เช่นอักษรไทย) จะคงไว้ไม่แตะ
 */
export function fixMulterFileName(name: string): string {
  if (/^[\x20-\x7F]*$/.test(name)) return name;
  if ([...name].some((c) => (c.codePointAt(0) ?? 0) > 0xff)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD')) return name;
  return Buffer.from(decoded, 'utf8').toString('latin1') === name ? decoded : name;
}

/**
 * อ่านไฟล์ชั่วคราวเป็น buffer ส่งให้ DMS port แล้ว **ลบไฟล์ชั่วคราวเสมอ** (ทั้งสำเร็จและล้มเหลว)
 * @returns ผลจาก `use` — เรียกด้วย buffer ที่พร้อมใช้
 */
export async function withUploadedBuffers<T>(
  files: TempUploadedFile[],
  use: (inputs: DmsUploadInput[]) => Promise<T>,
): Promise<T> {
  try {
    const inputs: DmsUploadInput[] = [];
    for (const f of files) {
      inputs.push({
        originalName: fixMulterFileName(f.originalname),
        buffer: await readFile(f.path),
        mimeType: f.mimetype,
      });
    }
    return await use(inputs);
  } finally {
    await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
  }
}
