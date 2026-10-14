import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Paginated, paginated, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { LIKE_ESCAPE, likeContains } from '../../../common/utils/query.util';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import {
  KbCategoryRow,
  flattenTree,
  getDescendantIds,
  getPath,
  toCategoryRow,
} from '../codes/kb-category-tree';
import { KMS_OP } from '../kms.constants';
import { KbCategory } from '../entities/kb-category.entity';
import { isUniqueViolation } from '../kms-sql';
import { assertUniqueCode, assertValidParent, normalizeImportTypeDigit } from './category-rules';
import type {
  CategoryListQueryDto,
  CategorySummaryDto,
  CategoryTitleDto,
  CreateCategoryDto,
  KbCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

/**
 * หมวดหมู่ความรู้ (KMS.m_KBCategory) — พอร์ตจาก KBCategoryService/KBCategoryRepository
 * ต้นไม้ลึกกี่ชั้นก็ได้ (ParentCategoryID) · CategoryID อาจเป็น IDENTITY หรือ INT ธรรมดา (ตรวจจาก DB แล้วใช้ MAX+1 แบบ Serializable เมื่อไม่ใช่)
 */
@Injectable()
export class CategoriesService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbCategory';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(KbCategory) private readonly repo: Repository<KbCategory>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  // ── อ่าน ────────────────────────────────────────────────────

  /** หมวดทั้งหมดแบบ entity (94 แถว — เล็กพอให้โหลดทั้งหมด) */
  private loadAll(): Promise<KbCategory[]> {
    return this.repo.find();
  }

  /** หมวดทั้งหมดเรียงตามต้นไม้ พร้อมระดับชั้นและเส้นทาง */
  async list(q: CategoryListQueryDto = {}): Promise<KbCategoryDto[]> {
    const entities = await this.loadAll();
    const rows = entities.map(toCategoryRow);
    const byId = new Map(entities.map((e) => [e.categoryId, e]));
    const nameOf = new Map(rows.map((r) => [r.categoryId, r.categoryName]));

    let items = flattenTree(rows, q.activeOnly === true);
    if (q.parentId !== undefined)
      items = items.filter((i) => i.category.parentCategoryId === q.parentId);
    if (q.rootsOnly) items = items.filter((i) => i.category.parentCategoryId === null);

    return items.map((i) =>
      this.toDto(byId.get(i.category.categoryId) as KbCategory, rows, nameOf, i.depth),
    );
  }

  async get(id: number): Promise<KbCategoryDto> {
    const entities = await this.loadAll();
    const e = entities.find((x) => x.categoryId === id);
    if (!e) throw new ResourceNotFoundException('หมวดหมู่ความรู้', id);
    const rows = entities.map(toCategoryRow);
    return this.toDto(e, rows, new Map(rows.map((r) => [r.categoryId, r.categoryName])), 0);
  }

  /** จำนวนบทความต่อหมวด (ไม่นับที่ถูกลบ) ทั้งของหมวดเองและรวมหมวดย่อย — ใช้วาด KB tree */
  async summary(): Promise<CategorySummaryDto[]> {
    const rows = (await this.loadAll()).map(toCategoryRow);
    const counts: { CategoryID: number; Cnt: number }[] = await this.ds.query(
      `SELECT CategoryID, COUNT(*) AS Cnt FROM KMS.t_KBArticle
        WHERE IsDelete = 0 OR IsDelete IS NULL GROUP BY CategoryID`,
    );
    const own = new Map(counts.map((c) => [c.CategoryID, Number(c.Cnt)]));
    return rows.map((r) => {
      let total = own.get(r.categoryId) ?? 0;
      for (const d of getDescendantIds(rows, r.categoryId)) total += own.get(d) ?? 0;
      return { categoryId: r.categoryId, ownCount: own.get(r.categoryId) ?? 0, totalCount: total };
    });
  }

  /** Title ที่ไม่ซ้ำในหมวด (ใบของ KB tree "📄 Title") พร้อมจำนวนบทความ — แบ่งหน้า · เรียงตาม ArticleCode แรกของแต่ละ Title */
  async titles(categoryId: number, q: PaginationQueryDto): Promise<Paginated<CategoryTitleDto>> {
    await this.get(categoryId);
    const search = q.q?.trim();
    const where = `CategoryID = @0 AND (IsDelete = 0 OR IsDelete IS NULL)${search ? ` AND Title LIKE @1 ${LIKE_ESCAPE}` : ''}`;
    const baseParams: unknown[] = search ? [categoryId, likeContains(search)] : [categoryId];

    const total: { N: number }[] = await this.ds.query(
      `SELECT COUNT(*) AS N FROM (SELECT Title FROM KMS.t_KBArticle WHERE ${where} GROUP BY Title) t`,
      baseParams,
    );
    const rows: { Title: string; Cnt: number; FirstId: number }[] = await this.ds.query(
      `SELECT Title, COUNT(*) AS Cnt, MIN(ArticleID) AS FirstId, MIN(ArticleCode) AS FirstCode
         FROM KMS.t_KBArticle WHERE ${where}
        GROUP BY Title ORDER BY MIN(ArticleCode)
       OFFSET ${(q.page - 1) * q.pageSize} ROWS FETCH NEXT ${q.pageSize} ROWS ONLY`,
      baseParams,
    );
    return paginated(
      rows.map((r) => ({ title: r.Title, articleCount: Number(r.Cnt), firstArticleId: r.FirstId })),
      Number(total[0]?.N ?? 0),
      q,
    );
  }

  // ── เขียน ───────────────────────────────────────────────────

  create(dto: CreateCategoryDto, user: UserContext): Promise<KbCategoryDto> {
    return this.logged(
      { action: 'CREATE', operation: KMS_OP.createCategory },
      async () => {
        const all = (await this.loadAll()).map(toCategoryRow);
        const candidate = {
          categoryId: 0,
          parentCategoryId: dto.parentCategoryId ?? null,
          categoryCode: dto.categoryCode.trim(),
        };
        assertUniqueCode(candidate, all);
        assertValidParent(candidate, all);
        const digit = normalizeImportTypeDigit(dto.importTypeDigit, candidate, all);

        let newId: number;
        try {
          newId = await this.insertCategory(
            {
              parentCategoryId: candidate.parentCategoryId,
              categoryCode: candidate.categoryCode,
              categoryName: dto.categoryName.trim(),
              icon: dto.icon ?? null,
              description: dto.description?.trim() || null,
              sortOrder: dto.sortOrder ?? 0,
              importTypeDigit: digit,
            },
            user.adUserName,
          );
        } catch (err) {
          if (isUniqueViolation(err))
            throw new ConflictBusinessException(
              'รหัสหมวดหรือรหัสประเภทเอกสารซ้ำกับหมวดอื่น (มีผู้ใช้อื่นเพิ่งเพิ่ม)',
              'CATEGORY_CODE_DUPLICATE',
            );
          throw err;
        }
        return this.get(newId);
      },
      (r) => ({ recordId: r.categoryId, after: r }),
    );
  }

  update(id: number, dto: UpdateCategoryDto, _user: UserContext): Promise<KbCategoryDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: KMS_OP.updateCategory,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        const entities = await this.loadAll();
        const current = entities.find((e) => e.categoryId === id);
        if (!current) throw new ResourceNotFoundException('หมวดหมู่ความรู้', id);
        const all = entities.map(toCategoryRow);

        const candidate = {
          categoryId: id,
          parentCategoryId:
            dto.parentCategoryId !== undefined
              ? dto.parentCategoryId
              : (current.parentCategoryId ?? null),
          categoryCode: (dto.categoryCode ?? current.categoryCode).trim(),
        };
        assertUniqueCode(candidate, all);
        assertValidParent(candidate, all);
        const digit = normalizeImportTypeDigit(
          dto.importTypeDigit !== undefined ? dto.importTypeDigit : current.importTypeDigit,
          candidate,
          all,
        );

        // DisplayProfileID ไม่แก้ที่นี่ (ผูกด้วย PUT /kms/categories/:id/display-profile) — คงค่าที่เก็บไว้ ไม่ให้ถูกเขียนทับเป็น null
        try {
          await this.ds.query(
            `UPDATE KMS.m_KBCategory SET
               ParentCategoryID = @0, CategoryCode = @1, CategoryName = @2, Icon = @3,
               Description = @4, SortOrder = @5, ImportTypeDigit = @6
             WHERE CategoryID = @7`,
            [
              candidate.parentCategoryId,
              candidate.categoryCode,
              (dto.categoryName ?? current.categoryName).trim(),
              dto.icon !== undefined ? dto.icon : (current.icon ?? null),
              dto.description !== undefined
                ? dto.description?.trim() || null
                : (current.description ?? null),
              dto.sortOrder ?? current.sortOrder ?? 0,
              digit,
              id,
            ],
          );
        } catch (err) {
          if (isUniqueViolation(err))
            throw new ConflictBusinessException(
              'รหัสหมวดหรือรหัสประเภทเอกสารซ้ำกับหมวดอื่น',
              'CATEGORY_CODE_DUPLICATE',
            );
          throw err;
        }
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  /** ปิดใช้งาน (IsActive = 0) — ไม่ลบแถว · ทำซ้ำได้ (idempotent) */
  deactivate(id: number): Promise<KbCategoryDto> {
    return this.logged(
      {
        action: 'DELETE',
        operation: KMS_OP.deactivateCategory,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        await this.get(id);
        await this.ds.query('UPDATE KMS.m_KBCategory SET IsActive = 0 WHERE CategoryID = @0', [id]);
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  // ── ภายใน ───────────────────────────────────────────────────

  /**
   * เพิ่มหมวด คืน CategoryID · CategoryID เป็น IDENTITY ในตารางที่สร้างจากสคริปต์ 03 แต่ในบาง DB (เช่น CMS_DB) เป็น INT ธรรมดา
   * — ตรวจจริงใน transaction เดียวกัน: ไม่ใช่ IDENTITY → MAX(CategoryID)+1 (ล็อกช่วงด้วย UPDLOCK/HOLDLOCK ผู้เพิ่มพร้อมกันจึงรอกัน ไม่ได้เลขซ้ำ)
   */
  private insertCategory(
    c: {
      parentCategoryId: number | null;
      categoryCode: string;
      categoryName: string;
      icon: string | null;
      description: string | null;
      sortOrder: number;
      importTypeDigit: string | null;
    },
    createdBy: string,
  ): Promise<number> {
    const values = [
      c.parentCategoryId,
      c.categoryCode,
      c.categoryName,
      c.icon,
      c.description,
      c.sortOrder,
      createdBy,
      c.importTypeDigit,
    ];
    return this.tx.run(
      async ({ manager }) => {
        const idInfo: { IsIdentity: number }[] = await manager.query(
          `SELECT ISNULL(COLUMNPROPERTY(OBJECT_ID('KMS.m_KBCategory'), 'CategoryID', 'IsIdentity'), 0) AS IsIdentity`,
        );
        if (Number(idInfo[0]?.IsIdentity) === 1) {
          const r: { CategoryID: number }[] = await manager.query(
            `INSERT INTO KMS.m_KBCategory
               (ParentCategoryID, CategoryCode, CategoryName, Icon, Description, SortOrder, IsActive, CreatedBy, CreatedDate, DisplayProfileID, ImportTypeDigit)
             VALUES (@0, @1, @2, @3, @4, @5, 1, @6, GETDATE(), NULL, @7);
             SELECT CONVERT(INT, SCOPE_IDENTITY()) AS CategoryID;`,
            values,
          );
          return Number(r[0].CategoryID);
        }
        const r: { CategoryID: number }[] = await manager.query(
          `DECLARE @NewID INT;
           SELECT @NewID = ISNULL(MAX(CategoryID), 0) + 1 FROM KMS.m_KBCategory WITH (UPDLOCK, HOLDLOCK);
           INSERT INTO KMS.m_KBCategory
             (CategoryID, ParentCategoryID, CategoryCode, CategoryName, Icon, Description, SortOrder, IsActive, CreatedBy, CreatedDate, DisplayProfileID, ImportTypeDigit)
           VALUES (@NewID, @0, @1, @2, @3, @4, @5, 1, @6, GETDATE(), NULL, @7);
           SELECT @NewID AS CategoryID;`,
          values,
        );
        return Number(r[0].CategoryID);
      },
      { isolation: 'SERIALIZABLE' },
    );
  }

  private toDto(
    e: KbCategory,
    rows: KbCategoryRow[],
    nameOf: Map<number, string>,
    depth: number,
  ): KbCategoryDto {
    return {
      categoryId: e.categoryId,
      parentCategoryId: e.parentCategoryId ?? null,
      parentCategoryName:
        e.parentCategoryId != null ? (nameOf.get(e.parentCategoryId) ?? null) : null,
      categoryCode: e.categoryCode,
      categoryName: e.categoryName,
      icon: e.icon ?? null,
      description: e.description ?? null,
      sortOrder: e.sortOrder ?? 0,
      isActive: e.isActive !== false,
      displayProfileId: e.displayProfileId ?? null,
      importTypeDigit: e.importTypeDigit?.trim() || null,
      createdBy: e.createdBy ?? null,
      createdDate: e.createdDate ?? null,
      depth,
      path: getPath(rows, e.categoryId, ' › '),
    };
  }

  /** ใช้ภายใน KMS: หมวดทั้งหมดในรูปแบบฟังก์ชันล้วน */
  async allRows(): Promise<KbCategoryRow[]> {
    return (await this.loadAll()).map(toCategoryRow);
  }
}
