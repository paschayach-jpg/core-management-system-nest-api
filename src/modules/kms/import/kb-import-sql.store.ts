import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { camelizeKeys } from '../../../common/utils/camelize';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import {
  IMPORT_UPDATABLE_COLUMNS,
  buildArticleUpdate,
  shouldCreateVersion,
} from '../articles/article-columns';
import { LINK_FILE, attachFileRow, ensureLink, linkLawBothWays } from '../articles/article-sql';
import { KbCategoryRow, toCategoryRow } from '../codes/kb-category-tree';
import { chunkArray } from '../kms-sql';
import {
  ExistingArticleInfo,
  ExistingArticleResult,
  ExistingArticleWrite,
  KbImportStore,
  NewArticleResult,
  NewArticleWrite,
} from './kb-import.store';

/**
 * Import store ของจริง (SQL Server): ทุกการเขียนต่อบทความอยู่ใน transaction เดียว
 * ไม่มี Stored Procedure ของ KMS ใน DB — ใช้ SQL ตรงแบบ parameterize ทั้งหมด (ชื่อคอลัมน์ที่เขียนทับมาจาก whitelist เท่านั้น)
 */
@Injectable()
export class SqlKbImportStore extends KbImportStore {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
  ) {
    super();
  }

  async loadCategories(): Promise<KbCategoryRow[]> {
    const rows: Record<string, unknown>[] = await this.ds.query(
      `SELECT CategoryID, ParentCategoryID, CategoryCode, CategoryName, SortOrder, IsActive, DisplayProfileID, ImportTypeDigit
         FROM KMS.m_KBCategory`,
    );
    return rows.map((r) => {
      const c = camelizeKeys<Record<string, unknown>>(r);
      return toCategoryRow({
        categoryId: Number(c.categoryId),
        parentCategoryId: c.parentCategoryId === null ? null : Number(c.parentCategoryId),
        categoryCode: String(c.categoryCode ?? ''),
        categoryName: String(c.categoryName ?? ''),
        sortOrder: Number(c.sortOrder ?? 0),
        isActive: Boolean(c.isActive),
        displayProfileId: c.displayProfileId === null ? null : Number(c.displayProfileId),
        importTypeDigit: c.importTypeDigit === null ? null : String(c.importTypeDigit),
      });
    });
  }

  async findArticlesByCodes(codes: string[]): Promise<Map<string, ExistingArticleInfo>> {
    const found = new Map<string, ExistingArticleInfo>();
    const unique = [...new Set(codes.filter(Boolean))];
    for (const part of chunkArray(unique)) {
      const rows: { ArticleID: number; ArticleCode: string; IsDelete: boolean | null }[] =
        await this.ds.query(
          `SELECT ArticleID, ArticleCode, IsDelete FROM KMS.t_KBArticle WHERE ArticleCode IN (${part.map((_, i) => `@${i}`).join(',')})`,
          part,
        );
      for (const r of rows) {
        found.set(r.ArticleCode.trim().toLowerCase(), {
          articleId: r.ArticleID,
          articleCode: r.ArticleCode,
          isDelete: Boolean(r.IsDelete),
        });
      }
    }
    return found;
  }

  async getAttachmentFileIds(articleId: number): Promise<number[]> {
    const rows: { FileID: number }[] = await this.ds.query(
      'SELECT FileID FROM KMS.t_KBArticleAttachment WHERE ArticleID = @0 ORDER BY AttachmentID',
      [articleId],
    );
    return rows.map((r) => r.FileID);
  }

  insertArticle(input: NewArticleWrite): Promise<NewArticleResult> {
    return this.tx.run(async ({ manager }) => {
      const a = input.article;
      const inserted: { ArticleID: number }[] = await manager.query(
        `INSERT INTO KMS.t_KBArticle
           (ArticleCode, Title, ContentHTML, Summary, TitleCategory, CategoryID, ArticleType,
            Status, CurrentVersion, PublishedDate, EffectiveDate, ExpiryDate, ReviewDueDate, IsOfficialPolicy,
            Tags, ConfidentialityLevel, CreatedBy, CreatedDate, ViewCount, LikeCount, IsDelete)
         VALUES
           (@0, @1, @2, @3, @4, @5, @6,
            @7, 1, @8, @9, NULL, NULL, 0,
            @10, @11, @12, GETDATE(), 0, 0, 0);
         SELECT CONVERT(INT, SCOPE_IDENTITY()) AS ArticleID;`,
        [
          a.articleCode,
          a.title,
          a.contentHtml,
          a.summary,
          a.titleCategory,
          a.categoryId,
          a.articleType,
          a.status,
          a.publishedDate,
          a.effectiveDate,
          a.tags,
          a.confidentialityLevel,
          a.createdBy,
        ],
      );
      const articleId = Number(inserted[0].ArticleID);

      if (input.initialVersion) {
        await manager.query(
          `INSERT INTO KMS.t_KBVersion (ArticleID, VersionNumber, ContentSnapshot, ChangeDescription, CreatedBy, CreatedDate)
           VALUES (@0, 1, @1, NULL, @2, GETDATE())`,
          [articleId, input.initialVersion.contentSnapshot, input.initialVersion.createdBy],
        );
      }

      let parentLinksInserted = 0;
      for (const parentId of input.parentArticleIds)
        parentLinksInserted += await linkLawBothWays(manager, articleId, parentId, input.createdBy);

      if (input.fileId !== null)
        await attachFileRow(manager, articleId, input.fileId, input.createdBy);

      return { articleId, parentLinksInserted };
    });
  }

  updateArticleFromImport(input: ExistingArticleWrite): Promise<ExistingArticleResult> {
    return this.tx.run(async ({ manager }) => {
      let nextVersion: number | null = null;

      // เพิ่ม version ใหม่เฉพาะเมื่อ ContentHTML ต่างจากที่เก็บไว้ (เทียบ ordinal) — อ่านค่าปัจจุบันใน transaction เดียวกัน
      if (input.versioning) {
        const cur: { ContentHTML: string | null }[] = await manager.query(
          'SELECT ContentHTML FROM KMS.t_KBArticle WITH (UPDLOCK) WHERE ArticleID = @0',
          [input.articleId],
        );
        if (cur.length > 0 && shouldCreateVersion(cur[0].ContentHTML, input.patch.contentHtml)) {
          const n: { N: number }[] = await manager.query(
            `SELECT ISNULL(MAX(VersionNumber), 0) + 1 AS N
               FROM KMS.t_KBVersion WITH (UPDLOCK, HOLDLOCK) WHERE ArticleID = @0`,
            [input.articleId],
          );
          nextVersion = Number(n[0].N);
          await manager.query(
            `INSERT INTO KMS.t_KBVersion (ArticleID, VersionNumber, ContentSnapshot, ChangeDescription, CreatedBy, CreatedDate)
             VALUES (@0, @1, @2, @3, @4, GETDATE())`,
            [
              input.articleId,
              nextVersion,
              input.patch.contentHtml ?? '',
              input.versioning.changeDescription,
              input.versioning.createdBy,
            ],
          );
        }
      }

      const upd = buildArticleUpdate(
        input.articleId,
        input.columns,
        input.patch,
        IMPORT_UPDATABLE_COLUMNS,
        input.updatedBy,
        nextVersion,
      );
      const res: { N: number }[] = await manager.query(
        `${upd.sql}; SELECT @@ROWCOUNT AS N;`,
        upd.params,
      );
      if (!res[0] || Number(res[0].N) === 0)
        throw new Error(`ไม่พบบทความ ArticleID ${input.articleId} ที่จะอัปเดต`);

      let fileLinksRepaired = 0;
      if (input.repairFileLinks) {
        const files: { FileID: number }[] = await manager.query(
          'SELECT FileID FROM KMS.t_KBArticleAttachment WHERE ArticleID = @0',
          [input.articleId],
        );
        for (const f of files) {
          if (
            await ensureLink(manager, input.articleId, LINK_FILE, String(f.FileID), input.createdBy)
          )
            fileLinksRepaired++;
        }
      }

      let attached = false;
      if (input.attachFileId !== null) {
        await attachFileRow(manager, input.articleId, input.attachFileId, input.createdBy);
        attached = true;
      }

      let parentLinksInserted = 0;
      for (const parentId of input.parentArticleIds)
        parentLinksInserted += await linkLawBothWays(
          manager,
          input.articleId,
          parentId,
          input.createdBy,
        );

      return {
        versionCreated: nextVersion !== null,
        parentLinksInserted,
        fileLinksRepaired,
        attached,
      };
    });
  }
}
