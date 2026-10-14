import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { DmsFilePort } from '../dms/ports/dms-file.port';

/**
 * KMS ฝากไฟล์เข้า DMS ผ่านพอร์ตเท่านั้น (DMS_FILE_PORT) — ถ้า DMS ยังไม่มี provider (เช่น module DMS ยังไม่พร้อม)
 * ที่จุดใช้งานต้องตอบ 503 code DMS_UNAVAILABLE แทนที่จะล้มด้วย error ภายใน
 */
export function requireDms(dms: DmsFilePort | undefined | null): DmsFilePort {
  if (!dms) {
    throw new BusinessException(
      'ระบบจัดเก็บไฟล์ (DMS) ยังไม่พร้อมใช้งาน จึงจัดการไฟล์แนบไม่ได้ในขณะนี้',
      'DMS_UNAVAILABLE',
      undefined,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return dms;
}
