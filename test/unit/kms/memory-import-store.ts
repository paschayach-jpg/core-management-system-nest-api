import { shouldCreateVersion } from '../../../src/modules/kms/articles/article-columns';
import type { KbCategoryRow } from '../../../src/modules/kms/codes/kb-category-tree';
import {
  ExistingArticleInfo,
  ExistingArticleResult,
  ExistingArticleWrite,
  KbImportStore,
  NewArticleResult,
  NewArticleWrite,
} from '../../../src/modules/kms/import/kb-import.store';
import type {
  DmsFileInfo,
  DmsFilePort,
  DmsFileReadHandle,
  DmsUploadInput,
} from '../../../src/modules/dms/ports/dms-file.port';

export interface MemArticle {
  articleId: number;
  articleCode: string;
  title: string;
  contentHtml: string;
  summary: string | null;
  titleCategory: string | null;
  categoryId: number;
  articleType: number;
  status: number;
  currentVersion: number;
  publishedDate: Date | null;
  effectiveDate: Date | null;
  tags: string | null;
  confidentialityLevel: number;
  createdBy: string;
  updatedBy: string | null;
  isDelete: boolean;
}

/** DB จำลองในหน่วยความจำที่ทำงานตามสัญญาของ KbImportStore (ทุกการเขียนต่อบทความเป็นอะตอมมิก) */
export class MemoryImportStore extends KbImportStore {
  articles = new Map<number, MemArticle>();
  versions: {
    articleId: number;
    versionNumber: number;
    content: string;
    changeDescription: string | null;
  }[] = [];
  links: { articleId: number; entityType: number; entityId: string }[] = [];
  attachments: { articleId: number; fileId: number }[] = [];
  private nextId = 100;
  /** ใส่ฟังก์ชันเพื่อบังคับให้การ insert/update ล้มเหลว (ทดสอบ rollback) */
  failInsertWhen: ((w: NewArticleWrite) => boolean) | null = null;
  failUpdateWhen: ((w: ExistingArticleWrite) => boolean) | null = null;

  constructor(public categories: KbCategoryRow[]) {
    super();
  }

  seedArticle(a: Partial<MemArticle> & { articleCode: string; categoryId: number }): MemArticle {
    const art: MemArticle = {
      articleId: this.nextId++,
      title: 'เดิม',
      contentHtml: 'เนื้อหาเดิม',
      summary: 'สรุปเดิม',
      titleCategory: 'อ้างอิงเดิม',
      articleType: 5,
      status: 3,
      currentVersion: 1,
      publishedDate: null,
      effectiveDate: null,
      tags: null,
      confidentialityLevel: 2,
      createdBy: 'seed',
      updatedBy: null,
      isDelete: false,
      ...a,
    };
    this.articles.set(art.articleId, art);
    return art;
  }

  byCode(code: string): MemArticle | undefined {
    return [...this.articles.values()].find(
      (a) => a.articleCode.toLowerCase() === code.toLowerCase(),
    );
  }

  hasLink(articleId: number, entityType: number, entityId: string | number): boolean {
    return this.links.some(
      (l) =>
        l.articleId === articleId && l.entityType === entityType && l.entityId === String(entityId),
    );
  }

  async loadCategories(): Promise<KbCategoryRow[]> {
    return this.categories;
  }

  async findArticlesByCodes(codes: string[]): Promise<Map<string, ExistingArticleInfo>> {
    const m = new Map<string, ExistingArticleInfo>();
    for (const c of codes) {
      const a = this.byCode(c);
      if (a)
        m.set(a.articleCode.toLowerCase(), {
          articleId: a.articleId,
          articleCode: a.articleCode,
          isDelete: a.isDelete,
        });
    }
    return m;
  }

  async getAttachmentFileIds(articleId: number): Promise<number[]> {
    return this.attachments.filter((a) => a.articleId === articleId).map((a) => a.fileId);
  }

  private ensureLink(articleId: number, entityType: number, entityId: string): boolean {
    if (this.hasLink(articleId, entityType, entityId)) return false;
    this.links.push({ articleId, entityType, entityId });
    return true;
  }

  async insertArticle(input: NewArticleWrite): Promise<NewArticleResult> {
    if (this.failInsertWhen?.(input)) throw new Error('จำลอง: insert ล้มเหลว');
    if (this.byCode(input.article.articleCode)) throw new Error('UNIQUE KEY violation');
    const snapshot = this.snapshot();
    try {
      const articleId = this.nextId++;
      this.articles.set(articleId, {
        articleId,
        ...input.article,
        currentVersion: 1,
        updatedBy: null,
        isDelete: false,
      });
      if (input.initialVersion)
        this.versions.push({
          articleId,
          versionNumber: 1,
          content: input.initialVersion.contentSnapshot,
          changeDescription: null,
        });
      let n = 0;
      for (const p of input.parentArticleIds) {
        if (this.ensureLink(articleId, 4, String(p))) n++;
        if (this.ensureLink(p, 4, String(articleId))) n++;
      }
      if (input.fileId !== null) {
        this.attachments.push({ articleId, fileId: input.fileId });
        this.ensureLink(articleId, 1, String(input.fileId));
      }
      return { articleId, parentLinksInserted: n };
    } catch (e) {
      this.restore(snapshot);
      throw e;
    }
  }

