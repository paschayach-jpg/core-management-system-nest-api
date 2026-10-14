import { unlink } from 'node:fs/promises';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import type { TempUploadedFile } from './upload.util';

/**
 * ลบไฟล์ชั่วคราวของ multer เสมอเมื่อคำขอจบ (สำเร็จหรือล้ม) — ใส่ "หลัง" FilesInterceptor
 * จำเป็นเพราะ multer เขียนไฟล์ลงดิสก์ก่อนที่ ValidationPipe จะตรวจ query/params: ถ้า validate ไม่ผ่าน handler ไม่ถูกเรียก
 * ไฟล์จะค้างในโฟลเดอร์ชั่วคราว (handler ที่ใช้ `withUploadedBuffers` ลบเองอยู่แล้วเมื่อทำงานถึง)
 */
@Injectable()
export class UploadCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ files?: TempUploadedFile[] | undefined }>();
    return next.handle().pipe(
      finalize(() => {
        for (const file of req.files ?? []) {
          if (file.path) void unlink(file.path).catch(() => undefined);
        }
      }),
    );
  }
}
