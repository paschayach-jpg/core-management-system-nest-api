import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { CategoriesService } from '../categories/categories.service';
import { analyzeArticleCode } from '../codes/kb-article-code-analyzer';
import { getDescendantIds, getPath } from '../codes/kb-category-tree';
import { KbLayout } from '../codes/kb-layout';
import { KB_STATUS, KMS_OP } from '../kms.constants';
import { isUniqueViolation } from '../kms-sql';
import {
  ARTICLE_EDITABLE_COLUMNS,
  buildArticleUpdate,
  shouldCreateVersion,
} from './article-columns';
import { mapArticleDetail, mapArticleListItem } from './article-mapper';
import { ARTICLE_SORT_WHITELIST, SqlParams, buildArticleWhere } from './article-query';
import {
  LINK_LAW,
  assertTargetsExist,
  linkLawBothWays,
  loadArticleState,
  removeAllLawLinks,
  requireArticle,
} from './article-sql';
import {
  assertTransition,
  isEditableStatus,
  minRoleForTransition,
  statusOperation,
} from './article-status';
import type {
  ArticleDetailDto,
  ArticleListItemDto,
  ArticleListQueryDto,
  ArticleVersionDetailDto,
  ArticleVersionDto,
  CodeAnalysisDto,
  CodeAnalysisQueryDto,
  CreateArticleDto,
  UpdateArticleDto,
} from './dto/article.dto';

type Row = Record<string, unknown>;

const LIST_COLUMNS = `a.ArticleID, a.ArticleCode, a.Title, a.TitleCategory,
       LEFT(a.Summary, 300) AS SummaryPreview, LEFT(a.ContentHTML, 300) AS ContentPreview,
       a.CategoryID, c.CategoryName, a.ArticleType, a.Status, a.ConfidentialityLevel, a.CurrentVersion,
       a.EffectiveDate, a.PublishedDate, a.ExpiryDate, a.ReviewDueDate, a.ViewCount, a.LikeCount,
       a.IsOfficialPolicy, a.Tags, a.CreatedBy, a.CreatedDate, a.UpdatedBy, a.UpdatedDate`;

const MAX_TITLE = 500;

/**
 * บทความความรู้ (KMS.t_KBArticle) — พอร์ตจาก KBArticleService + KBArticleRepository
 * วงจรสถานะ Draft → Review → Published → Archived · แก้ไขเพิ่ม version เฉพาะเมื่อ ContentHTML เปลี่ยน · ลบ = soft delete + ลบ link สองทาง
 */
@Injectable()
export class ArticlesService extends CrudLoggedService {
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

  // ── อ่าน ────────────────────────────────────────────────────

  /** รายการบทความแบบแบ่งหน้า (ตาราง 1.9e4 แถว — ไม่คืนเนื้อหาเต็ม) กรองหมวด(+ลูก)/สถานะ/ประเภท/Title/ArticleID/คำค้น */
  async list(q: ArticleListQueryDto): Promise<Paginated<ArticleListItemDto>> {
    let categoryIds: number[] | null = null;
    if (q.categoryId !== undefined) {
      const rows = await this.categories.allRows();
      categoryIds = [q.categoryId];
      if (q.includeSubCategories !== false)
        categoryIds.push(...getDescendantIds(rows, q.categoryId));
    }

    const p = new SqlParams();
    const where = buildArticleWhere(q, categoryIds, p);
    const totalRows: { N: number }[] = await this.ds.query(
      `SELECT COUNT(*) AS N FROM KMS.t_KBArticle a WHERE ${where}`,
      p.values,
    );

    const sortCol =
      q.sortBy && Object.prototype.hasOwnProperty.call(ARTICLE_SORT_WHITELIST, q.sortBy)
        ? ARTICLE_SORT_WHITELIST[q.sortBy]
        : 'a.ArticleCode';
    const dir = q.sortDir === 'desc' ? 'DESC' : 'ASC';
    const skip = p.add((q.page - 1) * q.pageSize);
    const take = p.add(q.pageSize);

    const rows: Row[] = await this.ds.query(
      `SELECT ${LIST_COLUMNS}
         FROM KMS.t_KBArticle a
         LEFT JOIN KMS.m_KBCategory c ON c.CategoryID = a.CategoryID
        WHERE ${where}
        ORDER BY ${sortCol} ${dir}, a.ArticleID ASC
       OFFSET ${skip} ROWS FETCH NEXT ${take} ROWS ONLY`,
      p.values,
    );
    return paginated(rows.map(mapArticleListItem), Number(totalRows[0]?.N ?? 0), q);
  }

