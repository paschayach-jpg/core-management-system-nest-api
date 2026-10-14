import { KbArticleColumn } from '../import-templates/kb-column-catalog';
import { KbLayout, KbLayoutType, detectLayoutFromCode } from '../codes/kb-layout';
import { tryParseDateText, fromExcelDate } from './kb-dates';
import { ExcelGrid, GridCell } from './kb-excel-grid';
import {
  KbExcelReadResult,
  KbImportRow,
  TemplateColumnRow,
  cloneImportRow,
  newImportRow,
} from './kb-import-row';
import { truncate } from './kb-text';

/** ไฟล์อ่านต่อไม่ได้ (Code รวมผิดรูปแบบ/ไม่มี mapping ArticleCode) — service แปลงเป็น 422 */
export class KbExcelReadError extends Error {}

type Row = GridCell[] | null | undefined;

const DATA_START_ROW_INDEX = 1; // แถว 2 ใน Excel

/** target column ที่ Template mapping ทับค่าตำแหน่งตายตัวได้ (ไม่รวม CategoryID/ArticleType) */
const OVERRIDABLE_TARGET_COLUMNS = [
  KbArticleColumn.ArticleCode,
  KbArticleColumn.Title,
  KbArticleColumn.TitleCategory,
  KbArticleColumn.Summary,
  KbArticleColumn.ContentHTML,
  KbArticleColumn.PublishedDate,
  KbArticleColumn.EffectiveDate,
  KbArticleColumn.Attachment,
  KbArticleColumn.LawReference,
] as const;

const PLACEHOLDER = /\{([^{}]+)\}/g;

// ── ตัวช่วยอ่านเซลล์ ─────────────────────────────────────────────────

const cellAt = (row: Row, index: number): GridCell | undefined =>
  row && index >= 0 ? row[index] : undefined;

const cellText = (cell: GridCell | undefined): string => cell?.text ?? '';

/** แปลงตัวอักษรคอลัมน์ ("A".."Z","AA") เป็น index เริ่ม 0 · -1 ถ้าไม่ใช่ตัวอักษรล้วน */
export function columnLetterToIndex(letters: string): number {
  if (!letters) return -1;
  let result = 0;
  for (const c of letters.toUpperCase()) {
    if (c < 'A' || c > 'Z') return -1;
    result = result * 26 + (c.charCodeAt(0) - 64);
  }
  return result - 1;
}

export function columnIndexToLetters(index: number): string {
  let dividend = index + 1;
  let name = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return name;
}

/** หา column index จากข้อความหัวตาราง (ไม่สนตัวพิมพ์เล็ก-ใหญ่) · -1 ถ้าไม่พบ */
function findColumnIndexByHeaderText(headerRow: Row, headerText: string): number {
  if (!headerRow || !headerText || !headerText.trim()) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const text = cellText(headerRow[c]).trim();
    if (text && text.toLowerCase() === headerText.toLowerCase()) return c;
  }
  return -1;
}

function resolveColumnIndex(colRef: string, headerRow: Row): number {
  const letterIndex = columnLetterToIndex(colRef);
  const headerWidth = headerRow ? headerRow.length : 0;

  // ตัวอักษรคอลัมน์ที่อยู่ในความกว้างของแถวหัวตาราง → ใช้ตามนั้น
  if (letterIndex >= 0 && letterIndex < headerWidth) return letterIndex;

  // ข้อความล้วนตัวอักษรอาจเป็นหัวตารางภาษาอังกฤษ (เช่น "Summary") — ลองจับคู่หัวตารางก่อน
  const headerIndex = findColumnIndexByHeaderText(headerRow, colRef);
  if (headerIndex >= 0) return headerIndex;

  // ไม่เจอหัวตาราง: คงพฤติกรรมเดิม (ตัวอักษรที่เกินความกว้างหัวตารางอาจยังมีข้อมูลอยู่ใต้หัวตารางที่ว่าง)
  return letterIndex;
}

function resolveColumnRef(
  colRef: string,
  headerRow: Row,
  dataRow: Row,
  preserveWhitespace: boolean,
): string {
  const index = resolveColumnIndex(colRef, headerRow);
  if (index < 0) return '';
  const text = cellText(cellAt(dataRow, index));
  return preserveWhitespace ? text : text.trim();
}

