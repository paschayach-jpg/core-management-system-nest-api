import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  ArticleAttachmentsService,
  TempUpload,
} from '../../../src/modules/kms/articles/article-attachments.service';
import type {
  DmsFilePort,
  DmsFileInfo,
  DmsUploadInput,
} from '../../../src/modules/dms/ports/dms-file.port';
import { FakeTx, MANAGER, ScriptedDb, crudLogHarness } from './sql-script';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kms-att-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function tempFile(name: string, content = 'pdf-bytes'): Promise<TempUpload> {
  const path = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  await writeFile(path, content);
  return { originalname: name, path, size: content.length, mimetype: 'application/pdf' };
}

/** DMS ปลอม: เก็บสิ่งที่ถูกอัปโหลด/ลบ */
function fakeDms() {
  const uploads: { folderId: number; inputs: DmsUploadInput[]; overwrite?: boolean }[] = [];
  const removed: number[] = [];
  let next = 500;
  const port: DmsFilePort = {
    upload: async (_u, folderId, files, opts) => {
      uploads.push({ folderId, inputs: files, overwrite: opts?.overwriteExisting });
      return files.map((f): DmsFileInfo => ({
        fileId: next++,
        folderId,
        originalFileName: f.originalName,
        storedFileName: f.originalName,
        fileSizeBytes: String(f.buffer.length),
        version: 1,
      }));
    },
    listFolder: async () => [],
    remove: async (_u, id) => void removed.push(id),
    openRead: async (_u, fileId) => ({
      stream: Readable.from(['x']),
      fileName: `f${fileId}.pdf`,
      size: 1,
      mimeType: 'application/pdf',
    }),
  };
  return { port, uploads, removed };
}