  /** รายละเอียดบทความ (ไม่กรอง IsDelete เหมือน GetById เดิม — ดู isDelete) */
  async get(id: number): Promise<ArticleDetailDto> {
    const rows: Row[] = await this.ds.query(
      `SELECT a.*, c.CategoryName,
              (SELECT COUNT(*) FROM KMS.t_KBArticleAttachment x WHERE x.ArticleID = a.ArticleID) AS AttachmentCount,
              (SELECT COUNT(*) FROM KMS.t_KBArticleLink l WHERE l.ArticleID = a.ArticleID AND l.EntityType = ${LINK_LAW}) AS RelatedCount
         FROM KMS.t_KBArticle a
         LEFT JOIN KMS.m_KBCategory c ON c.CategoryID = a.CategoryID
        WHERE a.ArticleID = @0`,
      [id],
    );
    if (rows.length === 0) throw new ResourceNotFoundException('บทความ', id);
    const path = getPath(await this.categories.allRows(), Number(rows[0].CategoryID), ' › ');
    return mapArticleDetail(rows[0], path);
  }

  /** ค้นด้วย ArticleCode (ไม่รวมที่ถูกลบ — GetByCode เดิม) */
  async getByCode(code: string): Promise<ArticleDetailDto> {
    const rows: { ArticleID: number }[] = await this.ds.query(
      `SELECT TOP 1 ArticleID FROM KMS.t_KBArticle
        WHERE ArticleCode = @0 AND (IsDelete = 0 OR IsDelete IS NULL)`,
      [code.trim()],
    );
    if (rows.length === 0) throw new ResourceNotFoundException('บทความรหัส', code);
    return this.get(rows[0].ArticleID);
  }

  /** ตรวจ Code รวมที่จะสร้างบทความ (ชนิด หมวด ชื่อ ซ้ำหรือไม่ กฎหมายแม่มีไหม) โดยไม่เขียนอะไร */
  async analyzeCode(q: CodeAnalysisQueryDto): Promise<CodeAnalysisDto> {
    const cats = await this.categories.allRows();
    const group = q.groupCategoryId
      ? (cats.find((c) => c.categoryId === q.groupCategoryId) ?? null)
      : null;
    const a = analyzeArticleCode(cats, q.code, group);

    const codeExists = a.storedCode ? await this.codeExists(a.storedCode) : false;
    let parentArticleId: number | null = null;
    if (a.parentCode) parentArticleId = await this.liveArticleIdByCode(a.parentCode);

    return {
      layout: a.layout,
      layoutLabel: a.layoutLabel,
      storedCode: a.storedCode,
      title: a.title,
      categoryId: a.category?.categoryId ?? null,
      categoryName: a.category?.categoryName ?? null,
      categoryFromCode: a.categoryFromCode,
      parentCode: a.parentCode,
      parentArticleId,
      codeExists,
      error: a.error,
      missingCategory: a.missingCategory
        ? {
            categoryCode: a.missingCategory.categoryCode,
            parentCategoryCode: a.missingCategory.parentCategoryCode ?? null,
            parentCategoryName: a.missingCategory.parentCategoryName ?? null,
          }
        : null,
      isValid: a.isValid && !codeExists,
    };
  }

  async listVersions(articleId: number): Promise<ArticleVersionDto[]> {
    await this.get(articleId);
    const rows: Row[] = await this.ds.query(
      `SELECT VersionID, ArticleID, VersionNumber, ChangeDescription, CreatedBy, CreatedDate,
              LEN(ContentSnapshot) AS ContentLength
         FROM KMS.t_KBVersion WHERE ArticleID = @0 ORDER BY VersionNumber DESC`,
      [articleId],
    );
    return rows.map(mapVersion);
  }

