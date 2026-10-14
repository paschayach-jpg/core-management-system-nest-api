import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import {
  LINK_LAW,
  assertTargetsExist,
  linkLawBothWays,
  loadArticleState,
  requireArticle,
  unlinkLawBothWays,
} from './article-sql';
import type { ArticleLinkDto, RelatedArticleDto } from './dto/article.dto';

type Row = Record<string, unknown>;

/**
 * ความเชื่อมโยงของบทความ (KMS.t_KBArticleLink) — พอร์ตจาก KBArticleService.SaveArticleLinks/LinkArticles/UnlinkArticles
 * ชุดที่หน้าแก้ไขจัดการคือบทความที่เกี่ยวข้อง (Law = 4) เท่านั้น และเป็นแบบ **สองทาง** เสมอ (ผังกฎหมายอ่านทั้งสองทิศ)
 * link ชนิดอื่น (ไฟล์=1 ฯลฯ) ถูกจัดการโดยระบบ ไม่แตะที่นี่
 */
@Injectable()
export class ArticleLinksService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbArticleLink';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  async list(articleId: number, entityType?: number): Promise<ArticleLinkDto[]> {
    if (!(await loadArticleState(this.ds, articleId)))
      throw new ResourceNotFoundException('บทความ', articleId);
    const rows: Row[] = await this.ds.query(
      `SELECT LinkID, ArticleID, EntityType, EntityID, CreatedBy, CreatedDate
         FROM KMS.t_KBArticleLink
        WHERE ArticleID = @0 ${entityType !== undefined ? 'AND EntityType = @1' : ''}
        ORDER BY CreatedDate DESC, LinkID DESC`,
      entityType !== undefined ? [articleId, entityType] : [articleId],
    );
    return rows.map((raw) => {
      const r = camelizeKeys<Row>(raw);
      return {
        linkId: Number(r.linkId),
        articleId: Number(r.articleId),
        entityType: Number(r.entityType),
        entityId: String(r.entityId),
        createdBy: String(r.createdBy ?? ''),
        createdDate: (r.createdDate as Date | null) ?? null,
      };
    });
  }

  /** บทความที่เกี่ยวข้อง (link Law) พร้อมข้อมูลสรุปของบทความปลายทาง */
  async related(articleId: number): Promise<RelatedArticleDto[]> {
    if (!(await loadArticleState(this.ds, articleId)))
      throw new ResourceNotFoundException('บทความ', articleId);
    const rows: Row[] = await this.ds.query(
      `SELECT l.LinkID, a.ArticleID, a.ArticleCode, a.Title, a.TitleCategory, a.CategoryID, a.Status, a.IsDelete
         FROM KMS.t_KBArticleLink l
         JOIN KMS.t_KBArticle a ON a.ArticleID = TRY_CONVERT(INT, l.EntityID)
        WHERE l.ArticleID = @0 AND l.EntityType = ${LINK_LAW}
        ORDER BY a.ArticleCode`,
      [articleId],
    );
    return rows.map((raw) => {
      const r = camelizeKeys<Row>(raw);
      return {
        linkId: Number(r.linkId),
        articleId: Number(r.articleId),
        articleCode: String(r.articleCode),
        title: String(r.title),
        titleCategory: (r.titleCategory as string | null) ?? null,
        categoryId: Number(r.categoryId),
        status: Number(r.status ?? 1),
        isDelete: Boolean(r.isDelete),
      };
    });
  }

  /**
   * กำหนดชุดบทความที่เกี่ยวข้อง "ทั้งชุด" (SaveArticleLinks): ตัวที่หายไปจากชุด → ยกเลิกทั้งสองทาง, ตัวใหม่ → ผูกทั้งสองทาง,
   * ตัวที่ยังอยู่ → ซ่อมให้ครบสองทางถ้าขาดทางใดทางหนึ่ง · ทั้งหมดใน transaction เดียว · ปลายทางต้องมีอยู่จริงและไม่ถูกลบ
   */
  setRelated(
    articleId: number,
    relatedIds: number[],
    user: UserContext,
  ): Promise<RelatedArticleDto[]> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'SAVE_KB_ARTICLE_LINKS',
        recordId: articleId,
        captureBefore: () => this.related(articleId),
      },
      async () => {
        const wanted = [...new Set(relatedIds.filter((id) => id > 0 && id !== articleId))];
        await this.tx.run(async ({ manager }) => {
          await requireArticle(manager, articleId, { editable: true });
          await assertTargetsExist(manager, wanted);

          const existing: { EntityID: string }[] = await manager.query(
            `SELECT EntityID FROM KMS.t_KBArticleLink WHERE ArticleID = @0 AND EntityType = ${LINK_LAW}`,
            [articleId],
          );
          const wantedSet = new Set(wanted);
          for (const e of existing) {
            const id = /^\d+$/.test(e.EntityID) ? Number(e.EntityID) : 0;
            if (id > 0 && wantedSet.has(id)) continue;
            if (id > 0) await unlinkLawBothWays(manager, articleId, id);
            else
              await manager.query(
                `DELETE FROM KMS.t_KBArticleLink WHERE ArticleID = @0 AND EntityType = ${LINK_LAW} AND EntityID = @1`,
                [articleId, e.EntityID], // EntityID แปลงเป็นเลขไม่ได้ → ลบเฉพาะแถวนั้น
              );
          }
          for (const id of wanted) await linkLawBothWays(manager, articleId, id, user.adUserName);
        });
        return this.related(articleId);
      },
      (r) => ({ after: r.map((x) => x.articleId) }),
    );
  }

  link(articleId: number, otherId: number, user: UserContext): Promise<RelatedArticleDto[]> {
    return this.logged(
      { action: 'CREATE', operation: 'LINK_KB_ARTICLES', recordId: articleId, meta: { otherId } },
      async () => {
        if (articleId === otherId)
          throw new BusinessException('ผูกบทความกับตัวเองไม่ได้', 'LINK_SELF');
        await this.tx.run(async ({ manager }) => {
          await requireArticle(manager, articleId, { editable: true });
          await assertTargetsExist(manager, [otherId]);
          await linkLawBothWays(manager, articleId, otherId, user.adUserName);
        });
        return this.related(articleId);
      },
    );
  }

  unlink(articleId: number, otherId: number): Promise<RelatedArticleDto[]> {
    return this.logged(
      { action: 'DELETE', operation: 'UNLINK_KB_ARTICLES', recordId: articleId, meta: { otherId } },
      async () => {
        await this.tx.run(async ({ manager }) => {
          await requireArticle(manager, articleId, { editable: true });
          await unlinkLawBothWays(manager, articleId, otherId);
        });
        return this.related(articleId);
      },
    );
  }
}
