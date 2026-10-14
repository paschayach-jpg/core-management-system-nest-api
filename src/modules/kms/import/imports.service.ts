import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { AppRole } from '../../../common/constants/enums';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { RequestContextService } from '../../../core/cls';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { DMS_FILE_PORT, DmsFilePort } from '../../dms/ports/dms-file.port';
import { PermissionEvaluator } from '../../dms/permissions/permission-evaluator';
import { SystemConfigService } from '../../shared/system-config/system-config.service';
import type { TempUpload } from '../articles/article-attachments.service';
import { ImportTemplatesService } from '../import-templates/import-templates.service';
import { KMS_CONFIG_KEY } from '../kms.constants';
import { requireDms } from '../kms-dms';
import type {
  CreateImportBodyDto,
  ImportAttachmentStatusDto,
  ImportJobDto,
  ImportRowDto,
  ImportRowsQueryDto,
} from './dto/import.dto';
import { ImportJob, ImportJobRegistry } from './import-job.registry';
import { KMS_IMPORT_STAGE_ROOT } from './import-upload';
import { KbExcelOpenError, loadExcelGrid } from './kb-excel-grid';
import { prepareImport } from './kb-import-pipeline';
import type { KbImportRow } from './kb-import-row';
import { KbImportStore } from './kb-import.store';
import { runImport } from './kb-import-writer';
import { SharedFileCache } from './kb-shared-file-cache';
import { StagedFiles } from './kb-staged-files';

/** จำนวนแถวข้อมูลสูงสุดต่อไฟล์ (กันไฟล์ใหญ่เกินกว่าจะถือในหน่วยความจำของงานเดียว) */
export const MAX_IMPORT_ROWS = 50_000;

/**
 * นำเข้าบทความจาก Excel เป็นงานเบื้องหลัง (KBImportWizard เดิมย้ายเป็น API):
 *  1) POST /kms/imports      — อัปโหลด .xlsx + Template (+ ไฟล์แนบ) → ตรวจชนิดไฟล์เทียบ Template → ตรวจรายแถว (ไม่เขียน DB) → ได้ importId + ผลตรวจ
 *  2) POST /kms/imports/:id/execute — สั่งนำเข้า (รันเบื้องหลัง ทีละแถว แต่ละแถว = 1 transaction) · ดูความคืบหน้าที่ GET /kms/imports/:id
 *  3) GET /kms/imports/:id/rows — ผลรายแถว (Valid/Skip/Warn/Error + หมายเหตุ + หมวดที่ต้องสร้าง)
 *
 * ไฟล์แนบ: API เปิดโฟลเดอร์ในเครื่องผู้ใช้ไม่ได้ จึงให้ส่งไฟล์มาเก็บชั่วคราว (staging) ต่อกับงาน แล้วอัปโหลดเข้า DMS ตอนนำเข้า ·
 * ไฟล์ที่มีใน DMS โฟลเดอร์ปลายทางอยู่แล้ว (ชื่อตรง) ใช้ FileID เดิม ไม่ต้องส่งมา และไม่อัปโหลดซ้ำ (กันไฟล์ "copy(N)")
 */
