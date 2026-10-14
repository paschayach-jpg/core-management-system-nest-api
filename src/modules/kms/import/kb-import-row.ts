import type { KbMissingCategory } from '../codes/kb-category-resolver';
import type { KbLayoutType } from '../codes/kb-layout';

export type KbImportStatus = 'Valid' | 'Skip' | 'Warn' | 'Error';

/** แถวแมปคอลัมน์ของ Template (KBImportTemplateColumnRow) */
export interface TemplateColumnRow {
  targetColumnName: string;
  /** ตัวอักษรคอลัมน์ ("C") · หัวตาราง · นิพจน์ "{A}" · หรือค่าคงที่ของแถวเสมือน (LayoutType/ArticleType) */
  excelColumnRef: string | null;
  displayOrder?: number;
}

/**
 * 1 แถวของไฟล์ Excel พร้อมสถานะการตรวจ (พอร์ตจาก KBImportRow)
 * ไฟล์พระราชกฤษฎีกามี rowKind = 'Law' เหมือนกฎหมาย (แยกโหมดด้วย rawLawReference != null)
 */
export interface KbImportRow {
  /** เลขแถวใน Excel (เริ่ม 1 · แถวข้อมูลแรก = 2) */
  rowNumber: number;
  /** NonLaw: ลำดับของ Code ในเซลล์ Code รวมเดียวกัน / จำนวน Code ทั้งหมด (1 Code = 1 แถว) */
  codeIndex: number;
  codeCount: number;
  status: KbImportStatus;
  statusNote: string | null;
  rowKind: 'Law' | 'NonLaw';

  /** Code รวม 29 หลักจาก mapping ArticleCode */
  colA: string | null;

  /** ชื่อไฟล์แนบจากเซลล์ · null = Template ไม่ได้ map Attachment (ไม่มีขั้นไฟล์แนบ) */
  attachmentFileName: string | null;
  attachmentUrl: string | null;
  /** Code กฎหมายแม่ (24 ตัว) ที่ต้อง link ไป-กลับ */
  parentCodes: string[];
  /** ArticleID ของ parentCodes แต่ละตัว (0 = ไม่พบ) */
  resolvedParentArticleIds: number[];
  /** ข้อความดิบของ "Code กฎหมายอ้างอิง" · null = ไม่ใช่โหมดพระราชกฤษฎีกา */
  rawLawReference: string | null;

  rawTitle: string | null;
  rawTitleCategory: string | null;
  rawSummary: string | null;
  rawContent: string | null;
  rawPublishedDate: string | null;
  rawEffectiveDate: string | null;
  publishedDateParsed: Date | null;
  effectiveDateParsed: Date | null;

  // ── ค่าที่คำนวณ/ตรวจแล้ว (ตั้งโดย validator) ──
  /** Law/Decree: 24 ตัวแรก · NonLaw: 29 ตัว */
  articleCode: string | null;
  title: string | null;
  tags: string | null;
  summary: string | null;
  titleCategory: string | null;
  resolvedCategoryId: number;
  resolvedCategoryName: string | null;
  missingCategory: KbMissingCategory | null;
  documentTypeLabel: string | null;
  documentTypeCode: string | null;
  /** ArticleID ที่มี ArticleCode นี้อยู่แล้ว (0 = จะ insert ใหม่) */
  existingArticleId: number;

  // ── ผลตอน import ──
  importedArticleId: number;
  uploadedFileId: number | null;
}

export function newImportRow(rowNumber: number, rowKind: 'Law' | 'NonLaw'): KbImportRow {
  return {
    rowNumber,
    codeIndex: 1,
    codeCount: 1,
    status: 'Valid',
    statusNote: null,
    rowKind,
    colA: null,
    attachmentFileName: null,
    attachmentUrl: null,
    parentCodes: [],
    resolvedParentArticleIds: [],
    rawLawReference: null,
    rawTitle: null,
    rawTitleCategory: null,
    rawSummary: null,
    rawContent: null,
    rawPublishedDate: null,
    rawEffectiveDate: null,
    publishedDateParsed: null,
    effectiveDateParsed: null,
    articleCode: null,
    title: null,
    tags: null,
    summary: null,
    titleCategory: null,
    resolvedCategoryId: 0,
    resolvedCategoryName: null,
    missingCategory: null,
    documentTypeLabel: null,
    documentTypeCode: null,
    existingArticleId: 0,
    importedArticleId: 0,
    uploadedFileId: null,
  };
}

/** สำเนาตื้น (list สร้างใหม่) — ใช้แตก 1 แถว Excel เป็นหลาย ArticleCode */
export function cloneImportRow(row: KbImportRow): KbImportRow {
  return {
    ...row,
    parentCodes: [...row.parentCodes],
    resolvedParentArticleIds: [...row.resolvedParentArticleIds],
  };
}

export interface KbExcelReadResult {
  rows: KbImportRow[];
  /** ชนิดไฟล์ที่ตรวจพบจาก Code รวม · null เมื่อไฟล์ไม่มีแถวข้อมูล */
  detectedLayout: KbLayoutType | null;
  /** mapping ของ Template ที่ชี้ไปคอลัมน์/หัวตารางที่ไม่มีในไฟล์ */
  mappingProblems: string[];
}
