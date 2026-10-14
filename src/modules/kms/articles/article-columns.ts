/**
 * คอลัมน์ของ KMS.t_KBArticle ที่แต่ละเส้นทางเขียนได้ (whitelist) — ชื่อคอลัมน์ไม่เคยมาจาก client โดยตรง
 * ArticleCode / CategoryID / Status / ReviewDueDate / IsOfficialPolicy / CurrentVersion ฯลฯ ไม่อยู่ในรายการใดเลย:
 *  - ArticleCode เป็นคีย์ที่ import ใช้หาบทความ · CategoryID เปลี่ยนด้วย "ย้ายบทความ" เท่านั้น · Status เปลี่ยนด้วย submit-review/publish/archive
 */

/** คอลัมน์ที่หน้าแก้ไขบทความเขียนได้ (KBArticleRepository.Update) */
export const ARTICLE_EDITABLE_COLUMNS = [
  'Title',
  'ContentHTML',
  'Summary',
  'TitleCategory',
  'ArticleType',
  'PublishedDate',
  'EffectiveDate',
  'ExpiryDate',
  'Tags',
  'ConfidentialityLevel',
] as const;

/** คอลัมน์ที่ Excel import เขียนทับได้เมื่อ re-upload (KBArticleRepository.ImportUpdatableColumns) */
export const IMPORT_UPDATABLE_COLUMNS = [
  'Title',
  'TitleCategory',
  'ContentHTML',
  'Summary',
  'PublishedDate',
  'EffectiveDate',
  'ArticleType',
  'Tags',
] as const;

export type ArticleEditableColumn = (typeof ARTICLE_EDITABLE_COLUMNS)[number];
export type ImportUpdatableColumn = (typeof IMPORT_UPDATABLE_COLUMNS)[number];

/** ค่าของบทความที่จะเขียน (ชื่อ property camelCase) */
export interface ArticleValues {
  title?: string | null;
  contentHtml?: string | null;
  summary?: string | null;
  titleCategory?: string | null;
  articleType?: number;
  publishedDate?: Date | null;
  effectiveDate?: Date | null;
  expiryDate?: Date | null;
  tags?: string | null;
  confidentialityLevel?: number;
}

const PROP_OF: Record<ArticleEditableColumn, keyof ArticleValues> = {
  Title: 'title',
  ContentHTML: 'contentHtml',
  Summary: 'summary',
  TitleCategory: 'titleCategory',
  ArticleType: 'articleType',
  PublishedDate: 'publishedDate',
  EffectiveDate: 'effectiveDate',
  ExpiryDate: 'expiryDate',
  Tags: 'tags',
  ConfidentialityLevel: 'confidentialityLevel',
};

export interface UpdateStatement {
  sql: string;
  params: unknown[];
}

/**
 * ประกอบ `UPDATE KMS.t_KBArticle SET ... WHERE ArticleID = @n` จากคอลัมน์ใน whitelist เท่านั้น (ชื่อที่ไม่อยู่ใน whitelist = throw)
 * ตั้ง UpdatedBy/UpdatedDate เสมอ และ CurrentVersion เมื่อมี version ใหม่ · ค่า undefined เขียนเป็น NULL
 * แถวที่ถูกลบ (IsDelete=1) ไม่ถูกแก้ — ผู้เรียกตรวจจำนวนแถวที่กระทบ
 */
export function buildArticleUpdate(
  articleId: number,
  columns: readonly string[],
  values: ArticleValues,
  allowed: readonly string[],
  updatedBy: string,
  nextVersion: number | null,
): UpdateStatement {
  const params: unknown[] = [];
  const sets: string[] = [];
  const seen = new Set<string>();

  for (const column of columns) {
    if (!allowed.includes(column)) {
      throw new Error(`คอลัมน์ '${column}' ไม่อยู่ในรายการที่เขียนทับได้`);
    }
    if (seen.has(column)) continue;
    seen.add(column);
    const prop = PROP_OF[column as ArticleEditableColumn];
    const v = values[prop];
    params.push(v === undefined ? null : v);
    sets.push(`${column} = @${params.length - 1}`);
  }

  if (nextVersion !== null) {
    params.push(nextVersion);
    sets.push(`CurrentVersion = @${params.length - 1}`);
  }
  params.push(updatedBy);
  sets.push(`UpdatedBy = @${params.length - 1}`);
  sets.push('UpdatedDate = GETDATE()');

  params.push(articleId);
  return {
    sql: `UPDATE KMS.t_KBArticle SET ${sets.join(', ')} WHERE ArticleID = @${params.length - 1} AND (IsDelete = 0 OR IsDelete IS NULL)`,
    params,
  };
}

/** บทความต้องมี version ใหม่เฉพาะเมื่อ ContentHTML ต่างจากที่เก็บไว้ (เทียบ ordinal ตัวต่อตัว · null นับเป็นว่าง) */
export function shouldCreateVersion(
  current: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return (current ?? '') !== (next ?? '');
}
