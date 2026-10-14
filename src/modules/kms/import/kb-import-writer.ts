import { Logger } from '@nestjs/common';
import type { UserContext } from '../../../common/interfaces/user-context';
import type { DmsFilePort } from '../../dms/ports/dms-file.port';
import { KB_STATUS } from '../kms.constants';
import { isNonLawCodeFormat, KbLayout } from '../codes/kb-layout';
import { buildImportPatch, getUpdateColumns } from './kb-import-patch';
import type { KbImportRow } from './kb-import-row';
import type { ExistingArticleResult, KbImportStore } from './kb-import.store';
import type { RowFile, SharedFileCache } from './kb-shared-file-cache';
import { convertPlainTextToHtml, truncate } from './kb-text';

/** ค่าคงที่ตอน insert จาก import (ระบบเดิม): สถานะ Review และ ConfidentialityLevel = 0 */
const FIXED_STATUS = KB_STATUS.review;
const FIXED_CONFIDENTIALITY_LEVEL = 0;

export interface ImportRunOptions {
  user: UserContext;
  /** ArticleType ที่ Template ตั้งไว้ (1-5) — ใช้กับทุกแถวใน batch */
  articleType: number;
  /** ไฟล์แนบ (ต้องมีเมื่อ Template map Attachment) */
  files: SharedFileCache;
  /** ใช้ลบไฟล์ที่เพิ่งอัปโหลดแต่ผูกบทความไม่สำเร็จ */
  dms: DmsFilePort | null;
  onProgress?: (done: number, total: number) => void;
  /** true = หยุดก่อนแถวถัดไป (ผู้ใช้ยกเลิกงาน) */
  shouldStop?: () => boolean;
}

export interface ImportRunSummary {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  warned: number;
  failed: number;
  cancelled: number;
}

const logger = new Logger('KmsImportWriter');

/**
 * นำเข้าแถวที่ผ่านการตรวจ (status = Valid) — พอร์ตจาก KBImportProcessor.InsertArticles
 * แต่ละแถวล้มเหลวแยกกัน (บันทึกลงแถวเป็น Error แล้วทำต่อ) · งานของแต่ละแถวอยู่ใน transaction เดียว (ในชั้น store) ต่างจากระบบเดิมที่เขียนทีละคำสั่ง
 *
 * ไฟล์แนบ: หา/อัปโหลดเข้า DMS "ก่อน" สร้างบทความ — บทความใหม่ที่ไม่ได้ไฟล์ไม่ถูกสร้าง (skipRowOnDownloadFailure = true ตามระบบเดิม)
 * บทความเดิมที่ยังไม่มีไฟล์และหาไฟล์ไม่ได้ = Skip ทั้งแถว (ยังไม่ update อะไร)
 */
export async function runImport(
  rows: KbImportRow[],
  store: KbImportStore,
  opts: ImportRunOptions,
): Promise<ImportRunSummary> {
  const summary: ImportRunSummary = {
    total: rows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    warned: 0,
    failed: 0,
    cancelled: 0,
  };
  if (!(opts.articleType >= 1 && opts.articleType <= 5))
    throw new Error(
      'articleType ต้องอยู่ระหว่าง 1-5 — Template ที่เลือกยังไม่ได้ตั้งค่า ArticleType',
    );

  const createdBy = opts.user.adUserName || 'system';
  const ctx: Ctx = { store, opts, createdBy };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (opts.shouldStop?.()) {
      for (let j = i; j < rows.length; j++) {
        rows[j].status = 'Skip';
        rows[j].statusNote = 'ยกเลิกการนำเข้าก่อนถึงแถวนี้';
        summary.cancelled++;
      }
      opts.onProgress?.(rows.length, rows.length);
      break;
    }

    const wasExisting = row.existingArticleId > 0;
    try {
      await processRow(row, ctx);
      if (row.status === 'Skip') summary.skipped++;
      else {
        if (wasExisting) summary.updated++;
        else summary.inserted++;
        if (row.status === 'Warn') summary.warned++;
      }
    } catch (err) {
      row.status = 'Error';
      row.statusNote = truncate((err as Error).message, 200);
      summary.failed++;
      logger.warn(
        `แถว ${row.rowNumber} (${row.articleCode ?? '-'}) นำเข้าไม่สำเร็จ: ${(err as Error).message}`,
      );
    }

    opts.onProgress?.(i + 1, rows.length);
  }

  return summary;
}

interface Ctx {
  store: KbImportStore;
  opts: ImportRunOptions;
  createdBy: string;
}

