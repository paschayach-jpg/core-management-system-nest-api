import { LIKE_ESCAPE, likeContains } from '../../../common/utils/query.util';
import type { ArticleListQueryDto, ArticleSearchField } from './dto/article.dto';

/** ตัวสะสม parameter ของ SQL (@0, @1, ...) — ค่าจากผู้ใช้ทุกตัวต้องผ่านที่นี่ ห้ามต่อสตริงเข้า SQL */
export class SqlParams {
  private readonly list: unknown[] = [];
  add(value: unknown): string {
    this.list.push(value);
    return `@${this.list.length - 1}`;
  }
  get values(): unknown[] {
    return this.list;
  }
}

/** ตัดช่องว่าง/tab/ขึ้นบรรทัดใหม่/NBSP ออกจากคอลัมน์ก่อนเทียบ (ระบบเดิมค้นแบบไม่สนช่องว่าง) */
export const stripWhitespaceSql = (col: string): string =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''), NCHAR(160), N'')`;

/** ContentHTML ที่ import สร้างมีแท็กเฉพาะ <br> และ &nbsp; — ตัดสองอย่างนี้ก่อนเทียบเพื่อให้ค้นข้อความข้ามบรรทัดเจอ (ประมาณของการ strip HTML เดิม) */
const contentTextSql = (col: string): string =>
  stripWhitespaceSql(`REPLACE(REPLACE(${col}, N'&nbsp;', N''), N'<br>', N'')`);

/** keyword ที่ตัดช่องว่างทุกชนิดออกแล้ว (ว่าง = ไม่กรอง) */
export function normalizeKeyword(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, '');
}

/** เงื่อนไขค้นข้อความตามฟิลด์ — คืน null เมื่อไม่มีคำค้น */
export function buildKeywordPredicate(
  keyword: string | null | undefined,
  field: ArticleSearchField,
  p: SqlParams,
): string | null {
  const kw = normalizeKeyword(keyword);
  if (!kw) return null;
  const k = p.add(likeContains(kw));

  const preds: Record<Exclude<ArticleSearchField, 'all'>, string> = {
    title: `${stripWhitespaceSql('a.Title')} LIKE ${k} ${LIKE_ESCAPE}`,
    tags: `a.Tags LIKE ${k} ${LIKE_ESCAPE}`,
    summary: `${stripWhitespaceSql('a.Summary')} LIKE ${k} ${LIKE_ESCAPE}`,
    titleCategory: `${stripWhitespaceSql('a.TitleCategory')} LIKE ${k} ${LIKE_ESCAPE}`,
    code: `a.ArticleCode LIKE ${k} ${LIKE_ESCAPE}`,
    content: `${contentTextSql('a.ContentHTML')} LIKE ${k} ${LIKE_ESCAPE}`,
  };
  if (field !== 'all') return preds[field];
  // ทุกฟิลด์: เรียงจากถูกไปแพง (เนื้อหา nvarchar(max) ไว้ท้ายสุด)
  return `(${[preds.code, preds.title, preds.tags, preds.titleCategory, preds.summary, preds.content].join(' OR ')})`;
}

/** ฟิลด์ที่ client ขอเรียงได้ → นิพจน์คอลัมน์ (whitelist กัน SQL injection ผ่านชื่อคอลัมน์) */
export const ARTICLE_SORT_WHITELIST: Record<string, string> = {
  articleCode: 'a.ArticleCode',
  title: 'a.Title',
  status: 'a.Status',
  articleType: 'a.ArticleType',
  categoryName: 'c.CategoryName',
  createdDate: 'a.CreatedDate',
  updatedDate: 'a.UpdatedDate',
  publishedDate: 'a.PublishedDate',
  effectiveDate: 'a.EffectiveDate',
  expiryDate: 'a.ExpiryDate',
  viewCount: 'a.ViewCount',
};

/**
 * เงื่อนไข WHERE ของรายการบทความ: ไม่รวมที่ถูกลบ + หมวด(รวมลูก) + สถานะ + ประเภท + Title ตรง + ArticleID + คำค้น
 * @param categoryIds ชุด CategoryID ที่จะกรอง (ผู้เรียกขยายหมวดย่อยมาให้แล้ว) · null = ไม่กรองหมวด
 */
export function buildArticleWhere(
  q: Pick<ArticleListQueryDto, 'status' | 'articleType' | 'title' | 'ids' | 'q' | 'searchField'>,
  categoryIds: number[] | null,
  p: SqlParams,
): string {
  const where: string[] = ['(a.IsDelete = 0 OR a.IsDelete IS NULL)'];

  if (categoryIds !== null) {
    where.push(
      categoryIds.length === 0
        ? '1 = 0'
        : `a.CategoryID IN (${categoryIds.map((id) => p.add(id)).join(',')})`,
    );
  }
  if (q.status !== undefined) where.push(`a.Status = ${p.add(q.status)}`);
  if (q.articleType !== undefined) where.push(`a.ArticleType = ${p.add(q.articleType)}`);
  if (q.title !== undefined) where.push(`a.Title = ${p.add(q.title)}`);
  if (q.ids !== undefined) {
    where.push(
      q.ids.length === 0 ? '1 = 0' : `a.ArticleID IN (${q.ids.map((id) => p.add(id)).join(',')})`,
    );
  }
  const kw = buildKeywordPredicate(q.q, q.searchField ?? 'all', p);
  if (kw) where.push(kw);

  return where.join(' AND ');
}
