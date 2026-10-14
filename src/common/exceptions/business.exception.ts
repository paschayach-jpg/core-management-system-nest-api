import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * ละเมิดกฎธุรกิจ (เทียบกับ InvalidOperationException ที่ Service เดิมโยนแล้ว Controller แสดง MessageBox)
 * ตอบ 422 พร้อม `code` ที่ client ใช้แยกกรณีได้ เช่น 'FOLDER_DEPTH_EXCEEDED'
 */
export class BusinessException extends HttpException {
  constructor(
    message: string,
    public readonly code: string = 'BUSINESS_RULE_VIOLATION',
    public readonly details?: unknown,
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
  ) {
    super({ message, code, details }, status);
  }
}

/** ไม่มีสิทธิ์กระทำการนี้ (403) พร้อมเหตุผล */
export class PermissionDeniedException extends BusinessException {
  constructor(message = 'ไม่มีสิทธิ์ดำเนินการนี้', code = 'PERMISSION_DENIED', details?: unknown) {
    super(message, code, details, HttpStatus.FORBIDDEN);
  }
}

/** ไม่พบทรัพยากร (404) */
export class ResourceNotFoundException extends BusinessException {
  constructor(entity: string, id?: string | number) {
    super(
      id === undefined ? `ไม่พบ ${entity}` : `ไม่พบ ${entity} (${id})`,
      'NOT_FOUND',
      { entity, id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** ข้อมูลซ้ำ/ขัดแย้งกับสถานะปัจจุบัน (409) */
export class ConflictBusinessException extends BusinessException {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(message, code, details, HttpStatus.CONFLICT);
  }
}
