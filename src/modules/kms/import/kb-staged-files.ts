import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, copyFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** ผลค้นไฟล์แนบตามชื่อ (เทียบกับ LawFileDownloader.Download เดิม ที่อ่านจากโฟลเดอร์ในเครื่องผู้ใช้) */
export type AttachmentLookup =
  | { ok: true; fileName: string; size: number; mimeType: string; read: () => Promise<Buffer> }
  | { ok: false; error: string };

/** แหล่งไฟล์แนบที่ import หาไฟล์ตามชื่อที่อยู่ในเซลล์ Excel */
export interface AttachmentSource {
  lookup(name: string): Promise<AttachmentLookup>;
}

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
};

export function mimeTypeOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.substring(dot).toLowerCase() : '';
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ชื่อไฟล์ล้วน: ห้ามมีตัวคั่น path หรืออักขระที่ชื่อไฟล์ใช้ไม่ได้ (เทียบ Path.GetInvalidFileNameChars)
// eslint-disable-next-line no-control-regex
const INVALID_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

/** true ถ้า name เป็นชื่อไฟล์ล้วนๆ (กันชื่อในเซลล์/ไฟล์อัปโหลดชี้ออกนอกโฟลเดอร์ staging) */
export function isPlainFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !INVALID_NAME.test(name) &&
    basename(name) === name
  );
}

interface Staged {
  originalName: string;
  path: string;
  size: number;
}

/**
 * ไฟล์แนบที่ผู้ใช้อัปโหลดมาพักไว้ใต้โฟลเดอร์ชั่วคราวของ import หนึ่งงาน (API เปิดโฟลเดอร์ในเครื่องผู้ใช้ไม่ได้ จึงให้ส่งไฟล์มาที่ server)
 * จับคู่ด้วยชื่อไฟล์ที่ Template map เป็น Attachment: ตรงเป๊ะก่อน ไม่เจอลองไม่สนตัวพิมพ์เล็ก-ใหญ่ · ไม่มีโฟลเดอร์ย่อย · ไฟล์ 0 byte = ไม่ผ่าน
 * เก็บบนดิสก์ด้วยชื่อ hash (ไม่ใช้ชื่อจากผู้ใช้เป็น path) และอ่านเนื้อไฟล์ตอนจะอัปโหลดเท่านั้น (ไม่ถือไฟล์ทั้งชุดไว้ในหน่วยความจำ)
 */
export class StagedFiles implements AttachmentSource {
  private readonly exact = new Map<string, Staged>();
  private readonly lower = new Map<string, Staged>();

  constructor(readonly dir: string) {}

  get count(): number {
    return this.exact.size;
  }

  get names(): string[] {
    return [...this.exact.values()].map((s) => s.originalName);
  }

  /**
   * รับไฟล์ที่ multer เขียนไว้แล้ว (tmpPath) เข้าโฟลเดอร์ staging · ชื่อซ้ำ = ไฟล์ใหม่ทับไฟล์เก่า
   * @returns null ถ้ารับสำเร็จ หรือข้อความเหตุผลที่ไม่รับ
   */
  async add(
    originalName: string,
    tmpPath: string,
  ): Promise<{ error?: string; replaced?: boolean }> {
    const name = originalName.trim();
    if (!isPlainFileName(name))
      return { error: `ชื่อไฟล์ '${originalName}' ไม่ถูกต้อง (ต้องเป็นชื่อไฟล์ล้วน ไม่มี path)` };

    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, createHash('sha1').update(name).digest('hex'));
    try {
      await rename(tmpPath, target);
    } catch {
      // ข้าม filesystem (tmp คนละ volume) → copy แล้วลบต้นทาง
      await copyFile(tmpPath, target);
      await rm(tmpPath, { force: true });
    }
    const size = (await stat(target)).size;

    const replaced = this.exact.has(name);
    const prevLower = this.lower.get(name.toLowerCase());
    const entry: Staged = { originalName: name, path: target, size };
    if (prevLower && prevLower.originalName !== name) this.exact.delete(prevLower.originalName);
    this.exact.set(name, entry);
    this.lower.set(name.toLowerCase(), entry);
    return { replaced };
  }

  async lookup(rawName: string): Promise<AttachmentLookup> {
    const name = (rawName ?? '').trim();
    if (!name) return { ok: false, error: 'ไม่พบชื่อไฟล์ในเซลล์ที่ Template map เป็น Attachment' };
    if (!isPlainFileName(name))
      return {
        ok: false,
        error: `ชื่อไฟล์ '${name}' ไม่ถูกต้อง (ต้องเป็นชื่อไฟล์ล้วน ไม่มี path)`,
      };

    const found = this.exact.get(name) ?? this.lower.get(name.toLowerCase());
    if (!found)
      return {
        ok: false,
        error: `ไม่พบไฟล์ '${name}' ในไฟล์แนบที่อัปโหลดไว้กับงานนี้ (ชื่อต้องตรงกับไฟล์ครบนามสกุล)`,
      };
    if (found.size === 0) return { ok: false, error: `ไฟล์ '${name}' ว่าง (0 byte)` };

    return {
      ok: true,
      fileName: found.originalName,
      size: found.size,
      mimeType: mimeTypeOf(found.originalName),
      read: () => readFile(found.path),
    };
  }

  async dispose(): Promise<void> {
    this.exact.clear();
    this.lower.clear();
    await rm(this.dir, { recursive: true, force: true });
  }
}
