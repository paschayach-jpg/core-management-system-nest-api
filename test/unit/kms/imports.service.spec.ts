import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppRole } from '../../../src/common/constants/enums';
import type { TempUpload } from '../../../src/modules/kms/articles/article-attachments.service';
import { ImportJobRegistry } from '../../../src/modules/kms/import/import-job.registry';
import { ImportsService } from '../../../src/modules/kms/import/imports.service';
import type {
  NewArticleResult,
  NewArticleWrite,
} from '../../../src/modules/kms/import/kb-import.store';
import type { TemplateColumnRow } from '../../../src/modules/kms/import/kb-import-row';
import { fakeUser } from '../../helpers/stubs';
import { lawCode, sampleCategories } from './kms-fixtures';
import { FakeDms, MemoryImportStore } from './memory-import-store';
import { ScriptedDb, crudLogHarness } from './sql-script';
import {
  LAW_HEADER,
  lawRow,
  nonLawRow,
  NONLAW_HEADER,
  xlsxBuffer,
  type CellInput,
} from './xlsx-helper';

const t = (target: string, ref: string | null): TemplateColumnRow => ({
  targetColumnName: target,
  excelColumnRef: ref,
});
const LAW_TEMPLATE = [t('ArticleCode', 'A'), t('LayoutType', 'Law'), t('ArticleType', '5')];
const NONLAW_TEMPLATE = [
  t('ArticleCode', 'A'),
  t('Title', 'E'),
  t('ContentHTML', 'I'),
  t('Attachment', 'K'),
  t('LayoutType', 'NonLaw'),
  t('ArticleType', '3'),
];

const PARENT = lawCode('PLI00', '0007', '535').substring(0, 24);
const OWNER = fakeUser({ userId: 7, appRole: AppRole.Manager, adUserName: 'DOM\\owner' });
const OTHER = fakeUser({ userId: 8, appRole: AppRole.Manager, adUserName: 'DOM\\other' });
const ADMIN = fakeUser({ userId: 9, appRole: AppRole.Admin, adUserName: 'DOM\\admin' });

let dir: string;
let seq = 0;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kms-imp-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function upload(name: string, content: Buffer | string): Promise<TempUpload> {
  const path = join(dir, `u${seq++}.tmp`);
  await writeFile(path, content);
  return { originalname: name, path, size: content.length, mimetype: 'application/octet-stream' };
}

async function xlsx(rows: CellInput[][], name = 'data.xlsx'): Promise<TempUpload> {
  return upload(name, await xlsxBuffer(rows));
}

/** store ที่หยุดรอก่อนเขียนบทความแรก — ใช้จำลองงานที่กำลังรันอยู่ */
class GatedStore extends MemoryImportStore {
  gate: Promise<void> = Promise.resolve();
  entered: () => void = () => undefined;
  override async insertArticle(input: NewArticleWrite): Promise<NewArticleResult> {
    this.entered();
    await this.gate;
    return super.insertArticle(input);
  }
}

interface Opts {
  template?: TemplateColumnRow[];
  layouts?: { templateName: string; layout: 'Law' | 'Decree' | 'NonLaw' | null }[];
  dms?: FakeDms | null;
  folderCfg?: number;
  folderRows?: Record<string, unknown>[];
  store?: MemoryImportStore;
  canAdd?: () => Promise<void>;
  /** สร้างมาตราแม่ของไฟล์ NonLaw ในระบบ (ไม่งั้นแถว NonLaw เป็น Error 'ไม่พบกฎหมายแม่') */
  seedParent?: boolean;
}

