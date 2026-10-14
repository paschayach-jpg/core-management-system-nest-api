import { KbLayoutType, describeFileKind } from '../codes/kb-layout';
import type { KbMissingCategory } from '../codes/kb-category-resolver';
import {
  getTemplateProblems,
  hasAttachmentMapping,
  resolveArticleType,
  resolveTemplateLayout,
} from '../import-templates/kb-template-rules';
import type { ExcelGrid } from './kb-excel-grid';
import { KbExcelReadError, readImportRows } from './kb-excel-reader';
import { validateImportRows } from './kb-import-validator';
import type { KbImportRow, TemplateColumnRow } from './kb-import-row';
import type { KbImportStore } from './kb-import.store';

export interface TemplateLayoutInfo {
  templateName: string;
  layout: KbLayoutType | null;
}

export interface ImportRowCounts {
  total: number;
  /** แถวที่จะสร้างบทความใหม่ */
  newCount: number;
  /** แถวที่ ArticleCode มีอยู่แล้ว → จะอัปเดตบทความเดิม */
  updateCount: number;
  skipCount: number;
  errorCount: number;
}

export interface MissingCategorySummary extends KbMissingCategory {
  /** จำนวนแถวที่ต้องใช้หมวดนี้ */
  rowCount: number;
}

export type PrepareResult =
  | {
      ok: true;
      rows: KbImportRow[];
      fileLayout: KbLayoutType;
      templateLayout: KbLayoutType;
      articleType: number;
      requiresAttachment: boolean;
      counts: ImportRowCounts;
      missingCategories: MissingCategorySummary[];
    }
  | { ok: false; code: string; message: string; details?: unknown };

/**
 * ข้อความเมื่อชนิดไฟล์ที่ upload (กฎหมาย / พระราชกฤษฎีกา / ที่ไม่ใช่กฎหมาย) ไม่ตรงกับประเภทไฟล์ของ Template ที่เลือก
 * — บอกทั้งสองฝั่งและแนะนำ Template ที่ใช้งานอยู่ซึ่งตรงกับไฟล์ (ข้อความตามระบบเดิม)
 */
export function buildLayoutMismatchMessage(
  selectedTemplateName: string,
  fileLayout: string,
  templateLayout: string,
  matchingTemplateNames: string[],
): string {
  const fileKind = describeFileKind(fileLayout);
  const templateKind = describeFileKind(templateLayout);
  const message = `ไฟล์ที่ upload เป็นรูปแบบ ${fileKind} แต่ Template "${selectedTemplateName}" เป็นประเภท ${templateKind}`;
  if (matchingTemplateNames.length > 0)
    return `${message}\n\nTemplate ที่ตรงกับไฟล์นี้: ${matchingTemplateNames.join(', ')}\nกรุณาเลือก Template ให้ถูกต้อง`;
  return `${message}\n\nยังไม่มี Template ประเภท${fileKind}ที่ใช้งานอยู่ — กรุณาสร้างที่หน้า config template ก่อน`;
}

/** สรุปจำนวนแถวตามสถานะหลังตรวจ */
export function countRows(rows: KbImportRow[]): ImportRowCounts {
  const c: ImportRowCounts = {
    total: rows.length,
    newCount: 0,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
  };
  for (const r of rows) {
    if (r.status === 'Valid') {
      if (r.existingArticleId > 0) c.updateCount++;
      else c.newCount++;
    } else if (r.status === 'Skip') c.skipCount++;
    else c.errorCount++;
  }
  return c;
}

/** รวมหมวดที่ยังไม่มีใน m_KBCategory ที่แถวต้องใช้ (หมวดเดียวกันรวมเป็นรายการเดียว) */
export function summarizeMissingCategories(rows: KbImportRow[]): MissingCategorySummary[] {
  const map = new Map<string, MissingCategorySummary>();
  for (const r of rows) {
    const m = r.missingCategory;
    if (!m?.categoryCode) continue;
    const key = m.categoryCode.toUpperCase();
    const cur = map.get(key);
    if (cur) cur.rowCount++;
    else map.set(key, { ...m, rowCount: 1 });
  }
  return [...map.values()].sort((a, b) => a.categoryCode.localeCompare(b.categoryCode));
}

const MAX_LISTED_PROBLEMS = 15;