async function processRow(row: KbImportRow, ctx: Ctx): Promise<void> {
  const isNonLaw = row.rowKind === 'NonLaw';
  if (!row.articleCode)
    throw new Error(
      isNonLaw
        ? 'Code รวม (ArticleCode ที่ Template map ไว้) ว่าง'
        : 'คอลัมน์ A (ArticleCode) ว่าง',
    );
  if (row.rowKind !== 'Law' && row.rowKind !== 'NonLaw')
    throw new Error(`ไม่รู้จัก RowKind '${String(row.rowKind)}'`);

  if (row.existingArticleId > 0) return updateExisting(row, ctx);
  return insertNew(row, ctx);
}

const unresolvedParents = (row: KbImportRow): string[] =>
  row.parentCodes.filter((_c, i) => !(row.resolvedParentArticleIds[i] > 0));

const resolvedParentIds = (row: KbImportRow): number[] =>
  row.resolvedParentArticleIds.filter((id) => id > 0);

async function insertNew(row: KbImportRow, ctx: Ctx): Promise<void> {
  const { store, opts, createdBy } = ctx;
  const isNonLaw = row.rowKind === 'NonLaw';
  const code = row.articleCode as string;

  // ตรวจซ้ำ — DB อาจเปลี่ยนไปหลัง validate (เพิ่งมีคนสร้าง Code นี้)
  const dup = await store.findArticlesByCodes([code]);
  if (dup.has(code.toLowerCase())) throw new Error(`ArticleCode '${code}' มีอยู่ในระบบแล้ว`);

  if (isNonLaw && !isNonLawCodeFormat(code))
    throw new Error(`${KbLayout.NonLawCodeFormatMessage} — '${code}'`);
  if (row.resolvedCategoryId <= 0)
    throw new Error('ไม่พบหมวด (CategoryID) ของแถวนี้ — ต้องผ่านการ validate ก่อน insert');

  // ไฟล์แนบ: NonLaw ต้องมีเสมอ · Law/Decree เฉพาะ Template ที่ map Attachment (attachmentFileName != null)
  let rowFile: RowFile | null = null;
  let fileId: number | null = null;
  if (isNonLaw || row.attachmentFileName !== null) {
    rowFile = await opts.files.for(row.attachmentFileName);
    if (!rowFile.ok) throw new Error(rowFile.error ?? 'ไม่พบไฟล์แนบ');
    fileId = await opts.files.ensureUploaded(rowFile);
    if (fileId === null)
      throw new Error(`อัปโหลดไฟล์แนบไม่สำเร็จ: ${rowFile.uploadError ?? 'ไม่ทราบสาเหตุ'}`);
  }

  const contentHtml = convertPlainTextToHtml(row.rawContent);
  let result;
  try {
    result = await store.insertArticle({
      article: {
        articleCode: code,
        title: row.title ?? '',
        contentHtml,
        summary: row.summary,
        titleCategory: row.titleCategory,
        categoryId: row.resolvedCategoryId,
        articleType: opts.articleType,
        status: FIXED_STATUS,
        publishedDate: row.publishedDateParsed,
        effectiveDate: row.effectiveDateParsed,
        tags: row.tags,
        confidentialityLevel: FIXED_CONFIDENTIALITY_LEVEL,
        createdBy,
      },
      // Law/Decree เก็บ version 1 · NonLaw ไม่มี version (ตามระบบเดิม)
      initialVersion: isNonLaw ? null : { contentSnapshot: contentHtml, createdBy },
      parentArticleIds: resolvedParentIds(row),
      fileId,
      createdBy,
    });
  } catch (err) {
    await discardFreshUpload(rowFile, ctx);
    throw err;
  }

  if (rowFile) rowFile.boundCount++;
  row.importedArticleId = result.articleId;
  row.uploadedFileId = fileId;

  const notes = unresolvedParents(row).map((c) => `ข้ามลิงก์ '${c}' (ไม่พบกฎหมายแม่ในระบบ)`);
  row.status = notes.length > 0 ? 'Warn' : 'Valid';
  row.statusNote = notes.length > 0 ? truncate(notes.join('; ')) : '';
}

