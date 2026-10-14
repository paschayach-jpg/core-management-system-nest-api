import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { chunkArray } from '../kms-sql';
import { CategoriesService } from '../categories/categories.service';
import { KbCategoryRow, getDescendantIds } from '../codes/kb-category-tree';
import { KMS_OP } from '../kms.constants';
import type {
  MoveCandidateDto,
  MoveCandidatesQueryDto,
  MovePreviewDto,
  MoveRequestDto,
  MoveResultDto,
} from './dto/move.dto';
import { computeMoveWarnings } from './move-warnings';

type Row = Record<string, unknown>;

/**
 * ย้ายบทความไปหมวดอื่น (KBArticleMoveService): เปลี่ยนเฉพาะ CategoryID (+UpdatedBy/UpdatedDate) ไม่สร้าง version ไม่แตะเนื้อหา/สถานะ ·
 * ปลายทางต้องเป็นหมวดที่มีอยู่และเปิดใช้งาน · กรณีเสี่ยง (ข้ามกฎหมาย↔ไม่ใช่กฎหมาย ฯลฯ) เป็น "คำเตือนที่ผู้ใช้ยืนยัน" ไม่ใช่การบล็อก
 * (API บังคับว่าต้องส่ง confirmWarnings=true ถ้ามีคำเตือน — ไม่เชื่อว่า client เคยเรียก preview) · audit MOVE_KB_ARTICLE ต่อบทความ
 */
