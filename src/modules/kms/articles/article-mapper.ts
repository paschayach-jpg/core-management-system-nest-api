import { camelizeKeys } from '../../../common/utils/camelize';
import type { ArticleBaseDto, ArticleDetailDto, ArticleListItemDto } from './dto/article.dto';

type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number =>
  v === null || v === undefined ? fallback : Number(v);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date | null =>
  v instanceof Date ? v : v ? new Date(v as string) : null;

/** คอลัมน์ร่วมของรายการและรายละเอียด (ชื่อคอลัมน์ PascalCase จาก SQL → camelCase) */
export function mapArticleBase(raw: Row): ArticleBaseDto {
  const r = camelizeKeys<Row>(raw);
  return {
    articleId: num(r.articleId),
    articleCode: String(r.articleCode ?? ''),
    title: String(r.title ?? ''),
    titleCategory: str(r.titleCategory),
    categoryId: num(r.categoryId),
    categoryName: str(r.categoryName),
    articleType: num(r.articleType),
    status: num(r.status, 1),
    confidentialityLevel: num(r.confidentialityLevel),
    currentVersion: num(r.currentVersion, 1),
    effectiveDate: date(r.effectiveDate),
    publishedDate: date(r.publishedDate),
    expiryDate: date(r.expiryDate),
    reviewDueDate: date(r.reviewDueDate),
    viewCount: num(r.viewCount),
    likeCount: num(r.likeCount),
    isOfficialPolicy: Boolean(r.isOfficialPolicy),
    tags: str(r.tags),
    createdBy: String(r.createdBy ?? ''),
    createdDate: date(r.createdDate),
    updatedBy: str(r.updatedBy),
    updatedDate: date(r.updatedDate),
  };
}

export function mapArticleListItem(raw: Row): ArticleListItemDto {
  const r = camelizeKeys<Row>(raw);
  return {
    ...mapArticleBase(raw),
    summaryPreview: str(r.summaryPreview),
    contentPreview: str(r.contentPreview),
  };
}

export function mapArticleDetail(raw: Row, categoryPath: string): ArticleDetailDto {
  const r = camelizeKeys<Row>(raw);
  return {
    ...mapArticleBase(raw),
    contentHtml: String(r.contentHtml ?? ''),
    summary: str(r.summary),
    isDelete: Boolean(r.isDelete),
    categoryPath,
    reviewedBy: str(r.reviewedBy),
    reviewedDate: date(r.reviewedDate),
    attachmentCount: num(r.attachmentCount),
    relatedCount: num(r.relatedCount),
  };
}
