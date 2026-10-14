import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  promises as fs,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline as pipelineCb, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import { AppConfigService } from '../../../../config';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { SystemConfigService } from '../../../shared/system-config/system-config.service';
import { MAX_STORED_NAME_LENGTH } from '../rules/file.rules';

export interface StoredFile {
  sizeBytes: number;
  /** SHA-256 (hex) คำนวณระหว่างเขียน */
  sha256: string;
}

export interface ReadableFile {
  stream: Readable;
  sizeBytes: number;
  path: string;
}

/** ข้อมูลที่ใช้หาตำแหน่งไฟล์กายภาพ */
export interface StoredFileLocation {
  orgUnitId: number;
  folderId: number;
  storedFileName: string;
  /** PhysicalPath ที่บันทึกใน DB (อาจเป็น path แบบ Windows/UNC ของระบบเดิม) — ใช้เฉพาะ 3 ส่วนท้ายเป็นตัวช่วยหา */
  physicalPath?: string | null;
}

export interface DeleteFilesResult {
  deleted: number;
  missing: number;
  failed: string[];
}

const storageError = (message: string, code: string, details?: unknown) =>
  new BusinessException(message, code, details, HttpStatus.INTERNAL_SERVER_ERROR);

/**
 * ที่เก็บไฟล์กายภาพของ DMS (แทน NetworkDriveHelper เดิม)
 *  - โครง `<STORAGE_ROOT>/<OrgUnitID>/<FolderID>/<storedName>` (STORAGE_ROOT = จุด mount ของ network share เดิม)
 *  - เขียนแบบ stream ลงไฟล์ชั่วคราวก่อนแล้วค่อย rename · คำนวณ SHA-256 ระหว่างเขียน · ตรวจขนาดหลังเขียน
 *  - ไม่โหลดทั้งไฟล์เข้า memory · ป้องกัน path traversal (ชื่อไฟล์/ id ต้องปลอดภัย และ path ต้องอยู่ใต้ root)
 *  - extend CrudLoggedService เพื่อบันทึกการลบไฟล์กายภาพ (งานทำลายข้อมูลที่ย้อนไม่ได้) ลง CRUD-log
 */