@Injectable()
export class ImportsService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbImport';
  private readonly log = new Logger(ImportsService.name);
  private readonly runs = new Map<string, Promise<void>>();
  /** อ่าน/แปลง Excel ทีละไฟล์ — workbook ในหน่วยความจำใหญ่ ไม่ให้หลายคนอัปโหลดพร้อมกันจน RAM พุ่ง */
  private parseLock: Promise<unknown> = Promise.resolve();

  constructor(
    crudLog: CrudLogService,
    private readonly registry: ImportJobRegistry,
    private readonly templates: ImportTemplatesService,
    private readonly store: KbImportStore,
    private readonly config: SystemConfigService,
    private readonly perm: PermissionEvaluator,
    private readonly ctx: RequestContextService,
    @InjectDataSource() private readonly ds: DataSource,
    @Optional() @Inject(DMS_FILE_PORT) private readonly dms?: DmsFilePort,
  ) {
    super(crudLog);
  }

  // ── 1) อัปโหลด + ตรวจ ───────────────────────────────────────

  start(
    file: TempUpload | undefined,
    body: CreateImportBodyDto,
    attachments: TempUpload[],
    user: UserContext,
  ): Promise<ImportJobDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'VALIDATE_KB_IMPORT', meta: { templateId: body.templateId } },
      async () => {
        const temps = [file, ...attachments].filter((f): f is TempUpload => !!f);
        try {
          if (!file)
            throw new BusinessException('ไม่พบไฟล์ Excel (field "file")', 'IMPORT_FILE_REQUIRED');
          if (!/\.xlsx$/i.test(file.originalname))
            throw new BusinessException('รองรับเฉพาะไฟล์ .xlsx', 'IMPORT_FILE_NOT_XLSX');

          const template = await this.templates.requireActiveForImport(body.templateId);

          const grid = await this.withParseLock(async () => {
            try {
              return await loadExcelGrid(file.path);
            } catch (err) {
              if (err instanceof KbExcelOpenError)
                throw new BusinessException(
                  `ไม่สามารถเปิดไฟล์ Excel ได้:\n${err.message}`,
                  'EXCEL_OPEN_FAILED',
                );
              throw err;
            }
          });
          if (grid.rows.length - 1 > MAX_IMPORT_ROWS)
            throw new BusinessException(
              `ไฟล์มีแถวข้อมูลเกิน ${MAX_IMPORT_ROWS.toLocaleString('en-US')} แถว — แบ่งไฟล์แล้วนำเข้าทีละส่วน`,
              'IMPORT_TOO_LARGE',
            );

          const prep = await prepareImport({
            grid,
            templateName: template.name,
            templateColumns: template.columns,
            store: this.store,
            loadActiveTemplateLayouts: () => this.templates.activeLayouts(),
          });
          if (!prep.ok) throw new BusinessException(prep.message, prep.code, prep.details);

          // Template ที่ map Attachment: ต้องมี DMS + โฟลเดอร์ปลายทางที่ผู้ใช้เพิ่มไฟล์ได้ (ตรวจครั้งเดียวก่อนเริ่ม ไม่ปล่อยให้ล้มทีละแถว)
          let dmsFolderId: number | null = null;
          if (prep.requiresAttachment) {
            requireDms(this.dms);
            dmsFolderId = await this.resolveFolder(body.dmsFolderId, user);
          }

          const id = this.registry.newId();
          const stage = new StagedFiles(join(KMS_IMPORT_STAGE_ROOT, id));
          const rejected: string[] = [];
          for (const a of attachments) {
            const r = await stage.add(a.originalname, a.path);
            if (r.error) rejected.push(a.originalname);
          }

          const now = new Date();
          const job: ImportJob = {
            id,
            status: 'Validated',
            createdAt: now,
            startedAt: null,
            finishedAt: null,
            touchedAt: now.getTime(),
            ownerUserId: user.userId,
            ownerName: user.displayName || user.adUserName,
            user,
            fileName: file.originalname,
            templateId: body.templateId,
            templateName: template.name,
            layoutType: prep.templateLayout,
            articleType: prep.articleType,
            requiresAttachment: prep.requiresAttachment,
            dmsFolderId,
            rows: prep.rows,
            counts: prep.counts,
            missingCategories: prep.missingCategories,
            stage,
            rejectedFiles: rejected,
            progress: { done: 0, total: prep.counts.newCount + prep.counts.updateCount },
            result: null,
            cancelRequested: false,
            errorMessage: null,
          };
          this.registry.add(job);
          return toJobDto(job);
        } finally {
          // ไฟล์ที่ยังไม่ถูกย้ายเข้า staging (Excel, ไฟล์ที่ถูกปฏิเสธ, กรณีล้มกลางทาง) ลบทิ้ง
          await Promise.all(temps.map((t) => rm(t.path, { force: true })));
        }
      },
      (r) => ({
        recordId: r.importId,
        meta: { ...r.validation, fileName: r.fileName, layoutType: r.layoutType },
      }),
    );
  }

  /** เพิ่มไฟล์แนบให้งานที่ตรวจแล้วแต่ยังไม่สั่งนำเข้า (ไฟล์ชื่อซ้ำ = ไฟล์ใหม่ทับ) */
  addAttachments(jobId: string, files: TempUpload[], user: UserContext): Promise<ImportJobDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'ADD_KB_IMPORT_ATTACHMENTS',
        recordId: jobId,
        meta: { count: files.length },
      },
      async () => {
        try {
          const job = this.getOwned(jobId, user);
          if (job.status !== 'Validated')
            throw new ConflictBusinessException(
              'เพิ่มไฟล์แนบได้เฉพาะงานที่ตรวจแล้วและยังไม่ได้สั่งนำเข้า',
              'IMPORT_NOT_EDITABLE',
            );
          if (files.length === 0) throw new BusinessException('ไม่พบไฟล์ที่อัปโหลด', 'NO_FILES');
          for (const f of files) {
            const r = await job.stage.add(f.originalname, f.path);
            if (r.error) job.rejectedFiles.push(f.originalname);
          }
          job.touchedAt = Date.now();
          return toJobDto(job);
        } finally {
          await Promise.all(files.map((t) => rm(t.path, { force: true })));
        }
      },
    );
  }

  // ── 2) สั่งนำเข้า ───────────────────────────────────────────

  /** สั่งนำเข้าเบื้องหลัง (ตอบทันทีด้วยสถานะ Running) — งานที่ตรวจแล้วนำเข้าได้ครั้งเดียว · รันได้ทีละงาน */
  execute(jobId: string, user: UserContext): Promise<ImportJobDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'START_KB_IMPORT', recordId: jobId },
      async () => {
        const job = this.getOwned(jobId, user);
        if (job.status !== 'Validated')
          throw new ConflictBusinessException(
            'งานนี้นำเข้าไปแล้วหรือกำลังนำเข้าอยู่',
            'IMPORT_NOT_READY',
          );
        if (job.counts.newCount + job.counts.updateCount === 0)
          throw new BusinessException(
            'ไม่มีแถวที่ผ่านการตรวจให้นำเข้า (ดูรายการ Error/Skip ที่ GET /kms/imports/:id/rows)',
            'IMPORT_NOTHING_TO_DO',
          );
        if (this.registry.running())
          throw new ConflictBusinessException(
            'มีงานนำเข้าอื่นกำลังทำงานอยู่ — รอให้เสร็จก่อน',
            'IMPORT_ALREADY_RUNNING',
          );

        // ตรวจ DMS/สิทธิ์โฟลเดอร์ซ้ำ: เวลาผ่านไประหว่างตรวจกับสั่งนำเข้า สถานะอาจเปลี่ยน
        if (job.requiresAttachment) {
          requireDms(this.dms);
          await this.resolveFolder(job.dmsFolderId ?? undefined, user);
        }

        job.user = user;
        job.status = 'Running';
        job.startedAt = new Date();
        job.touchedAt = Date.now();
        job.progress = { done: 0, total: job.counts.newCount + job.counts.updateCount };

        // รันนอก request: ให้มี context ของตัวเอง (ผู้ใช้เดิม) เพื่อให้ CRUD-log ระบุผู้กระทำถูกต้อง
        const run = this.ctx.run(() => this.runJob(job), { user, sessionId: user.sessionId });
        this.runs.set(job.id, run);
        void run.finally(() => this.runs.delete(job.id));
        return toJobDto(job);
      },
    );
  }

  /** รอให้งานที่กำลังรันอยู่จบ (ใช้ในเทสต์/ตอน shutdown) */
  async whenFinished(jobId: string): Promise<void> {
    await this.runs.get(jobId);
  }

  private async runJob(job: ImportJob): Promise<void> {
    let error: Error | undefined;
    try {
      const files = new SharedFileCache({
        source: job.stage,
        dms: this.dms ?? null,
        user: job.user,
        folderId: job.dmsFolderId,
      });
      const valid = job.rows.filter((r) => r.status === 'Valid');
      job.result = await runImport(valid, this.store, {
        user: job.user,
        articleType: job.articleType,
        files,
        dms: this.dms ?? null,
        onProgress: (done, total) => {
          job.progress = { done, total };
          job.touchedAt = Date.now();
        },
        shouldStop: () => job.cancelRequested,
      });
      job.status = job.cancelRequested ? 'Cancelled' : 'Completed';
    } catch (err) {
      error = err as Error;
      job.status = 'Failed';
      job.errorMessage = error.message;
      this.log.error(`งานนำเข้า ${job.id} ล้มเหลว: ${error.message}`, error.stack);
    } finally {
      job.finishedAt = new Date();
      job.touchedAt = Date.now();
      slimRows(job.rows);
      await job.stage.dispose().catch(() => undefined);
      this.logEvent({
        action: 'EXECUTE',
        operation: 'IMPORT_KB_ARTICLES',
        recordId: job.id,
        success: !error,
        error,
        meta: {
          templateId: job.templateId,
          templateName: job.templateName,
          fileName: job.fileName,
          layoutType: job.layoutType,
          status: job.status,
          ...(job.result ?? {}),
        },
      });
    }
  }

  // ── 3) ดูผล / ควบคุมงาน ─────────────────────────────────────

  get(jobId: string, user: UserContext): ImportJobDto {
    return toJobDto(this.getOwned(jobId, user));
  }

  list(user: UserContext): ImportJobDto[] {
    return this.registry
      .list()
      .filter((j) => j.ownerUserId === user.userId || user.appRole >= AppRole.Admin)
      .map(toJobDto);
  }

  /** ผลรายแถว (แบ่งหน้า) กรองสถานะ / ค้นใน ArticleCode, ชื่อ, หมายเหตุ */
  rows(jobId: string, q: ImportRowsQueryDto, user: UserContext): Paginated<ImportRowDto> {
    const job = this.getOwned(jobId, user);
    const kw = q.q?.trim().toLowerCase();
    let list = job.rows;
    if (q.status) list = list.filter((r) => r.status === q.status);
    if (kw)
      list = list.filter(
        (r) =>
          (r.articleCode ?? r.colA ?? '').toLowerCase().includes(kw) ||
          (r.title ?? '').toLowerCase().includes(kw) ||
          (r.statusNote ?? '').toLowerCase().includes(kw),
      );
    const start = (q.page - 1) * q.pageSize;
    return paginated(list.slice(start, start + q.pageSize).map(toRowDto), list.length, q);
  }

  /** ไฟล์แนบที่แถวต้องใช้: มีในไฟล์ที่อัปโหลด / มีใน DMS แล้ว / ยังขาด (ตรวจก่อนสั่งนำเข้าได้) */
  async attachmentStatus(jobId: string, user: UserContext): Promise<ImportAttachmentStatusDto> {
    const job = this.getOwned(jobId, user);
    const referenced = new Map<string, string>();
    for (const r of job.rows) {
      if (r.status !== 'Valid' || !r.attachmentFileName?.trim()) continue;
      const key = r.attachmentFileName.trim().toLowerCase();
      if (!referenced.has(key)) referenced.set(key, r.attachmentFileName.trim());
    }

    let dmsNames = new Set<string>();
    let dmsError: string | null = null;
    if (job.requiresAttachment && this.dms && job.dmsFolderId !== null) {
      try {
        dmsNames = new Set(
          (await this.dms.listFolder(job.dmsFolderId)).map((f) =>
            (f.originalFileName ?? '').trim().toLowerCase(),
          ),
        );
      } catch (err) {
        dmsError = `ตรวจรายการไฟล์ในโฟลเดอร์ปลายทาง DMS ไม่สำเร็จ: ${(err as Error).message}`;
      }
    }

    let staged = 0;
    let inDms = 0;
    const missing: string[] = [];
    for (const [key, name] of referenced) {
      const s = (await job.stage.lookup(name)).ok;
      if (s) staged++;
      if (dmsNames.has(key)) inDms++;
      if (!s && !dmsNames.has(key)) missing.push(name);
    }
    return { referenced: referenced.size, staged, inDms, missing: missing.sort(), dmsError };
  }

  /** ยกเลิก: งานที่ยังไม่รัน = ทิ้งงาน · งานที่กำลังรัน = หยุดก่อนแถวถัดไป (แถวที่เหลือเป็น Skip) */
  cancel(jobId: string, user: UserContext): Promise<ImportJobDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'CANCEL_KB_IMPORT', recordId: jobId },
      async () => {
        const job = this.getOwned(jobId, user);
        if (job.status === 'Running') {
          job.cancelRequested = true;
          return toJobDto(job);
        }
        if (job.status === 'Validated') {
          const dto = toJobDto(job);
          await this.registry.remove(job.id);
          return { ...dto, status: 'Cancelled' };
        }
        throw new ConflictBusinessException('งานนี้จบไปแล้ว', 'IMPORT_ALREADY_FINISHED');
      },
    );
  }

  /** ลบงานที่ไม่ได้รันอยู่ออกจากทะเบียน (พร้อมไฟล์ชั่วคราว) */
  async remove(jobId: string, user: UserContext): Promise<void> {
    const job = this.getOwned(jobId, user);
    if (job.status === 'Running')
      throw new ConflictBusinessException('งานกำลังนำเข้าอยู่ — ใช้ยกเลิกก่อน', 'IMPORT_RUNNING');
    await this.registry.remove(job.id);
  }

  // ── ภายใน ───────────────────────────────────────────────────

  /** งานของตัวเอง (Admin ดูได้ทุกงาน) — ไม่พบ/ไม่ใช่ของตัวเองตอบ 404 เหมือนกัน (ไม่เปิดเผยว่ามีงานของคนอื่น) */
  private getOwned(jobId: string, user: UserContext): ImportJob {
    const job = this.registry.get(jobId);
    if (!job || (job.ownerUserId !== user.userId && user.appRole < AppRole.Admin))
      throw new ResourceNotFoundException('งานนำเข้า', jobId);
    return job;
  }

  /** โฟลเดอร์ DMS ปลายทาง: ค่าที่ส่งมา > ค่าตั้งระบบ · ต้องมีอยู่จริง ไม่ถูกลบ และผู้ใช้เพิ่มไฟล์ได้ */
  private async resolveFolder(requested: number | undefined, user: UserContext): Promise<number> {
    const folderId =
      requested ?? (await this.config.getNumber(KMS_CONFIG_KEY.importAttachmentFolderId, 0)) ?? 0;
    if (!(folderId > 0))
      throw new BusinessException(
        `Template นี้ map ไฟล์แนบ — ต้องระบุ dmsFolderId หรือตั้งค่าระบบ ${KMS_CONFIG_KEY.importAttachmentFolderId}`,
        'IMPORT_DMS_FOLDER_REQUIRED',
      );
    const rows: {
      ConfidentialityLevel: number;
      IsDeleted: boolean | null;
      IsArchived: boolean | null;
    }[] = await this.ds.query(
      'SELECT ConfidentialityLevel, IsDeleted, IsArchived FROM storage.Folder WHERE FolderID = @0',
      [folderId],
    );
    if (rows.length === 0 || rows[0].IsDeleted)
      throw new BusinessException(
        `ไม่พบโฟลเดอร์ปลายทางใน DMS (FolderID ${folderId})`,
        'DMS_FOLDER_NOT_FOUND',
      );
    if (rows[0].IsArchived)
      throw new BusinessException('โฟลเดอร์ปลายทางใน DMS ถูก Archive แล้ว', 'DMS_FOLDER_ARCHIVED');
    await this.perm.assertCanAdd(user, folderId, Number(rows[0].ConfidentialityLevel));
    return folderId;
  }

  private withParseLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.parseLock.then(fn, fn);
    this.parseLock = next.catch(() => undefined);
    return next;
  }
}

