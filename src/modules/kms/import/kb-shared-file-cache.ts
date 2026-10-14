import type { DmsFilePort } from '../../dms/ports/dms-file.port';
import type { UserContext } from '../../../common/interfaces/user-context';
import type { AttachmentSource } from './kb-staged-files';

/** ไฟล์แนบ 1 ไฟล์ (ตามชื่อ) ตลอดทั้ง batch: ผลหาไฟล์ + ผลอัปโหลดเข้า DMS (ทำครั้งเดียว ใช้ร่วมทุกแถวที่ชื่อเดียวกัน) */
export interface RowFile {
  /** หาไฟล์ได้ (ใน DMS หรือในไฟล์ที่อัปโหลดมา) */
  ok: boolean;
  error: string | null;
  fileName: string | null;
  /** อ่านเนื้อไฟล์ (เฉพาะไฟล์ที่ต้องอัปโหลดใหม่) */
  read: (() => Promise<Buffer>) | null;
  mimeType: string | null;
  fileId: number | null;
  uploadAttempted: boolean;
  uploadError: string | null;
  /** true = ใช้ FileID ที่มีใน DMS อยู่แล้ว (ไม่ได้อัปโหลดใน batch นี้) — ห้ามลบเมื่อผูกบทความไม่สำเร็จ */
  reusedExisting: boolean;
  /** จำนวนบทความที่ผูกไฟล์นี้สำเร็จใน batch นี้ — มากกว่า 0 = ไฟล์ถูกใช้อยู่ ห้ามลบ */
  boundCount: number;
}

const fail = (error: string): RowFile => ({
  ok: false,
  error,
  fileName: null,
  read: null,
  mimeType: null,
  fileId: null,
  uploadAttempted: false,
  uploadError: null,
  reusedExisting: false,
  boundCount: 0,
});

export interface SharedFileCacheOptions {
  /** ไฟล์ที่อัปโหลดมากับงาน import (null = ไม่มี) */
  source: AttachmentSource | null;
  /** พอร์ตไฟล์ของ DMS (null = ยังไม่มี provider) */
  dms: DmsFilePort | null;
  user: UserContext;
  /** โฟลเดอร์ DMS ปลายทาง */
  folderId: number | null;
}

/**
 * ไฟล์แนบตลอดทั้ง batch (พอร์ตจาก SharedFileCache): หลายแถวที่ **ชื่อไฟล์เหมือนกัน** ใช้ไฟล์เดียวกัน (FileID เดียว)
 * key = ชื่อไฟล์ในเซลล์ (ตัดช่องว่าง ไม่สนตัวพิมพ์เล็ก-ใหญ่) ครั้งแรกที่เจอชื่อ:
 *  1) มีไฟล์ชื่อนี้ใน DMS โฟลเดอร์ปลายทางแล้ว → ใช้ FileID เดิม ไม่อัปโหลดใหม่ ไม่ต้องมีไฟล์ใน request (ไม่แตะเนื้อไฟล์ใน DMS —
 *     "แทนที่" ใน DMS จะได้ FileID ใหม่และ soft-delete ตัวเดิม)
 *  2) ไม่มี → อ่านจากไฟล์ที่อัปโหลดมา แล้วอัปโหลดครั้งเดียว (overwriteExisting=false)
 * รายการไฟล์ใน DMS โหลดครั้งเดียวต่อ batch — โหลดไม่ได้ (เช่น ไม่มีสิทธิ์ดูโฟลเดอร์) แถวที่ใช้ไฟล์เป็น Error
 * ไม่ถอยไปอัปโหลดซ้ำ (กันเกิดไฟล์ "name copy(N)")
 */
export class SharedFileCache {
  private readonly files = new Map<string, RowFile>();
  private dmsFiles: Map<string, { fileId: number; originalFileName: string }> | null = null;
  private dmsListError: string | null = null;

  constructor(private readonly opts: SharedFileCacheOptions) {}

  async for(rawName: string | null | undefined): Promise<RowFile> {
    const name = (rawName ?? '').trim();
    const key = name.toLowerCase();

    let file = this.files.get(key);
    if (!file) {
      file = await this.resolve(name);
      this.files.set(key, file);
    }
    return file;
  }

