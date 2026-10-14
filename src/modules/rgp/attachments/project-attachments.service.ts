import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import {
  DMS_FILE_PORT,
  type DmsFileInfo,
  type DmsFilePort,
  type DmsFileReadHandle,
  type DmsUploadInput,
} from '../../dms/ports/dms-file.port';
import { SystemConfigService } from '../../shared/system-config/system-config.service';
import { ACTOR_LONG, rgpActor } from '../common/rgp-actor';
import { Project } from '../entities/project.entity';
import { ProjectAttachment } from '../entities/project-attachment.entity';
import type { LinkAttachmentsResultDto, ProjectAttachmentDto } from './dto/attachment.dto';

/** key ใน dbo.SystemConfig ที่ใช้แทน app.config `ExternalUpload.FolderId.Level4` ของโปรแกรมเดิม */
export const ATTACHMENT_FOLDER_CONFIG_KEY = 'ExternalUpload.FolderId.Level4';
/** โฟลเดอร์ราก DMS ระดับ 4 (PC) ที่โปรแกรมเดิมใช้เป็นค่าเริ่มต้น */
export const ATTACHMENT_FOLDER_DEFAULT = 437;

const ATTACHMENTS_SQL = `
SELECT a.i_attach_id AS attachId,
       a.i_project_id AS projectId,
       a.i_file_id AS fileId,
       fd.OriginalFileName AS fileName,
       fd.FileExtension AS fileExt,
       fd.FileSizeBytes AS fileSizeBytes,
       fd.UploadedBy AS uploadedBy,
       fd.UploadedDate AS uploadedDate,
       ISNULL(f.ConfidentialityLevel, 0) AS confidentialityLevel,
       f.FolderName AS folderName,
       a.i_create_user AS createUser,
       a.d_create_date AS createDate
FROM storage.t_project_attachment a
JOIN storage.FileDocument fd ON fd.FileID = a.i_file_id AND fd.FileStatus <> 3
LEFT JOIN storage.Folder f ON f.FolderID = fd.FolderID
WHERE a.i_project_id = @0
ORDER BY a.d_create_date DESC, a.i_attach_id DESC`;

/**
 * ไฟล์แนบโครงการ — ไฟล์เก็บใน DMS, ผูกกับโครงการด้วย `storage.t_project_attachment (i_project_id, i_file_id)` (unique)
 * พอร์ตจาก ProjectAttachmentService/Repository
 *
 * การอัปโหลด/อ่านไฟล์ทำ "เฉพาะผ่าน port" `DMS_FILE_PORT` (ตรวจสิทธิ์ ชนิดไฟล์ ขนาด quota ที่ฝั่ง DMS)
 * ถ้ายังไม่มีผู้ implement port → ตอบ 503 `DMS_UNAVAILABLE` ที่จุดใช้งาน (ดู list/unlink ที่ไม่ใช้ port ยังทำงานได้)
 */
