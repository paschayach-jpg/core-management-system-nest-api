import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FINISHED_TTL_MS,
  ImportJob,
  ImportJobRegistry,
  MAX_JOBS,
  VALIDATED_TTL_MS,
} from '../../../src/modules/kms/import/import-job.registry';
import { SharedFileCache } from '../../../src/modules/kms/import/kb-shared-file-cache';
import {
  StagedFiles,
  isPlainFileName,
  mimeTypeOf,
} from '../../../src/modules/kms/import/kb-staged-files';
import { FakeDms } from './memory-import-store';
import { MANAGER } from './sql-script';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kms-stage-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let seq = 0;
async function incoming(content: string): Promise<string> {
  const p = join(root, `in-${seq++}.tmp`);
  await writeFile(p, content);
  return p;
}

describe('isPlainFileName / mimeTypeOf', () => {
  it('ชื่อล้วนผ่าน · path, .., ตัวอักษรต้องห้าม ไม่ผ่าน', () => {
    expect(isPlainFileName('ประกาศ 1.pdf')).toBe(true);
    for (const bad of [
      '',
      '.',
      '..',
      '../x.pdf',
      'a/b.pdf',
      'a\\b.pdf',
      'C:x.pdf',
      'a*b.pdf',
      'x\u0000.pdf',
    ])
      expect(isPlainFileName(bad)).toBe(false);
  });
  it('mime ตามนามสกุล (ไม่สนตัวพิมพ์) และ fallback octet-stream', () => {
    expect(mimeTypeOf('a.PDF')).toBe('application/pdf');
    expect(mimeTypeOf('a.xyz')).toBe('application/octet-stream');
    expect(mimeTypeOf('noext')).toBe('application/octet-stream');
  });
});

describe('StagedFiles', () => {
  async function stage() {
    return new StagedFiles(join(root, `stage-${seq++}`));
  }

  it('รับไฟล์แล้วค้นตามชื่อ: ตรงเป๊ะก่อน ไม่เจอลองไม่สนตัวพิมพ์ · อ่านเนื้อไฟล์เมื่อเรียก read()', async () => {
    const s = await stage();
    await s.add('Law-1.PDF', await incoming('abc'));
    const exact = await s.lookup('Law-1.PDF');
    expect(exact).toMatchObject({
      ok: true,
      fileName: 'Law-1.PDF',
      size: 3,
      mimeType: 'application/pdf',
    });
    expect((await (exact as { read: () => Promise<Buffer> }).read()).toString()).toBe('abc');
    expect(await s.lookup('law-1.pdf')).toMatchObject({ ok: true, fileName: 'Law-1.PDF' });
    expect(await s.lookup(' Law-1.PDF ')).toMatchObject({ ok: true });
    await s.dispose();
  });

  it('ไม่เจอ / ชื่อมี path / ว่าง / ไฟล์ 0 byte → ok=false พร้อมเหตุผลภาษาไทย', async () => {
    const s = await stage();
    await s.add('empty.pdf', await incoming(''));
    expect(await s.lookup('none.pdf')).toMatchObject({
      ok: false,
      error: expect.stringContaining('ไม่พบไฟล์'),
    });
    expect(await s.lookup('../etc/passwd')).toMatchObject({
      ok: false,
      error: expect.stringContaining('ไม่ถูกต้อง'),
    });
    expect(await s.lookup('   ')).toMatchObject({ ok: false });
    expect(await s.lookup('empty.pdf')).toMatchObject({
      ok: false,
      error: expect.stringContaining('0 byte'),
    });
    await s.dispose();
  });

  it('ชื่อไฟล์อัปโหลดที่ชี้ออกนอกโฟลเดอร์ถูกปฏิเสธ · ไฟล์เก็บด้วยชื่อ hash ไม่ใช้ชื่อผู้ใช้เป็น path', async () => {
    const s = await stage();
    const r = await s.add('../../evil.pdf', await incoming('x'));
    expect(r.error).toContain('ไม่ถูกต้อง');
    expect(s.count).toBe(0);
    await s.add('ok.pdf', await incoming('x'));
    expect(existsSync(join(s.dir, 'ok.pdf'))).toBe(false);
    await s.dispose();
  });

  it('ชื่อซ้ำ: ไฟล์ใหม่ทับไฟล์เก่า (replaced=true) · ชื่อต่างแค่ตัวพิมพ์ไม่ซ้อนกัน 2 รายการ', async () => {
    const s = await stage();
    await s.add('A.pdf', await incoming('one'));
    const again = await s.add('A.pdf', await incoming('two'));
    expect(again.replaced).toBe(true);
    const f = await s.lookup('A.pdf');
    expect((await (f as { read: () => Promise<Buffer> }).read()).toString()).toBe('two');
    await s.add('a.PDF', await incoming('three'));
    expect(s.count).toBe(1);
    expect(s.names).toEqual(['a.PDF']);
    await s.dispose();
  });

  it('dispose ลบโฟลเดอร์ชั่วคราว', async () => {
    const s = await stage();
    await s.add('A.pdf', await incoming('x'));
    expect(existsSync(s.dir)).toBe(true);
    await s.dispose();
    expect(existsSync(s.dir)).toBe(false);
  });
});

