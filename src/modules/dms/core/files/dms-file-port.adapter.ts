import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import type {
  DmsFileInfo,
  DmsFilePort,
  DmsFileReadHandle,
  DmsFileUncheckedReadPort,
  DmsUploadInput,
} from '../../ports/dms-file.port';
import { FilesService } from './files.service';

/**
 * ตัวเชื่อม DMS_FILE_PORT สำหรับ KMS/RGP/approvals — ใช้กฎเดียวกับ HTTP API ทุกประการ (สิทธิ์ ชนิด/ขนาด โควตา ชื่อซ้ำ)
 *  - upload: โยน error ของไฟล์แรกที่ไม่ผ่าน (ไฟล์ก่อนหน้าที่บันทึกแล้วยังคงอยู่) — ถ้าต้องการผลรายไฟล์ให้เรียกทีละไฟล์
 *  - openRead: ใช้เกณฑ์ดาวน์โหลดเดียวกับ GET /dms/files/:id/download (รวมการขออนุมัติ) — ถ้า module ผู้เรียกตรวจสิทธิ์เองแล้ว
 *    และไม่ต้องการเกณฑ์นี้ ให้ใช้ DMS_FILE_UNCHECKED_PORT
 */
@Injectable()
export class DmsFilePortAdapter implements DmsFilePort {
  constructor(private readonly files: FilesService) {}

  async upload(
    user: UserContext,
    folderId: number,
    inputs: DmsUploadInput[],
    opts?: { overwriteExisting?: boolean },
  ): Promise<DmsFileInfo[]> {
    const result = await this.files.upload(
      user,
      folderId,
      inputs.map((f) => ({
        originalName: f.originalName,
        sizeBytes: f.buffer.length,
        mimeType: f.mimeType,
        open: () => Readable.from([f.buffer], { objectMode: false }),
      })),
      { overwriteExisting: opts?.overwriteExisting === true },
    );
    const failed = result.items.find((i) => !i.success);
    if (failed) {
      throw new BusinessException(
        `อัปโหลด '${failed.originalName}' ไม่สำเร็จ: ${failed.error ?? ''}`.trim(),
        failed.errorCode ?? 'UPLOAD_FAILED',
        { items: result.items },
      );
    }
    return Promise.all(result.items.map((i) => this.files.infoOf(i.fileId as number)));
  }

  listFolder(folderId: number): Promise<DmsFileInfo[]> {
    return this.files.listActiveForPort(folderId);
  }

  remove(user: UserContext, fileId: number): Promise<void> {
    return this.files.remove(user, fileId);
  }

  async openRead(user: UserContext, fileId: number): Promise<DmsFileReadHandle> {
    return this.files.toReadHandle(await this.files.openDownload(user, fileId));
  }
}

/**
 * ตัวเชื่อม DMS_FILE_UNCHECKED_PORT — เปิดอ่านไฟล์โดยไม่ตรวจสิทธิ์ผู้ใช้ (ใช้หลังตรวจสิทธิ์ด้วยวิธีอื่นแล้ว เช่น share token)
 * แยกคลาส/โทเคนจาก DMS_FILE_PORT โดยตั้งใจ · ยังบันทึก CRUD-log (EXECUTE `DOWNLOAD_FILE_UNCHECKED`)
 */
@Injectable()
export class DmsFileUncheckedAdapter implements DmsFileUncheckedReadPort {
  constructor(private readonly files: FilesService) {}

  async openReadUnchecked(fileId: number): Promise<DmsFileReadHandle> {
    return this.files.toReadHandle(await this.files.openReadUnchecked(fileId));
  }
}