  async getVersion(articleId: number, versionNumber: number): Promise<ArticleVersionDetailDto> {
    const rows: Row[] = await this.ds.query(
      `SELECT VersionID, ArticleID, VersionNumber, ChangeDescription, CreatedBy, CreatedDate, ContentSnapshot,
              LEN(ContentSnapshot) AS ContentLength
         FROM KMS.t_KBVersion WHERE ArticleID = @0 AND VersionNumber = @1`,
      [articleId, versionNumber],
    );
    if (rows.length === 0) throw new ResourceNotFoundException('เวอร์ชันบทความ', versionNumber);
    return {
      ...mapVersion(rows[0]),
      contentSnapshot: String(camelizeKeys<Row>(rows[0]).contentSnapshot ?? ''),
    };
  }

  // ── เขียน ───────────────────────────────────────────────────

  /**
   * สร้างบทความใหม่ (สถานะ Draft + version 1 + link บทความที่เกี่ยวข้อง ใน transaction เดียว)
   * Code รวมตรวจด้วยกฎเดียวกับ import: กฎหมาย/พระราชกฤษฎีกาเก็บ 24 ตัวแรก ชื่อ "มาตรา N" และหมวดคำนวณจาก Code ·
   * ไม่ใช่กฎหมายเก็บเต็ม 29 ตัวและผูกกับมาตราของกฎหมายแม่ให้อัตโนมัติ (ถ้ามีในระบบ) · Code ซ้ำ (รวมที่ถูกลบ) = 409
   */
  create(dto: CreateArticleDto, user: UserContext): Promise<ArticleDetailDto> {
    return this.logged(
      { action: 'CREATE', operation: KMS_OP.createArticle, meta: { articleCode: dto.articleCode } },
      async () => {
        const cats = await this.categories.allRows();
        let group = null;
        if (dto.groupCategoryId !== undefined) {
          group = cats.find((c) => c.categoryId === dto.groupCategoryId) ?? null;
          if (!group)
            throw new BusinessException(
              `ไม่พบหมวดกลุ่มพระราชกฤษฎีกา (CategoryID ${dto.groupCategoryId})`,
              'DECREE_GROUP_NOT_FOUND',
            );
        }

        const analysis = analyzeArticleCode(cats, dto.articleCode, group);
        if (!analysis.isValid || !analysis.category || !analysis.storedCode)
          throw new BusinessException(
            analysis.error ?? 'Code รวมไม่ถูกต้อง',
            'ARTICLE_CODE_INVALID',
            {
              missingCategory: analysis.missingCategory,
            },
          );

        // ชื่อ: "มาตรา N" ของกฎหมาย/พระราชกฤษฎีกาคำนวณจาก Code (แก้ไม่ได้ ไม่งั้น import ซ้ำจะทับ) · ไม่ใช่กฎหมายต้องตั้งชื่อเอง
        const title = analysis.title ?? dto.title?.trim() ?? '';
        if (!title) throw new BusinessException('กรุณากรอกชื่อบทความ', 'TITLE_REQUIRED');
        if (title.length > MAX_TITLE)
          throw new BusinessException(`ชื่อบทความยาวเกิน ${MAX_TITLE} ตัวอักษร`, 'TITLE_TOO_LONG');

        // ArticleCode ซ้ำไม่ได้ — นับบทความที่ถูกลบด้วย (Code เดียวกับบทความที่ลบแล้ว import ซ้ำไม่ได้ จึงห้ามสร้างทับ)
        if (await this.codeExists(analysis.storedCode))
          throw new ConflictBusinessException(
            `ArticleCode '${analysis.storedCode}' มีอยู่ในระบบแล้ว (รวมบทความที่ถูกลบ)`,
            'ARTICLE_CODE_EXISTS',
          );

        const related = [...new Set(dto.relatedArticleIds ?? [])];
        if (analysis.layout === KbLayout.Decree && related.length === 0)
          throw new BusinessException(
            'พระราชกฤษฎีกาต้องผูกกับมาตราของกฎหมายที่อ้างอิงอย่างน้อย 1 มาตรา (relatedArticleIds)',
            'DECREE_REQUIRES_LAW_LINK',
          );

        const parentArticleId = analysis.parentCode
          ? await this.liveArticleIdByCode(analysis.parentCode)
          : null;
        const createdBy = user.adUserName;

        let newId: number;
        try {
          newId = await this.tx.run(async ({ manager }) => {
            await assertTargetsExist(manager, related);
            const ins: { ArticleID: number }[] = await manager.query(
              `INSERT INTO KMS.t_KBArticle
                 (ArticleCode, Title, ContentHTML, Summary, TitleCategory, CategoryID, ArticleType,
                  Status, CurrentVersion, PublishedDate, EffectiveDate, ExpiryDate, ReviewDueDate, IsOfficialPolicy,
                  Tags, ConfidentialityLevel, CreatedBy, CreatedDate, ViewCount, LikeCount, IsDelete)
               VALUES
                 (@0, @1, @2, @3, @4, @5, @6,
                  ${KB_STATUS.draft}, 1, @7, @8, @9, DATEADD(YEAR, 1, GETDATE()), 0,
                  @10, @11, @12, GETDATE(), 0, 0, 0);
               SELECT CONVERT(INT, SCOPE_IDENTITY()) AS ArticleID;`,
              [
                analysis.storedCode,
                title,
                dto.contentHtml,
                dto.summary ?? null,
                dto.titleCategory ?? null,
                analysis.category!.categoryId,
                dto.articleType,
                dto.publishedDate ?? null,
                dto.effectiveDate ?? null,
                dto.expiryDate ?? null,
                dto.tags ?? null,
                dto.confidentialityLevel ?? 1,
                createdBy,
              ],
            );
            const id = Number(ins[0].ArticleID);
            await manager.query(
              `INSERT INTO KMS.t_KBVersion (ArticleID, VersionNumber, ContentSnapshot, ChangeDescription, CreatedBy, CreatedDate)
               VALUES (@0, 1, @1, @2, @3, GETDATE())`,
              [id, dto.contentHtml, 'บทความใหม่', createdBy],
            );
            for (const other of related) await linkLawBothWays(manager, id, other, createdBy);
            if (parentArticleId) await linkLawBothWays(manager, id, parentArticleId, createdBy);
            return id;
          });
        } catch (err) {
          if (isUniqueViolation(err))
            throw new ConflictBusinessException(
              `ArticleCode '${analysis.storedCode}' มีอยู่ในระบบแล้ว (มีผู้ใช้อื่นเพิ่งสร้าง)`,
              'ARTICLE_CODE_EXISTS',
            );
          throw err;
        }
        return this.get(newId);
      },
      (r) => ({
        recordId: r.articleId,
        after: {
          articleCode: r.articleCode,
          title: r.title,
          categoryId: r.categoryId,
          status: r.status,
        },
      }),
    );
  }