describe('SharedFileCache — ชื่อเดียวกัน = ไฟล์เดียว (FileID เดียว) ไม่เกิด copy(N)', () => {
  async function setup(
    opts: {
      dmsHas?: string[];
      staged?: Record<string, string>;
      dms?: boolean;
      folderId?: number | null;
    } = {},
  ) {
    const dms = new FakeDms();
    for (const n of opts.dmsHas ?? []) dms.seed(437, n);
    const stage = new StagedFiles(join(root, `sf-${seq++}`));
    for (const [n, c] of Object.entries(opts.staged ?? {})) await stage.add(n, await incoming(c));
    const cache = new SharedFileCache({
      source: stage,
      dms: opts.dms === false ? null : dms,
      user: MANAGER,
      folderId: opts.folderId === undefined ? 437 : opts.folderId,
    });
    return { dms, stage, cache };
  }

  it('หลายแถวชื่อเดียวกัน (ไม่สนตัวพิมพ์) อัปโหลดครั้งเดียว ใช้ FileID เดียวกัน', async () => {
    const { dms, cache, stage } = await setup({ staged: { 'A.pdf': 'x' } });
    const f1 = await cache.for('A.pdf');
    const f2 = await cache.for(' a.PDF ');
    expect(f2).toBe(f1);
    const id1 = await cache.ensureUploaded(f1);
    const id2 = await cache.ensureUploaded(f2);
    expect(id1).toBe(id2);
    expect(dms.uploads.length).toBe(1);
    expect(dms.files.filter((f) => f.folderId === 437).map((f) => f.originalFileName)).toEqual([
      'A.pdf',
    ]);
    await stage.dispose();
  });

  it('มีไฟล์ชื่อนี้ใน DMS โฟลเดอร์ปลายทางอยู่แล้ว → ใช้ FileID เดิม ไม่อัปโหลด (ไม่ต้องมีไฟล์ในคำขอ)', async () => {
    const { dms, cache, stage } = await setup({ dmsHas: ['B.pdf'] });
    const f = await cache.for('b.pdf');
    expect(f).toMatchObject({ ok: true, reusedExisting: true });
    const id = await cache.ensureUploaded(f);
    expect(id).toBe(dms.files.filter((f) => f.folderId === 437)[0].fileId);
    expect(dms.uploads.length).toBe(0);
    await stage.dispose();
  });

  it('ไม่มีทั้งใน DMS และในไฟล์ที่อัปโหลด → ok=false · ไม่มีชื่อ → ok=false', async () => {
    const { cache, stage } = await setup();
    expect(await cache.for('missing.pdf')).toMatchObject({
      ok: false,
      error: expect.stringContaining('ไม่พบไฟล์'),
    });
    expect(await cache.for('')).toMatchObject({ ok: false });
    await stage.dispose();
  });

  it('DMS ไม่พร้อม / ไม่ระบุโฟลเดอร์ → ok=false พร้อมเหตุผล', async () => {
    const noDms = await setup({ dms: false, staged: { 'A.pdf': 'x' } });
    expect(await noDms.cache.for('A.pdf')).toMatchObject({
      ok: false,
      error: expect.stringContaining('DMS'),
    });
    const noFolder = await setup({ folderId: null, staged: { 'A.pdf': 'x' } });
    expect(await noFolder.cache.for('A.pdf')).toMatchObject({
      ok: false,
      error: expect.stringContaining('โฟลเดอร์'),
    });
  });

  it('listFolder ล้มเหลว → ทุกแถวที่ใช้ไฟล์เป็น Error ไม่ถอยไปอัปโหลดซ้ำ (กัน copy(N))', async () => {
    const { dms, cache, stage } = await setup({ staged: { 'A.pdf': 'x' } });
    dms.listError = new Error('timeout');
    const f = await cache.for('A.pdf');
    expect(f.ok).toBe(false);
    expect(f.error).toContain('ตรวจรายการไฟล์ในโฟลเดอร์ปลายทาง DMS ไม่สำเร็จ');
    expect(dms.uploads.length).toBe(0);
    await stage.dispose();
  });

  it('อัปโหลดล้มเหลว → uploadError ถูกจำ ไม่ลองอัปโหลดซ้ำเอง · resetUpload ให้ลองใหม่ได้', async () => {
    const { dms, cache, stage } = await setup({ staged: { 'A.pdf': 'x' } });
    let attempts = 0;
    dms.uploadError = () => {
      attempts++;
      return new Error('disk full');
    };
    const f = await cache.for('A.pdf');
    expect(await cache.ensureUploaded(f)).toBeNull();
    expect(f.uploadError).toBeTruthy();
    expect(await cache.ensureUploaded(f)).toBeNull();
    expect(attempts).toBe(1); // ไม่ลองซ้ำเอง
    dms.uploadError = null;
    cache.resetUpload(f);
    expect(await cache.ensureUploaded(f)).not.toBeNull();
    await stage.dispose();
  });
});