@Injectable()
export class ArticleMoveService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbArticle';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly categories: CategoriesService,
  ) {
    super(crudLog);
  }

  /** บทความในหมวดต้นทาง (ไม่รวมที่ถูกลบ) สำหรับเลือกย้าย — แบ่งหน้า */
  async candidates(q: MoveCandidatesQueryDto): Promise<Paginated<MoveCandidateDto>> {
    const all = await this.categories.allRows();
    const ids = new Set<number>(q.categoryIds);
    if (q.includeSubCategories !== false)
      for (const id of q.categoryIds) for (const d of getDescendantIds(all, id)) ids.add(d);

    const list = [...ids];
    const where = `a.CategoryID IN (${list.map((_, i) => `@${i}`).join(',')}) AND (a.IsDelete = 0 OR a.IsDelete IS NULL)`;
    const total: { N: number }[] = await this.ds.query(
      `SELECT COUNT(*) AS N FROM KMS.t_KBArticle a WHERE ${where}`,
      list,
    );
    const rows: Row[] = await this.ds.query(
      `SELECT a.ArticleID, a.ArticleCode, a.Title, a.TitleCategory, a.CategoryID, c.CategoryName, a.ArticleType, a.Status
         FROM KMS.t_KBArticle a LEFT JOIN KMS.m_KBCategory c ON c.CategoryID = a.CategoryID
        WHERE ${where}
        ORDER BY a.ArticleCode, a.ArticleID
       OFFSET @${list.length} ROWS FETCH NEXT @${list.length + 1} ROWS ONLY`,
      [...list, (q.page - 1) * q.pageSize, q.pageSize],
    );
    return paginated(rows.map(toCandidate), Number(total[0]?.N ?? 0), q);
  }

  /** ตรวจก่อนย้าย (ไม่เขียน DB) */
  async preview(articleIds: number[], toCategoryId: number): Promise<MovePreviewDto> {
    const all = await this.categories.allRows();
    const dest = requireDestination(all, toCategoryId);
    const found = await this.loadArticles(articleIds);
    const toMove = found.filter((a) => a.categoryId !== toCategoryId);
    return {
      toMoveCount: toMove.length,
      alreadyInDestinationCount: found.length - toMove.length,
      warnings: computeMoveWarnings(all, dest, toMove),
    };
  }

  /** ย้ายบทความ — ทั้งชุดใน transaction เดียว (ล้มกลางทาง = ไม่ย้ายเลย) */
  move(dto: MoveRequestDto, user: UserContext): Promise<MoveResultDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'MOVE_KB_ARTICLES',
        meta: { toCategoryId: dto.toCategoryId, requested: dto.articleIds.length },
      },
      async () => {
        const requested = [...new Set(dto.articleIds)];
        if (requested.length === 0)
          throw new BusinessException('ยังไม่ได้เลือกบทความที่จะย้าย', 'MOVE_NO_ARTICLES');

        const all = await this.categories.allRows();
        const dest = requireDestination(all, dto.toCategoryId);

        const found = await this.loadArticles(requested);
        const warnings = computeMoveWarnings(
          all,
          dest,
          found.filter((a) => a.categoryId !== dto.toCategoryId),
        );
        if (warnings.length > 0 && dto.confirmWarnings !== true)
          throw new ConflictBusinessException(
            'การย้ายครั้งนี้มีคำเตือนที่ต้องยืนยัน (ส่ง confirmWarnings=true เพื่อย้ายต่อ)',
            'MOVE_WARNINGS_NOT_CONFIRMED',
            { warnings },
          );

        const moved = await this.tx.run(async ({ manager }) => {
          const done: { articleId: number; from: number }[] = [];
          for (const part of chunkArray(requested)) {
            const toMove: { ArticleID: number; CategoryID: number }[] = await manager.query(
              `SELECT ArticleID, CategoryID FROM KMS.t_KBArticle WITH (UPDLOCK)
                WHERE ArticleID IN (${part.map((_, i) => `@${i + 1}`).join(',')})
                  AND CategoryID <> @0 AND (IsDelete = 0 OR IsDelete IS NULL)`,
              [dto.toCategoryId, ...part],
            );
            if (toMove.length === 0) continue;
            await manager.query(
              `UPDATE KMS.t_KBArticle SET CategoryID = @0, UpdatedBy = @1, UpdatedDate = GETDATE()
                WHERE ArticleID IN (${toMove.map((_, i) => `@${i + 2}`).join(',')})`,
              [dto.toCategoryId, user.adUserName || 'system', ...toMove.map((m) => m.ArticleID)],
            );
            for (const m of toMove) done.push({ articleId: m.ArticleID, from: m.CategoryID });
          }
          return done;
        });

        // audit ต่อบทความ (MOVE_KB_ARTICLE) เหมือนระบบเดิม
        for (const m of moved) {
          this.logEvent({
            action: 'UPDATE',
            operation: KMS_OP.moveArticle,
            recordId: m.articleId,
            before: { categoryId: m.from },
            after: { categoryId: dto.toCategoryId },
          });
        }

        return {
          requestedCount: requested.length,
          movedCount: moved.length,
          skippedCount: requested.length - moved.length,
          warnings,
        };
      },
      (r) => ({ meta: { moved: r.movedCount, skipped: r.skippedCount } }),
    );
  }

  /** บทความที่ยังไม่ถูกลบตาม ArticleID (แบ่งชุดตามข้อจำกัด parameter ของ SQL Server) */
  private async loadArticles(ids: number[]): Promise<{ articleId: number; categoryId: number }[]> {
    const out: { articleId: number; categoryId: number }[] = [];
    for (const part of chunkArray([...new Set(ids)])) {
      const rows: { ArticleID: number; CategoryID: number }[] = await this.ds.query(
        `SELECT ArticleID, CategoryID FROM KMS.t_KBArticle
          WHERE ArticleID IN (${part.map((_, i) => `@${i}`).join(',')}) AND (IsDelete = 0 OR IsDelete IS NULL)`,
        part,
      );
      for (const r of rows) out.push({ articleId: r.ArticleID, categoryId: r.CategoryID });
    }
    return out;
  }
}

function requireDestination(all: readonly KbCategoryRow[], toCategoryId: number): KbCategoryRow {
  const dest = all.find((c) => c.categoryId === toCategoryId);
  if (!dest) throw new BusinessException('ไม่พบหมวดปลายทาง', 'MOVE_DESTINATION_NOT_FOUND');
  if (!dest.isActive)
    throw new BusinessException(
      'หมวดปลายทางถูกปิดใช้งาน — เลือกหมวดอื่น',
      'MOVE_DESTINATION_INACTIVE',
    );
  return dest;
}

function toCandidate(raw: Row): MoveCandidateDto {
  const r = camelizeKeys<Row>(raw);
  return {
    articleId: Number(r.articleId),
    articleCode: String(r.articleCode ?? ''),
    title: String(r.title ?? ''),
    titleCategory: (r.titleCategory as string | null) ?? null,
    categoryId: Number(r.categoryId),
    categoryName: (r.categoryName as string | null) ?? null,
    articleType: Number(r.articleType),
    status: Number(r.status ?? 1),
  };
}