function make(opts: Opts = {}) {
  const store = opts.store ?? new MemoryImportStore(sampleCategories());
  if (opts.seedParent ?? opts.template === NONLAW_TEMPLATE)
    store.seedArticle({ articleCode: PARENT, categoryId: 4 });
  const registry = new ImportJobRegistry();
  const log = crudLogHarness();
  const db = new ScriptedDb();
  db.when(
    /FROM storage\.Folder WHERE FolderID/,
    opts.folderRows ?? [{ ConfidentialityLevel: 1, IsDeleted: 0, IsArchived: 0 }],
  );
  const templates = {
    requireActiveForImport: jest.fn(async () => ({
      name: 'แม่แบบ',
      columns: opts.template ?? LAW_TEMPLATE,
    })),
    activeLayouts: jest.fn(
      async () => opts.layouts ?? [{ templateName: 'แม่แบบ', layout: 'Law' as const }],
    ),
  };
  const perm = { assertCanAdd: jest.fn(opts.canAdd ?? (async () => undefined)) };
  const config = { getNumber: jest.fn(async () => opts.folderCfg ?? 0) };
  const ctx = { run: <T>(fn: () => T) => fn() };
  const dms = opts.dms === null ? undefined : (opts.dms ?? new FakeDms());
  const svc = new ImportsService(
    log.service,
    registry,
    templates as never,
    store,
    config as never,
    perm as never,
    ctx as never,
    db as never,
    dms as never,
  );
  return {
    svc,
    store,
    registry,
    log,
    templates,
    perm,
    config,
    db,
    dms: dms as FakeDms | undefined,
  };
}

const lawFile = (n = 2) =>
  xlsx([
    LAW_HEADER,
    ...Array.from({ length: n }, (_, i) =>
      lawRow({
        code: lawCode('PVI00', String(i + 1).padStart(4, '0'), '535'),
        content: `เนื้อหา ${i + 1}`,
      }),
    ),
  ]);