function job(over: Partial<ImportJob> = {}): ImportJob {
  const stage = new StagedFiles(join(root, `job-${seq++}`));
  return {
    id: `j${seq}`,
    status: 'Validated',
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    touchedAt: Date.now(),
    ownerUserId: 7,
    ownerName: 'x',
    user: MANAGER,
    fileName: 'a.xlsx',
    templateId: 1,
    templateName: 't',
    layoutType: 'Law',
    articleType: 4,
    requiresAttachment: false,
    dmsFolderId: null,
    rows: [],
    counts: { total: 0, newCount: 0, updateCount: 0, skipCount: 0, errorCount: 0 },
    missingCategories: [],
    stage,
    rejectedFiles: [],
    progress: { done: 0, total: 0 },
    result: null,
    cancelRequested: false,
    errorMessage: null,
    ...over,
  };
}

describe('ImportJobRegistry — in-memory', () => {
  it('add/get/list (ใหม่สุดก่อน) และ running() หาได้ทีละงาน', () => {
    const r = new ImportJobRegistry();
    const a = job({ createdAt: new Date(2026, 0, 1) });
    const b = job({ createdAt: new Date(2026, 0, 2), status: 'Running' });
    r.add(a);
    r.add(b);
    expect(r.get(a.id)).toBe(a);
    expect(r.list().map((j) => j.id)).toEqual([b.id, a.id]);
    expect(r.running()).toBe(b);
    expect(r.get('nope')).toBeUndefined();
  });

  it('sweep: Validated หมดอายุ 2 ชม. · งานจบแล้ว 24 ชม. · งานที่กำลังรันไม่ถูกกวาด · ลบไฟล์ชั่วคราวด้วย', async () => {
    const r = new ImportJobRegistry();
    const now = Date.now();
    const staleValidated = job({ touchedAt: now - VALIDATED_TTL_MS - 1 });
    const freshValidated = job({ touchedAt: now - VALIDATED_TTL_MS + 60_000 });
    const staleDone = job({ status: 'Completed', touchedAt: now - FINISHED_TTL_MS - 1 });
    const doneRecently = job({ status: 'Completed', touchedAt: now - VALIDATED_TTL_MS - 1 });
    const longRunning = job({ status: 'Running', touchedAt: now - 10 * FINISHED_TTL_MS });
    for (const j of [staleValidated, freshValidated, staleDone, doneRecently, longRunning])
      r.add(j);
    r.sweep(now);
    expect(
      r
        .list()
        .map((j) => j.id)
        .sort(),
    ).toEqual([freshValidated.id, doneRecently.id, longRunning.id].sort());
    await new Promise((res) => setImmediate(res));
  });

  it('เกิน MAX_JOBS: ทิ้งงานที่แตะนานที่สุดและไม่ได้รันก่อน', () => {
    const r = new ImportJobRegistry();
    const now = Date.now();
    const running = job({ status: 'Running', touchedAt: now - 1_000_000 });
    r.add(running);
    const jobs: ImportJob[] = [];
    for (let i = 0; i < MAX_JOBS + 3; i++) {
      const j = job({ touchedAt: now - i * 1000 });
      jobs.push(j);
      r.add(j);
    }
    expect(r.list().length).toBeLessThanOrEqual(MAX_JOBS);
    expect(r.get(running.id)).toBe(running);
    expect(r.get(jobs[jobs.length - 1].id)).toBeUndefined(); // เก่าสุดถูกทิ้ง
    expect(r.get(jobs[0].id)).toBeDefined();
  });

  it('remove: ลบงานและโฟลเดอร์ชั่วคราว', async () => {
    const r = new ImportJobRegistry();
    const j = job();
    await j.stage.add('x.pdf', await incoming('x'));
    r.add(j);
    await r.remove(j.id);
    expect(r.get(j.id)).toBeUndefined();
    expect(existsSync(j.stage.dir)).toBe(false);
    await expect(r.remove('nope')).resolves.toBeUndefined();
  });
});
