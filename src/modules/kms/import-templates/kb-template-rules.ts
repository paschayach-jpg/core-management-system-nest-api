import { KbLayout, normalizeLayout } from '../codes/kb-layout';
import type { TemplateColumnRow } from '../import/kb-import-row';
import { KbArticleColumn } from './kb-column-catalog';

/** แถวที่เลือกค่าจาก dropdown แทนการ map คอลัมน์ Excel — ไม่นับในกฎ "ห้าม map คอลัมน์ Excel ซ้ำ" */
const FIXED_VALUE_TARGETS = new Set<string>([
  KbArticleColumn.LayoutType,
  KbArticleColumn.ArticleType,
]);

const isFormulaMapping = (ref: string | null | undefined): boolean =>
  !!ref && (ref.includes('{') || ref.includes('}'));

/** ตรวจว่า {ชื่อคอลัมน์} ในค่า mapping มีวงเล็บปีกกาเปิด-ปิดครบคู่ */
export function validateFormulaSyntax(value: string | null | undefined): string | null {
  if (!value || !isFormulaMapping(value)) return null;
  const stripped = value.replace(/\{[^{}]+\}/g, '');
  if (stripped.includes('{') || stripped.includes('}'))
    return 'รูปแบบ {ชื่อคอลัมน์} ไม่ถูกต้อง ต้องมีวงเล็บปีกกาเปิด-ปิดครบคู่ เช่น "มาตรา {C}"';
  return null;
}

/** แถวที่ map แล้ว (ไม่ว่าง) โดยไม่นับ CategoryID ที่ Template เก่าเคยบันทึกไว้ (ระบบหาเองตอน import) */
export function mappedRows(rows: readonly TemplateColumnRow[]): TemplateColumnRow[] {
  return rows.filter(
    (r) =>
      r &&
      !!r.excelColumnRef &&
      r.excelColumnRef.trim().length > 0 &&
      r.targetColumnName.toLowerCase() !== KbArticleColumn.CategoryID.toLowerCase(),
  );
}

/** ค่าของแถว mapping ตามชื่อคอลัมน์ (ไม่สนตัวพิมพ์) */
export function findMapping(
  rows: readonly TemplateColumnRow[],
  target: string,
): TemplateColumnRow | undefined {
  return rows.find((r) => r.targetColumnName.toLowerCase() === target.toLowerCase());
}

/** ArticleType ที่ Template ตั้งไว้ (1-5) · null ถ้ายังไม่ตั้ง/ไม่ใช่ตัวเลข 1-5 */
export function resolveArticleType(rows: readonly TemplateColumnRow[]): number | null {
  const ref = findMapping(rows, KbArticleColumn.ArticleType)?.excelColumnRef?.trim();
  if (!ref || !/^\d+$/.test(ref)) return null;
  const n = parseInt(ref, 10);
  return n >= 1 && n <= 5 ? n : null;
}

/** ประเภทไฟล์ที่ Template ตั้งไว้ (Law/Decree/NonLaw) · null ถ้ายังไม่เลือก */
export function resolveTemplateLayout(rows: readonly TemplateColumnRow[]) {
  return normalizeLayout(findMapping(rows, KbArticleColumn.LayoutType)?.excelColumnRef);
}

/** Template map คอลัมน์ Attachment หรือไม่ (= ต้องมีไฟล์แนบ/โฟลเดอร์ DMS ตอน import) */
export function hasAttachmentMapping(rows: readonly TemplateColumnRow[]): boolean {
  const ref = findMapping(rows, KbArticleColumn.Attachment)?.excelColumnRef;
  return !!ref && ref.trim().length > 0;
}

/**
 * ตรวจว่า mapping ของ Template ครบและถูกต้อง — ใช้ชุดเดียวกันทั้งตอนบันทึก Template และตอน import (GetTemplateProblems):
 * ต้องเลือกประเภทไฟล์ (LayoutType) และประเภทบทความ (ArticleType 1-5), map ArticleCode (Code รวม), Template ที่ไม่ใช่กฎหมาย
 * ต้อง map Title/ContentHTML/Attachment (ไม่มีตำแหน่งคอลัมน์ตายตัว), Decree ต้อง map LawReference ส่วน Law/NonLaw ห้าม map,
 * รูปแบบ {X} ถูกต้อง และไม่ map คอลัมน์ Excel เดียวกันซ้ำ · คืนรายการปัญหา (ว่าง = ใช้งานได้)
 */
export function getTemplateProblems(
  rows: readonly TemplateColumnRow[] | null | undefined,
): string[] {
  if (!rows) return ['ไม่พบข้อมูล mapping ของ Template'];

  const problems: string[] = [];
  const mapped = mappedRows(rows);
  const isMapped = (name: string) =>
    mapped.some((r) => r.targetColumnName.toLowerCase() === name.toLowerCase());

  const layoutType = resolveTemplateLayout(mapped);
  if (layoutType === null)
    problems.push('ยังไม่ได้เลือกประเภทไฟล์ (LayoutType: กฎหมาย / พระราชกฤษฎีกา / ไม่ใช่กฎหมาย)');

  if (!isMapped(KbArticleColumn.ArticleType)) {
    problems.push('ยังไม่ได้เลือกประเภทบทความ (ArticleType)');
  } else if (resolveArticleType(mapped) === null) {
    problems.push('ประเภทบทความ (ArticleType) ต้องเป็นตัวเลข 1-5');
  }

  if (!isMapped(KbArticleColumn.ArticleCode))
    problems.push('ยังไม่ได้ Map คอลัมน์ ArticleCode (Code รวม)');

  if (layoutType === KbLayout.NonLaw) {
    for (const required of [
      KbArticleColumn.Title,
      KbArticleColumn.ContentHTML,
      KbArticleColumn.Attachment,
    ]) {
      if (!isMapped(required))
        problems.push(`Template ที่ไม่ใช่กฎหมายต้อง Map คอลัมน์ ${required}`);
    }
  }

  const lawReferenceMapped = isMapped(KbArticleColumn.LawReference);
  if (layoutType === KbLayout.Decree && !lawReferenceMapped)
    problems.push(
      `Template ประเภทพระราชกฤษฎีกาต้อง Map คอลัมน์ ${KbArticleColumn.LawReference} (Code กฎหมายอ้างอิง)`,
    );
  if (layoutType !== null && layoutType !== KbLayout.Decree && lawReferenceMapped)
    problems.push(
      `คอลัมน์ ${KbArticleColumn.LawReference} ใช้ได้เฉพาะ Template ประเภทพระราชกฤษฎีกา — ถ้าเป็นพระราชกฤษฎีกาให้เลือกประเภทไฟล์เป็นพระราชกฤษฎีกา ไม่งั้นลบ Map นี้ออก`,
    );

  for (const row of mapped) {
    const err = validateFormulaSyntax(row.excelColumnRef);
    if (err) problems.push(`คอลัมน์ "${row.targetColumnName}": ${err}`);
  }

  const groups = new Map<string, number>();
  for (const r of mapped) {
    if (FIXED_VALUE_TARGETS.has(r.targetColumnName)) continue; // ค่าคงที่ ไม่ใช่การใช้คอลัมน์ Excel
    if (isFormulaMapping(r.excelColumnRef)) continue; // สูตรใช้คอลัมน์ต้นทางร่วมกันได้
    const key = (r.excelColumnRef as string).trim().toUpperCase();
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const duplicates = [...groups.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (duplicates.length > 0)
    problems.push('มีการ Map คอลัมน์ Excel ซ้ำกัน: ' + duplicates.join(', '));

  return problems;
}