  private async resolve(name: string): Promise<RowFile> {
    if (!name) return fail('ไม่พบชื่อไฟล์ในเซลล์ที่ Template map เป็น Attachment');
    if (!this.opts.dms) return fail('ระบบจัดเก็บไฟล์ (DMS) ยังไม่พร้อมใช้งาน');
    if (this.opts.folderId === null) return fail('ยังไม่ได้ระบุโฟลเดอร์ปลายทางใน DMS');

    await this.ensureDmsListing();
    if (this.dmsListError) return fail(this.dmsListError);

    const existing = this.dmsFiles?.get(name.toLowerCase());
    if (existing) {
      return {
        ...fail(''),
        ok: true,
        error: null,
        fileName: existing.originalFileName,
        fileId: existing.fileId,
        uploadAttempted: true, // มีใน DMS แล้ว → ensureUploaded คืน FileID เดิม ไม่อัปโหลด
        reusedExisting: true,
      };
    }

    if (!this.opts.source) return fail('ยังไม่ได้อัปโหลดไฟล์แนบสำหรับงานนี้');
    const found = await this.opts.source.lookup(name);
    if (!found.ok) return fail(found.error);
    return {
      ...fail(''),
      ok: true,
      error: null,
      fileName: found.fileName,
      read: found.read,
      mimeType: found.mimeType,
    };
  }

  private async ensureDmsListing(): Promise<void> {
    if (this.dmsFiles || this.dmsListError) return;
    const map = new Map<string, { fileId: number; originalFileName: string }>();
    try {
      for (const f of await (this.opts.dms as DmsFilePort).listFolder(
        this.opts.folderId as number,
      )) {
        const key = (f.originalFileName ?? '').trim().toLowerCase();
        if (!key) continue;
        const cur = map.get(key);
        // ชื่อซ้ำ (ไม่ควรมี) → ใช้ตัวที่เก่าสุดให้ผลคงที่
        if (!cur || f.fileId < cur.fileId)
          map.set(key, { fileId: f.fileId, originalFileName: f.originalFileName });
      }
      this.dmsFiles = map;
    } catch (err) {
      this.dmsListError = `ตรวจรายการไฟล์ในโฟลเดอร์ปลายทาง DMS ไม่สำเร็จ: ${(err as Error).message}`;
    }
  }

  /** อัปโหลดเข้า DMS ครั้งเดียวต่อไฟล์ (ครั้งถัดไปคืน FileID เดิม) · คืน null พร้อม file.uploadError เมื่ออัปโหลดไม่สำเร็จ */
  async ensureUploaded(file: RowFile): Promise<number | null> {
    if (!file.uploadAttempted) {
      file.uploadAttempted = true;
      file.uploadError = null;
      try {
        if (!file.read || !file.fileName) throw new Error('ไม่มีเนื้อไฟล์ให้อัปโหลด');
        const buffer = await file.read();
        const result = await (this.opts.dms as DmsFilePort).upload(
          this.opts.user,
          this.opts.folderId as number,
          [{ originalName: file.fileName, buffer, mimeType: file.mimeType ?? undefined }],
          { overwriteExisting: false },
        );
        const first = result?.[0];
        if (!first) {
          file.uploadError = 'ไม่ได้รับผลลัพธ์จากระบบจัดเก็บไฟล์';
        } else {
          file.fileId = first.fileId;
        }
      } catch (err) {
        file.uploadError = (err as Error).message || 'ไม่ทราบสาเหตุ';
      }
    }
    return file.fileId;
  }

  /** ไฟล์ที่อัปโหลดแล้วแต่ผูกบทความไม่สำเร็จและลบออกจาก DMS แล้ว → ล้างผลเพื่อให้แถวถัดไปอัปโหลดใหม่ ไม่ใช้ FileID ที่ถูกลบ */
  resetUpload(file: RowFile): void {
    file.uploadAttempted = false;
    file.fileId = null;
    file.uploadError = null;
  }
}
