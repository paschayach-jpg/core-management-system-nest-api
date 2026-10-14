import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import { isEditableStatus } from './article-status';

/** ทั้ง DataSource และ EntityManager (ใน transaction) มี query(sql, params) เหมือนกัน */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const LINK_FILE = 1;
export const LINK_LAW = 4;

export interface ArticleState {
  articleId: number;
  articleCode: string;
  status: number;
  isDelete: boolean;
}

/** สถานะปัจจุบันของบทความ (รวมที่ถูกลบ) · null ถ้าไม่มี ArticleID นี้ */
export async function loadArticleState(
  q: Queryable,
  articleId: number,
): Promise<ArticleState | null> {
  const rows: {
    ArticleID: number;
    ArticleCode: string;
    Status: number | null;
    IsDelete: boolean | null;
  }[] = await q.query(
    'SELECT ArticleID, ArticleCode, Status, IsDelete FROM KMS.t_KBArticle WHERE ArticleID = @0',
    [articleId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    articleId: r.ArticleID,
    articleCode: r.ArticleCode,
    status: Number(r.Status ?? 1),
    isDelete: Boolean(r.IsDelete),
  };
}

/** บทความต้องมีอยู่ ไม่ถูกลบ และ (ถ้า editable=true) ไม่ใช่ Archived — ไม่งั้นโยน 404/422 */
export async function requireArticle(
  q: Queryable,
  articleId: number,
  opts: { editable?: boolean } = {},
): Promise<ArticleState> {
  const s = await loadArticleState(q, articleId);
  if (!s || s.isDelete) throw new ResourceNotFoundException('บทความ', articleId);
  if (opts.editable && !isEditableStatus(s.status))
    throw new BusinessException('บทความที่ Archive แล้วแก้ไขไม่ได้', 'ARTICLE_ARCHIVED');
  return s;
}

/** เพิ่ม link ถ้ายังไม่มี (UQ ArticleID+EntityType+EntityID) · คืน true ถ้าเพิ่มจริง */
export async function ensureLink(
  q: Queryable,
  articleId: number,
  entityType: number,
  entityId: string,
  createdBy: string,
): Promise<boolean> {
  const rows: { Inserted: number }[] = await q.query(
    `IF NOT EXISTS (SELECT 1 FROM KMS.t_KBArticleLink WHERE ArticleID = @0 AND EntityType = @1 AND EntityID = @2)
     BEGIN
       INSERT INTO KMS.t_KBArticleLink (ArticleID, EntityType, EntityID, CreatedBy, CreatedDate)
       VALUES (@0, @1, @2, @3, GETDATE());
       SELECT 1 AS Inserted;
     END
     ELSE SELECT 0 AS Inserted;`,
    [articleId, entityType, entityId, createdBy],
  );
  return Number(rows[0]?.Inserted) === 1;
}

/** link บทความ ↔ บทความ (Law) ทั้งสองทาง · คืนจำนวน link ที่เพิ่มจริง */
export async function linkLawBothWays(
  q: Queryable,
  a: number,
  b: number,
  createdBy: string,
): Promise<number> {
  if (a <= 0 || b <= 0 || a === b) return 0;
  let n = 0;
  if (await ensureLink(q, a, LINK_LAW, String(b), createdBy)) n++;
  if (await ensureLink(q, b, LINK_LAW, String(a), createdBy)) n++;
  return n;
}

/** ยกเลิก link ระหว่างสองบทความทั้งสองทาง */
export async function unlinkLawBothWays(q: Queryable, a: number, b: number): Promise<void> {
  await q.query(
    `DELETE FROM KMS.t_KBArticleLink
      WHERE EntityType = ${LINK_LAW}
        AND ((ArticleID = @0 AND EntityID = @1) OR (ArticleID = @2 AND EntityID = @3))`,
    [a, String(b), b, String(a)],
  );
}

/** ลบ link ชนิด Law ทั้งหมดของบทความ: ที่ออกจากบทความนี้ + ที่ชี้เข้าบทความนี้ (EntityID = ArticleID นี้) */
export async function removeAllLawLinks(q: Queryable, articleId: number): Promise<number> {
  const rows: { N: number }[] = await q.query(
    `DELETE FROM KMS.t_KBArticleLink
      WHERE EntityType = ${LINK_LAW} AND (ArticleID = @0 OR EntityID = @1);
     SELECT @@ROWCOUNT AS N;`,
    [articleId, String(articleId)],
  );
  return Number(rows[0]?.N ?? 0);
}

/** ผูกไฟล์กับบทความ: แถว attachment + link (EntityType=1, EntityID=FileID) — ไม่ลบของเดิม */
export async function attachFileRow(
  q: Queryable,
  articleId: number,
  fileId: number,
  createdBy: string,
): Promise<number> {
  const rows: { AttachmentID: number }[] = await q.query(
    `INSERT INTO KMS.t_KBArticleAttachment (ArticleID, FileID, CreatedBy, CreatedDate) VALUES (@0, @1, @2, GETDATE());
     SELECT CONVERT(INT, SCOPE_IDENTITY()) AS AttachmentID;`,
    [articleId, fileId, createdBy],
  );
  await ensureLink(q, articleId, LINK_FILE, String(fileId), createdBy);
  return Number(rows[0]?.AttachmentID ?? 0);
}

/** ปลายทางของ link ต้องมีอยู่จริงและไม่ถูกลบ ไม่งั้น 422 พร้อมรายการที่ไม่พบ */
export async function assertTargetsExist(q: Queryable, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows: { ArticleID: number }[] = await q.query(
    `SELECT ArticleID FROM KMS.t_KBArticle
      WHERE (IsDelete = 0 OR IsDelete IS NULL) AND ArticleID IN (${ids.map((_, i) => `@${i}`).join(',')})`,
    ids,
  );
  const found = new Set(rows.map((r) => r.ArticleID));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new BusinessException(
      `ไม่พบบทความที่จะผูก (หรือถูกลบแล้ว): ${missing.join(', ')}`,
      'LINK_TARGET_NOT_FOUND',
      { missing },
    );
}
