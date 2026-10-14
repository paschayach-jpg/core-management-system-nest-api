import type { Readable } from 'node:stream';
import type { UserContext } from '../../../common/interfaces/user-context';

/**
 * สัญญาที่ module อื่น (KMS, RGP) ใช้ฝากไฟล์เข้า DMS — DmsCoreModule เป็นผู้ implement และ export ผ่าน token นี้
 * เหตุผลที่ใช้ port: KMS/RGP ไม่ต้องรู้ว่า DMS เก็บไฟล์ที่ไหน/ตรวจสิทธิ์อย่างไร และเทสต์ mock ได้ง่าย
 */
export const DMS_FILE_PORT = Symbol('DMS_FILE_PORT');

export interface DmsUploadInput {
  originalName: string;
  buffer: Buffer;
  mimeType?: string;
}

export interface DmsFileInfo {
  fileId: number;
  folderId: number;
  originalFileName: string;
  storedFileName: string;
  /** bigint ส่งเป็นสตริง */
  fileSizeBytes: string;
  version: number;
  createdDate?: Date;
}

export interface DmsFileReadHandle {
  stream: Readable;
  fileName: string;
  size: number;
  mimeType: string;
}

export interface DmsFilePort {
  /**
   * อัปโหลดเข้าโฟลเดอร์ — ตรวจสิทธิ์/ชนิด/ขนาด/quota ตามกฎของ DMS
   * ชื่อซ้ำ: overwriteExisting=false → ตั้งชื่อ `name copy(N).ext`, true → เพิ่ม Version และ soft delete แถวเก่า
   */
  upload(
    user: UserContext,
    folderId: number,
    files: DmsUploadInput[],
    opts?: { overwriteExisting?: boolean },
  ): Promise<DmsFileInfo[]>;
  /** ไฟล์ที่ยังใช้งานในโฟลเดอร์ (ไม่รวมที่ถูกลบ/ซ่อน) */
  listFolder(folderId: number): Promise<DmsFileInfo[]>;
  /** ลบ (soft delete) ไฟล์ */
  remove(user: UserContext, fileId: number): Promise<void>;
  /** เปิดอ่านไฟล์เพื่อดาวน์โหลด (ตรวจสิทธิ์ให้) */
  openRead(user: UserContext, fileId: number): Promise<DmsFileReadHandle>;
}
