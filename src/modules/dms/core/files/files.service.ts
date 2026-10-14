import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  paginated,
  type Paginated,
  type PaginationQueryDto,
} from '../../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { AppConfigService } from '../../../../config';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../../database/transaction-runner.service';
import { canDownloadLevel } from '../../permissions/authority.util';
import type { AclSubject } from '../../permissions/permission.types';
import { type DmsApprovalPort, DMS_APPROVAL_PORT } from '../../ports/dms-approval.port';
import type { DmsFileInfo, DmsFileReadHandle } from '../../ports/dms-file.port';
import { type DmsQuotaPort, DMS_QUOTA_PORT } from '../../ports/dms-quota.port';
import { AclRepository } from '../acl/acl.repository';
import { FolderAccess, isPrivilegedUser } from '../access/folder-access';
import { FolderRepository } from '../folders/folder.repository';
import type { FolderRow } from '../folders/folder.types';
import { FoldersService } from '../folders/folders.service';
import {
  baseNameOf,
  checkUploadCandidate,
  buildStoredFileName,
  extensionOf,
  MAX_FILE_SIZE_BYTES,
  mimeTypeFor,
  resolveCopyName,
  validateFileName,
} from '../rules/file.rules';
import {
  decideDownload,
  fileAclDecision,
  fileOverrideBlocks,
  type FileAclEntry,
} from '../rules/file-acl.rules';
import { FileStorageService } from '../storage/file-storage.service';
import {
  CopyFileDto,
  DownloadAccessDto,
  DuplicateNamesDto,
  FileDto,
  FileVersionDto,
  MoveFilesResultDto,
  MoveItemResultDto,
  toFileDto,
  UploadItemResultDto,
  UploadResultDto,
} from './dto/file.dto';
import { FileRepository } from './file.repository';
import { FILE_STATUS_DELETED, type FileRow } from './file.types';

/** ไฟล์ที่รอรับเข้าระบบ (จาก multipart หรือจาก module อื่นผ่าน port) */
export interface UploadSource {
  originalName: string;
  /** ขนาดที่ผู้ส่งแจ้ง (ต้องตรงกับที่เขียนจริง) */
  sizeBytes: number;
  mimeType?: string;
  open: () => Readable;
  /** เรียกเสมอเมื่อประมวลผลเสร็จ (เช่น ลบไฟล์ชั่วคราวของ multer) */
  dispose?: () => Promise<void>;
}

export interface DownloadHandle {
  fileId: number;
  stream: Readable;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

const subjectOf = (u: UserContext): AclSubject => ({
  userId: u.userId,
  appRole: u.appRole,
  departmentId: u.departmentId,
  divisionId: u.divisionId,
});

const errorInfo = (e: unknown): { code: string; message: string } => {
  if (e instanceof BusinessException) {
    const r = e.getResponse() as { code: string; message: string };
    return { code: r.code, message: r.message };
  }
  return {
    code: 'UPLOAD_FAILED',
    message: 'เกิดข้อผิดพลาดระหว่างบันทึกไฟล์ ระบบได้ยกเลิกรายการนี้แล้ว',
  };
};

/**
 * ไฟล์ DMS — พอร์ตจาก FileService.cs
 * อัปโหลด (ตรวจชนิด/ขนาด/โควตา/สิทธิ์, ชื่อซ้ำ copy(N) หรือแทนที่เป็น Version ใหม่, checksum, คัดลอกสิทธิ์โฟลเดอร์ลงไฟล์),
 * ดาวน์โหลดเป็น stream (Authority.CanDownload / สิทธิ์ไฟล์ / ใบอนุมัติ), เปลี่ยนชื่อ, ย้าย, คัดลอก, ลบ (soft), กู้คืน, ประวัติเวอร์ชัน
 *
 * ต่างจากระบบเดิม: งานที่แก้หลายตารางอยู่ใน transaction เดียว (ระบบเดิมกลืน exception หลังบันทึกไฟล์),
 * ไฟล์กายภาพเป็น compensation (ลบเมื่อ DB ล้ม), ไม่มีฟีเจอร์ซ่อน/แสดงไฟล์ (DB ไม่มีคอลัมน์ IsHidden — ดู docs/modules/dms-core.md)
 */
@Injectable()
export class FilesService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'FileDocument';
  private readonly logger = new Logger(FilesService.name);

