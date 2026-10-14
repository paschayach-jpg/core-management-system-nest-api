import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { readFile, rm } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { DMS_FILE_PORT, DmsFilePort, DmsFileReadHandle } from '../../dms/ports/dms-file.port';
import { SystemConfigService } from '../../shared/system-config/system-config.service';
import { KMS_CONFIG_KEY, KMS_OP } from '../kms.constants';
import { requireDms } from '../kms-dms';
import { isConstraintViolation } from '../kms-sql';
import { LINK_FILE, attachFileRow, requireArticle } from './article-sql';
import type { ArticleAttachmentDto } from './dto/article.dto';

type Row = Record<string, unknown>;

/** ไฟล์ที่ multer เขียนไว้ที่ดิสก์ชั่วคราวแล้ว */
export interface TempUpload {
  originalname: string;
  path: string;
  size: number;
  mimetype?: string;
}

/**
 * ไฟล์แนบของบทความ (KMS.t_KBArticleAttachment) — ตัวไฟล์อยู่ใน DMS (storage.FileDocument) เข้าถึงผ่านพอร์ต DMS_FILE_PORT เท่านั้น
 *
 * ระวัง: SaveArticleAttachments ของระบบเดิม **ลบไฟล์แนบเดิมทั้งหมดก่อน** แล้วใส่ชุดใหม่ (ใช้ได้ปลอดภัยเฉพาะบทความที่ยังไม่มีไฟล์)
 * API แยกเป็น: เพิ่ม (POST — ไม่ลบของเดิม) · ถอดทีละไฟล์ (DELETE) · แทนที่ทั้งชุด (PUT — ระบุชัดเจน ทำใน transaction เดียว
 * และไม่ลบแถวของไฟล์ที่ยังอยู่ในชุด) · ไฟล์ใน DMS ไม่ถูกลบเมื่อถอดออกจากบทความ
 */