  async updateArticleFromImport(input: ExistingArticleWrite): Promise<ExistingArticleResult> {
    if (this.failUpdateWhen?.(input)) throw new Error('จำลอง: update ล้มเหลว');
    const a = this.articles.get(input.articleId);
    if (!a || a.isDelete) throw new Error(`ไม่พบบทความ ArticleID ${input.articleId} ที่จะอัปเดต`);
    let versionCreated = false;
    if (input.versioning && shouldCreateVersion(a.contentHtml, input.patch.contentHtml)) {
      const next =
        Math.max(
          0,
          ...this.versions.filter((v) => v.articleId === a.articleId).map((v) => v.versionNumber),
        ) + 1;
      this.versions.push({
        articleId: a.articleId,
        versionNumber: next,
        content: input.patch.contentHtml ?? '',
        changeDescription: input.versioning.changeDescription,
      });
      a.currentVersion = next;
      versionCreated = true;
    }
    const map: Record<string, keyof MemArticle> = {
      Title: 'title',
      TitleCategory: 'titleCategory',
      ContentHTML: 'contentHtml',
      Summary: 'summary',
      PublishedDate: 'publishedDate',
      EffectiveDate: 'effectiveDate',
      ArticleType: 'articleType',
      Tags: 'tags',
    };
    const patchProp: Record<string, keyof typeof input.patch> = {
      Title: 'title',
      TitleCategory: 'titleCategory',
      ContentHTML: 'contentHtml',
      Summary: 'summary',
      PublishedDate: 'publishedDate',
      EffectiveDate: 'effectiveDate',
      ArticleType: 'articleType',
      Tags: 'tags',
    };
    for (const c of input.columns) {
      (a as unknown as Record<string, unknown>)[map[c]] = input.patch[patchProp[c]] ?? null;
    }
    a.updatedBy = input.updatedBy;

    let fileLinksRepaired = 0;
    if (input.repairFileLinks) {
      for (const f of this.attachments.filter((x) => x.articleId === a.articleId))
        if (this.ensureLink(a.articleId, 1, String(f.fileId))) fileLinksRepaired++;
    }
    let attached = false;
    if (input.attachFileId !== null) {
      this.attachments.push({ articleId: a.articleId, fileId: input.attachFileId });
      this.ensureLink(a.articleId, 1, String(input.attachFileId));
      attached = true;
    }
    let n = 0;
    for (const p of input.parentArticleIds) {
      if (this.ensureLink(a.articleId, 4, String(p))) n++;
      if (this.ensureLink(p, 4, String(a.articleId))) n++;
    }
    return { versionCreated, parentLinksInserted: n, fileLinksRepaired, attached };
  }

  private snapshot() {
    return {
      articles: new Map([...this.articles].map(([k, v]) => [k, { ...v }])),
      versions: this.versions.map((v) => ({ ...v })),
      links: this.links.map((l) => ({ ...l })),
      attachments: this.attachments.map((a) => ({ ...a })),
    };
  }
  private restore(s: ReturnType<MemoryImportStore['snapshot']>) {
    this.articles = s.articles;
    this.versions = s.versions;
    this.links = s.links;
    this.attachments = s.attachments;
  }
}

/** DMS จำลอง: ตั้งชื่อซ้ำเป็น "name copy(N).ext" เหมือนของจริง (overwriteExisting=false) เพื่อพิสูจน์ว่า import ไม่สร้างไฟล์ซ้ำ */
export class FakeDms implements DmsFilePort {
  files: (DmsFileInfo & { deleted?: boolean })[] = [];
  uploads: string[] = [];
  removed: number[] = [];
  listError: Error | null = null;
  uploadError: ((name: string) => Error | null) | null = null;
  private nextId = 5000;

  seed(folderId: number, originalFileName: string): DmsFileInfo {
    const f: DmsFileInfo = {
      fileId: this.nextId++,
      folderId,
      originalFileName,
      storedFileName: originalFileName,
      fileSizeBytes: '10',
      version: 1,
    };
    this.files.push(f);
    return f;
  }

  async upload(_user: unknown, folderId: number, inputs: DmsUploadInput[]): Promise<DmsFileInfo[]> {
    const out: DmsFileInfo[] = [];
    for (const input of inputs) {
      const err = this.uploadError?.(input.originalName);
      if (err) throw err;
      let name = input.originalName;
      let n = 0;
      while (
        this.files.some((f) => !f.deleted && f.folderId === folderId && f.originalFileName === name)
      ) {
        n++;
        const dot = input.originalName.lastIndexOf('.');
        name =
          dot > 0
            ? `${input.originalName.slice(0, dot)} copy(${n})${input.originalName.slice(dot)}`
            : `${input.originalName} copy(${n})`;
      }
      this.uploads.push(name);
      const f = this.seed(folderId, name);
      out.push(f);
    }
    return out;
  }

  async listFolder(folderId: number): Promise<DmsFileInfo[]> {
    if (this.listError) throw this.listError;
    return this.files.filter((f) => !f.deleted && f.folderId === folderId);
  }

  async remove(_user: unknown, fileId: number): Promise<void> {
    this.removed.push(fileId);
    const f = this.files.find((x) => x.fileId === fileId);
    if (f) f.deleted = true;
  }

  async openRead(): Promise<DmsFileReadHandle> {
    throw new Error('ไม่ใช้ในเทสต์นี้');
  }
}