/** ปล่อยข้อความหนัก (เนื้อหา/สรุป) หลังงานจบ — เก็บเฉพาะข้อมูลสำหรับแสดงผลรายแถว */
function slimRows(rows: KbImportRow[]): void {
  for (const r of rows) {
    r.rawContent = null;
    r.rawSummary = null;
    r.rawTitle = null;
    r.rawTitleCategory = null;
    r.summary = null;
    r.titleCategory = null;
    r.rawLawReference = null;
  }
}

function toJobDto(job: ImportJob): ImportJobDto {
  const { done, total } = job.progress;
  return {
    importId: job.id,
    status: job.status,
    fileName: job.fileName,
    templateId: job.templateId,
    templateName: job.templateName,
    layoutType: job.layoutType,
    articleType: job.articleType,
    requiresAttachment: job.requiresAttachment,
    dmsFolderId: job.dmsFolderId,
    createdBy: job.ownerName,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: {
      done,
      total,
      percent:
        job.status === 'Completed'
          ? 100
          : total === 0
            ? 0
            : Math.min(100, Math.floor((done * 100) / total)),
    },
    validation: job.counts,
    missingCategories: job.missingCategories.map((m) => ({
      categoryCode: m.categoryCode,
      parentCategoryCode: m.parentCategoryCode ?? null,
      parentCategoryName: m.parentCategoryName ?? null,
      rowCount: m.rowCount,
    })),
    result: job.result,
    errorMessage: job.errorMessage,
    stagedFiles: { count: job.stage.count },
    rejectedFiles: job.rejectedFiles.length > 0 ? job.rejectedFiles : undefined,
  };
}

function toRowDto(r: KbImportRow): ImportRowDto {
  return {
    rowNumber: r.rowNumber,
    codeIndex: r.codeIndex,
    codeCount: r.codeCount,
    status: r.status,
    statusNote: r.statusNote,
    articleCode: r.articleCode ?? r.colA,
    title: r.title,
    resolvedCategoryId: r.resolvedCategoryId,
    resolvedCategoryName: r.resolvedCategoryName,
    documentTypeCode: r.documentTypeCode,
    documentTypeLabel: r.documentTypeLabel,
    willUpdate: r.existingArticleId > 0,
    existingArticleId: r.existingArticleId,
    importedArticleId: r.importedArticleId,
    attachmentFileName: r.attachmentFileName,
    uploadedFileId: r.uploadedFileId,
    missingCategory: r.missingCategory
      ? {
          categoryCode: r.missingCategory.categoryCode,
          parentCategoryCode: r.missingCategory.parentCategoryCode ?? null,
          parentCategoryName: r.missingCategory.parentCategoryName ?? null,
        }
      : null,
  };
}