/**
 * ตรวจไฟล์เทียบกับ Template แล้วคืนแถวพร้อมสถานะ (พอร์ตจาก KBImportWizardController.ValidateFile) ตามลำดับ:
 *  0) Template ตั้งค่าครบ (GetTemplateProblems) · ชนิดไฟล์/ArticleType จาก Template
 *  1) อ่านไฟล์ + ตรวจชนิดไฟล์ (Law/Decree/NonLaw) เทียบกับ LayoutType ของ Template — ก่อนตรวจ mapping เพราะถ้าเลือก Template ผิดประเภท
 *     รายการคอลัมน์ที่ขาดจะบดบังสาเหตุจริง
 *  2) mapping ของ Template ต้องชี้คอลัมน์/หัวตารางที่มีในไฟล์
 *  3) ตรวจรายแถว (หมวดจาก ArticleCode, ซ้ำ, มีอยู่แล้ว, วันที่, ฯลฯ)
 * ไม่เขียน DB · ไม่โยน exception สำหรับความผิดของผู้ใช้ (คืน ok:false พร้อม code/ข้อความไทย)
 */
export async function prepareImport(args: {
  grid: ExcelGrid;
  templateName: string;
  templateColumns: TemplateColumnRow[];
  store: KbImportStore;
  /** โหลดประเภทไฟล์ของ Template ที่ใช้งานอยู่ทั้งหมด (เรียกเฉพาะเมื่อชนิดไม่ตรงเพื่อแนะนำ Template) */
  loadActiveTemplateLayouts?: () => Promise<TemplateLayoutInfo[]>;
}): Promise<PrepareResult> {
  const { grid, templateName, templateColumns, store } = args;

  const problems = getTemplateProblems(templateColumns);
  if (problems.length > 0)
    return {
      ok: false,
      code: 'TEMPLATE_INCOMPLETE',
      message: `Template "${templateName}" ตั้งค่ายังไม่ครบ กรุณาแก้ที่หน้า config template ก่อน:\n• ${problems.join('\n• ')}`,
      details: { problems },
    };

  const templateLayout = resolveTemplateLayout(templateColumns) as KbLayoutType;
  const articleType = resolveArticleType(templateColumns) as number;

  let read;
  try {
    read = readImportRows(grid, templateColumns);
  } catch (err) {
    if (err instanceof KbExcelReadError)
      return {
        ok: false,
        code: 'EXCEL_READ_FAILED',
        message: `ไม่สามารถเปิดไฟล์ Excel ได้:\n${err.message}`,
      };
    throw err;
  }

  if (read.rows.length === 0 || read.detectedLayout === null)
    return {
      ok: false,
      code: 'IMPORT_NO_ROWS',
      message: 'ไฟล์ Excel ไม่มีแถวข้อมูล (ข้อมูลเริ่มที่แถว 2 ของ sheet แรก)',
    };

  if (read.detectedLayout !== templateLayout) {
    let matching: string[] = [];
    try {
      matching =
        (await args.loadActiveTemplateLayouts?.())
          ?.filter((t) => t.layout === read.detectedLayout)
          .map((t) => t.templateName) ?? [];
    } catch {
      matching = []; // การหา Template แนะนำล้มเหลวไม่บดบังข้อความหลัก
    }
    return {
      ok: false,
      code: 'LAYOUT_MISMATCH',
      message: buildLayoutMismatchMessage(
        templateName,
        read.detectedLayout,
        templateLayout,
        matching,
      ),
      details: { fileLayout: read.detectedLayout, templateLayout, matchingTemplates: matching },
    };
  }

  if (read.mappingProblems.length > 0) {
    const listed = read.mappingProblems.slice(0, MAX_LISTED_PROBLEMS);
    const more =
      read.mappingProblems.length > MAX_LISTED_PROBLEMS
        ? `\n… และอีก ${read.mappingProblems.length - MAX_LISTED_PROBLEMS} รายการ`
        : '';
    return {
      ok: false,
      code: 'MAPPING_MISMATCH',
      message: `ไฟล์ที่อัปโหลดไม่ตรงกับ Template "${templateName}" — Template map คอลัมน์ที่ไม่มีในไฟล์:\n• ${listed.join('\n• ')}${more}\n\nกรุณาเลือก Template ให้ตรงกับไฟล์ หรือแก้ Template ที่หน้า config`,
      details: { mappingProblems: read.mappingProblems },
    };
  }

  await validateImportRows(read.rows, store);

  return {
    ok: true,
    rows: read.rows,
    fileLayout: read.detectedLayout,
    templateLayout,
    articleType,
    requiresAttachment: hasAttachmentMapping(templateColumns),
    counts: countRows(read.rows),
    missingCategories: summarizeMissingCategories(read.rows),
  };
}