  constructor(
    crudLog: CrudLogService,
    private readonly files: FileRepository,
    private readonly folderRepo: FolderRepository,
    private readonly folders: FoldersService,
    private readonly access: FolderAccess,
    private readonly acl: AclRepository,
    private readonly storage: FileStorageService,
    private readonly tx: TransactionRunner,
    private readonly config: AppConfigService,
    @Optional() @Inject(DMS_QUOTA_PORT) private readonly quota?: DmsQuotaPort,
    @Optional() @Inject(DMS_APPROVAL_PORT) private readonly approvals?: DmsApprovalPort,
  ) {
    super(crudLog);
  }

  /** ขนาดสูงสุดต่อไฟล์: กฎ 100 MB หรือค่า STORAGE_MAX_UPLOAD_MB ถ้าต่ำกว่า */
  get maxUploadBytes(): number {
    return Math.min(MAX_FILE_SIZE_BYTES, this.config.get('STORAGE_MAX_UPLOAD_MB') * 1024 * 1024);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** ไฟล์ที่ยังไม่ถูกลบ — 404 ถ้าไม่พบ/ถูกลบแล้ว */
  async requireActive(fileId: number): Promise<FileRow> {
    const f = await this.files.getById(fileId);
    if (!f) throw new ResourceNotFoundException('File', fileId);
    if (f.fileStatus === FILE_STATUS_DELETED) {
      throw new BusinessException(
        'ไฟล์ถูกลบแล้ว',
        'FILE_DELETED',
        { fileId },
        HttpStatus.NOT_FOUND,
      );
    }
    return f;
  }

  /** ต้องอ่านไฟล์ได้: ไม่ถูก Deny ระดับไฟล์ และ (เห็นโฟลเดอร์ หรือไฟล์ถูกแชร์ให้ตรงๆ) */
  private async assertReadable(
    user: UserContext,
    file: FileRow,
    folder: FolderRow,
  ): Promise<FileAclEntry[]> {
    const entries = await this.acl.activeFileEntries(file.fileId);
    const read = fileAclDecision({ subject: subjectOf(user), perm: 'Read', entries });
    if (read.denied) {
      throw new PermissionDeniedException('ไม่มีสิทธิ์เข้าถึงไฟล์นี้', 'FILE_PERMISSION_DENIED', {
        fileId: file.fileId,
      });
    }
    if (!read.allowed && !(await this.access.canView(user, folder))) {
      throw new PermissionDeniedException('ไม่มีสิทธิ์ดูไฟล์นี้', 'FILE_VIEW_DENIED', {
        fileId: file.fileId,
      });
    }
    return entries;
  }

  async listByFolder(
    user: UserContext,
    folderId: number,
    q: PaginationQueryDto,
  ): Promise<Paginated<FileDto>> {
    const folder = await this.folders.require(folderId);
    await this.access.assertView(user, folder, 'ไม่มีสิทธิ์ดูไฟล์ในโฟลเดอร์นี้');
    const { items, total } = await this.files.listByFolder(folderId, q);
    return paginated(items.map(toFileDto), total, q);
  }

  async get(user: UserContext, fileId: number): Promise<FileDto> {
    const file = await this.requireActive(fileId);
    const folder = await this.folders.require(file.folderId);
    await this.assertReadable(user, file, folder);
    return toFileDto({ ...file, folderName: folder.folderName });
  }

  /** ประวัติเวอร์ชัน = ไฟล์ชื่อเดียวกันในโฟลเดอร์เดียวกัน (การแทนที่สร้างแถวใหม่ + ลบแถวเก่าแบบ soft) */
  async versions(user: UserContext, fileId: number): Promise<FileVersionDto[]> {
    const file = await this.requireActive(fileId);
    const folder = await this.folders.require(file.folderId);
    await this.assertReadable(user, file, folder);
    const rows = await this.files.versionsOf(file.folderId, file.originalFileName);
    return rows.map((r) => ({ ...toFileDto(r), isCurrent: r.fileId === file.fileId }));
  }

  async checkDuplicates(
    user: UserContext,
    folderId: number,
    names: readonly string[],
  ): Promise<DuplicateNamesDto> {
    const folder = await this.folders.require(folderId);
    await this.access.assertView(user, folder);
    return { duplicates: await this.files.namesExist(folderId, names) };
  }

  // ── อัปโหลด ────────────────────────────────────────────────

  /**
   * อัปโหลดไฟล์เข้าโฟลเดอร์ — คืนผลรายไฟล์ (ไฟล์ที่ไม่ผ่านกฎไม่ทำให้ไฟล์อื่นล้ม)
   * ล้มทั้งชุด: โฟลเดอร์ไม่มี/ถูกลบ/เก็บถาวร, ไม่มีสิทธิ์เพิ่ม, โควตาของหน่วยงานไม่พอสำหรับทั้งชุด
   */
  async upload(
    user: UserContext,
    folderId: number,
    sources: readonly UploadSource[],
    opts: { overwriteExisting?: boolean } = {},
  ): Promise<UploadResultDto> {
    try {
      const folder = await this.folders.requireUsable(folderId, 'โฟลเดอร์ปลายทาง');
      await this.access.assertAdd(
        user,
        folder,
        `ไม่มีสิทธิ์อัปโหลดไฟล์ลงโฟลเดอร์ '${folder.folderName}'`,
      );
      await this.validateQuotaForBatch(folder, sources, opts.overwriteExisting === true);

      const items: UploadItemResultDto[] = [];
      for (const src of sources) {
        try {
          items.push(await this.uploadOne(user, folder, src, opts.overwriteExisting === true));
        } catch (err) {
          const e = errorInfo(err);
          if (!(err instanceof BusinessException)) {
            this.logger.error(`อัปโหลด '${src.originalName}' ไม่สำเร็จ: ${(err as Error).message}`);
          }
          items.push({
            originalName: src.originalName,
            success: false,
            errorCode: e.code,
            error: e.message,
          });
        }
      }
      const successCount = items.filter((i) => i.success).length;
      return { items, successCount, failureCount: items.length - successCount };
    } finally {
      await Promise.all(sources.map((s) => s.dispose?.().catch(() => undefined)));
    }
  }

  private async validateQuotaForBatch(
    folder: FolderRow,
    sources: readonly UploadSource[],
    overwrite: boolean,
  ): Promise<void> {
    if (!this.quota) return;
    const deltas: number[] = [];
    for (const s of sources) {
      let existing = 0;
      if (overwrite) {
        const e = await this.files.findActiveByName(folder.folderId, s.originalName.trim());
        existing = e ? Number(e.fileSizeBytes) : 0;
      }
      deltas.push(Math.max(0, s.sizeBytes - existing));
    }
    await this.quota.validateBatch(folder.orgUnitId, deltas);
  }

  private uploadOne(
    user: UserContext,
    folder: FolderRow,
    src: UploadSource,
    overwrite: boolean,
  ): Promise<UploadItemResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'UPLOAD_FILE',
        meta: {
          folderId: folder.folderId,
          name: src.originalName,
          sizeBytes: src.sizeBytes,
          overwrite,
        },
      },
      async () => {
        const name = validateFileName(src.originalName);
        const invalid = checkUploadCandidate({
          name,
          sizeBytes: src.sizeBytes,
          maxBytes: this.maxUploadBytes,
        });
        if (invalid) throw new BusinessException(invalid.message, invalid.code);

        const ext = extensionOf(name);
        const storedName = buildStoredFileName(name);
        const target = this.storage.pathFor(folder.orgUnitId, folder.folderId, storedName);
        const stored = await this.storage.store(src.open(), target, {
          expectedSize: src.sizeBytes,
          maxBytes: this.maxUploadBytes,
        });

        try {
          const dbPath = await this.storage.toDbPath(folder.orgUnitId, folder.folderId, storedName);
          const saved = await this.tx.run(async (s) => {
            let resolvedName = name;
            let version = 1;
            let replaced: FileRow | null = null;
            if (overwrite) {
              replaced = await this.files.findActiveByName(folder.folderId, name, s);
              if (replaced) version = replaced.version + 1;
            } else {
              const taken = await this.files.activeNamesStartingWith(
                folder.folderId,
                baseNameOf(name),
                s,
              );
              resolvedName = resolveCopyName(name, taken);
            }
            const fileId = await this.files.insert(
              {
                folderId: folder.folderId,
                originalFileName: resolvedName,
                storedFileName: storedName,
                fileExtension: ext,
                mimeType: mimeTypeFor(ext),
                fileSizeBytes: stored.sizeBytes,
                physicalPath: dbPath,
                checksum: stored.sha256,
                uploadedBy: user.userId,
                version,
              },
              s,
            );
            // แทนที่: ลบแถวเก่าหลังแถวใหม่บันทึกแล้ว (ใน transaction เดียวกัน)
            if (replaced) await this.files.softDelete(replaced.fileId, user.userId, s);
            await this.acl.copyFolderPermissionsToFile(folder.folderId, fileId, user.userId, s);
            await this.folderRepo.refreshCounters([folder.folderId], s);
            return { fileId, resolvedName, version, replacedFileId: replaced?.fileId };
          });
          this.alertQuota(folder.orgUnitId);
          return {
            originalName: src.originalName,
            success: true,
            fileId: saved.fileId,
            actualName: saved.resolvedName,
            isDuplicate: saved.resolvedName !== name,
            version: saved.version,
          };
        } catch (err) {
          await this.storage.discard(target); // DB ล้ม → ไม่ทิ้งไฟล์กายภาพค้าง
          throw err;
        }
      },
      (r) => ({ recordId: r.fileId, after: { name: r.actualName, version: r.version } }),
    );
  }

  // ── ดาวน์โหลด ──────────────────────────────────────────────

  /** ใบอนุมัติดาวน์โหลดที่ยังใช้ได้ (ถ้ามีระบบอนุมัติ) */
  private async findApproval(user: UserContext, fileId: number): Promise<number | null> {
    if (!this.approvals) return null;
    const ref = await this.approvals.findApprovedDownload(user, fileId);
    return ref ? ref.requestId : null;
  }

  private async evaluateDownload(user: UserContext, file: FileRow, folder: FolderRow) {
    const entries = await this.acl.activeFileEntries(file.fileId);
    return decideDownload({
      isPrivileged: isPrivilegedUser(user),
      folderCanRead: await this.access.canView(user, folder),
      authorityCanDownload: canDownloadLevel(user, folder.confidentialityLevel),
      subject: subjectOf(user),
      entries,
    });
  }

  /** ผู้ใช้ดาวน์โหลดไฟล์นี้ได้ทันทีหรือต้องขออนุมัติ (ให้ UI ตัดสินใจก่อนเรียกดาวน์โหลด) */
  async downloadAccess(user: UserContext, fileId: number): Promise<DownloadAccessDto> {
    const file = await this.requireActive(fileId);
    const folder = await this.folders.require(file.folderId);
    const v = await this.evaluateDownload(user, file, folder);
    if (v.allowed) return { canDownload: true, requiresApproval: false, via: v.via };
    if (v.reason !== 'NEED_APPROVAL') {
      return { canDownload: false, requiresApproval: false, reason: 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้' };
    }
    const approvedId = await this.findApproval(user, fileId);
    if (approvedId !== null) {
      return {
        canDownload: true,
        requiresApproval: false,
        via: 'APPROVAL',
        approvedRequestId: approvedId,
      };
    }
    return {
      canDownload: false,
      requiresApproval: this.approvals !== undefined,
      reason: this.approvals
        ? 'ต้องขออนุมัติก่อนดาวน์โหลดไฟล์นี้'
        : 'ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้ (ระบบอนุมัติไม่พร้อมใช้งาน)',
    };
  }

  /**
   * เปิดไฟล์เพื่อดาวน์โหลดแบบ stream (ไม่โหลดทั้งไฟล์เข้า memory)
   * สิทธิ์: Manager/Admin · Authority.CanDownload ของชั้นความลับ · สิทธิ์ไฟล์ที่ให้ CanDownload · ใบอนุมัติที่อนุมัติแล้ว (ใช้ได้ครั้งเดียว)
   * ถ้ายังไม่มีสิทธิ์และมีระบบอนุมัติ → 403 DOWNLOAD_APPROVAL_REQUIRED · บันทึก CRUD-log EXECUTE `DOWNLOAD_FILE`
   */
  openDownload(user: UserContext, fileId: number): Promise<DownloadHandle> {
    return this.logged(
      { action: 'EXECUTE', operation: 'DOWNLOAD_FILE', recordId: fileId },
      async () => {
        const file = await this.requireActive(fileId);
        const folder = await this.folders.require(file.folderId);
        if (folder.isDeleted) {
          throw new BusinessException('โฟลเดอร์ของไฟล์นี้ถูกลบแล้ว', 'FOLDER_DELETED', { fileId });
        }
        const verdict = await this.evaluateDownload(user, file, folder);
        let approvalId: number | null = null;
        if (!verdict.allowed) {
          if (verdict.reason !== 'NEED_APPROVAL') {
            throw new PermissionDeniedException(
              'ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้',
              'FILE_PERMISSION_DENIED',
              {
                fileId,
              },
            );
          }
          approvalId = await this.findApproval(user, fileId);
          if (approvalId === null) {
            throw new PermissionDeniedException(
              this.approvals ? 'ต้องขออนุมัติก่อนดาวน์โหลดไฟล์นี้' : 'ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้',
              this.approvals ? 'DOWNLOAD_APPROVAL_REQUIRED' : 'DOWNLOAD_DENIED',
              { fileId, canRequestApproval: this.approvals !== undefined },
            );
          }
        }

        const handle = await this.openStored(file, folder);
        try {
          if (approvalId !== null && this.approvals) {
            await this.approvals.consumeDownload(user, approvalId); // ใช้ได้ครั้งเดียว
          }
        } catch (err) {
          this.storage.closeQuietly(handle.stream);
          throw err;
        }
        return {
          fileId,
          stream: this.storage.withIntegrityCheck(handle.stream, file.checksum, (r) => {
            if (r.ok) return;
            this.logger.error(
              `ไฟล์ ${fileId} ไม่ผ่านการตรวจ checksum หลังส่ง (คาด ${file.checksum} ได้ ${r.actual})`,
            );
            this.logEvent({
              action: 'EXECUTE',
              operation: 'FILE_INTEGRITY_FAILURE',
              recordId: fileId,
              success: false,
              error: new Error('checksum mismatch'),
            });
          }),
          fileName: file.originalFileName,
          sizeBytes: handle.sizeBytes,
          mimeType: file.mimeType,
        };
      },
      () => ({ meta: { fileId } }),
    );
  }

  /** เปิดอ่านโดยไม่ตรวจสิทธิ์ผู้ใช้ (ใช้หลังตรวจสิทธิ์ด้วยวิธีอื่นแล้ว เช่น share token) */
  openReadUnchecked(fileId: number): Promise<DownloadHandle> {
    return this.logged(
      { action: 'EXECUTE', operation: 'DOWNLOAD_FILE_UNCHECKED', recordId: fileId },
      async () => {
        const file = await this.requireActive(fileId);
        const folder = await this.folders.require(file.folderId);
        const handle = await this.openStored(file, folder);
        return {
          fileId,
          stream: handle.stream,
          fileName: file.originalFileName,
          sizeBytes: handle.sizeBytes,
          mimeType: file.mimeType,
        };
      },
    );
  }

  private async openStored(file: FileRow, folder: FolderRow) {
    const handle = await this.storage.openRead({
      orgUnitId: folder.orgUnitId,
      folderId: file.folderId,
      storedFileName: file.storedFileName,
      physicalPath: file.physicalPath,
    });
    if (String(handle.sizeBytes) !== file.fileSizeBytes) {
      this.storage.closeQuietly(handle.stream);
      this.logger.error(
        `ขนาดไฟล์ ${file.fileId} บนที่จัดเก็บ (${handle.sizeBytes}) ไม่ตรงกับ DB (${file.fileSizeBytes})`,
      );
      throw new BusinessException(
        'ไฟล์ไม่ผ่านการตรวจความสมบูรณ์ กรุณาติดต่อผู้ดูแลระบบ',
        'FILE_INTEGRITY_FAILED',
        { fileId: file.fileId },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return handle;
  }

  // ── แก้ไข ──────────────────────────────────────────────────

  rename(user: UserContext, fileId: number, rawName: string): Promise<FileDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'RENAME_FILE',
        recordId: fileId,
        captureBefore: () => this.files.getById(fileId).then((r) => (r ? toFileDto(r) : null)),
      },
      async () => {
        const name = validateFileName(rawName);
        const file = await this.requireActive(fileId);
        const folder = await this.folders.require(file.folderId);
        await this.access.assertEdit(
          user,
          folder,
          `ไม่มีสิทธิ์เปลี่ยนชื่อไฟล์ '${file.originalFileName}' (ต้องการสิทธิ์ Edit)`,
        );
        if (extensionOf(name) !== extensionOf(file.originalFileName)) {
          throw new BusinessException(
            `ต้องคงนามสกุลเดิมของไฟล์ (${extensionOf(file.originalFileName)})`,
            'FILE_EXTENSION_CHANGE_NOT_ALLOWED',
          );
        }
        const dup = await this.files.findActiveByName(file.folderId, name);
        if (dup && dup.fileId !== fileId) {
          throw new ConflictBusinessException(
            `มีไฟล์ชื่อ '${name}' อยู่แล้วในโฟลเดอร์นี้`,
            'FILE_NAME_DUPLICATE',
            { fileId: dup.fileId },
          );
        }
        await this.files.rename(fileId, name);
        return this.get(user, fileId);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบไฟล์ (soft delete; ไฟล์กายภาพยังอยู่เพื่อกู้คืน) — สิทธิ์ระดับไฟล์ทับสิทธิ์โฟลเดอร์เมื่อมี */
  remove(user: UserContext, fileId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_FILE',
        recordId: fileId,
        captureBefore: () => this.files.getById(fileId).then((r) => (r ? toFileDto(r) : null)),
      },
      async () => {
        const file = await this.files.getById(fileId);
        if (!file) throw new ResourceNotFoundException('File', fileId);
        if (file.fileStatus === FILE_STATUS_DELETED) {
          throw new ConflictBusinessException('ไฟล์ถูกลบไปแล้ว', 'FILE_ALREADY_DELETED');
        }
        const folder = await this.folders.require(file.folderId);
        await this.access.assertDeleteFile(
          user,
          folder,
          `ไม่มีสิทธิ์ลบไฟล์ '${file.originalFileName}' ในโฟลเดอร์นี้`,
        );
        const entries = await this.acl.activeFileEntries(fileId);
        if (
          fileOverrideBlocks(fileAclDecision({ subject: subjectOf(user), perm: 'Delete', entries }))
        ) {
          throw new PermissionDeniedException(
            'สิทธิ์ระดับไฟล์ไม่อนุญาตให้ลบไฟล์นี้',
            'FILE_PERMISSION_DENIED',
            { fileId },
          );
        }
        await this.tx.run(async (s) => {
          await this.files.softDelete(fileId, user.userId, s);
          await this.folderRepo.refreshCounters([file.folderId], s);
        });
      },
    );
  }

  /** กู้คืนไฟล์จากถังขยะ — โฟลเดอร์ต้องใช้งานอยู่, ต้องมีสิทธิ์เพิ่ม, ไฟล์กายภาพต้องยังอยู่; ชื่อชนจะตั้ง copy(N) */
  restore(user: UserContext, fileId: number): Promise<FileDto> {
    return this.logged(
      { action: 'UPDATE', operation: 'RESTORE_FILE', recordId: fileId },
      async () => {
        const file = await this.files.getById(fileId);
        if (!file) throw new ResourceNotFoundException('File', fileId);
        if (file.fileStatus !== FILE_STATUS_DELETED) {
          throw new ConflictBusinessException('ไฟล์นี้ไม่ได้อยู่ในถังขยะ', 'FILE_NOT_DELETED');
        }
        const folder = await this.folders.requireUsable(file.folderId, 'โฟลเดอร์ของไฟล์นี้');
        await this.access.assertAdd(user, folder, 'ไม่มีสิทธิ์กู้คืนไฟล์เข้าโฟลเดอร์นี้');
        const located = await this.storage.locate({
          orgUnitId: folder.orgUnitId,
          folderId: file.folderId,
          storedFileName: file.storedFileName,
          physicalPath: file.physicalPath,
        });
        if (!located) {
          throw new ConflictBusinessException(
            'ไม่พบไฟล์จริงบนที่จัดเก็บ จึงกู้คืนไม่ได้',
            'FILE_CONTENT_MISSING',
          );
        }
        await this.tx.run(async (s) => {
          const taken = await this.files.activeNamesStartingWith(
            file.folderId,
            baseNameOf(file.originalFileName),
            s,
          );
          const name = resolveCopyName(file.originalFileName, taken);
          await this.files.restore(fileId, name === file.originalFileName ? null : name, s);
          await this.folderRepo.refreshCounters([file.folderId], s);
        });
        return this.get(user, fileId);
      },
      (r) => ({ after: r }),
    );
  }

  // ── ย้าย / คัดลอก ──────────────────────────────────────────

  /**
   * ย้ายไฟล์ไปโฟลเดอร์อื่น (ไฟล์ต้องเป็น Active) — ต้องมีสิทธิ์ปลายทาง และต้นทาง (Admin ข้าม)
   * ย้ายไฟล์กายภาพก่อนแล้วค่อยแก้ DB; DB ล้ม → ย้ายไฟล์กลับ · ชื่อชนในปลายทางตั้งเป็น copy(N)
   */
  async moveMany(
    user: UserContext,
    fileIds: readonly number[],
    destinationFolderId: number,
  ): Promise<MoveFilesResultDto> {
    const dest = await this.folders.requireUsable(destinationFolderId, 'โฟลเดอร์ปลายทาง');
    await this.access.assertMoveWithin(
      user,
      dest,
      `ไม่มีสิทธิ์ย้ายไปยังโฟลเดอร์ปลายทาง '${dest.folderName}'`,
    );
    const items: MoveItemResultDto[] = [];
    for (const fileId of [...new Set(fileIds)]) {
      try {
        const renamedTo = await this.moveOne(user, fileId, dest);
        items.push({ fileId, success: true, renamedTo });
      } catch (err) {
        const e = errorInfo(err);
        items.push({ fileId, success: false, errorCode: e.code, error: e.message });
      }
    }
    const successCount = items.filter((i) => i.success).length;
    return { items, successCount, failureCount: items.length - successCount };
  }

  private moveOne(user: UserContext, fileId: number, dest: FolderRow): Promise<string | undefined> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'MOVE_FILE',
        recordId: fileId,
        meta: { destinationFolderId: dest.folderId },
        captureBefore: () => this.files.getById(fileId).then((r) => (r ? toFileDto(r) : null)),
      },
      async () => {
        const file = await this.requireActive(fileId);
        if (file.fileStatus !== 1) {
          throw new BusinessException(
            `ไม่สามารถย้ายไฟล์ ID ${fileId} ได้ เนื่องจากสถานะไม่ใช่ Active`,
            'FILE_NOT_ACTIVE',
          );
        }
        const source = await this.folders.require(file.folderId);
        if (source.folderId === dest.folderId) return undefined; // อยู่ที่เดิมแล้ว
        await this.access.assertMoveWithin(
          user,
          source,
          `ไม่มีสิทธิ์ย้ายจากโฟลเดอร์ต้นทาง (ID: ${source.folderId})`,
        );
        if (source.orgUnitId !== dest.orgUnitId) {
          await this.quota?.validateBatch(dest.orgUnitId, [Number(file.fileSizeBytes)]);
        }

        const oldName = file.originalFileName;
        const taken = await this.files.activeNamesStartingWith(dest.folderId, baseNameOf(oldName));
        const finalName = resolveCopyName(oldName, taken);

        // ย้ายไฟล์กายภาพ (ถ้ามี) ไปโครง <org>/<folder>/ ของปลายทาง
        const from = await this.storage.locate({
          orgUnitId: source.orgUnitId,
          folderId: source.folderId,
          storedFileName: file.storedFileName,
          physicalPath: file.physicalPath,
        });
        let storedName = file.storedFileName;
        let dbPath = file.physicalPath;
        let moved: { from: string; to: string } | null = null;
        if (from) {
          let to = this.storage.pathFor(dest.orgUnitId, dest.folderId, storedName);
          if (await this.storage.exists(to)) {
            storedName = buildStoredFileName(file.originalFileName);
            to = this.storage.pathFor(dest.orgUnitId, dest.folderId, storedName);
          }
          await this.storage.move(from, to);
          moved = { from, to };
          dbPath = await this.storage.toDbPath(dest.orgUnitId, dest.folderId, storedName);
        }
        try {
          await this.tx.run(async (s) => {
            await this.files.relocate(
              fileId,
              {
                folderId: dest.folderId,
                physicalPath: dbPath,
                storedFileName: storedName,
                originalFileName: finalName,
              },
              s,
            );
            await this.folderRepo.refreshCounters([source.folderId, dest.folderId], s);
          });
        } catch (err) {
          if (moved) {
            await this.storage.move(moved.to, moved.from).catch((e: Error) => {
              this.logger.error(
                `ย้ายไฟล์กลับไม่สำเร็จหลัง DB ล้ม (${moved?.to} → ${moved?.from}): ${e.message}`,
              );
            });
          }
          throw err;
        }
        return finalName !== oldName ? finalName : undefined;
      },
    );
  }

  /** คัดลอกไฟล์ไปโฟลเดอร์อื่น — ต้องอ่านต้นทางได้และเพิ่มปลายทางได้ · overwrite=true แทนที่ไฟล์ชื่อเดียวกัน (Version+1) */
  copy(user: UserContext, fileId: number, dto: CopyFileDto): Promise<FileDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'COPY_FILE',
        recordId: fileId,
        meta: { destinationFolderId: dto.destinationFolderId, overwrite: dto.overwrite === true },
      },
      async () => {
        const file = await this.requireActive(fileId);
        const sourceFolder = await this.folders.require(file.folderId);
        await this.assertReadable(user, file, sourceFolder);
        const dest = await this.folders.requireUsable(dto.destinationFolderId, 'โฟลเดอร์ปลายทาง');
        await this.access.assertAdd(
          user,
          dest,
          `ไม่มีสิทธิ์เขียนในโฟลเดอร์ปลายทาง '${dest.folderName}'`,
        );

        const from = await this.storage.locate({
          orgUnitId: sourceFolder.orgUnitId,
          folderId: file.folderId,
          storedFileName: file.storedFileName,
          physicalPath: file.physicalPath,
        });
        if (!from) {
          throw new ConflictBusinessException(
            'ไม่พบไฟล์จริงบนที่จัดเก็บ จึงคัดลอกไม่ได้',
            'FILE_CONTENT_MISSING',
          );
        }
        const size = Number(file.fileSizeBytes);
        const overwrite = dto.overwrite === true;
        const existingForQuota = overwrite
          ? await this.files.findActiveByName(dest.folderId, file.originalFileName)
          : null;
        await this.quota?.validateBatch(dest.orgUnitId, [
          Math.max(0, size - (existingForQuota ? Number(existingForQuota.fileSizeBytes) : 0)),
        ]);

        const storedName = buildStoredFileName(file.originalFileName);
        const target = this.storage.pathFor(dest.orgUnitId, dest.folderId, storedName);
        await this.storage.copy(from, target);
        try {
          const dbPath = await this.storage.toDbPath(dest.orgUnitId, dest.folderId, storedName);
          const newId = await this.tx.run(async (s) => {
            let name = file.originalFileName;
            let version = 1;
            if (overwrite) {
              const existing = await this.files.findActiveByName(dest.folderId, name, s);
              if (existing) {
                version = existing.version + 1;
                await this.files.softDelete(existing.fileId, user.userId, s);
              }
            } else {
              name = resolveCopyName(
                name,
                await this.files.activeNamesStartingWith(dest.folderId, baseNameOf(name), s),
              );
            }
            const id = await this.files.insert(
              {
                folderId: dest.folderId,
                originalFileName: name,
                storedFileName: storedName,
                fileExtension: file.fileExtension,
                mimeType: file.mimeType,
                fileSizeBytes: size,
                physicalPath: dbPath,
                checksum: file.checksum,
                uploadedBy: user.userId,
                version,
              },
              s,
            );
            await this.acl.copyFolderPermissionsToFile(dest.folderId, id, user.userId, s);
            await this.folderRepo.refreshCounters([dest.folderId], s);
            return id;
          });
          this.alertQuota(dest.orgUnitId);
          return await this.get(user, newId);
        } catch (err) {
          await this.storage.discard(target);
          throw err;
        }
      },
      (r) => ({ after: { newFileId: r.fileId, name: r.originalFileName } }),
    );
  }

  // ── สำหรับ module อื่น (DMS_FILE_PORT) ─────────────────────

  async listActiveForPort(folderId: number): Promise<DmsFileInfo[]> {
    const rows = await this.files.listActiveByFolder(folderId);
    return rows.map((r) => this.toInfo(r));
  }

  toInfo(r: FileRow): DmsFileInfo {
    return {
      fileId: r.fileId,
      folderId: r.folderId,
      originalFileName: r.originalFileName,
      storedFileName: r.storedFileName,
      fileSizeBytes: r.fileSizeBytes,
      version: r.version,
      createdDate: r.uploadedDate ?? undefined,
    };
  }

  async infoOf(fileId: number): Promise<DmsFileInfo> {
    const row = await this.files.getById(fileId);
    if (!row) throw new ResourceNotFoundException('File', fileId);
    return this.toInfo(row);
  }

  toReadHandle(h: DownloadHandle): DmsFileReadHandle {
    return { stream: h.stream, fileName: h.fileName, size: h.sizeBytes, mimeType: h.mimeType };
  }

  private alertQuota(orgUnitId: number): void {
    if (!this.quota) return;
    this.quota.sendAlertIfNeeded(orgUnitId).catch((err: unknown) => {
      this.logger.warn(
        `ส่งแจ้งเตือนโควตาหน่วยงาน ${orgUnitId} ไม่สำเร็จ: ${(err as Error).message}`,
      );
    });
  }
}
