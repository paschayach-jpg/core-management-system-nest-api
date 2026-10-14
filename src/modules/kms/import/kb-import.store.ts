import type { ArticleValues, ImportUpdatableColumn } from '../articles/article-columns';
import type { KbCategoryRow } from '../codes/kb-category-tree';

/** บทความที่มี ArticleCode นี้อยู่ใน DB (รวมที่ถูก soft delete — ExistsByCode เดิมไม่กรอง IsDelete) */
export interface ExistingArticleInfo {
  articleId: number;
  articleCode: string;
  isDelete: boolean;
}

export interface NewArticleData {
  articleCode: string;
  title: string;
  contentHtml: string;
  summary: string | null;
  titleCategory: string | null;
  categoryId: number;
  articleType: number;
  status: number;
  publishedDate: Date | null;
  effectiveDate: Date | null;
  tags: string | null;
  confidentialityLevel: number;
  createdBy: string;
}

/** บทความใหม่ + ผลข้างเคียงที่ต้องสำเร็จพร้อมกัน (1 transaction ต่อบทความ) */
export interface NewArticleWrite {
  article: NewArticleData;
  /** Law/Decree: เก็บ version 1 (ContentSnapshot = ContentHTML) · NonLaw: null (ไม่มี version) */
  initialVersion: { contentSnapshot: string; createdBy: string } | null;
  /** ArticleID ของมาตราแม่ที่ต้อง link ไป-กลับ (EntityType=4) */
  parentArticleIds: number[];
  /** ไฟล์ DMS ที่ต้องผูก (t_KBArticleAttachment + link EntityType=1) */
  fileId: number | null;
  createdBy: string;
}

export interface NewArticleResult {
  articleId: number;
  parentLinksInserted: number;
}

export interface ExistingArticleWrite {
  articleId: number;
  patch: ArticleValues;
  columns: ImportUpdatableColumn[];
  updatedBy: string;
  /** Law/Decree: ถ้า ContentHTML ใหม่ต่างจากที่เก็บไว้ให้เพิ่ม version · NonLaw: null */
  versioning: { createdBy: string; changeDescription: string } | null;
  parentArticleIds: number[];
  /** บทความมีไฟล์แนบอยู่แล้ว → เติมเฉพาะ link ไฟล์ (EntityType=1) ที่ขาด */
  repairFileLinks: boolean;
  /** บทความยังไม่มีไฟล์แนบ → ผูกไฟล์นี้ */
  attachFileId: number | null;
  createdBy: string;
}

export interface ExistingArticleResult {
  versionCreated: boolean;
  parentLinksInserted: number;
  fileLinksRepaired: number;
  attached: boolean;
}

/**
 * การอ่าน/เขียน DB ที่ KMS Import ต้องใช้ — แยกเป็น port เพื่อเทสต์ด้วยหน่วยความจำ
 * ทุกเมธอดเขียน (insertArticle/updateArticleFromImport) ต้องทำงานใน transaction เดียวต่อบทความ (ล้มกลางทาง = ไม่เหลือบทความครึ่งๆ กลางๆ)
 */
export abstract class KbImportStore {
  abstract loadCategories(): Promise<KbCategoryRow[]>;
  /** ค้น ArticleCode หลายตัวพร้อมกัน (รวมที่ถูกลบ) · คีย์ผลลัพธ์เป็นตัวพิมพ์เล็ก */
  abstract findArticlesByCodes(codes: string[]): Promise<Map<string, ExistingArticleInfo>>;
  abstract getAttachmentFileIds(articleId: number): Promise<number[]>;
  abstract insertArticle(input: NewArticleWrite): Promise<NewArticleResult>;
  abstract updateArticleFromImport(input: ExistingArticleWrite): Promise<ExistingArticleResult>;
}