/** ตัวเลขล้วน (ไม่นับช่องว่างหัวท้าย) แปลงผ่าน int แล้วกลับเป็นข้อความ (ตัดเลขศูนย์นำหน้า) ไม่งั้นคืนค่าเดิม */
function normalizeNumericToken(raw: string): string {
  if (!raw) return raw;
  const probe = raw.trim();
  if (/^\d+$/.test(probe)) {
    const n = Number(probe);
    if (n <= 2147483647) return String(n);
  }
  return raw;
}

/**
 * ค่าของ ExcelColumnRef หนึ่งช่อง — ถ้ามี {ชื่อคอลัมน์} ผสมอยู่จะแทน token ด้วยค่าของคอลัมน์นั้นในแถวเดียวกัน
 * (ตัวเลขล้วนถูก normalize เช่น "0001"→"1") · ถ้าไม่มี {} เลย ทั้งสตริงคือ column ref เดียวและคืน raw text (ไม่ normalize)
 * preserveWhitespace=true (Title/TitleCategory/Summary/ContentHTML) ไม่ trim ค่าที่อ่านจากเซลล์
 */
export function resolveTemplateExpression(
  expression: string | null | undefined,
  headerRow: Row,
  dataRow: Row,
  preserveWhitespace = false,
): string {
  if (!expression || !expression.trim()) return '';
  if (!expression.includes('{'))
    return resolveColumnRef(expression.trim(), headerRow, dataRow, preserveWhitespace);

  return expression.replace(PLACEHOLDER, (_m, name: string) =>
    normalizeNumericToken(resolveColumnRef(name.trim(), headerRow, dataRow, preserveWhitespace)),
  );
}

/** แตกเซลล์หลายบรรทัด (Alt+Enter) เป็นรายการ ตัดช่องว่างแต่ละบรรทัด */
export function splitLines(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/\r\n|\n|\r/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const firstLine = (raw: string | null | undefined) => splitLines(raw)[0] ?? '';

function isRowBlank(row: Row): boolean {
  if (!row) return true;
  for (const cell of row) if (cell && cell.text.trim().length > 0) return false;
  return true;
}

/** วันที่จากเซลล์: วันที่ native → ใช้เลย (แก้ปี พ.ศ.) · อย่างอื่นแปลงจากข้อความ · เซลล์ว่าง = null */
function tryParseDateCell(cell: GridCell | undefined): Date | null {
  if (!cell) return null;
  if (cell.date) return fromExcelDate(cell.date);
  return tryParseDateText(cell.text.trim());
}

// ── Template mapping overrides ───────────────────────────────────────

/** target column → ExcelColumnRef (เฉพาะที่ map แล้วและอยู่ใน OVERRIDABLE_TARGET_COLUMNS) */
function buildFieldOverrides(
  templateColumns: readonly TemplateColumnRow[] | null,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const col of templateColumns ?? []) {
    if (!col || !col.excelColumnRef || !col.excelColumnRef.trim()) continue;
    const name = OVERRIDABLE_TARGET_COLUMNS.find(
      (n) => n.toLowerCase() === col.targetColumnName.toLowerCase(),
    );
    if (name) result.set(name, col.excelColumnRef.trim());
  }
  return result;
}

function applyDateOverride(
  expression: string,
  headerRow: Row,
  dataRow: Row,
): { rawText: string; parsed: Date | null } {
  if (!expression.includes('{')) {
    const colIndex = resolveColumnIndex(expression.trim(), headerRow);
    if (colIndex >= 0) {
      const cell = cellAt(dataRow, colIndex);
      return { rawText: cellText(cell).trim(), parsed: tryParseDateCell(cell) };
    }
  }
  // สูตร (หรือ column ref ที่หาไม่เจอ) — เหลือแค่ข้อความ
  const rawText = resolveTemplateExpression(expression, headerRow, dataRow);
  return { rawText, parsed: tryParseDateText(rawText) };
}

function applyAttachmentOverride(
  expression: string,
  headerRow: Row,
  dataRow: Row,
  row: KbImportRow,
): void {
  if (!expression.includes('{')) {
    const colIndex = resolveColumnIndex(expression.trim(), headerRow);
    if (colIndex >= 0) {
      const cell = cellAt(dataRow, colIndex);
      row.attachmentFileName = cellText(cell).trim();
      row.attachmentUrl = cell?.hyperlink ?? null;
      return;
    }
  }
  row.attachmentFileName = resolveTemplateExpression(expression, headerRow, dataRow).trim();
  row.attachmentUrl = null;
}