describe('ImportsService.start — อัปโหลดแล้วตรวจก่อน (ไม่เขียน DB)', () => {
  it('ตรวจผ่าน: คืน importId + สรุปผลตรวจ · ไม่เขียนบทความ · ลบไฟล์ชั่วคราว', async () => {
    const { svc, store } = make();
    const f = await lawFile(3);
    const dto = await svc.start(f, { templateId: 1 } as never, [], OWNER);
    expect(dto).toMatchObject({
      status: 'Validated',
      fileName: 'data.xlsx',
      templateName: 'แม่แบบ',
      layoutType: 'Law',
      articleType: 5,
      requiresAttachment: false,
      validation: { total: 3, newCount: 3, updateCount: 0, skipCount: 0, errorCount: 0 },
    });
    expect(dto.importId).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.articles.size).toBe(0);
    expect(existsSync(f.path)).toBe(false);
  });

  it('ไม่ส่งไฟล์ / ไม่ใช่ .xlsx → 422 และลบไฟล์ที่ส่งมา', async () => {
    const { svc } = make();
    await expect(svc.start(undefined, { templateId: 1 } as never, [], OWNER)).rejects.toMatchObject(
      {
        response: { code: 'IMPORT_FILE_REQUIRED' },
      },
    );
    const csv = await upload('data.csv', 'a,b');
    await expect(svc.start(csv, { templateId: 1 } as never, [], OWNER)).rejects.toMatchObject({
      response: { code: 'IMPORT_FILE_NOT_XLSX' },
    });
    expect(existsSync(csv.path)).toBe(false);
  });

  it('ไฟล์ .xlsx เสีย → 422 EXCEL_OPEN_FAILED', async () => {
    const { svc } = make();
    const bad = await upload('x.xlsx', 'นี่ไม่ใช่ไฟล์ excel');
    await expect(svc.start(bad, { templateId: 1 } as never, [], OWNER)).rejects.toMatchObject({
      response: { code: 'EXCEL_OPEN_FAILED' },
    });
    expect(existsSync(bad.path)).toBe(false);
  });

  it('ชนิดไฟล์ไม่ตรง Template → 422 LAYOUT_MISMATCH บอกทั้งสองฝั่ง + Template ที่ตรงกับไฟล์ · ไม่สร้างงาน', async () => {
    const { svc, registry } = make({
      template: NONLAW_TEMPLATE,
      layouts: [
        { templateName: 'แม่แบบ', layout: 'NonLaw' },
        { templateName: 'กฎหมายมาตรฐาน', layout: 'Law' },
      ],
    });
    const f = await lawFile(1);
    await expect(svc.start(f, { templateId: 1 } as never, [], OWNER)).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'LAYOUT_MISMATCH',
        message: expect.stringContaining('กฎหมายมาตรฐาน'),
      },
    });
    expect(registry.list()).toHaveLength(0);
  });

  it('Template ที่ map Attachment: DMS ไม่พร้อม → 503 · ไม่ระบุโฟลเดอร์ → 422 · โฟลเดอร์ไม่มี → 422 · ไม่มีสิทธิ์เพิ่มไฟล์ → ส่งต่อ error ของสิทธิ์', async () => {
    const nonLaw = () =>
      xlsx([
        NONLAW_HEADER,
        nonLawRow({
          code: lawCode('PLI00', '0007', '535').substring(0, 24) + '20001',
          title: 'ก',
          content: 'x',
          file: 'a.pdf',
        }),
      ]);

    const noDms = make({
      template: NONLAW_TEMPLATE,
      layouts: [{ templateName: 'แม่แบบ', layout: 'NonLaw' }],
      dms: null,
    });
    await expect(
      noDms.svc.start(await nonLaw(), { templateId: 1, dmsFolderId: 437 } as never, [], OWNER),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'DMS_UNAVAILABLE' },
    });

    const base = {
      template: NONLAW_TEMPLATE,
      layouts: [{ templateName: 'แม่แบบ', layout: 'NonLaw' as const }],
    };
    const noFolder = make({ ...base, folderCfg: 0 });
    await expect(
      noFolder.svc.start(await nonLaw(), { templateId: 1 } as never, [], OWNER),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT_DMS_FOLDER_REQUIRED' },
    });

    const missing = make({ ...base, folderRows: [] });
    await expect(
      missing.svc.start(await nonLaw(), { templateId: 1, dmsFolderId: 9 } as never, [], OWNER),
    ).rejects.toMatchObject({
      response: { code: 'DMS_FOLDER_NOT_FOUND' },
    });

    const denied = make({
      ...base,
      canAdd: async () => {
        throw Object.assign(new Error('ไม่มีสิทธิ์'), { status: 403 });
      },
    });
    await expect(
      denied.svc.start(await nonLaw(), { templateId: 1, dmsFolderId: 437 } as never, [], OWNER),
    ).rejects.toMatchObject({ status: 403 });

    // ใช้ค่าระบบเมื่อไม่ส่ง dmsFolderId
    const cfg = make({ ...base, folderCfg: 437 });
    const dto = await cfg.svc.start(await nonLaw(), { templateId: 1 } as never, [], OWNER);
    expect(dto).toMatchObject({ requiresAttachment: true, dmsFolderId: 437 });
    expect(cfg.perm.assertCanAdd).toHaveBeenCalledWith(OWNER, 437, 1);
  });

  it('ไฟล์แนบที่ส่งมาพร้อมกันถูกเก็บใน staging · ชื่อที่ไม่ปลอดภัยถูกปฏิเสธ (rejectedFiles)', async () => {
    const { svc } = make({
      template: NONLAW_TEMPLATE,
      layouts: [{ templateName: 'แม่แบบ', layout: 'NonLaw' }],
      folderCfg: 437,
    });
    const f = await xlsx([
      NONLAW_HEADER,
      nonLawRow({
        code: lawCode('PLI00', '0007', '535').substring(0, 24) + '20001',
        title: 'ก',
        content: 'x',
        file: 'a.pdf',
      }),
    ]);
    const dto = await svc.start(
      f,
      { templateId: 1 } as never,
      [await upload('a.pdf', 'pdf'), await upload('../evil.pdf', 'x')],
      OWNER,
    );
    expect(dto.stagedFiles.count).toBe(1);
    expect(dto.rejectedFiles).toEqual(['../evil.pdf']);
    const status = await svc.attachmentStatus(dto.importId, OWNER);
    expect(status).toMatchObject({ referenced: 1, staged: 1, inDms: 0, missing: [] });
    await svc.remove(dto.importId, OWNER);
  });
});

