import type { ArticleValues, ImportUpdatableColumn } from '../articles/article-columns';
import type { KbImportRow } from './kb-import-row';
import { convertPlainTextToHtml } from './kb-text';

const nonBlank = (s: string | null | undefined): boolean => !!s && s.trim().length > 0;

/**
 * คอลัมน์ของ t_KBArticle ที่จะเขียนทับบทความเดิมจาก row: เฉพาะ field ที่ Excel/Template ให้ค่าไม่ว่างมา
 * (เซลล์ว่าง หรือ field ที่ Template ไม่ได้ map = คงค่าเดิม) + ArticleType เสมอ
 * ไม่แก้ ArticleCode และ CategoryID และไม่รวมค่าคงที่ตอน insert (Status, ConfidentialityLevel, IsOfficialPolicy, CurrentVersion, Created*)
 * — กันบทความที่ Publish ไปแล้วถูกดึงกลับเป็น Review ทุกครั้งที่ upload ซ้ำ
 */
export function getUpdateColumns(row: KbImportRow, isLaw: boolean): ImportUpdatableColumn[] {
  const columns: ImportUpdatableColumn[] = [];
  if (nonBlank(row.title)) columns.push('Title');
  if (isLaw && nonBlank(row.tags)) columns.push('Tags');
  if (nonBlank(row.titleCategory)) columns.push('TitleCategory');
  if (nonBlank(row.rawContent)) columns.push('ContentHTML');
  if (nonBlank(row.summary)) columns.push('Summary');
  if (row.publishedDateParsed) columns.push('PublishedDate');
  if (row.effectiveDateParsed) columns.push('EffectiveDate');
  columns.push('ArticleType');
  return columns;
}

/** ค่าที่จะเขียนทับบทความเดิม — แปลงด้วยกฎเดียวกับตอน insert (ContentHTML ผ่าน convertPlainTextToHtml) · ใช้คู่กับ getUpdateColumns */
export function buildImportPatch(row: KbImportRow, articleType: number): ArticleValues {
  return {
    title: row.title,
    tags: row.tags,
    titleCategory: row.titleCategory,
    contentHtml: convertPlainTextToHtml(row.rawContent),
    summary: row.summary,
    publishedDate: row.publishedDateParsed,
    effectiveDate: row.effectiveDateParsed,
    articleType,
  };
}