function applyFieldOverrides(
  row: KbImportRow,
  dataRow: Row,
  headerRow: Row,
  overrides: Map<string, string>,
): void {
  let expr: string | undefined;

  // ArticleCode (Code รวม 29 หลัก) — แทนคอลัมน์ A ตายตัว
  if ((expr = overrides.get(KbArticleColumn.ArticleCode)) !== undefined)
    row.colA = resolveTemplateExpression(expr, headerRow, dataRow).trim();

  // ไฟล์แนบ (ทุกประเภทไฟล์) — ไม่ map = attachmentFileName เป็น null (ไม่มีขั้นไฟล์แนบ)
  if ((expr = overrides.get(KbArticleColumn.Attachment)) !== undefined)
    applyAttachmentOverride(expr, headerRow, dataRow, row);

  // พระราชกฤษฎีกา (Template ที่ map LawReference): ข้อความหลายบรรทัด หมวด 5 ตัว + มาตรา 24 ตัวต่อบรรทัด
  if (
    row.rowKind === KbLayout.Law &&
    (expr = overrides.get(KbArticleColumn.LawReference)) !== undefined
  )
    row.rawLawReference = resolveTemplateExpression(expr, headerRow, dataRow);

  // Title/TitleCategory/Summary/ContentHTML เป็นข้อความที่ต้องเหมือนต้นฉบับ — ไม่ trim
  if ((expr = overrides.get(KbArticleColumn.Title)) !== undefined)
    row.rawTitle = resolveTemplateExpression(expr, headerRow, dataRow, true);
  if ((expr = overrides.get(KbArticleColumn.TitleCategory)) !== undefined)
    row.rawTitleCategory = resolveTemplateExpression(expr, headerRow, dataRow, true);
  if ((expr = overrides.get(KbArticleColumn.Summary)) !== undefined)
    row.rawSummary = resolveTemplateExpression(expr, headerRow, dataRow, true);
  if ((expr = overrides.get(KbArticleColumn.ContentHTML)) !== undefined)
    row.rawContent = resolveTemplateExpression(expr, headerRow, dataRow, true);

  if ((expr = overrides.get(KbArticleColumn.PublishedDate)) !== undefined) {
    const r = applyDateOverride(expr, headerRow, dataRow);
    row.rawPublishedDate = r.rawText;
    row.publishedDateParsed = r.parsed;
  }
  if ((expr = overrides.get(KbArticleColumn.EffectiveDate)) !== undefined) {
    const r = applyDateOverride(expr, headerRow, dataRow);
    row.rawEffectiveDate = r.rawText;
    row.effectiveDateParsed = r.parsed;
  }
}

// ── อ่านแถวตามชนิดไฟล์ ───────────────────────────────────────────────

/**
 * ไฟล์กฎหมาย/พระราชกฤษฎีกา: ค่าเริ่มต้นตามตำแหน่งตายตัวของไฟล์ "law-matrix" 20 คอลัมน์ (ทับได้ด้วย Template mapping)
 * M=ชื่อ(Summary) N=วันที่ประกาศ O=วันที่มีผลบังคับใช้ P=บัญญัติไว้ว่า(เนื้อหา) S=กฎหมายอ้างอิง(TitleCategory)
 */
function readLawRow(dataRow: Row, rowIdx: number): KbImportRow {
  const row = newImportRow(rowIdx + 1, 'Law');
  row.rawSummary = cellText(cellAt(dataRow, 12)); // M — ไม่ trim
  row.rawPublishedDate = cellText(cellAt(dataRow, 13)).trim(); // N
  row.rawEffectiveDate = cellText(cellAt(dataRow, 14)).trim(); // O
  row.rawContent = cellText(cellAt(dataRow, 15)); // P — ไม่ trim
  row.rawTitleCategory = cellText(cellAt(dataRow, 18)); // S — ไม่ trim
  row.publishedDateParsed = tryParseDateCell(cellAt(dataRow, 13));
  row.effectiveDateParsed = tryParseDateCell(cellAt(dataRow, 14));
  return row;
}

/** ไฟล์ที่ไม่ใช่กฎหมาย: ทุกฟิลด์มาจาก Template mapping เท่านั้น (ไม่มีตำแหน่งตายตัว) */
function readNonLawRow(rowIdx: number): KbImportRow {
  return newImportRow(rowIdx + 1, 'NonLaw');
}