@Injectable()
export class ProjectAttachmentsService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectAttachment';
  private readonly logger = new Logger(ProjectAttachmentsService.name);

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ProjectAttachment) private readonly repo: Repository<ProjectAttachment>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly tx: TransactionRunner,
    private readonly sysConfig: SystemConfigService,
    @Optional() @Inject(DMS_FILE_PORT) private readonly dms?: DmsFilePort,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** ไฟล์แนบของโครงการ (ใหม่สุดก่อน) — ซ่อนไฟล์ที่ถูกลบใน DMS (FileStatus = 3) */
  async list(projectId: number): Promise<ProjectAttachmentDto[]> {
    await this.assertProject(projectId);
    const rows: (Omit<ProjectAttachmentDto, 'fileSizeBytes'> & { fileSizeBytes: unknown })[] =
      await this.ds.query(ATTACHMENTS_SQL, [projectId]);
    return rows.map((r) => ({ ...r, fileSizeBytes: String(r.fileSizeBytes ?? '0') }));
  }

  // ── เขียน ──────────────────────────────────────────────────

  /**
   * อัปโหลดไฟล์ใหม่เข้า DMS แล้วผูกกับโครงการ
   * @param folderId โฟลเดอร์ DMS ปลายทาง (ไม่ระบุ = ค่า config ExternalUpload.FolderId.Level4, ค่าเริ่มต้น 437)
   */
  upload(
    projectId: number,
    files: DmsUploadInput[],
    folderId: number | undefined,
    user: UserContext,
  ): Promise<ProjectAttachmentDto[]> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'UPLOAD_PROJECT_ATTACHMENT',
        meta: { projectId, files: files.map((f) => f.originalName) },
      },
      async () => {
        const dms = this.requireDms();
        if (files.length === 0) {
          throw new BusinessException('ไม่พบไฟล์ที่อัปโหลด', 'NO_FILE_UPLOADED');
        }
        await this.assertProject(projectId);

        const targetFolder =
          folderId ??
          (await this.sysConfig.getNumber(ATTACHMENT_FOLDER_CONFIG_KEY, ATTACHMENT_FOLDER_DEFAULT));
        const uploaded: DmsFileInfo[] = await dms.upload(user, targetFolder, files, {
          overwriteExisting: false,
        });

        try {
          await this.insertLinks(
            projectId,
            uploaded.map((u) => u.fileId),
            user,
          );
        } catch (err) {
          // ผูกไม่สำเร็จ → ไม่ให้เหลือไฟล์กำพร้าใน DMS (พยายามลบ ถ้าลบไม่ได้แค่เตือน)
          await Promise.all(
            uploaded.map((u) =>
              dms
                .remove(user, u.fileId)
                .catch((e: unknown) =>
                  this.logger.warn(
                    `ลบไฟล์ DMS ${u.fileId} ที่อัปโหลดค้างไม่สำเร็จ: ${(e as Error)?.message}`,
                  ),
                ),
            ),
          );
          throw err;
        }

        const ids = new Set(uploaded.map((u) => u.fileId));
        return (await this.list(projectId)).filter((a) => ids.has(a.fileId));
      },
      (list) => ({ after: { fileIds: list.map((a) => a.fileId) } }),
    );
  }

  /** ผูกไฟล์ที่มีอยู่แล้วใน DMS เข้ากับโครงการ — ผู้ใช้ต้องมีสิทธิ์อ่านไฟล์นั้น (ตรวจผ่าน DMS) */
  link(projectId: number, fileIds: number[], user: UserContext): Promise<LinkAttachmentsResultDto> {
    return this.logged(
      { action: 'CREATE', operation: 'LINK_PROJECT_ATTACHMENT', meta: { projectId, fileIds } },
      async () => {
        const dms = this.requireDms();
        const unique = [...new Set(fileIds)];
        await this.assertProject(projectId);
        for (const fileId of unique) {
          const handle = await dms.openRead(user, fileId); // ไม่พบ/ไม่มีสิทธิ์ → DMS โยน 404/403
          handle.stream.destroy();
        }
        return this.insertLinks(projectId, unique, user);
      },
      (r) => ({ after: r }),
    );
  }

  /** เปิดไฟล์แนบเพื่อดาวน์โหลด — ต้องเป็นไฟล์ที่ผูกกับโครงการนี้ และผู้ใช้มีสิทธิ์ใน DMS */
  download(projectId: number, fileId: number, user: UserContext): Promise<DmsFileReadHandle> {
    return this.logged(
      {
        action: 'READ',
        operation: 'DOWNLOAD_PROJECT_ATTACHMENT',
        recordId: fileId,
        meta: { projectId },
      },
      async () => {
        const dms = this.requireDms();
        if (!(await this.repo.existsBy({ projectId, fileId }))) {
          throw new ResourceNotFoundException('ไฟล์แนบของโครงการ', fileId);
        }
        return dms.openRead(user, fileId);
      },
    );
  }

  /** ยกเลิกการแนบ (ลบเฉพาะการผูก — ไฟล์ยังอยู่ใน DMS) */
  unlink(projectId: number, fileId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'REMOVE_PROJECT_ATTACHMENT',
        recordId: fileId,
        meta: { projectId },
      },
      async () => {
        const link = await this.repo.findOneBy({ projectId, fileId });
        if (!link) throw new ResourceNotFoundException('ไฟล์แนบของโครงการ', fileId);
        await this.repo.delete({ projectId, fileId });
      },
    );
  }

  // ── ภายใน ──────────────────────────────────────────────────

  private async assertProject(projectId: number): Promise<void> {
    if (!(await this.projects.existsBy({ projectId, active: 'Y' }))) {
      throw new ResourceNotFoundException('โครงการ', projectId);
    }
  }

  private requireDms(): DmsFilePort {
    if (!this.dms) {
      throw new BusinessException(
        'ระบบจัดการไฟล์ (DMS) ยังไม่พร้อมใช้งาน',
        'DMS_UNAVAILABLE',
        undefined,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.dms;
  }

  /** เพิ่มแถวผูกไฟล์ (ข้ามที่ผูกอยู่แล้ว — unique i_project_id + i_file_id) ใน transaction เดียว */
  private insertLinks(
    projectId: number,
    fileIds: number[],
    user: UserContext,
  ): Promise<LinkAttachmentsResultDto> {
    return this.tx.run(async ({ manager }) => {
      const linked: number[] = [];
      const alreadyLinked: number[] = [];
      for (const fileId of fileIds) {
        if (await manager.existsBy(ProjectAttachment, { projectId, fileId })) {
          alreadyLinked.push(fileId);
          continue;
        }
        await manager.insert(ProjectAttachment, {
          projectId,
          fileId,
          createUser: rgpActor(user, ACTOR_LONG),
        });
        linked.push(fileId);
      }
      return { linked, alreadyLinked };
    });
  }
}