async function updateExisting(row: KbImportRow, ctx: Ctx): Promise<void> {
  const { store, opts, createdBy } = ctx;
  const isLaw = row.rowKind === 'Law';
  const articleId = row.existingArticleId;
  row.importedArticleId = articleId;

  // ไฟล์แนบ: Law/Decree เฉพาะ Template ที่ map Attachment · NonLaw ตรวจเสมอ
  //  - มี t_KBArticleAttachment แล้ว → ไม่แตะไฟล์ (ไม่ดาวน์โหลด/อัปโหลดซ้ำ) เติมเฉพาะ link ไฟล์ที่ขาด
  //  - ยังไม่มี → ต้องได้ไฟล์ (ไม่ได้ = Skip แถวนี้ ยังไม่ update อะไร) แล้วผูก
  let attachFileId: number | null = null;
  let repairFileLinks = false;
  let rowFile: RowFile | null = null;
  if (!isLaw || row.attachmentFileName !== null) {
    const attachments = await store.getAttachmentFileIds(articleId);
    if (attachments.length === 0) {
      rowFile = await opts.files.for(row.attachmentFileName);
      if (!rowFile.ok) {
        row.status = 'Skip';
        row.statusNote = truncate(
          `ArticleCode '${row.articleCode}' (ArticleID ${articleId}) มีในระบบแล้วแต่ยังไม่มีไฟล์แนบ — ข้าม: ${rowFile.error}`,
        );
        return;
      }
      attachFileId = await opts.files.ensureUploaded(rowFile);
      if (attachFileId === null)
        throw new Error(`อัปโหลดไฟล์แนบไม่สำเร็จ: ${rowFile.uploadError ?? 'ไม่ทราบสาเหตุ'}`);
    } else {
      repairFileLinks = true;
    }
  }

  const columns = getUpdateColumns(row, isLaw);
  let result: ExistingArticleResult;
  try {
    result = await store.updateArticleFromImport({
      articleId,
      patch: buildImportPatch(row, opts.articleType),
      columns,
      updatedBy: 'system', // ระบบเดิมตั้ง UpdatedBy = 'system' ทุกครั้งที่ import อัปเดตบทความเดิม
      versioning:
        isLaw && columns.includes('ContentHTML')
          ? { createdBy, changeDescription: 'แก้ไขจาก Excel import' }
          : null,
      parentArticleIds: resolvedParentIds(row),
      repairFileLinks,
      attachFileId,
      createdBy,
    });
  } catch (err) {
    await discardFreshUpload(rowFile, ctx);
    throw err;
  }

  if (rowFile && attachFileId !== null) {
    rowFile.boundCount++;
    row.uploadedFileId = attachFileId;
  }

  const added: string[] = [];
  if (result.attached) added.push('ไฟล์แนบ');
  if (result.fileLinksRepaired > 0) added.push(`link ไฟล์ ${result.fileLinksRepaired} รายการ`);
  if (result.parentLinksInserted > 0)
    added.push(
      `${row.rawLawReference !== null ? 'link กฎหมายอ้างอิง' : 'link กฎหมายแม่'} ${result.parentLinksInserted} รายการ`,
    );

  let summary = `อัปเดตแล้ว: ${columns.join(', ')}${result.versionCreated ? ' (เพิ่ม version ใหม่)' : ''}`;
  if (added.length > 0) summary += `; เติม: ${added.join(', ')}`;

  const notes = unresolvedParents(row).map((c) => `ข้ามลิงก์ '${c}' (ไม่พบกฎหมายแม่ในระบบ)`);
  row.status = notes.length > 0 ? 'Warn' : 'Valid';
  row.statusNote = truncate(notes.length > 0 ? `${summary}; ${notes.join('; ')}` : summary);
}

/**
 * ไฟล์ที่เพิ่งอัปโหลดใน batch นี้แต่บทความที่จะผูกสร้าง/อัปเดตไม่สำเร็จ → ลบออกจาก DMS (ไม่ทิ้งไฟล์ค้าง) และล้างผลใน cache
 * ห้ามลบไฟล์ที่ใช้ร่วม: ใช้ FileID ที่มีใน DMS อยู่แล้ว (reusedExisting) หรือผูกกับบทความอื่นใน batch นี้แล้ว (boundCount > 0)
 */
async function discardFreshUpload(rowFile: RowFile | null, ctx: Ctx): Promise<void> {
  if (!rowFile || rowFile.fileId === null || rowFile.reusedExisting || rowFile.boundCount > 0)
    return;
  const dms = ctx.opts.dms;
  if (!dms) return;
  try {
    await dms.remove(ctx.opts.user, rowFile.fileId);
    ctx.opts.files.resetUpload(rowFile);
  } catch (err) {
    // ลบไม่ได้ → ไฟล์ค้างใน DMS (แถวถัดไปที่ใช้ชื่อเดียวกันจะใช้ FileID นี้ต่อ ไม่อัปโหลดซ้ำ)
    logger.warn(
      `ลบไฟล์ที่อัปโหลดแล้วผูกบทความไม่สำเร็จไม่ได้ (FileID ${rowFile.fileId}): ${(err as Error).message}`,
    );
  }
}