/** NonLaw: เซลล์ Code รวมที่มีหลาย Code แตกเป็น 1 แถวต่อ Code (ฟิลด์อื่นเหมือนกัน) */
function expandArticleCodes(row: KbImportRow): KbImportRow[] {
  const codes = splitLines(row.colA);
  if (codes.length <= 1) return [row];
  return codes.map((code, i) => {
    const copy = cloneImportRow(row);
    copy.colA = code;
    copy.codeIndex = i + 1;
    copy.codeCount = codes.length;
    return copy;
  });
}

// ── ตรวจชนิดไฟล์ ─────────────────────────────────────────────────────

/**
 * ชนิดไฟล์จาก Code รวมของแถวข้อมูลแรกที่ Code ไม่ว่าง (ตาม mapping ArticleCode ของ Template) — ไม่อ่านหัวตารางตามตำแหน่งตายตัว
 * Code ผิดรูปแบบทุกแบบ (หรือไม่มี Code เลยทั้งที่มีข้อมูล) = โยน KbExcelReadError · คืน null เฉพาะเมื่อไฟล์ไม่มีแถวข้อมูล
 */
function detectLayout(
  grid: ExcelGrid,
  headerRow: Row,
  overrides: Map<string, string>,
): KbLayoutType | null {
  const articleCodeExpr = overrides.get(KbArticleColumn.ArticleCode);
  if (articleCodeExpr === undefined)
    throw new KbExcelReadError(
      'Template ไม่ได้ map คอลัมน์ ArticleCode (Code รวม) จึงแยกประเภทไฟล์ไม่ได้ — กรุณาแก้ Template ที่หน้า config',
    );

  let hasData = false;
  for (let rowIdx = DATA_START_ROW_INDEX; rowIdx < grid.rows.length; rowIdx++) {
    const excelRow = grid.rows[rowIdx];
    if (!excelRow || isRowBlank(excelRow)) continue;
    hasData = true;

    const code = firstLine(resolveTemplateExpression(articleCodeExpr, headerRow, excelRow));
    if (!code) continue;

    const layout = detectLayoutFromCode(code);
    if (layout) return layout;

    throw new KbExcelReadError(
      `Code รวม (ArticleCode) ของแถว ${rowIdx + 1} ผิดรูปแบบ: "${code}" (ยาว ${code.length} ตัว) จึงแยกประเภทไฟล์ไม่ได้ — กรุณาแก้ Code ในไฟล์ก่อน\n` +
        `• กฎหมาย: ยาว ${KbLayout.LawCodeLength} ตัว, ตัวที่ 4-5 เป็น ${KbLayout.LawSeriesLaw} และ 5 ตัวสุดท้ายเป็น ${KbLayout.LawCodeSuffix}\n` +
        `• พระราชกฤษฎีกา: ยาว ${KbLayout.LawCodeLength} ตัว, ตัวที่ 4-5 ไม่ใช่ ${KbLayout.LawSeriesLaw} และ 5 ตัวสุดท้ายเป็น ${KbLayout.LawCodeSuffix}\n` +
        `• ไม่ใช่กฎหมาย: ${KbLayout.NonLawCodeFormatMessage}`,
    );
  }

  if (hasData) {
    const hint =
      grid.uncachedFormulaCount > 0
        ? ` (พบเซลล์สูตร ${grid.uncachedFormulaCount} เซลล์ที่ไม่มีค่าที่คำนวณไว้ — เปิดไฟล์ด้วย Excel แล้วบันทึกซ้ำก่อนอัปโหลด เพราะระบบอ่านค่าสูตรที่ Excel เก็บไว้เท่านั้น)`
        : '';
    throw new KbExcelReadError(
      `ไม่พบ Code รวม (ArticleCode) ในไฟล์เลย (ตามคอลัมน์ที่ Template map ไว้) จึงแยกประเภทไฟล์ไม่ได้${hint}`,
    );
  }
  return null;
}

// ── ตรวจ mapping ↔ โครงสร้างไฟล์ ─────────────────────────────────────

function* extractColumnRefs(expression: string): Generator<string> {
  if (!expression || !expression.trim()) return;
  if (!expression.includes('{')) {
    yield expression.trim();
    return;
  }
  for (const m of expression.matchAll(PLACEHOLDER)) {
    const ref = m[1].trim();
    if (ref.length > 0) yield ref;
  }
}

