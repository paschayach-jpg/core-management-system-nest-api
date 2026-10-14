import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { FileStorageService } from '../../../src/modules/dms/core/storage/file-storage.service';
import { fakeConfig, makeCrudLog } from '../../helpers/stubs';

const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

describe('FileStorageService (ใช้ temp dir จริง)', () => {
  let root: string;
  let svc: FileStorageService;
  let crud: ReturnType<typeof makeCrudLog>;
  const make = (sys?: { get: (k: string) => Promise<string | null> }) => {
    crud = makeCrudLog();
    return new FileStorageService(crud.service, fakeConfig({ STORAGE_ROOT: root }), sys as never);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dms-storage-'));
    svc = make();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('path / การป้องกัน path traversal', () => {
    it('สร้าง path ตามโครง <root>/<OrgUnitID>/<FolderID>/<ชื่อ>', () => {
      expect(svc.pathFor(12, 345, 'a_1.pdf')).toBe(join(root, '12', '345', 'a_1.pdf'));
    });

    it.each(['../evil.pdf', '..', '.', 'a/b.pdf', 'a\\b.pdf', '', ' a.pdf', 'a\u0000.pdf'])(
      'ชื่อไฟล์ไม่ปลอดภัย %j ถูกปฏิเสธ',
      (name) => {
        expect(() => svc.pathFor(1, 1, name)).toThrow(/ไม่ปลอดภัย/);
      },
    );

    it('OrgUnitID/FolderID ที่ไม่ใช่จำนวนเต็มบวกถูกปฏิเสธ', () => {
      expect(() => svc.pathFor(0, 1, 'a.pdf')).toThrow();
      expect(() => svc.pathFor(1, -3, 'a.pdf')).toThrow();
      expect(() => svc.pathFor(1.5, 1, 'a.pdf')).toThrow();
      expect(() => svc.pathFor(Number('../..'), 1, 'a.pdf')).toThrow();
    });

    it('assertInsideRoot ปฏิเสธ path นอก root', () => {
      expect(() => svc.assertInsideRoot(join(root, '..', 'x'))).toThrow(/นอกที่จัดเก็บ/);
      expect(() => svc.assertInsideRoot(root)).toThrow();
      expect(() => svc.assertInsideRoot(join(root, '1', '2', 'ok.pdf'))).not.toThrow();
    });

    it('candidatePaths: อ่านเฉพาะ 3 ส่วนท้ายของ PhysicalPath แบบ Windows/UNC ที่ปลอดภัย', () => {
      const c = svc.candidatePaths({
        orgUnitId: 5,
        folderId: 9,
        storedFileName: 'new.pdf',
        physicalPath: '\\\\fileserver\\dms\\3\\8\\old.pdf',
      });
      expect(c).toEqual([join(root, '3', '8', 'old.pdf'), join(root, '5', '9', 'new.pdf')]);
    });

    it('candidatePaths: PhysicalPath ที่มี .. หรือส่วนที่ไม่ใช่ตัวเลขถูกข้าม (ไม่หลุด root)', () => {
      const c = svc.candidatePaths({
        orgUnitId: 5,
        folderId: 9,
        storedFileName: 'x.pdf',
        physicalPath: 'C:\\data\\..\\..\\etc\\passwd',
      });
      expect(c).toEqual([join(root, '5', '9', 'x.pdf')]);
      const d = svc.candidatePaths({
        orgUnitId: 5,
        folderId: 9,
        storedFileName: 'x.pdf',
        physicalPath: '/1/2/../x.pdf',
      });
      expect(d.every((p) => p.startsWith(root))).toBe(true);
    });

    it('candidatePaths: StoredFileName ที่ไม่ปลอดภัยไม่ได้เป็นตำแหน่งที่เป็นไปได้', () => {
      expect(
        svc.candidatePaths({ orgUnitId: 1, folderId: 1, storedFileName: '../../x', physicalPath: null }),
      ).toEqual([]);
    });
  });

  describe('store — เขียน stream พร้อม SHA-256 และตรวจขนาด', () => {
    it('เขียนไฟล์ คำนวณ SHA-256 และขนาดตรงกัน ไม่เหลือไฟล์ .uploading', async () => {
      const data = Buffer.from('สวัสดี DMS '.repeat(1000));
      const target = svc.pathFor(1, 2, 'a.pdf');
      const r = await svc.store(Readable.from([data]), target, { expectedSize: data.length });
      expect(r).toEqual({ sizeBytes: data.length, sha256: sha256(data) });
      expect(readFileSync(target).equals(data)).toBe(true);
      expect(readdirSync(join(root, '1', '2'))).toEqual(['a.pdf']);
    });

    it('ขนาดที่เขียนไม่ตรงกับที่รับ (expectedSize) → ล้มและลบไฟล์ชั่วคราว', async () => {
      const target = svc.pathFor(1, 2, 'a.pdf');
      await expect(
        svc.store(Readable.from([Buffer.from('12345')]), target, { expectedSize: 99 }),
      ).rejects.toMatchObject({ response: { code: 'STORAGE_SIZE_MISMATCH' } });
      expect(existsSync(target)).toBe(false);
      expect(readdirSync(join(root, '1', '2'))).toEqual([]);
    });

    it('เกิน maxBytes ระหว่างเขียน → หยุดทันที (FILE_TOO_LARGE) และไม่ทิ้งไฟล์ค้าง', async () => {
      const target = svc.pathFor(1, 2, 'big.pdf');
      const chunks = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
      await expect(svc.store(chunks, target, { maxBytes: 1000 })).rejects.toMatchObject({
        response: { code: 'FILE_TOO_LARGE' },
      });
      expect(readdirSync(join(root, '1', '2'))).toEqual([]);
    });

    it('stream ต้นทางล้มกลางทาง → ล้มและไม่ทิ้งไฟล์ค้าง', async () => {
      const target = svc.pathFor(1, 2, 'broken.pdf');
      const src = new Readable({
        read() {
          this.push(Buffer.from('abc'));
          this.destroy(new Error('network reset'));
        },
      });
      await expect(svc.store(src, target)).rejects.toMatchObject({
        response: { code: 'STORAGE_WRITE_FAILED' },
      });
      expect(readdirSync(join(root, '1', '2'))).toEqual([]);
    });

    it('ไม่เขียนทับไฟล์ที่มีอยู่แล้ว', async () => {
      const target = svc.pathFor(1, 2, 'a.pdf');
      mkdirSync(join(root, '1', '2'), { recursive: true });
      writeFileSync(target, 'เดิม');
      await expect(svc.store(Readable.from([Buffer.from('ใหม่')]), target)).rejects.toMatchObject({
        response: { code: 'STORAGE_TARGET_EXISTS' },
      });
      expect(readFileSync(target, 'utf8')).toBe('เดิม');
    });

    it('ปฏิเสธ target นอก root', async () => {
      await expect(
        svc.store(Readable.from([Buffer.from('x')]), join(root, '..', 'evil.pdf')),
      ).rejects.toMatchObject({ response: { code: 'STORAGE_PATH_INVALID' } });
    });
  });

  describe('อ่าน / ย้าย / คัดลอก / ลบ', () => {
    const put = async (org: number, folder: number, name: string, text: string) => {
      const p = svc.pathFor(org, folder, name);
      await svc.store(Readable.from([Buffer.from(text)]), p);
      return p;
    };

    it('openRead เปิดอ่านเป็น stream จากตำแหน่งที่บันทึกใน DB (แบบ Windows) ได้', async () => {
      await put(3, 8, 'old.pdf', 'เนื้อหา');
      const h = await svc.openRead({
        orgUnitId: 99,
        folderId: 99,
        storedFileName: 'missing.pdf',
        physicalPath: 'Z:\\share\\3\\8\\old.pdf',
      });
      expect(h.sizeBytes).toBe(Buffer.byteLength('เนื้อหา'));
      expect((await drain(h.stream)).toString('utf8')).toBe('เนื้อหา');
    });

    it('openRead ไม่พบไฟล์ → 404 FILE_CONTENT_MISSING', async () => {
      await expect(
        svc.openRead({ orgUnitId: 1, folderId: 1, storedFileName: 'none.pdf' }),
      ).rejects.toMatchObject({ response: { code: 'FILE_CONTENT_MISSING' }, status: 404 });
    });

    it('move: ย้ายไฟล์ข้ามโฟลเดอร์ และไม่เขียนทับปลายทาง', async () => {
      const from = await put(1, 2, 'a.pdf', 'A');
      const to = svc.pathFor(1, 3, 'a.pdf');
      await svc.move(from, to);
      expect(existsSync(from)).toBe(false);
      expect(readFileSync(to, 'utf8')).toBe('A');
      const other = await put(1, 4, 'b.pdf', 'B');
      await expect(svc.move(other, to)).rejects.toMatchObject({
        response: { code: 'STORAGE_TARGET_EXISTS' },
      });
      expect(existsSync(other)).toBe(true);
    });

    it('copy: คัดลอกแล้วต้นฉบับยังอยู่ · ไม่เขียนทับ', async () => {
      const from = await put(1, 2, 'a.pdf', 'AAA');
      const to = svc.pathFor(1, 5, 'copy.pdf');
      await svc.copy(from, to);
      expect(readFileSync(to, 'utf8')).toBe('AAA');
      expect(existsSync(from)).toBe(true);
      await expect(svc.copy(from, to)).rejects.toMatchObject({ response: { code: 'STORAGE_COPY_FAILED' } });
    });

    it('withIntegrityCheck: ตรวจ SHA-256 ระหว่างส่ง แจ้งผลเมื่อจบ', async () => {
      const data = Buffer.from('integrity');
      const results: boolean[] = [];
      const good = svc.withIntegrityCheck(Readable.from([data]), sha256(data), (r) => results.push(r.ok));
      expect((await drain(good)).equals(data)).toBe(true);
      const bad = svc.withIntegrityCheck(Readable.from([data]), sha256('อื่น'), (r) => results.push(r.ok));
      await drain(bad);
      expect(results).toEqual([true, false]);
    });

    it('deleteFiles: ลบทุกตำแหน่งที่มีไฟล์ ไม่ throw เมื่อไม่พบ และบันทึก CRUD-log (DELETE_PHYSICAL_FILE)', async () => {
      const p1 = await put(1, 2, 'a.pdf', 'A');
      const p2 = await put(1, 2, 'b.pdf', 'B');
      const res = await svc.deleteFiles(
        [[p1, join(root, '9', '9', 'nope.pdf')], [p2], [join(root, '1', '2', 'ghost.pdf')]],
        { reason: 'test' },
      );
      expect(res).toEqual({ deleted: 2, missing: 1, failed: [] });
      expect(existsSync(p1) || existsSync(p2)).toBe(false);
      await crud.service.drain();
      const ev = crud.sink.events.find((e) => e.operation === 'DELETE_PHYSICAL_FILE');
      expect(ev).toMatchObject({ module: 'DMS', entity: 'PhysicalFile', action: 'DELETE', success: true });
      expect(ev?.meta).toMatchObject({ reason: 'test', files: 3, deleted: 2 });
    });

    it('deleteFiles ปฏิเสธ path นอก root (ไม่ลบไฟล์นอกที่จัดเก็บ)', async () => {
      const outside = join(tmpdir(), `dms-outside-${Date.now()}.txt`);
      writeFileSync(outside, 'x');
      try {
        const res = await svc.deleteFiles([[outside]]);
        expect(res.failed).toEqual([outside]);
        expect(existsSync(outside)).toBe(true);
      } finally {
        rmSync(outside, { force: true });
      }
    });
  });

  describe('toDbPath — ค่าที่บันทึกใน FileDocument.PhysicalPath', () => {
    it('ไม่มี NetworkDrivePath → path สัมพัทธ์แบบ posix', async () => {
      expect(await make({ get: async () => null }).toDbPath(5, 9, 'a.pdf')).toBe('5/9/a.pdf');
    });

    it('มี NetworkDrivePath แบบ UNC/Windows → คงรูปแบบเดิมให้ WinForms อ่านต่อได้', async () => {
      const s = make({ get: async () => '\\\\fileserver\\dms\\' });
      expect(await s.toDbPath(5, 9, 'a.pdf')).toBe('\\\\fileserver\\dms\\5\\9\\a.pdf');
    });

    it('อ่านค่าตั้งล้ม → ใช้ path สัมพัทธ์ (ไม่ทำให้อัปโหลดล้ม)', async () => {
      const s = make({
        get: async () => {
          throw new Error('db down');
        },
      });
      expect(await s.toDbPath(1, 2, 'x.pdf')).toBe('1/2/x.pdf');
    });
  });
});