function make(opts: { dms?: DmsFilePort | null; folderCfg?: number; status?: number } = {}) {
  const db = new ScriptedDb();
  const tx = new FakeTx(db);
  const log = crudLogHarness();
  db.when(/SELECT ArticleID, ArticleCode, Status, IsDelete FROM KMS\.t_KBArticle/, [
    { ArticleID: 1, ArticleCode: 'X', Status: opts.status ?? 1, IsDelete: 0 },
  ]);
  db.when(/INSERT INTO KMS\.t_KBArticleAttachment/, [{ AttachmentID: 9 }]);
  db.when(/IF NOT EXISTS \(SELECT 1 FROM KMS\.t_KBArticleLink/, [{ Inserted: 1 }]);
  db.when(/FROM KMS\.t_KBArticleAttachment a\s+LEFT JOIN storage\.FileDocument/, (_s, _p) => [
    {
      AttachmentID: 9,
      FileID: 500,
      OriginalFileName: 'a.pdf',
      FileExtension: 'pdf',
      IsDeleted: 0,
      FileStatus: 1,
      CreatedBy: 'x',
    },
    {
      AttachmentID: 8,
      FileID: 501,
      OriginalFileName: null,
      IsDeleted: null,
      FileStatus: null,
      CreatedBy: 'x',
    },
  ]);
  const config = { getNumber: jest.fn(async () => opts.folderCfg ?? 0) };
  const svc = new ArticleAttachmentsService(
    log.service,
    db as never,
    tx as never,
    config as never,
    (opts.dms === null ? undefined : opts.dms) as never,
  );
  return { svc, db, tx, log, config };
}

describe('ArticleAttachmentsService', () => {
  it('DMS ไม่พร้อม (ไม่มี provider) → 503 DMS_UNAVAILABLE ที่จุดใช้งาน และล้างไฟล์ชั่วคราว', async () => {
    const { svc } = make({ dms: null });
    const f = await tempFile('a.pdf');
    await expect(svc.upload(1, [f], 437, MANAGER)).rejects.toMatchObject({
      status: 503,
      response: { code: 'DMS_UNAVAILABLE' },
    });
    expect(existsSync(f.path)).toBe(false);
    await expect(svc.openDownload(1, 500, MANAGER)).rejects.toMatchObject({
      status: 503,
      response: { code: 'DMS_UNAVAILABLE' },
    });
  });

  it('upload: ส่งไฟล์เข้า DMS (ไม่ overwrite → ไม่ทับ) แล้วผูกแถว attachment + link ไฟล์ · ลบไฟล์ชั่วคราว', async () => {
    const dms = fakeDms();
    const { svc, db } = make({ dms: dms.port });
    const f = await tempFile('ประกาศ.pdf', 'hello');
    const r = await svc.upload(1, [f], 437, MANAGER);

    expect(dms.uploads).toHaveLength(1);
    expect(dms.uploads[0]).toMatchObject({ folderId: 437, overwrite: false });
    expect(dms.uploads[0].inputs[0].originalName).toBe('ประกาศ.pdf');
    expect(dms.uploads[0].inputs[0].buffer.toString()).toBe('hello');
    expect(db.find(/INSERT INTO KMS\.t_KBArticleAttachment/)[0].params).toEqual([
      1,
      500,
      MANAGER.adUserName,
    ]);
    // link ไฟล์ EntityType=1, EntityID=FileID
    expect(db.find(/IF NOT EXISTS/)[0].params.slice(0, 3)).toEqual([1, 1, '500']);
    // ไม่เรียก DELETE attachment เดิม (ต่างจาก SaveArticleAttachments เดิมที่ลบทั้งหมดก่อน)
    expect(db.count(/DELETE FROM KMS\.t_KBArticleAttachment/)).toBe(0);
    expect(r.map((a) => a.fileId)).toEqual([500]);
    expect(existsSync(f.path)).toBe(false);
  });

  it('upload: ไม่ระบุโฟลเดอร์ใช้ค่าระบบ · ไม่มีค่าระบบ = 422 ATTACHMENT_FOLDER_REQUIRED', async () => {
    const dms = fakeDms();
    const withCfg = make({ dms: dms.port, folderCfg: 77 });
    await withCfg.svc.upload(1, [await tempFile('a.pdf')], undefined, MANAGER);
    expect(dms.uploads[0].folderId).toBe(77);

    const noCfg = make({ dms: dms.port, folderCfg: 0 });
    await expect(
      noCfg.svc.upload(1, [await tempFile('a.pdf')], undefined, MANAGER),
    ).rejects.toMatchObject({
      response: { code: 'ATTACHMENT_FOLDER_REQUIRED' },
    });
  });

  it('upload: ผูกบทความไม่สำเร็จ → ลบไฟล์ที่เพิ่งอัปโหลดออกจาก DMS (ไม่ทิ้งไฟล์กำพร้า)', async () => {
    const dms = fakeDms();
    const { svc, db } = make({ dms: dms.port });
    db.failWhen(/INSERT INTO KMS\.t_KBArticleAttachment/, new Error('db down'));
    await expect(
      svc.upload(1, [await tempFile('a.pdf'), await tempFile('b.pdf')], 437, MANAGER),
    ).rejects.toThrow('db down');
    expect(dms.removed).toEqual([500, 501]);
  });

  it('upload: บทความ Archived แก้ไม่ได้ · ไม่มีไฟล์ = 422', async () => {
    const dms = fakeDms();
    await expect(
      make({ dms: dms.port, status: 4 }).svc.upload(1, [await tempFile('a.pdf')], 437, MANAGER),
    ).rejects.toMatchObject({ response: { code: 'ARTICLE_ARCHIVED' } });
    await expect(make({ dms: dms.port }).svc.upload(1, [], 437, MANAGER)).rejects.toMatchObject({
      response: { code: 'NO_FILES' },
    });
    expect(dms.uploads).toHaveLength(0);
  });

  it('list: ไฟล์ที่หายจาก DMS / ถูกลบ ถูกทำเครื่องหมาย fileMissing', async () => {
    const { svc } = make({ dms: fakeDms().port });
    const r = await svc.list(1);
    expect(r.map((a) => [a.fileId, a.fileMissing])).toEqual([
      [500, false],
      [501, true],
    ]);
  });

  it('remove: ถอดแถว attachment + link ไฟล์ แต่ไม่ลบไฟล์ใน DMS · ไม่เจอ = 404', async () => {
    const dms = fakeDms();
    const { svc, db } = make({ dms: dms.port });
    db.when(/DELETE FROM KMS\.t_KBArticleAttachment[\s\S]*SELECT @@ROWCOUNT AS N/, [{ N: 1 }]);
    await svc.remove(1, 500);
    expect(db.find(/DELETE FROM KMS\.t_KBArticleLink/)[0].params).toEqual([1, '500']);
    expect(dms.removed).toEqual([]);

    const none = make({ dms: dms.port });
    none.db.when(/DELETE FROM KMS\.t_KBArticleAttachment[\s\S]*SELECT @@ROWCOUNT AS N/, [{ N: 0 }]);
    await expect(none.svc.remove(1, 999)).rejects.toMatchObject({ status: 404 });
  });

  it('replaceAll: diff ไม่ลบ-สร้างไฟล์ที่ยังอยู่ในชุด · FileID ไม่มีใน DMS (FK) = 422', async () => {
    const { svc, db } = make({ dms: fakeDms().port });
    db.when(/SELECT FileID FROM KMS\.t_KBArticleAttachment WHERE ArticleID = @0$/, [
      { FileID: 500 },
      { FileID: 501 },
    ]);
    await svc.replaceAll(1, [500, 502, 502], MANAGER);
    const dels = db.find(/DELETE FROM KMS\.t_KBArticleAttachment/);
    expect(dels.map((c) => c.params)).toEqual([[1, 501]]); // ถอดเฉพาะ 501
    const adds = db.find(/INSERT INTO KMS\.t_KBArticleAttachment/);
    expect(adds.map((c) => c.params[1])).toEqual([502]); // เพิ่มเฉพาะ 502 (500 ไม่ถูกแตะ)

    const bad = make({ dms: fakeDms().port });
    bad.db.failWhen(/INSERT INTO KMS\.t_KBArticleAttachment/, { number: 547 });
    await expect(bad.svc.replaceAll(1, [12345], MANAGER)).rejects.toMatchObject({
      response: { code: 'FILE_NOT_FOUND' },
    });
  });

  it('openDownload: ต้องเป็นไฟล์ที่ผูกกับบทความนี้ · เปิดผ่านพอร์ต DMS (DMS ตรวจสิทธิ์)', async () => {
    const dms = fakeDms();
    const ok = make({ dms: dms.port });
    ok.db.when(
      /SELECT FileID FROM KMS\.t_KBArticleAttachment WHERE ArticleID = @0 AND FileID = @1/,
      [{ FileID: 500 }],
    );
    const h = await ok.svc.openDownload(1, 500, MANAGER);
    expect(h.fileName).toBe('f500.pdf');

    const no = make({ dms: dms.port });
    await expect(no.svc.openDownload(1, 999, MANAGER)).rejects.toMatchObject({ status: 404 });
  });

  it('CRUD-log: ATTACH_FILE พร้อมจำนวนไฟล์', async () => {
    const { svc, log } = make({ dms: fakeDms().port });
    await svc.upload(1, [await tempFile('a.pdf')], 437, MANAGER);
    const ev = await log.events();
    expect(ev[0]).toMatchObject({
      entity: 'KbArticleAttachment',
      operation: 'ATTACH_FILE',
      action: 'CREATE',
      recordId: 1,
      meta: { fileCount: 1 },
      success: true,
    });
  });
});
