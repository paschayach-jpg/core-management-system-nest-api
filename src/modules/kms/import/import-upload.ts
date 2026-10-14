import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskStorage } from 'multer';

/** โฟลเดอร์ชั่วคราวของไฟล์ที่อัปโหลด (multer เขียนที่นี่ก่อน แล้ว service ย้ายเข้า staging ของงาน/ลบทิ้ง) */
export const KMS_UPLOAD_TMP = join(tmpdir(), 'cms-kms-upload');
/** โฟลเดอร์ staging ไฟล์แนบของงาน import — ใต้นี้แยกโฟลเดอร์ตาม importId */
export const KMS_IMPORT_STAGE_ROOT = join(tmpdir(), 'cms-kms-import');

/**
 * ตั้งค่า multer ของ KMS: เขียนลงดิสก์ (ไม่เก็บทั้งไฟล์ใน memory) · ขนาดต่อไฟล์ตาม STORAGE_MAX_UPLOAD_MB
 * defParamCharset=utf8 — browser ส่งชื่อไฟล์เป็น UTF-8 แต่ busboy ตีความเป็น latin1 โดยปริยาย ทำให้ชื่อไฟล์ไทยเพี้ยน
 */
export function kmsMulterOptions(maxUploadMb: number): MulterOptions {
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        mkdirSync(KMS_UPLOAD_TMP, { recursive: true });
        cb(null, KMS_UPLOAD_TMP);
      },
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 400, fields: 20 },
    defParamCharset: 'utf8',
  } as MulterOptions;
}