describe('ImportsService.execute — รันเบื้องหลัง', () => {
  it('นำเข้าสำเร็จ: Running ทันที แล้ว Completed · บทความถูกเขียน · log สรุป IMPORT_KB_ARTICLES', async () => {
    const { svc, store, log } = make();
    const job = await svc.start(await lawFile(2), { templateId: 1 } as never, [], OWNER);
    const started = await svc.execute(job.importId, OWNER);
    expect(started.status).toBe('Running');
    await svc.whenFinished(job.importId);

    const done = svc.get(job.importId, OWNER);
    expect(done).toMatchObject({
      status: 'Completed',
      progress: { done: 2, total: 2, percent: 100 },
    });
    expect(done.result).toMatchObject({ inserted: 2, updated: 0, failed: 0 });
    expect(store.articles.size).toBe(2);

    const ev = await log.events();
    expect(ev.map((e) => e.operation)).toEqual([
      'VALIDATE_KB_IMPORT',
      'START_KB_IMPORT',
      'IMPORT_KB_ARTICLES',
    ]);
    expect(ev[2]).toMatchObject({
      entity: 'KbImport',
      action: 'EXECUTE',
      success: true,
      meta: expect.objectContaining({ inserted: 2, status: 'Completed' }),
    });
  });

  it('สั่งซ้ำ = 409 IMPORT_NOT_READY · ไม่มีแถวให้นำเข้า = 422 IMPORT_NOTHING_TO_DO', async () => {
    const { svc } = make();
    const job = await svc.start(await lawFile(1), { templateId: 1 } as never, [], OWNER);
    await svc.execute(job.importId, OWNER);
    await svc.whenFinished(job.importId);
    await expect(svc.execute(job.importId, OWNER)).rejects.toMatchObject({
      response: { code: 'IMPORT_NOT_READY' },
    });

    const empty = make();
    const bad = await empty.svc.start(
      await xlsx([LAW_HEADER, lawRow({ code: lawCode('PVI00', '0001', '535'), content: '' })]),
      { templateId: 1 } as never,
      [],
      OWNER,
    );
    expect(bad.validation).toMatchObject({ newCount: 0, errorCount: 1 });
    await expect(empty.svc.execute(bad.importId, OWNER)).rejects.toMatchObject({
      response: { code: 'IMPORT_NOTHING_TO_DO' },
    });
  });

  it('รันได้ทีละงาน: งานที่สองสั่งขณะงานแรกกำลังรัน = 409 IMPORT_ALREADY_RUNNING · ยกเลิกงานที่รัน → หยุดก่อนแถวถัดไป', async () => {
    const store = new GatedStore(sampleCategories());
    let release!: () => void;
    store.gate = new Promise<void>((r) => (release = r));
    const entered = new Promise<void>((r) => (store.entered = r));
    const { svc, registry } = make({ store });

    const a = await svc.start(await lawFile(3), { templateId: 1 } as never, [], OWNER);
    const b = await svc.start(await lawFile(1), { templateId: 1 } as never, [], OWNER);
    await svc.execute(a.importId, OWNER);
    await entered;
    expect(registry.running()?.id).toBe(a.importId);
    await expect(svc.execute(b.importId, OWNER)).rejects.toMatchObject({
      response: { code: 'IMPORT_ALREADY_RUNNING' },
    });
    await expect(svc.remove(a.importId, OWNER)).rejects.toMatchObject({
      response: { code: 'IMPORT_RUNNING' },
    });

    const cancelling = await svc.cancel(a.importId, OWNER);
    expect(cancelling.status).toBe('Running'); // ยังรันแถวปัจจุบันให้จบ
    release();
    await svc.whenFinished(a.importId);
    const fin = svc.get(a.importId, OWNER);
    expect(fin.status).toBe('Cancelled');
    expect(store.articles.size).toBe(1); // แถวแรกที่เริ่มแล้วจบ ที่เหลือไม่ถูกนำเข้า
    expect(fin.result?.inserted).toBe(1);

    // หลังงานแรกจบ งานที่สองสั่งได้
    await svc.execute(b.importId, OWNER);
    await svc.whenFinished(b.importId);
    expect(svc.get(b.importId, OWNER).status).toBe('Completed');
  });

  it('ยกเลิกงานที่ตรวจแล้วแต่ยังไม่รัน = ทิ้งงานทันที · งานที่จบแล้วยกเลิกไม่ได้ (409)', async () => {
    const { svc, registry } = make();
    const a = await svc.start(await lawFile(1), { templateId: 1 } as never, [], OWNER);
    expect((await svc.cancel(a.importId, OWNER)).status).toBe('Cancelled');
    expect(registry.get(a.importId)).toBeUndefined();

    const b = await svc.start(await lawFile(1), { templateId: 1 } as never, [], OWNER);
    await svc.execute(b.importId, OWNER);
    await svc.whenFinished(b.importId);
    await expect(svc.cancel(b.importId, OWNER)).rejects.toMatchObject({
      response: { code: 'IMPORT_ALREADY_FINISHED' },
    });
  });

  it('แถวที่ store เขียนไม่สำเร็จ: นับเป็น failed ต่อแถว ไม่ทำให้ทั้งงานล้ม และแถวอื่นยังเข้า', async () => {
    const store = new MemoryImportStore(sampleCategories());
    store.failInsertWhen = (w) => w.article.title === 'มาตรา 1';
    const { svc } = make({ store });
    const job = await svc.start(await lawFile(3), { templateId: 1 } as never, [], OWNER);
    await svc.execute(job.importId, OWNER);
    await svc.whenFinished(job.importId);
    const done = svc.get(job.importId, OWNER);
    expect(done.status).toBe('Completed');
    expect(done.result).toMatchObject({ inserted: 2, failed: 1 });
    expect(store.articles.size).toBe(2);
    const failed = svc.rows(
      job.importId,
      { page: 1, pageSize: 50, status: 'Error' } as never,
      OWNER,
    );
    expect(failed.total).toBe(1);
  });
});