  /**
   * แก้ไขบทความ — เขียนเฉพาะคอลัมน์ใน whitelist (ARTICLE_EDITABLE_COLUMNS): ไม่แตะ ArticleCode / CategoryID (ใช้ "ย้ายบทความ") /
   * Status (ใช้ submit-review/publish/archive) / ReviewDueDate / IsOfficialPolicy · เพิ่ม version ใหม่ + CurrentVersion
   * เฉพาะเมื่อ ContentHTML ต่างจากที่เก็บไว้ (เทียบ ordinal) · Archived แล้วแก้ไม่ได้
   */
  update(id: number, dto: UpdateArticleDto, user: UserContext): Promise<ArticleDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: KMS_OP.updateArticle,
        recordId: id,
        captureBefore: () => this.snapshot(id),
      },
      async () => {
        const cur = await this.loadEditable(this.ds, id);

        // กฎหมาย/พระราชกฤษฎีกา (ArticleCode 24 ตัว): ชื่อ "มาตรา N" คำนวณจาก Code เสมอ — แก้ไม่ได้
        const titleLocked = String(cur.ArticleCode).length === KbLayout.ParentCodeLength;
        if (titleLocked && dto.title !== undefined && dto.title.trim() !== String(cur.Title))
          throw new BusinessException(
            'กฎหมาย/พระราชกฤษฎีกาแก้ชื่อไม่ได้ — ชื่อคือ "มาตรา N" ที่คำนวณจาก Code รวม',
            'TITLE_LOCKED',
          );

        const merged = {
          title: titleLocked ? String(cur.Title) : (dto.title ?? String(cur.Title)).trim(),
          contentHtml: dto.contentHtml ?? String(cur.ContentHTML ?? ''),
          summary:
            dto.summary !== undefined ? dto.summary : ((cur.Summary as string | null) ?? null),
          titleCategory:
            dto.titleCategory !== undefined
              ? dto.titleCategory
              : ((cur.TitleCategory as string | null) ?? null),
          articleType: dto.articleType ?? Number(cur.ArticleType),
          publishedDate:
            dto.publishedDate !== undefined
              ? dto.publishedDate
              : ((cur.PublishedDate as Date | null) ?? null),
          effectiveDate:
            dto.effectiveDate !== undefined
              ? dto.effectiveDate
              : ((cur.EffectiveDate as Date | null) ?? null),
          expiryDate:
            dto.expiryDate !== undefined
              ? dto.expiryDate
              : ((cur.ExpiryDate as Date | null) ?? null),
          tags: dto.tags !== undefined ? dto.tags : ((cur.Tags as string | null) ?? null),
          confidentialityLevel: dto.confidentialityLevel ?? Number(cur.ConfidentialityLevel ?? 0),
        };
        if (!merged.title) throw new BusinessException('กรุณากรอกชื่อบทความ', 'TITLE_REQUIRED');
        if (merged.title.length > MAX_TITLE)
          throw new BusinessException(`ชื่อบทความยาวเกิน ${MAX_TITLE} ตัวอักษร`, 'TITLE_TOO_LONG');

        await this.tx.run(async ({ manager }) => {
          // อ่านเนื้อหาปัจจุบันใน transaction (ล็อกแถว) แล้วตัดสินใจสร้าง version จากค่านี้ ไม่ใช่ค่าที่อ่านก่อนหน้า
          const locked: { ContentHTML: string | null; Status: number }[] = await manager.query(
            `SELECT ContentHTML, Status FROM KMS.t_KBArticle WITH (UPDLOCK)
              WHERE ArticleID = @0 AND (IsDelete = 0 OR IsDelete IS NULL)`,
            [id],
          );
          if (locked.length === 0) throw new ResourceNotFoundException('บทความ', id);
          if (!isEditableStatus(Number(locked[0].Status)))
            throw new BusinessException('บทความที่ Archive แล้วแก้ไขไม่ได้', 'ARTICLE_ARCHIVED');

          let nextVersion: number | null = null;
          if (shouldCreateVersion(locked[0].ContentHTML, merged.contentHtml)) {
            const n: { N: number }[] = await manager.query(
              `SELECT ISNULL(MAX(VersionNumber), 0) + 1 AS N
                 FROM KMS.t_KBVersion WITH (UPDLOCK, HOLDLOCK) WHERE ArticleID = @0`,
              [id],
            );
            nextVersion = Number(n[0].N);
            await manager.query(
              `INSERT INTO KMS.t_KBVersion (ArticleID, VersionNumber, ContentSnapshot, ChangeDescription, CreatedBy, CreatedDate)
               VALUES (@0, @1, @2, @3, @4, GETDATE())`,
              [
                id,
                nextVersion,
                merged.contentHtml,
                dto.changeDescription?.trim() || 'แก้ไขบทความ',
                user.adUserName,
              ],
            );
          }

          const upd = buildArticleUpdate(
            id,
            ARTICLE_EDITABLE_COLUMNS,
            merged,
            ARTICLE_EDITABLE_COLUMNS,
            user.adUserName,
            nextVersion,
          );
          const res: { N: number }[] = await manager.query(
            `${upd.sql}; SELECT @@ROWCOUNT AS N;`,
            upd.params,
          );
          if (Number(res[0]?.N) === 0) throw new ResourceNotFoundException('บทความ', id);
        });
        return this.get(id);
      },
      (r) => ({ after: { title: r.title, status: r.status, currentVersion: r.currentVersion } }),
    );
  }

  /**
   * เปลี่ยนสถานะ: ส่งขอ Review (Draft→Review) ทุกคนทำได้ · เผยแพร่ (Review→Published) และ Archive (Published→Archived) ต้อง Manager ขึ้นไป ·
   * ข้ามขั้น/ย้อนกลับไม่ได้ · Archived แล้วเปลี่ยนไม่ได้อีก · ชื่อ audit เดิม SUBMIT_REVIEW | PUBLISH | ARCHIVE
   */
  changeStatus(id: number, to: number, user: UserContext): Promise<ArticleDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: statusOperation(to),
        recordId: id,
        meta: { to },
        captureBefore: () => this.snapshot(id),
      },
      async () => {
        const minRole = minRoleForTransition(to);
        if (minRole !== null && user.appRole < minRole)
          throw new PermissionDeniedException(
            'สิทธิ์ของท่านไม่เพียงพอสำหรับการเผยแพร่/Archive บทความ (ต้องเป็น Manager ขึ้นไป)',
            'ARTICLE_STATUS_ROLE_DENIED',
          );

        const state = await loadArticleState(this.ds, id);
        if (!state || state.isDelete) throw new ResourceNotFoundException('บทความ', id);
        assertTransition(state.status, to);

        // ReviewedBy ตั้งทุกครั้งที่เปลี่ยนสถานะเหมือนระบบเดิม · PublishedDate: ตั้งเมื่อเผยแพร่ถ้ายังว่าง (ไม่ทับวันประกาศที่ import เข้ามา — ต่างจากระบบเดิมที่ทับเสมอ)
        const res: { N: number }[] = await this.ds.query(
          `UPDATE KMS.t_KBArticle SET
             Status        = @0,
             ReviewedBy    = @1,
             ReviewedDate  = CASE WHEN @0 = ${KB_STATUS.published} THEN GETDATE() ELSE ReviewedDate END,
             PublishedDate = CASE WHEN @0 = ${KB_STATUS.published} THEN ISNULL(PublishedDate, GETDATE()) ELSE PublishedDate END,
             UpdatedBy     = @1,
             UpdatedDate   = GETDATE()
           WHERE ArticleID = @2 AND Status = @3 AND (IsDelete = 0 OR IsDelete IS NULL);
           SELECT @@ROWCOUNT AS N;`,
          [to, user.adUserName, id, state.status],
        );
        if (Number(res[0]?.N) === 0)
          throw new ConflictBusinessException(
            'สถานะบทความถูกเปลี่ยนโดยผู้อื่นแล้ว กรุณาโหลดใหม่',
            'ARTICLE_STATUS_CHANGED',
          );
        return this.get(id);
      },
      (r) => ({ after: { status: r.status, publishedDate: r.publishedDate } }),
    );
  }

  /** ลบบทความ (soft delete: IsDelete = 1) พร้อมลบ link บทความที่เกี่ยวข้องทั้งสองทาง ใน transaction เดียว */
  softDelete(id: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: KMS_OP.deleteArticle,
        recordId: id,
        captureBefore: () => this.snapshot(id),
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          await requireArticle(manager, id);
          const removed = await removeAllLawLinks(manager, id);
          await manager.query(
            `UPDATE KMS.t_KBArticle SET IsDelete = 1, UpdatedBy = @1, UpdatedDate = GETDATE() WHERE ArticleID = @0`,
            [id, user.adUserName],
          );
          return removed;
        });
      },
    );
  }

  /** นับการเปิดอ่าน (+1) — ไม่ใช่ข้อมูลที่ต้อง audit (ระบบเดิมไม่เขียน audit) บันทึกเป็น READ (เก็บเมื่อ CRUD_LOG_LEVEL=all) */
  incrementView(id: number): Promise<void> {
    return this.logged({ action: 'READ', operation: 'VIEW_KB_ARTICLE', recordId: id }, async () => {
      await this.bump(id, 'ViewCount');
    });
  }

  incrementLike(id: number): Promise<void> {
    return this.logged(
      { action: 'UPDATE', operation: 'LIKE_KB_ARTICLE', recordId: id },
      async () => {
        await this.bump(id, 'LikeCount');
      },
    );
  }

  /** ตั้ง/ล้างวันหมดอายุ (null = ไม่มีวันหมดอายุ) */
  setExpiryDate(id: number, expiryDate: Date | null, user: UserContext): Promise<ArticleDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_KB_ARTICLE_EXPIRY',
        recordId: id,
        meta: { expiryDate },
      },
      async () => {
        await requireArticle(this.ds, id);
        await this.ds.query(
          `UPDATE KMS.t_KBArticle SET ExpiryDate = @0, UpdatedBy = @1, UpdatedDate = GETDATE() WHERE ArticleID = @2`,
          [expiryDate, user.adUserName, id],
        );
        return this.get(id);
      },
    );
  }

  // ── ภายใน ───────────────────────────────────────────────────

  private async bump(id: number, column: 'ViewCount' | 'LikeCount'): Promise<void> {
    const res: { N: number }[] = await this.ds.query(
      `UPDATE KMS.t_KBArticle SET ${column} = ISNULL(${column}, 0) + 1
        WHERE ArticleID = @0 AND (IsDelete = 0 OR IsDelete IS NULL); SELECT @@ROWCOUNT AS N;`,
      [id],
    );
    if (Number(res[0]?.N) === 0) throw new ResourceNotFoundException('บทความ', id);
  }

  /** ArticleCode ซ้ำหรือไม่ — นับที่ถูกลบด้วย (ExistsByCode เดิมไม่กรอง IsDelete) */
  private async codeExists(code: string): Promise<boolean> {
    const rows = await this.ds.query(
      'SELECT TOP 1 1 AS X FROM KMS.t_KBArticle WHERE ArticleCode = @0',
      [code],
    );
    return rows.length > 0;
  }

  /** ArticleID ของบทความที่ไม่ถูกลบตาม ArticleCode (GetByCode เดิมกรอง IsDelete) */
  private async liveArticleIdByCode(code: string): Promise<number | null> {
    const rows: { ArticleID: number }[] = await this.ds.query(
      `SELECT TOP 1 ArticleID FROM KMS.t_KBArticle WHERE ArticleCode = @0 AND (IsDelete = 0 OR IsDelete IS NULL)`,
      [code],
    );
    return rows[0]?.ArticleID ?? null;
  }

  private async loadEditable(q: DataSource, id: number): Promise<Row> {
    const rows: Row[] = await q.query(
      `SELECT * FROM KMS.t_KBArticle WHERE ArticleID = @0 AND (IsDelete = 0 OR IsDelete IS NULL)`,
      [id],
    );
    if (rows.length === 0) throw new ResourceNotFoundException('บทความ', id);
    if (!isEditableStatus(Number(rows[0].Status)))
      throw new BusinessException('บทความที่ Archive แล้วแก้ไขไม่ได้', 'ARTICLE_ARCHIVED');
    return rows[0];
  }

  /** ภาพสรุปสำหรับ before/after ของ CRUD-log (ไม่ใส่เนื้อหาเต็ม เพื่อไม่ให้ log บวม) */
  private async snapshot(id: number): Promise<Row | null> {
    const rows: Row[] = await this.ds.query(
      `SELECT ArticleCode, Title, Status, CategoryID, CurrentVersion, ArticleType, ConfidentialityLevel,
              LEN(ContentHTML) AS ContentLength, IsDelete
         FROM KMS.t_KBArticle WHERE ArticleID = @0`,
      [id],
    );
    return rows[0] ?? null;
  }
}

function mapVersion(raw: Row): ArticleVersionDto {
  const r = camelizeKeys<Row>(raw);
  return {
    versionId: Number(r.versionId),
    articleId: Number(r.articleId),
    versionNumber: Number(r.versionNumber),
    changeDescription: (r.changeDescription as string | null) ?? null,
    createdBy: String(r.createdBy ?? ''),
    createdDate: (r.createdDate as Date | null) ?? null,
    contentLength: Number(r.contentLength ?? 0),
  };
}