@Injectable()
export class FileStorageService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'PhysicalFile';
  private readonly logger = new Logger(FileStorageService.name);

  constructor(
    crudLog: CrudLogService,
    private readonly config: AppConfigService,
    @Optional() private readonly systemConfig?: SystemConfigService,
  ) {
    super(crudLog);
  }

  /** root ที่เก็บไฟล์ (absolute) */
  get root(): string {
    return resolve(this.config.get('STORAGE_ROOT'));
  }

  // ── path ───────────────────────────────────────────────────

  /** ชื่อไฟล์บนที่เก็บต้องเป็นชื่อเดี่ยวๆ (ไม่มี path separator / .. / อักขระควบคุม) */
  assertSafeStoredName(name: string): void {
    if (
      !name ||
      name.length > MAX_STORED_NAME_LENGTH ||
      name === '.' ||
      name === '..' ||
      // eslint-disable-next-line no-control-regex
      /[\\/\u0000]/.test(name) ||
      name !== name.trim()
    ) {
      throw storageError('ชื่อไฟล์บนที่จัดเก็บไม่ปลอดภัย', 'STORAGE_PATH_INVALID');
    }
  }

  /** `<root>/<orgUnitId>/<folderId>/<storedName>` — ตรวจความปลอดภัยทุกส่วน */
  pathFor(orgUnitId: number, folderId: number, storedName: string): string {
    if (
      !Number.isInteger(orgUnitId) ||
      orgUnitId <= 0 ||
      !Number.isInteger(folderId) ||
      folderId <= 0
    ) {
      throw storageError('รหัสหน่วยงาน/โฟลเดอร์ไม่ถูกต้อง', 'STORAGE_PATH_INVALID');
    }
    this.assertSafeStoredName(storedName);
    const full = resolve(this.root, String(orgUnitId), String(folderId), storedName);
    this.assertInsideRoot(full);
    return full;
  }

  assertInsideRoot(fullPath: string): void {
    const rel = relative(this.root, resolve(fullPath));
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      throw storageError('ตำแหน่งไฟล์อยู่นอกที่จัดเก็บ', 'STORAGE_PATH_INVALID');
    }
  }

  /**
   * ตำแหน่งที่ไฟล์อาจอยู่ (เรียงตามความน่าจะเป็น):
   *  1) ตามที่บันทึกใน DB — เอาเฉพาะ 3 ส่วนท้าย `<org>/<folder>/<name>` ของ PhysicalPath (รองรับ path Windows เดิม)
   *  2) ตามโฟลเดอร์ปัจจุบัน (OrgUnitID/FolderID/StoredFileName)
   * ใช้อย่างนี้เพราะระบบเดิมย้ายโฟลเดอร์ข้ามหน่วยงานโดยไม่ย้ายไฟล์จริง และ PhysicalPath ใน DB เป็นของ share เดิม
   */
  candidatePaths(file: StoredFileLocation): string[] {
    const out: string[] = [];
    const add = (fn: () => string) => {
      try {
        const p = fn();
        if (!out.includes(p)) out.push(p);
      } catch {
        // ข้ามตำแหน่งที่ไม่ปลอดภัย/ไม่ถูกต้อง
      }
    };
    if (file.physicalPath) {
      const parts = file.physicalPath.split(/[\\/]+/).filter(Boolean);
      if (parts.length >= 3) {
        const [org, folder, name] = parts.slice(-3);
        if (/^\d+$/.test(org) && /^\d+$/.test(folder)) {
          add(() => this.pathFor(Number(org), Number(folder), name));
        }
      }
    }
    add(() => this.pathFor(file.orgUnitId, file.folderId, file.storedFileName));
    return out;
  }

  /** ค่าที่จะบันทึกในคอลัมน์ FileDocument.PhysicalPath — ถ้ามีค่า `NetworkDrivePath` ใน dbo.SystemConfig จะใช้เป็น prefix (คงรูปแบบ path ของ share เดิมให้ WinForms ที่ยังใช้ร่วมกันอ่านได้) */
  async toDbPath(orgUnitId: number, folderId: number, storedName: string): Promise<string> {
    this.assertSafeStoredName(storedName);
    let prefix: string | null = null;
    try {
      prefix = (await this.systemConfig?.get('NetworkDrivePath')) ?? null;
    } catch (err) {
      this.logger.warn(`อ่านค่า NetworkDrivePath ไม่ได้: ${(err as Error).message}`);
    }
    if (!prefix?.trim()) return `${orgUnitId}/${folderId}/${storedName}`;
    const s = prefix.includes('\\') ? '\\' : '/';
    return `${prefix.replace(/[\\/]+$/, '')}${s}${orgUnitId}${s}${folderId}${s}${storedName}`;
  }

  // ── เขียน ──────────────────────────────────────────────────

  /**
   * เขียน stream ลง `target` อย่างปลอดภัย:
   * ไฟล์ชั่วคราว (.uploading) → fsync → ตรวจขนาด → rename → ตรวจขนาดอีกครั้งที่ปลายทาง
   * @param expectedSize ขนาดที่ผู้ส่งแจ้ง (ถ้าระบุและไม่ตรงกับที่เขียนจริงถือว่าล้มเหลว)
   * @param maxBytes เกินกว่านี้หยุดทันที (กันไฟล์ใหญ่เกินกำหนดที่ไม่ได้แจ้งขนาด)
   */
  async store(
    source: Readable,
    target: string,
    opts: { expectedSize?: number; maxBytes?: number } = {},
  ): Promise<StoredFile> {
    this.assertInsideRoot(target);
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${randomBytes(4).toString('hex')}.uploading`;
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (opts.maxBytes !== undefined && bytes > opts.maxBytes) {
          cb(
            new BusinessException(
              `ไฟล์ใหญ่เกิน ${Math.floor(opts.maxBytes / 1024 / 1024)} MB`,
              'FILE_TOO_LARGE',
            ),
          );
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      await fs.access(target).then(
        () => {
          throw storageError('มีไฟล์ชื่อนี้บนที่จัดเก็บอยู่แล้ว', 'STORAGE_TARGET_EXISTS');
        },
        () => undefined,
      );
      await pipeline(source, meter, createWriteStream(tmp, { flags: 'wx' }));
      const fh = await fs.open(tmp, 'r+');
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
      const tmpSize = (await fs.stat(tmp)).size;
      if (tmpSize !== bytes) {
        throw storageError(
          `ขนาดไฟล์ที่เขียนไม่ตรง (คาด ${bytes} ได้ ${tmpSize} ไบต์)`,
          'STORAGE_SIZE_MISMATCH',
        );
      }
      if (opts.expectedSize !== undefined && opts.expectedSize !== bytes) {
        throw storageError(
          `ขนาดไฟล์ที่เขียนไม่ตรงกับที่รับ (รับ ${opts.expectedSize} เขียน ${bytes} ไบต์)`,
          'STORAGE_SIZE_MISMATCH',
        );
      }
      await fs.rename(tmp, target);
      const finalSize = (await fs.stat(target).catch(() => null))?.size;
      if (finalSize !== bytes) {
        await fs.rm(target, { force: true });
        throw storageError('ไฟล์ที่เขียนไม่พบหรือขนาดไม่ตรงหลังบันทึก', 'STORAGE_SIZE_MISMATCH');
      }
      return { sizeBytes: bytes, sha256: hash.digest('hex') };
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      if (err instanceof BusinessException) throw err;
      this.logger.error(`เขียนไฟล์ลง ${target} ไม่สำเร็จ: ${(err as Error).message}`);
      throw storageError('บันทึกไฟล์ลงที่จัดเก็บไม่สำเร็จ', 'STORAGE_WRITE_FAILED');
    }
  }

  /** คัดลอกไฟล์กายภาพ (ไม่เขียนทับ) แล้วตรวจขนาด */
  async copy(from: string, to: string): Promise<void> {
    this.assertInsideRoot(from);
    this.assertInsideRoot(to);
    await fs.mkdir(dirname(to), { recursive: true });
    try {
      await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
      const [a, b] = await Promise.all([fs.stat(from), fs.stat(to)]);
      if (a.size !== b.size) {
        await fs.rm(to, { force: true });
        throw storageError('ขนาดไฟล์ที่คัดลอกไม่ตรงกับต้นฉบับ', 'STORAGE_SIZE_MISMATCH');
      }
    } catch (err) {
      if (err instanceof BusinessException) throw err;
      throw storageError('คัดลอกไฟล์บนที่จัดเก็บไม่สำเร็จ', 'STORAGE_COPY_FAILED');
    }
  }

  /** ย้ายไฟล์กายภาพ (ไม่เขียนทับ; ข้ามอุปกรณ์ใช้ copy+unlink) */
  async move(from: string, to: string): Promise<void> {
    this.assertInsideRoot(from);
    this.assertInsideRoot(to);
    if (resolve(from) === resolve(to)) return;
    await fs.mkdir(dirname(to), { recursive: true });
    try {
      await fs.access(to).then(
        () => {
          throw storageError('มีไฟล์ปลายทางอยู่แล้ว', 'STORAGE_TARGET_EXISTS');
        },
        () => undefined,
      );
      try {
        await fs.rename(from, to);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await this.copy(from, to);
        await fs.rm(from, { force: true });
      }
    } catch (err) {
      if (err instanceof BusinessException) throw err;
      throw storageError('ย้ายไฟล์บนที่จัดเก็บไม่สำเร็จ', 'STORAGE_MOVE_FAILED');
    }
  }

  // ── อ่าน ───────────────────────────────────────────────────

  async exists(path: string): Promise<boolean> {
    try {
      this.assertInsideRoot(path);
      return (await fs.stat(path)).isFile();
    } catch {
      return false;
    }
  }

  /** ตำแหน่งแรกที่มีไฟล์จริง (undefined ถ้าไม่พบ) */
  async locate(file: StoredFileLocation): Promise<string | undefined> {
    for (const p of this.candidatePaths(file)) {
      if (await this.exists(p)) return p;
    }
    return undefined;
  }

  /** เปิดอ่านแบบ stream — 404 FILE_CONTENT_MISSING ถ้าไม่พบไฟล์บนที่จัดเก็บ */
  async openRead(file: StoredFileLocation): Promise<ReadableFile> {
    const path = await this.locate(file);
    if (!path) {
      this.logger.error(
        `ไม่พบไฟล์บนที่จัดเก็บ: folder=${file.folderId} stored=${file.storedFileName}`,
      );
      throw new BusinessException(
        'ไม่พบไฟล์ในพื้นที่จัดเก็บ กรุณาติดต่อผู้ดูแลระบบ',
        'FILE_CONTENT_MISSING',
        undefined,
        HttpStatus.NOT_FOUND,
      );
    }
    const st = await fs.stat(path);
    return { stream: createReadStream(path), sizeBytes: st.size, path };
  }

  /**
   * ปิด stream ที่ยังไม่ได้ส่งต่อให้ใคร โดยไม่ให้ 'error' ที่ตามมา (เช่น เปิดไฟล์ไม่ได้เพราะถูกลบพอดี) กลายเป็น uncaught exception
   */
  closeQuietly(stream: Readable): void {
    stream.on('error', () => undefined);
    stream.destroy();
  }

  /**
   * ครอบ stream ด้วยการคำนวณ SHA-256 ระหว่างส่ง แล้วเรียก `onDone` เมื่อจบ (ตรวจความสมบูรณ์โดยไม่ต้องอ่านไฟล์ซ้ำทั้งก้อนเหมือนระบบเดิม)
   * หมายเหตุ: ส่วนหัวตอบกลับถูกส่งไปแล้ว จึงทำได้แค่แจ้ง/บันทึกเมื่อพบว่าไม่ตรง
   */
  withIntegrityCheck(
    source: Readable,
    expectedSha256: string | null | undefined,
    onDone: (result: { ok: boolean; actual: string }) => void,
  ): Readable {
    if (!expectedSha256) return source;
    const hash = createHash('sha256');
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
      flush(cb) {
        const actual = hash.digest('hex');
        onDone({ ok: actual.toLowerCase() === expectedSha256.toLowerCase(), actual });
        cb();
      },
    });
    return pipelineCb(source, tap, () => undefined) as unknown as Readable;
  }

  // ── ลบ ─────────────────────────────────────────────────────

  /**
   * ลบไฟล์กายภาพ (ไม่ throw — ใช้หลัง DB commit หรือเป็น compensation) · บันทึก CRUD-log หนึ่งรายการต่อชุด
   * @param candidateGroups ตำแหน่งที่เป็นไปได้ของแต่ละไฟล์ (ลบทุกตำแหน่งที่มีไฟล์จริง)
   */
  deleteFiles(
    candidateGroups: readonly (readonly string[])[],
    meta: Record<string, unknown> = {},
  ): Promise<DeleteFilesResult> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_PHYSICAL_FILE',
        meta: { ...meta, files: candidateGroups.length },
      },
      async () => {
        const result: DeleteFilesResult = { deleted: 0, missing: 0, failed: [] };
        for (const group of candidateGroups) {
          let found = false;
          for (const p of group) {
            try {
              this.assertInsideRoot(p);
              await fs.rm(p); // ไม่มีไฟล์ → ENOENT
              found = true;
              result.deleted++;
            } catch (err) {
              const code = (err as NodeJS.ErrnoException).code;
              if (code !== 'ENOENT') {
                result.failed.push(p);
                this.logger.error(`ลบไฟล์กายภาพ ${p} ไม่สำเร็จ: ${(err as Error).message}`);
              }
            }
          }
          if (!found && group.every((p) => !result.failed.includes(p))) result.missing++;
        }
        return result;
      },
      (r) => ({ meta: { deleted: r.deleted, missing: r.missing, failed: r.failed.length } }),
    );
  }

  /** ลบไฟล์ที่เพิ่งเขียนเพราะขั้นตอนถัดไปล้ม (compensation) — ไม่ throw */
  async discard(path: string): Promise<void> {
    try {
      this.assertInsideRoot(path);
      await fs.rm(path, { force: true });
    } catch (err) {
      this.logger.error(`ลบไฟล์ชั่วคราว/ไฟล์ที่ค้าง ${path} ไม่สำเร็จ: ${(err as Error).message}`);
    }
  }
}