describe('ImportsService — สิทธิ์เข้าถึงงานและผลรายแถว', () => {
  it('งานของคนอื่น = 404 (ไม่เปิดเผยว่ามีงาน) · Admin เห็นทุกงาน · list กรองตามเจ้าของ', async () => {
    const { svc } = make();
    const job = await svc.start(await lawFile(1), { templateId: 1 } as never, [], OWNER);
    for (const call of [
      () => svc.get(job.importId, OTHER),
      () => svc.rows(job.importId, { page: 1, pageSize: 10 } as never, OTHER),
      () => svc.execute(job.importId, OTHER),
      () => svc.cancel(job.importId, OTHER),
      () => svc.remove(job.importId, OTHER),
      () => svc.attachmentStatus(job.importId, OTHER),
      () => svc.addAttachments(job.importId, [], OTHER),
    ])
      await expect(Promise.resolve().then(call as () => unknown)).rejects.toMatchObject({
        status: 404,
      });
    expect(svc.get(job.importId, ADMIN).importId).toBe(job.importId);
    expect(svc.list(OWNER)).toHaveLength(1);
    expect(svc.list(OTHER)).toHaveLength(0);
    expect(svc.list(ADMIN)).toHaveLength(1);
    expect(() => svc.get('no-such-id', OWNER)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('rows: แบ่งหน้า กรองสถานะ ค้นใน Code/ชื่อ/หมายเหตุ', async () => {
    const { svc } = make();
    const job = await svc.start(
      await xlsx([
        LAW_HEADER,
        lawRow({ code: lawCode('PVI00', '0001', '535'), content: 'a' }),
        lawRow({ code: '', content: 'b' }),
        lawRow({ code: 'สั้น', content: 'c' }),
        lawRow({ code: lawCode('PVI00', '0002', '535'), content: 'd' }),
      ]),
      { templateId: 1 } as never,
      [],
      OWNER,
    );
    const all = svc.rows(job.importId, { page: 1, pageSize: 2 } as never, OWNER);
    expect(all).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(all.items).toHaveLength(2);
    expect(
      svc.rows(job.importId, { page: 1, pageSize: 10, status: 'Valid' } as never, OWNER).total,
    ).toBe(2);
    expect(
      svc.rows(job.importId, { page: 1, pageSize: 10, q: 'ความยาวไม่ถูกต้อง' } as never, OWNER)
        .total,
    ).toBe(1);
    expect(
      svc.rows(
        job.importId,
        { page: 1, pageSize: 10, q: lawCode('PVI00', '0002', '535').slice(0, 8) } as never,
        OWNER,
      ).total,
    ).toBe(2);
  });

  it('addAttachments: เฉพาะงานที่ยังไม่รัน', async () => {
    const { svc } = make({
      template: NONLAW_TEMPLATE,
      layouts: [{ templateName: 'แม่แบบ', layout: 'NonLaw' }],
      folderCfg: 437,
    });
    const f = await xlsx([
      NONLAW_HEADER,
      nonLawRow({
        code: lawCode('PLI00', '0007', '535').substring(0, 24) + '20001',
        title: 'ก',
        content: 'x',
        file: 'a.pdf',
      }),
    ]);
    const job = await svc.start(f, { templateId: 1 } as never, [], OWNER);
    const added = await svc.addAttachments(job.importId, [await upload('a.pdf', 'pdf')], OWNER);
    expect(added.stagedFiles.count).toBe(1);
    await expect(svc.addAttachments(job.importId, [], OWNER)).rejects.toMatchObject({
      response: { code: 'NO_FILES' },
    });
    await svc.execute(job.importId, OWNER);
    await svc.whenFinished(job.importId);
    await expect(
      svc.addAttachments(job.importId, [await upload('b.pdf', 'x')], OWNER),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT_NOT_EDITABLE' },
    });
  });

  it('attachmentStatus: แยกไฟล์ที่ส่งมา / มีใน DMS แล้ว / ยังขาด · DMS list ล้มเหลวแจ้งใน dmsError', async () => {
    const dms = new FakeDms();
    dms.seed(437, 'in-dms.pdf');
    const { svc } = make({
      template: NONLAW_TEMPLATE,
      layouts: [{ templateName: 'แม่แบบ', layout: 'NonLaw' }],
      folderCfg: 437,
      dms,
    });
    const base = lawCode('PLI00', '0007', '535').substring(0, 24);
    const f = await xlsx([
      NONLAW_HEADER,
      nonLawRow({ code: base + '20001', title: 'ก', content: 'x', file: 'sent.pdf' }),
      nonLawRow({ code: base + '20002', title: 'ข', content: 'x', file: 'IN-DMS.pdf' }),
      nonLawRow({ code: base + '20003', title: 'ค', content: 'x', file: 'lost.pdf' }),
    ]);
    const job = await svc.start(
      f,
      { templateId: 1 } as never,
      [await upload('sent.pdf', 'pdf')],
      OWNER,
    );
    expect(await svc.attachmentStatus(job.importId, OWNER)).toEqual({
      referenced: 3,
      staged: 1,
      inDms: 1,
      missing: ['lost.pdf'],
      dmsError: null,
    });
    dms.listError = new Error('timeout');
    expect((await svc.attachmentStatus(job.importId, OWNER)).dmsError).toContain('timeout');
  });

  it('นำเข้า NonLaw พร้อมไฟล์แนบ: ไฟล์ชื่อเดียวกันหลายแถวใช้ FileID เดียว ไม่เกิด copy(N)', async () => {
    const dms = new FakeDms();
    const { svc, store } = make({
      template: NONLAW_TEMPLATE,
      layouts: [{ templateName: 'แม่แบบ', layout: 'NonLaw' }],
      folderCfg: 437,
      dms,
    });
    const base = lawCode('PLI00', '0007', '535').substring(0, 24);
    const f = await xlsx([
      NONLAW_HEADER,
      nonLawRow({ code: base + '20001', title: 'ก', content: 'x', file: 'shared.pdf' }),
      nonLawRow({ code: base + '20002', title: 'ข', content: 'y', file: 'Shared.PDF' }),
    ]);
    const job = await svc.start(
      f,
      { templateId: 1 } as never,
      [await upload('shared.pdf', 'pdf')],
      OWNER,
    );
    await svc.execute(job.importId, OWNER);
    await svc.whenFinished(job.importId);
    expect(svc.get(job.importId, OWNER).result).toMatchObject({ inserted: 2, failed: 0 });
    expect(dms.uploads).toEqual(['shared.pdf']);
    expect(new Set(store.attachments.map((a) => a.fileId)).size).toBe(1);
    expect(store.attachments).toHaveLength(2);
  });
});