/**
 * ตรวจว่าทุก mapping ของ Template (ref ตรงๆ และ {X} ในสูตร) ชี้ไปคอลัมน์/หัวตารางที่มีอยู่จริงในไฟล์ —
 * ref ที่หาไม่เจอจะอ่านได้ค่าว่างเงียบๆ ทำให้เนื้อหาหายหรือผิดคอลัมน์โดยไม่มี error จึงรายงานล่วงหน้า
 */
function findMappingProblems(
  overrides: Map<string, string>,
  headerRow: Row,
  columnCount: number,
): string[] {
  const problems: string[] = [];
  for (const [target, expr] of overrides) {
    for (const colRef of extractColumnRefs(expr)) {
      const letterIndex = columnLetterToIndex(colRef);
      if (letterIndex >= 0 && letterIndex < columnCount) continue; // ตัวอักษรคอลัมน์ที่มีในไฟล์
      if (findColumnIndexByHeaderText(headerRow, colRef) >= 0) continue; // หัวตารางที่มีในไฟล์

      problems.push(
        letterIndex >= 0
          ? `${target} → "${colRef}": ไม่พบคอลัมน์นี้ในไฟล์ (ไฟล์มี ${columnCount} คอลัมน์: A–${
              columnCount > 0 ? columnIndexToLetters(columnCount - 1) : '-'
            })`
          : `${target} → "${colRef}": ไม่พบหัวตารางนี้ในไฟล์`,
      );
    }
  }
  return problems;
}

// ── จุดเข้าหลัก ──────────────────────────────────────────────────────

/**
 * อ่านตาราง (แถวหัวตารางแถว 1, ข้อมูลตั้งแต่แถว 2, sheet แรก) เป็น KbImportRow ต่อแถว + ชนิดไฟล์ที่ตรวจพบ + mapping ที่ไม่ตรงกับไฟล์
 * ไม่ตรวจกฎธุรกิจรายแถว (หน้าที่ของ validator) · แถวที่อ่านไม่ได้เป็น Error รายแถว ไม่ทำให้ทั้งไฟล์ล้ม
 * @throws KbExcelReadError เมื่อ Template ไม่ map ArticleCode หรือ Code รวมผิดรูปแบบจนแยกชนิดไฟล์ไม่ได้
 */
export function readImportRows(
  grid: ExcelGrid,
  templateColumns: readonly TemplateColumnRow[] | null,
): KbExcelReadResult {
  const result: KbExcelReadResult = { rows: [], detectedLayout: null, mappingProblems: [] };
  if (grid.rows.length === 0) return result;

  const headerRow: Row = grid.rows[0];
  const overrides = buildFieldOverrides(templateColumns);

  const layout = detectLayout(grid, headerRow, overrides);
  if (layout === null) return result; // ไม่มีแถวข้อมูลเลย

  // พระราชกฤษฎีกามีรูปแบบแถวเหมือนกฎหมาย: detectedLayout บอกชนิดไฟล์ให้เทียบกับ Template, rowKind ที่ใช้อ่านแถวยังเป็น Law
  result.detectedLayout = layout;
  const rowKind: 'Law' | 'NonLaw' = layout === KbLayout.NonLaw ? 'NonLaw' : 'Law';
  const columnCount = grid.rows.reduce((max, r) => Math.max(max, r ? r.length : 0), 0);

  for (let rowIdx = DATA_START_ROW_INDEX; rowIdx < grid.rows.length; rowIdx++) {
    const excelRow = grid.rows[rowIdx];
    if (!excelRow || isRowBlank(excelRow)) continue;

    let row: KbImportRow;
    try {
      row = rowKind === 'NonLaw' ? readNonLawRow(rowIdx) : readLawRow(excelRow, rowIdx);
      applyFieldOverrides(row, excelRow, headerRow, overrides);
    } catch (err) {
      // แถวเดียวที่อ่านไม่ได้ต้องไม่ทำให้ทั้งไฟล์ล้ม
      row = newImportRow(rowIdx + 1, rowKind);
      row.status = 'Error';
      row.statusNote = truncate(`อ่านข้อมูล Excel ไม่สำเร็จ: ${(err as Error).message}`, 200);
    }

    if (rowKind === 'NonLaw') result.rows.push(...expandArticleCodes(row));
    else result.rows.push(row);
  }

  result.mappingProblems = findMappingProblems(overrides, headerRow, columnCount);
  return result;
}
