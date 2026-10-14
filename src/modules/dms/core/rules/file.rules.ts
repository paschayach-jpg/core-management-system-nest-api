import { randomBytes } from 'node:crypto';
import { BusinessException } from '../../../../common/exceptions/business.exception';

/**
 * กฎธุรกิจของไฟล์ที่เป็นฟังก์ชันล้วน — พอร์ตจาก FileService.cs
 */

/** นามสกุลที่อนุญาต (AllowedExtensions เดิม) */
export const ALLOWED_FILE_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.jpg',
  '.png',
  '.gif',
  '.zip',
];
/** ขนาดสูงสุดต่อไฟล์ 100 MB (MaxFileSizeBytes เดิม) */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
/** OriginalFileName เป็น nvarchar(260) */
export const MAX_FILE_NAME_LENGTH = 260;
/** StoredFileName เป็น nvarchar(360) */
export const MAX_STORED_NAME_LENGTH = 360;

export const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
};

/** อักขระที่ห้ามอยู่ในชื่อไฟล์ (ครอบคลุม path separator และอักขระที่ Windows ไม่รับ) */
// eslint-disable-next-line no-control-regex
const INVALID_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

/** นามสกุลตัวพิมพ์เล็กพร้อมจุด ('' ถ้าไม่มี) */
export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
}

export function baseNameOf(name: string): string {
  const ext = extensionOf(name);
  return ext ? name.slice(0, name.length - ext.length) : name;
}

/** ชื่อไฟล์จากผู้ใช้: ตัดช่องว่าง, ห้ามว่าง/ยาวเกิน/มี path/อักขระต้องห้าม */
export function validateFileName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim();
  if (!name) throw new BusinessException('ชื่อไฟล์ต้องไม่ว่าง', 'FILE_NAME_REQUIRED');
  if (name.length > MAX_FILE_NAME_LENGTH) {
    throw new BusinessException(
      `ชื่อไฟล์ยาวเกิน ${MAX_FILE_NAME_LENGTH} ตัวอักษร`,
      'FILE_NAME_TOO_LONG',
    );
  }
  if (INVALID_FILE_NAME.test(name) || name === '.' || name === '..') {
    throw new BusinessException('ชื่อไฟล์มีอักขระที่ไม่อนุญาต', 'FILE_NAME_INVALID');
  }
  return name;
}

/**
 * ตรวจไฟล์ก่อนรับเข้าระบบ (ชนิด/ขนาด) — คืนข้อความผิดพลาดแทนการ throw เพื่อให้การอัปโหลดเป็นชุด
 * รายงานผลรายไฟล์ได้ (พฤติกรรมเดิมของ UploadResult)
 */
export function checkUploadCandidate(args: {
  name: string;
  sizeBytes: number;
  maxBytes?: number;
}): { code: string; message: string } | null {
  const max = args.maxBytes ?? MAX_FILE_SIZE_BYTES;
  let name: string;
  try {
    name = validateFileName(args.name);
  } catch (e) {
    const r = (e as BusinessException).getResponse() as { code: string; message: string };
    return { code: r.code, message: r.message };
  }
  const ext = extensionOf(name);
  if (!ext || !ALLOWED_FILE_EXTENSIONS.includes(ext)) {
    return {
      code: 'FILE_EXTENSION_NOT_ALLOWED',
      message: `ไม่อนุญาตให้อัปโหลดไฟล์นามสกุล '${ext || '(ไม่มี)'}' (อนุญาต: ${ALLOWED_FILE_EXTENSIONS.join(' ')})`,
    };
  }
  if (args.sizeBytes > max) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `ไฟล์มีขนาด ${args.sizeBytes.toLocaleString('en-US')} ไบต์ เกินกำหนด ${Math.floor(max / 1024 / 1024)} MB`,
    };
  }
  return null;
}

/** มีนามสกุลที่อนุญาตหรือไม่ (ใช้ตอนเปลี่ยนชื่อ/คัดลอก) */
export function isAllowedExtension(ext: string): boolean {
  return ALLOWED_FILE_EXTENSIONS.includes(ext.toLowerCase());
}

/** MIME ที่เชื่อถือได้: ใช้ตารางของนามสกุล (ไม่เชื่อ Content-Type จาก client) */
export function mimeTypeFor(ext: string): string {
  return MIME_BY_EXTENSION[ext.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * ตั้งชื่อไม่ให้ซ้ำในโฟลเดอร์: `name.ext` → `name copy(N).ext` (ResolveFileName เดิม)
 *  - ไม่ซ้ำ → ใช้ชื่อเดิม
 *  - ซ้ำ → N เริ่มที่ (จำนวนไฟล์ที่ขึ้นต้นด้วย `name copy` + 1) แล้วเพิ่มจนกว่าจะว่าง
 * @param existingNames ชื่อไฟล์ที่ยังใช้งานในโฟลเดอร์ (ส่งมาเฉพาะชื่อที่ขึ้นต้นด้วย base ก็พอ) · เทียบแบบไม่สนตัวพิมพ์เหมือน SQL Server
 */
export function resolveCopyName(requested: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!taken.has(requested.toLowerCase())) return requested;
  const ext = extensionOf(requested);
  const base = ext ? requested.slice(0, requested.length - ext.length) : requested;
  const prefix = `${base} copy`.toLowerCase();
  let counter = existingNames.filter((n) => n.toLowerCase().startsWith(prefix)).length + 1;
  let candidate: string;
  do {
    candidate = `${base} copy(${counter})${ext}`;
    counter++;
  } while (taken.has(candidate.toLowerCase()));
  return candidate;
}

/**
 * ชื่อไฟล์จริงบนที่เก็บ: `<ชื่อที่ปลอดภัย>_<yyyyMMddHHmmssfff>_<สุ่ม 6 hex><ext>`
 * ต่างจากระบบเดิมที่ใช้ชื่อเดิมของผู้ใช้เป็นชื่อไฟล์กายภาพ (ทำให้ไฟล์ที่ถูก soft-delete ถูกเขียนทับเมื่ออัปโหลดชื่อเดียวกันซ้ำ)
 */
export function buildStoredFileName(
  originalName: string,
  now: Date = new Date(),
  rand: () => string = () => randomBytes(3).toString('hex'),
): string {
  const ext = extensionOf(originalName);
  const base = baseNameOf(originalName)
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\s]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${p(now.getMilliseconds(), 3)}`;
  const stored = `${base || 'file'}_${stamp}_${rand()}${ext}`;
  return stored.slice(0, MAX_STORED_NAME_LENGTH);
}

/** ป้องกันชื่อ attachment ในส่วนหัว Content-Disposition (RFC 5987) */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