@Injectable()
export class ArticleAttachmentsService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbArticleAttachment';
  private readonly log = new Logger(ArticleAttachmentsService.name);

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly config: SystemConfigService,
    @Optional() @Inject(DMS_FILE_PORT) private readonly dms?: DmsFilePort,
  ) {
    super(crudLog);
  }

  async list(articleId: number): Promise<ArticleAttachmentDto[]> {
    // อ่านข้อมูลไฟล์จาก storage.FileDocument แบบอ่านอย่างเดียว (พอร์ต DMS ยังไม่มีเมธอดอ่าน metadata ตาม FileID — ดู docs "ขอแก้ core")
    const rows: Row[] = await this.ds.query(
      `SELECT a.AttachmentID, a.FileID, a.CreatedBy, a.CreatedDate,
              f.OriginalFileName, f.FileExtension, f.MimeType, f.FileSizeBytes, f.IsDeleted, f.FileStatus
         FROM KMS.t_KBArticleAttachment a
         LEFT JOIN storage.FileDocument f ON f.FileID = a.FileID
        WHERE a.ArticleID = @0
        ORDER BY a.CreatedDate DESC, a.AttachmentID DESC`,
      [articleId],
    );
    return rows.map((raw) => {
      const r = camelizeKeys<Row>(raw);
      const missing =
        r.originalFileName == null || Boolean(r.isDeleted) || Number(r.fileStatus) === 3;
      return {
        attachmentId: Number(r.attachmentId),
        fileId: Number(r.fileId),
        originalFileName: (r.originalFileName as string | null) ?? null,
        fileExtension: (r.fileExtension as string | null) ?? null,
        mimeType: (r.mimeType as string | null) ?? null,
        fileSizeBytes: r.fileSizeBytes == null ? null : String(r.fileSizeBytes),
        fileMissing: missing,
        createdBy: String(r.createdBy ?? ''),
        createdDate: (r.createdDate as Date | null) ?? null,
      };
    });
  }

  /** อัปโหลดไฟล์เข้า DMS แล้วผูกกับบทความ (เพิ่ม ไม่ลบของเดิม) */
  upload(
    articleId: number,
    files: TempUpload[],
    folderId: number | undefined,
    user: UserContext,
  ): Promise<ArticleAttachmentDto[]> {
    return this.logged(
      {
        action: 'CREATE',
        operation: KMS_OP.attachFile,
        recordId: articleId,
        meta: { fileCount: files.length },
      },
      async () => {
        try {
          const dms = requireDms(this.dms);
          await requireArticle(this.ds, articleId, { editable: true });
          if (files.length === 0) throw new BusinessException('ไม่พบไฟล์ที่อัปโหลด', 'NO_FILES');

          const target = folderId ?? (await this.defaultFolder());
          const inputs = [];
          for (const f of files)
            inputs.push({
              originalName: f.originalname,
              buffer: await readFile(f.path),
              mimeType: f.mimetype,
            });

          const uploaded = await dms.upload(user, target, inputs, { overwriteExisting: false });
          try {
            await this.tx.run(async ({ manager }) => {
              for (const info of uploaded)
                await attachFileRow(manager, articleId, info.fileId, user.adUserName);
            });
          } catch (err) {
            // ผูกบทความไม่สำเร็จ → ไม่ทิ้งไฟล์ที่เพิ่งอัปโหลดค้างใน DMS
            for (const info of uploaded) {
              await dms
                .remove(user, info.fileId)
                .catch((e: Error) =>
                  this.log.warn(
                    `ลบไฟล์ที่อัปโหลดแล้วผูกบทความไม่สำเร็จไม่ได้ (FileID ${info.fileId}): ${e.message}`,
                  ),
                );
            }
            throw err;
          }
          const ids = new Set(uploaded.map((u) => u.fileId));
          return (await this.list(articleId)).filter((a) => ids.has(a.fileId));
        } finally {
          await Promise.all(files.map((f) => rm(f.path, { force: true })));
        }
      },
      (r) => ({ after: r.map((a) => a.fileId) }),
    );
  }

  /** ถอดไฟล์ออกจากบทความ (แถว attachment + link ไฟล์) — ไฟล์ใน DMS คงอยู่ */
  remove(articleId: number, fileId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'REMOVE_KB_ATTACHMENT',
        recordId: articleId,
        meta: { fileId },
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          await requireArticle(manager, articleId, { editable: true });
          const del: { N: number }[] = await manager.query(
            `DELETE FROM KMS.t_KBArticleAttachment WHERE ArticleID = @0 AND FileID = @1; SELECT @@ROWCOUNT AS N;`,
            [articleId, fileId],
          );
          if (Number(del[0]?.N) === 0)
            throw new ResourceNotFoundException('ไฟล์แนบของบทความ', fileId);
          await manager.query(
            `DELETE FROM KMS.t_KBArticleLink WHERE ArticleID = @0 AND EntityType = ${LINK_FILE} AND EntityID = @1`,
            [articleId, String(fileId)],
          );
        });
      },
    );
  }

  /**
   * แทนที่ไฟล์แนบ "ทั้งชุด" ด้วยไฟล์ DMS ที่ระบุ (เทียบ SaveArticleAttachments เดิม แต่ทำเป็น diff ใน transaction เดียว:
   * ไฟล์ที่ยังอยู่ในชุดไม่ถูกลบ-สร้างใหม่) · FileID ต้องมีอยู่ใน DMS (FK)
   */
  replaceAll(
    articleId: number,
    fileIds: number[],
    user: UserContext,
  ): Promise<ArticleAttachmentDto[]> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: KMS_OP.attachFile,
        recordId: articleId,
        captureBefore: async () => (await this.list(articleId)).map((a) => a.fileId),
      },
      async () => {
        const wanted = [...new Set(fileIds)];
        try {
          await this.tx.run(async ({ manager }) => {
            await requireArticle(manager, articleId, { editable: true });
            const existing: { FileID: number }[] = await manager.query(
              'SELECT FileID FROM KMS.t_KBArticleAttachment WHERE ArticleID = @0',
              [articleId],
            );
            const have = new Set(existing.map((e) => e.FileID));
            const want = new Set(wanted);
            for (const id of have) {
              if (want.has(id)) continue;
              await manager.query(
                'DELETE FROM KMS.t_KBArticleAttachment WHERE ArticleID = @0 AND FileID = @1',
                [articleId, id],
              );
              await manager.query(
                `DELETE FROM KMS.t_KBArticleLink WHERE ArticleID = @0 AND EntityType = ${LINK_FILE} AND EntityID = @1`,
                [articleId, String(id)],
              );
            }
            for (const id of wanted)
              if (!have.has(id)) await attachFileRow(manager, articleId, id, user.adUserName);
          });
        } catch (err) {
          if (isConstraintViolation(err))
            throw new BusinessException(
              'มี FileID ที่ไม่พบในระบบจัดเก็บไฟล์ (DMS)',
              'FILE_NOT_FOUND',
            );
          throw err;
        }
        return this.list(articleId);
      },
      (r) => ({ after: r.map((a) => a.fileId) }),
    );
  }

  /** เปิดอ่านไฟล์แนบเพื่อดาวน์โหลด — ต้องเป็นไฟล์ที่ผูกกับบทความนี้ และสิทธิ์อ่านไฟล์ตรวจโดย DMS */
  openDownload(articleId: number, fileId: number, user: UserContext): Promise<DmsFileReadHandle> {
    return this.logged(
      {
        action: 'READ',
        operation: 'DOWNLOAD_KB_ATTACHMENT',
        recordId: articleId,
        meta: { fileId },
      },
      async () => {
        const dms = requireDms(this.dms);
        const rows: { FileID: number }[] = await this.ds.query(
          'SELECT FileID FROM KMS.t_KBArticleAttachment WHERE ArticleID = @0 AND FileID = @1',
          [articleId, fileId],
        );
        if (rows.length === 0) throw new ResourceNotFoundException('ไฟล์แนบของบทความ', fileId);
        return dms.openRead(user, fileId);
      },
    );
  }

  private async defaultFolder(): Promise<number> {
    const id = await this.config.getNumber(KMS_CONFIG_KEY.articleAttachmentFolderId, 0);
    if (!(id > 0))
      throw new BusinessException(
        `ยังไม่ได้ระบุโฟลเดอร์ DMS สำหรับไฟล์แนบ — ส่ง folderId หรือตั้งค่าระบบ ${KMS_CONFIG_KEY.articleAttachmentFolderId}`,
        'ATTACHMENT_FOLDER_REQUIRED',
      );
    return id;
  }
}
