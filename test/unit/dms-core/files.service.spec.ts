import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PrincipalType } from '../../../src/common/constants/enums';
import { BusinessException } from '../../../src/common/exceptions/business.exception';
import { DmsFilePortAdapter, DmsFileUncheckedAdapter } from '../../../src/modules/dms/core/files/dms-file-port.adapter';
import { FilesService, type UploadSource } from '../../../src/modules/dms/core/files/files.service';
import { FoldersService } from '../../../src/modules/dms/core/folders/folders.service';
import type { FileAclEntry } from '../../../src/modules/dms/core/rules/file-acl.rules';
import { FileStorageService } from '../../../src/modules/dms/core/storage/file-storage.service';
import { fakeConfig, makeCrudLog } from '../../helpers/stubs';
import {
  errorCode,
  errorStatus,
  FakeFileRepo,
  FakeFolderRepo,
  fakeAccess,
  fakeTx,
  fileRow,
  folderRow,
  fullAuthority,
  logEvents,
  manager,
  officer,
} from './helpers';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

interface Opts {
  rule?: Parameters<typeof fakeAccess>[0];
  quota?: unknown;
  approvals?: unknown;
  maxMb?: number;
  entries?: FileAclEntry[];
  files?: ReturnType<typeof fileRow>[];
  folders?: ReturnType<typeof folderRow>[];
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dms-files-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function make(opts: Opts = {}) {
  const crud = makeCrudLog();
  /** ปิดสิทธิ์ ACL ภายหลังเตรียมข้อมูล (gate.open = false) */
  const gate = { open: true };
  const rule: Parameters<typeof fakeAccess>[0] = (u, f, p) =>
    gate.open && (opts.rule ? opts.rule(u, f, p) : true);
  const folderRepo = new FakeFolderRepo(
    opts.folders ?? [
      folderRow({ folderId: 1, folderName: '2SC - A', confidentialityLevel: 2, folderDepth: 1 }),
      folderRow({ folderId: 10, folderName: 'เอกสาร', parentFolderId: 1, confidentialityLevel: 2, folderDepth: 2 }),
      folderRow({ folderId: 11, folderName: 'ปลายทาง', parentFolderId: 1, confidentialityLevel: 2, folderDepth: 2 }),
      folderRow({ folderId: 20, folderName: '3NC - B', confidentialityLevel: 3, folderDepth: 1, orgUnitId: 2 }),
      folderRow({ folderId: 21, folderName: 'ข้ามหน่วยงาน', parentFolderId: 20, confidentialityLevel: 3, folderDepth: 2, orgUnitId: 2 }),
    ],
  );
  const fileRepo = new FakeFileRepo(opts.files ?? []);
  const access = fakeAccess(rule);
  const tx = fakeTx();
  const folders = new FoldersService(
    crud.service,
    folderRepo as never,
    access,
    { visibleOrgUnitIds: async () => ({ mode: 'role', ids: new Set([1, 2]) }) } as never,
    {} as never,
    tx as never,
    opts.quota as never,
    opts.approvals as never,
  );
  const aclRepo = {
    activeFileEntries: jest.fn(async () => opts.entries ?? []),
    copyFolderPermissionsToFile: jest.fn(async () => 0),
  };
  const config = fakeConfig({ STORAGE_ROOT: root, STORAGE_MAX_UPLOAD_MB: opts.maxMb ?? 100 });
  const storage = new FileStorageService(crud.service, config, undefined);
  const svc = new FilesService(
    crud.service,
    fileRepo as never,
    folderRepo as never,
    folders,
    access,
    aclRepo as never,
    storage,
    tx as never,
    config,
    opts.quota as never,
    opts.approvals as never,
  );
  return { svc, storage, folderRepo, fileRepo, aclRepo, tx, crud, folders, gate };
}

const source = (name: string, data: Buffer | string, extra: Partial<UploadSource> = {}): UploadSource => {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return {
    originalName: name,
    sizeBytes: buf.length,
    open: () => Readable.from([buf]),
    dispose: jest.fn(async () => undefined),
    ...extra,
  };
};

/** ไฟล์กายภาพทั้งหมดใต้ root (ไม่รวมโฟลเดอร์) */
function filesOnDisk(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else out.push(join(d, e.name));
    }
  };
  walk(root);
  return out;
}

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

describe('FilesService.upload', () => {
  it('บันทึกไฟล์: เขียนลง <root>/<org>/<folder>/, คำนวณ SHA-256, บันทึก DB และสิทธิ์ที่สืบทอดจากโฟลเดอร์, อัปเดตตัวนับ, เขียน CRUD-log', async () => {
    const { svc, fileRepo, aclRepo, folderRepo, tx, crud } = make();
    const data = Buffer.from('เนื้อหา PDF '.repeat(50));
    const src = source('รายงาน.pdf', data);
    const res = await svc.upload(manager(), 10, [src]);

    expect(res).toMatchObject({ successCount: 1, failureCount: 0 });
    expect(res.items[0]).toMatchObject({ success: true, actualName: 'รายงาน.pdf', isDuplicate: false, version: 1 });

    const row = fileRepo.rows[0];
    expect(row).toMatchObject({
      folderId: 10,
      originalFileName: 'รายงาน.pdf',
      fileExtension: '.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: String(data.length),
      checksum: sha(data),
      version: 1,
    });
    const disk = filesOnDisk();
    expect(disk).toHaveLength(1);
    expect(disk[0]).toContain(join(root, '1', '10'));
    expect(readFileSync(disk[0]).equals(data)).toBe(true);
    expect(row.storedFileName).not.toBe('รายงาน.pdf'); // ไม่ใช้ชื่อผู้ใช้เป็นชื่อไฟล์จริง
    expect(aclRepo.copyFolderPermissionsToFile).toHaveBeenCalledWith(10, row.fileId, manager().userId, tx.scope);
    expect(folderRepo.called('refreshCounters')[0].args[0]).toEqual([10]);
    expect(src.dispose).toHaveBeenCalled();

    const ev = (await logEvents(crud)).find((e) => e.operation === 'UPLOAD_FILE');
    expect(ev).toMatchObject({ module: 'DMS', entity: 'FileDocument', action: 'CREATE', success: true, recordId: row.fileId });
  });

  it('ชื่อซ้ำ → ตั้งเป็น "name copy(N).ext" และรายงาน isDuplicate', async () => {
    const { svc, fileRepo } = make({ files: [fileRow({ fileId: 1, originalFileName: 'a.pdf' })] });
    const r1 = await svc.upload(manager(), 10, [source('a.pdf', 'x')]);
    expect(r1.items[0]).toMatchObject({ actualName: 'a copy(1).pdf', isDuplicate: true });
    const r2 = await svc.upload(manager(), 10, [source('a.pdf', 'y')]);
    expect(r2.items[0].actualName).toBe('a copy(2).pdf');
    expect(fileRepo.rows.map((r) => r.originalFileName)).toEqual(['a.pdf', 'a copy(1).pdf', 'a copy(2).pdf']);
  });

  it('overwriteExisting: ชื่อเดิม + Version+1 และ soft delete แถวเก่า "หลัง" แถวใหม่บันทึก', async () => {
    const { svc, fileRepo } = make({ files: [fileRow({ fileId: 1, originalFileName: 'a.pdf', version: 3 })] });
    const res = await svc.upload(manager(), 10, [source('a.pdf', 'ใหม่')], { overwriteExisting: true });
    expect(res.items[0]).toMatchObject({ actualName: 'a.pdf', version: 4, isDuplicate: false });
    expect(fileRepo.order.indexOf('insert')).toBeLessThan(fileRepo.order.indexOf('softDelete'));
    expect(fileRepo.rows.find((r) => r.fileId === 1)?.fileStatus).toBe(3);
    expect(fileRepo.rows.find((r) => r.fileId !== 1)).toMatchObject({ originalFileName: 'a.pdf', version: 4 });
  });

  it('ชนิดไฟล์ไม่อนุญาต/เกิน 100MB: รายงานรายไฟล์ ไม่กระทบไฟล์อื่นในชุดเดียวกัน', async () => {
    const { svc, fileRepo } = make();
    const big = source('big.pdf', 'x', { sizeBytes: 100 * 1024 * 1024 + 1 });
    const res = await svc.upload(manager(), 10, [
      source('virus.exe', 'MZ'),
      big,
      source('../etc/passwd.pdf', 'x'),
      source('ok.pdf', 'ok'),
    ]);
    expect(res.items.map((i) => [i.originalName, i.success, i.errorCode])).toEqual([
      ['virus.exe', false, 'FILE_EXTENSION_NOT_ALLOWED'],
      ['big.pdf', false, 'FILE_TOO_LARGE'],
      ['../etc/passwd.pdf', false, 'FILE_NAME_INVALID'],
      ['ok.pdf', true, undefined],
    ]);
    expect(res).toMatchObject({ successCount: 1, failureCount: 3 });
    expect(fileRepo.rows).toHaveLength(1);
    expect(filesOnDisk()).toHaveLength(1);
  });

  it('ค่า STORAGE_MAX_UPLOAD_MB ที่ต่ำกว่า 100 MB ถูกใช้เป็นเพดาน', async () => {
    const { svc } = make({ maxMb: 1 });
    expect(svc.maxUploadBytes).toBe(1024 * 1024);
    const res = await svc.upload(manager(), 10, [source('a.pdf', 'x', { sizeBytes: 2 * 1024 * 1024 })]);
    expect(res.items[0].errorCode).toBe('FILE_TOO_LARGE');
  });

  it('ขนาดที่แจ้งไม่ตรงกับที่ส่งจริง → ล้ม ไม่มีไฟล์ค้าง ไม่มีแถวใน DB', async () => {
    const { svc, fileRepo } = make();
    const res = await svc.upload(manager(), 10, [source('a.pdf', '12345', { sizeBytes: 99 })]);
    expect(res.items[0]).toMatchObject({ success: false, errorCode: 'STORAGE_SIZE_MISMATCH' });
    expect(fileRepo.rows).toHaveLength(0);
    expect(filesOnDisk()).toHaveLength(0);
  });

  it('บันทึก DB ล้มเหลว → ลบไฟล์กายภาพที่เพิ่งเขียน (compensation) และรายงานล้มเหลว', async () => {
    const { svc, fileRepo, crud } = make();
    fileRepo.failInsert = new Error('deadlock victim');
    const src = source('a.pdf', 'สำคัญ');
    const res = await svc.upload(manager(), 10, [src]);
    expect(res.items[0]).toMatchObject({ success: false, errorCode: 'UPLOAD_FAILED' });
    expect(filesOnDisk()).toHaveLength(0);
    expect(src.dispose).toHaveBeenCalled();
    const ev = (await logEvents(crud)).find((e) => e.operation === 'UPLOAD_FILE');
    expect(ev).toMatchObject({ success: false, action: 'CREATE' });
  });

  it('ตรวจโควตาทั้งชุดก่อนเขียนไฟล์ใดๆ — เต็ม = ล้มทั้งชุด ไม่มีไฟล์ถูกเขียน', async () => {
    const quota = {
      validateBatch: jest.fn(async () => {
        throw new BusinessException('พื้นที่ไม่พอ', 'QUOTA_FULL');
      }),
      enforceQuota: jest.fn(),
      sendAlertIfNeeded: jest.fn(),
    };
    const { svc, fileRepo } = make({ quota });
    const a = source('a.pdf', 'aaa');
    const b = source('b.pdf', 'bbbbb');
    expect(await errorCode(svc.upload(manager(), 10, [a, b]))).toBe('QUOTA_FULL');
    expect(quota.validateBatch).toHaveBeenCalledWith(1, [3, 5]);
    expect(fileRepo.rows).toHaveLength(0);
    expect(filesOnDisk()).toHaveLength(0);
    expect(a.dispose).toHaveBeenCalled(); // ยังเก็บกวาดไฟล์ชั่วคราวแม้ล้มทั้งชุด
  });

  it('overwrite: โควตานับเฉพาะส่วนที่เพิ่มขึ้น (ขนาดใหม่ − ขนาดไฟล์เดิม)', async () => {
    const quota = { validateBatch: jest.fn(async () => undefined), enforceQuota: jest.fn(), sendAlertIfNeeded: jest.fn(async () => undefined) };
    const { svc } = make({ quota, files: [fileRow({ fileId: 1, originalFileName: 'a.pdf', fileSizeBytes: '4' })] });
    await svc.upload(manager(), 10, [source('a.pdf', '1234567890')], { overwriteExisting: true });
    expect(quota.validateBatch).toHaveBeenCalledWith(1, [6]);
    expect(quota.sendAlertIfNeeded).toHaveBeenCalledWith(1);
  });

  it('ไม่มีสิทธิ์เพิ่มในโฟลเดอร์ → 403 และไม่เขียนอะไร · โฟลเดอร์ถูกลบ/เก็บถาวร → 422 · ไม่พบ → 404', async () => {
    const a = make({ rule: () => false });
    expect(await errorCode(a.svc.upload(officer(), 10, [source('a.pdf', 'x')]))).toBe('FOLDER_ADD_DENIED');
    expect(filesOnDisk()).toHaveLength(0);

    const folders = [
      folderRow({ folderId: 1, folderName: '2SC', confidentialityLevel: 2 }),
      folderRow({ folderId: 10, parentFolderId: 1, isDeleted: true, folderDepth: 2 }),
      folderRow({ folderId: 11, parentFolderId: 1, isArchived: true, folderDepth: 2 }),
    ];
    const b = make({ folders });
    expect(await errorCode(b.svc.upload(manager(), 10, [source('a.pdf', 'x')]))).toBe('FOLDER_DELETED');
    expect(await errorCode(b.svc.upload(manager(), 11, [source('a.pdf', 'x')]))).toBe('FOLDER_ARCHIVED');
    expect(await errorStatus(b.svc.upload(manager(), 999, [source('a.pdf', 'x')]))).toBe(404);
  });

  it('ผู้ใช้ทั่วไปที่มี Authority.CanAdd อัปโหลดได้', async () => {
    const { svc } = make({ rule: () => false });
    const u = officer({ authority: fullAuthority() });
    expect((await svc.upload(u, 10, [source('a.pdf', 'x')])).successCount).toBe(1);
  });
});

describe('FilesService — ดาวน์โหลด', () => {
  async function withStoredFile(opts: Opts = {}) {
    const ctx = make({ files: [], ...opts });
    const data = Buffer.from('ไฟล์ลับ');
    await ctx.svc.upload(manager(), 10, [source('secret.pdf', data)]);
    const fileId = ctx.fileRepo.rows[0].fileId;
    return { ...ctx, fileId, data };
  }

  it('Manager/Admin ดาวน์โหลดได้ทันที และบันทึก EXECUTE DOWNLOAD_FILE', async () => {
    const { svc, fileId, data, crud } = await withStoredFile();
    const h = await svc.openDownload(manager(), fileId);
    expect(h).toMatchObject({ fileName: 'secret.pdf', mimeType: 'application/pdf', sizeBytes: data.length });
    expect((await drain(h.stream)).equals(data)).toBe(true);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'DOWNLOAD_FILE');
    expect(ev).toMatchObject({ action: 'EXECUTE', entity: 'FileDocument', recordId: fileId, success: true });
  });

  it('ผู้ใช้ทั่วไปที่อ่านได้แต่ไม่มี CanDownload และมีระบบอนุมัติ → 403 DOWNLOAD_APPROVAL_REQUIRED', async () => {
    const approvals = { findApprovedDownload: jest.fn(async () => null), consumeDownload: jest.fn(), submit: jest.fn() };
    const { svc, fileId, crud } = await withStoredFile({ approvals });
    const u = officer({ authority: { 2: { ...fullAuthority()![2], canDownload: false } } });
    const p = svc.openDownload(u, fileId);
    expect(await errorCode(p)).toBe('DOWNLOAD_APPROVAL_REQUIRED');
    expect(await errorStatus(svc.openDownload(u, fileId))).toBe(403);
    expect(approvals.findApprovedDownload).toHaveBeenCalledWith(u, fileId);
    expect(approvals.consumeDownload).not.toHaveBeenCalled();
    const ev = (await logEvents(crud)).filter((e) => e.operation === 'DOWNLOAD_FILE' && !e.success);
    expect(ev.length).toBeGreaterThan(0);
  });

  it('ไม่มีระบบอนุมัติ → 403 DOWNLOAD_DENIED (ไม่บอกว่าขออนุมัติได้)', async () => {
    const { svc, fileId } = await withStoredFile();
    const u = officer({ authority: { 2: { ...fullAuthority()![2], canDownload: false } } });
    const e = await svc.openDownload(u, fileId).catch((x) => x);
    expect(e.getResponse()).toMatchObject({ code: 'DOWNLOAD_DENIED', details: { canRequestApproval: false } });
  });

  it('มีใบอนุมัติที่อนุมัติแล้ว → ดาวน์โหลดได้ และใช้สิทธิ์ (consume) เพียงครั้งเดียว', async () => {
    const approvals = {
      findApprovedDownload: jest.fn(async () => ({ requestId: 88, requestStatus: 2 })),
      consumeDownload: jest.fn(async () => undefined),
      submit: jest.fn(),
    };
    const { svc, fileId, data } = await withStoredFile({ approvals });
    const u = officer({ authority: { 2: { ...fullAuthority()![2], canDownload: false } } });
    const h = await svc.openDownload(u, fileId);
    expect(approvals.consumeDownload).toHaveBeenCalledTimes(1);
    expect(approvals.consumeDownload).toHaveBeenCalledWith(u, 88);
    expect((await drain(h.stream)).equals(data)).toBe(true);
  });

  it('ใช้สิทธิ์จากใบอนุมัติล้ม (เช่น ถูกใช้ไปแล้ว) → ไม่ส่งไฟล์ และปิด stream', async () => {
    const approvals = {
      findApprovedDownload: jest.fn(async () => ({ requestId: 88, requestStatus: 2 })),
      consumeDownload: jest.fn(async () => {
        throw new BusinessException('ใช้สิทธิ์ไปแล้ว', 'DOWNLOAD_ALREADY_USED');
      }),
      submit: jest.fn(),
    };
    const { svc, fileId } = await withStoredFile({ approvals });
    const u = officer({ authority: { 2: { ...fullAuthority()![2], canDownload: false } } });
    expect(await errorCode(svc.openDownload(u, fileId))).toBe('DOWNLOAD_ALREADY_USED');
  });

  it('Authority.CanDownload ของชั้นความลับ → ดาวน์โหลดได้โดยไม่ต้องเรียกระบบอนุมัติ', async () => {
    const approvals = { findApprovedDownload: jest.fn(), consumeDownload: jest.fn(), submit: jest.fn() };
    const { svc, fileId } = await withStoredFile({ approvals });
    const h = await svc.openDownload(officer({ authority: fullAuthority() }), fileId);
    await drain(h.stream);
    expect(approvals.findApprovedDownload).not.toHaveBeenCalled();
  });

  it('สิทธิ์ระดับไฟล์ที่ให้ CanDownload ผ่านได้', async () => {
    const entry: FileAclEntry = {
      fileId: 1, principalType: PrincipalType.User, principalId: officer().userId,
      canRead: true, canWrite: false, canDelete: false, canModify: false, canFullControl: false, canDownload: true, isDeny: false,
    };
    const { svc, fileId } = await withStoredFile({ entries: [entry] });
    const h = await svc.openDownload(officer(), fileId);
    await drain(h.stream);
  });

  it('ถูก Deny ระดับไฟล์ → 403 FILE_PERMISSION_DENIED แม้เป็น Admin', async () => {
    const entry: FileAclEntry = {
      fileId: 1, principalType: PrincipalType.Role, principalId: manager().appRole,
      canRead: true, canWrite: false, canDelete: false, canModify: false, canFullControl: false, canDownload: false, isDeny: true,
    };
    const { svc, fileId } = await withStoredFile({ entries: [entry] });
    expect(await errorCode(svc.openDownload(manager(), fileId))).toBe('FILE_PERMISSION_DENIED');
  });

  it('อ่านโฟลเดอร์ไม่ได้ (ไม่มี Authority และ ACL ปฏิเสธ) → 403 FILE_PERMISSION_DENIED', async () => {
    const { svc, fileId, gate } = await withStoredFile();
    gate.open = false;
    expect(await errorCode(svc.openDownload(officer(), fileId))).toBe('FILE_PERMISSION_DENIED');
  });

  it('ไฟล์ถูกลบแล้ว → 404 FILE_DELETED · ไม่พบ → 404', async () => {
    const { svc, fileId, fileRepo } = await withStoredFile();
    fileRepo.rows[0].fileStatus = 3;
    expect(await errorCode(svc.openDownload(manager(), fileId))).toBe('FILE_DELETED');
    expect(await errorStatus(svc.openDownload(manager(), 99999))).toBe(404);
  });

  it('ขนาดไฟล์บนที่จัดเก็บไม่ตรงกับ DB → 500 FILE_INTEGRITY_FAILED (ไม่ส่งไฟล์เสีย)', async () => {
    const { svc, fileId, fileRepo } = await withStoredFile();
    fileRepo.rows[0].fileSizeBytes = '9999';
    const p = svc.openDownload(manager(), fileId);
    expect(await errorCode(p)).toBe('FILE_INTEGRITY_FAILED');
    expect(await errorStatus(svc.openDownload(manager(), fileId))).toBe(500);
  });

  it('checksum ไม่ตรงระหว่างส่ง → บันทึก FILE_INTEGRITY_FAILURE (success=false)', async () => {
    const { svc, fileId, fileRepo, crud } = await withStoredFile();
    fileRepo.rows[0].checksum = sha('อื่น');
    const h = await svc.openDownload(manager(), fileId);
    await drain(h.stream);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'FILE_INTEGRITY_FAILURE');
    expect(ev).toMatchObject({ action: 'EXECUTE', success: false, recordId: fileId });
  });

  it('ไฟล์กายภาพหาย → 404 FILE_CONTENT_MISSING', async () => {
    const { svc, fileId } = await withStoredFile();
    for (const f of filesOnDisk()) rmSync(f);
    expect(await errorCode(svc.openDownload(manager(), fileId))).toBe('FILE_CONTENT_MISSING');
  });

  it('หาไฟล์จาก PhysicalPath แบบ Windows เดิม (3 ส่วนท้าย) ได้เมื่อโฟลเดอร์ถูกย้ายหน่วยงานโดยไม่ย้ายไฟล์', async () => {
    mkdirSync(join(root, '7', '8'), { recursive: true });
    writeFileSync(join(root, '7', '8', 'legacy.pdf'), 'เก่า');
    const { svc } = make({
      files: [
        fileRow({
          fileId: 300, folderId: 10, storedFileName: 'legacy.pdf', fileSizeBytes: String(Buffer.byteLength('เก่า')),
          physicalPath: '\\\\server\\share\\7\\8\\legacy.pdf', checksum: sha('เก่า'),
        }),
      ],
    });
    const h = await svc.openDownload(manager(), 300);
    expect((await drain(h.stream)).toString()).toBe('เก่า');
  });

  it('downloadAccess บอกว่าดาวน์โหลดได้ทันที / ต้องขออนุมัติ / มีใบอนุมัติแล้ว', async () => {
    const approvals = { findApprovedDownload: jest.fn(async () => null), consumeDownload: jest.fn(), submit: jest.fn() };
    const { svc, fileId } = await withStoredFile({ approvals });
    expect(await svc.downloadAccess(manager(), fileId)).toEqual({ canDownload: true, requiresApproval: false, via: 'PRIVILEGED' });
    const u = officer({ authority: { 2: { ...fullAuthority()![2], canDownload: false } } });
    expect(await svc.downloadAccess(u, fileId)).toMatchObject({ canDownload: false, requiresApproval: true });
    approvals.findApprovedDownload.mockResolvedValueOnce({ requestId: 5, requestStatus: 2 } as never);
    expect(await svc.downloadAccess(u, fileId)).toMatchObject({ canDownload: true, via: 'APPROVAL', approvedRequestId: 5 });
  });
});

describe('FilesService — เปลี่ยนชื่อ / ลบ / กู้คืน', () => {
  const base = () => [
    fileRow({ fileId: 1, folderId: 10, originalFileName: 'a.pdf' }),
    fileRow({ fileId: 2, folderId: 10, originalFileName: 'b.pdf' }),
  ];

  it('เปลี่ยนชื่อ: คงนามสกุล, ห้ามชื่อซ้ำ, ห้ามเปลี่ยนนามสกุล', async () => {
    const { svc, fileRepo } = make({ files: base() });
    expect((await svc.rename(manager(), 1, 'ใหม่.pdf')).originalFileName).toBe('ใหม่.pdf');
    expect(fileRepo.called('rename')[0].args).toEqual([1, 'ใหม่.pdf']);
    expect(await errorCode(svc.rename(manager(), 1, 'b.pdf'))).toBe('FILE_NAME_DUPLICATE');
    expect(await errorCode(svc.rename(manager(), 1, 'x.exe'))).toBe('FILE_EXTENSION_CHANGE_NOT_ALLOWED');
    expect(await errorCode(svc.rename(manager(), 1, 'ไม่มีนามสกุล'))).toBe('FILE_EXTENSION_CHANGE_NOT_ALLOWED');
    expect(await errorCode(svc.rename(manager(), 1, '../x.pdf'))).toBe('FILE_NAME_INVALID');
  });

  it('เปลี่ยนชื่อต้องมีสิทธิ์แก้ไข', async () => {
    const { svc } = make({ files: base(), rule: () => false });
    expect(await errorCode(svc.rename(officer(), 1, 'z.pdf'))).toBe('FOLDER_EDIT_DENIED');
  });

  it('ลบ: soft delete + ปรับตัวนับ + CRUD-log DELETE_FILE', async () => {
    const { svc, fileRepo, folderRepo, crud } = make({ files: base() });
    await svc.remove(manager(), 1);
    expect(fileRepo.rows[0].fileStatus).toBe(3);
    expect(fileRepo.called('softDelete')[0].args).toEqual([1, manager().userId]);
    expect(folderRepo.called('refreshCounters')[0].args[0]).toEqual([10]);
    expect((await logEvents(crud)).find((e) => e.operation === 'DELETE_FILE')).toMatchObject({
      action: 'DELETE',
      recordId: 1,
      success: true,
    });
    expect(await errorCode(svc.remove(manager(), 1))).toBe('FILE_ALREADY_DELETED');
  });

  it('ลบ: สิทธิ์ระดับไฟล์ที่ไม่ให้สิทธิ์ลบทับสิทธิ์โฟลเดอร์ (รวม Manager)', async () => {
    const entry: FileAclEntry = {
      fileId: 1, principalType: PrincipalType.User, principalId: manager().userId,
      canRead: true, canWrite: false, canDelete: false, canModify: false, canFullControl: false, canDownload: false, isDeny: false,
    };
    const { svc, fileRepo } = make({ files: base(), entries: [entry] });
    expect(await errorCode(svc.remove(manager(), 1))).toBe('FILE_PERMISSION_DENIED');
    expect(fileRepo.rows[0].fileStatus).toBe(1);
  });

  it('ลบ: ผู้ใช้ทั่วไปไม่มีสิทธิ์ → 403', async () => {
    const { svc } = make({ files: base(), rule: () => false });
    expect(await errorCode(svc.remove(officer(), 1))).toBe('FILE_DELETE_DENIED');
  });

  it('กู้คืน: ไม่ได้อยู่ในถังขยะ → 409 · โฟลเดอร์ถูกลบ → 422 · ไฟล์จริงหาย → 409', async () => {
    const a = make({ files: base() });
    expect(await errorCode(a.svc.restore(manager(), 1))).toBe('FILE_NOT_DELETED');

    const deleted = fileRow({ fileId: 5, folderId: 10, originalFileName: 'd.pdf', fileStatus: 3, deletedDate: new Date() });
    const b = make({ files: [deleted] });
    expect(await errorCode(b.svc.restore(manager(), 5))).toBe('FILE_CONTENT_MISSING');

    const folders = [folderRow({ folderId: 1, confidentialityLevel: 2 }), folderRow({ folderId: 10, parentFolderId: 1, isDeleted: true, folderDepth: 2 })];
    const c = make({ files: [deleted], folders });
    expect(await errorCode(c.svc.restore(manager(), 5))).toBe('FOLDER_DELETED');
  });

  it('กู้คืนสำเร็จ: ชื่อชนกับไฟล์ที่ใช้งานอยู่ → ตั้งเป็น copy(N)', async () => {
    const files = [
      fileRow({ fileId: 1, folderId: 10, originalFileName: 'a.pdf' }),
      fileRow({ fileId: 5, folderId: 10, originalFileName: 'a.pdf', fileStatus: 3, storedFileName: 'del_1_x.pdf', physicalPath: '1/10/del_1_x.pdf' }),
    ];
    const { svc, fileRepo } = make({ files });
    mkdirSync(join(root, '1', '10'), { recursive: true });
    writeFileSync(join(root, '1', '10', 'del_1_x.pdf'), 'x');
    const r = await svc.restore(manager(), 5);
    expect(r.originalFileName).toBe('a copy(1).pdf');
    expect(fileRepo.called('restore')[0].args).toEqual([5, 'a copy(1).pdf']);
  });
});

describe('FilesService — ย้าย / คัดลอก', () => {
  async function stored(opts: Opts = {}) {
    const ctx = make({ files: [], ...opts });
    await ctx.svc.upload(manager(), 10, [source('doc.pdf', 'เนื้อหา')]);
    return { ...ctx, file: ctx.fileRepo.rows.find((r) => r.folderId === 10) as ReturnType<typeof fileRow> };
  }

  it('ย้าย: ย้ายไฟล์กายภาพไปโครง <org>/<folder>/ ใหม่ แล้วแก้ DB และปรับตัวนับทั้งสองโฟลเดอร์', async () => {
    const { svc, file, fileRepo, folderRepo } = await stored();
    const before = filesOnDisk()[0];
    const res = await svc.moveMany(manager(), [file.fileId], 11);
    expect(res).toMatchObject({ successCount: 1, failureCount: 0 });
    expect(res.items[0].renamedTo).toBeUndefined();
    expect(fileRepo.rows[0].folderId).toBe(11);
    const after = filesOnDisk();
    expect(after).toHaveLength(1);
    expect(after[0]).toContain(join(root, '1', '11'));
    expect(after[0]).not.toBe(before);
    expect(readFileSync(after[0], 'utf8')).toBe('เนื้อหา');
    expect(folderRepo.called('refreshCounters').pop()?.args[0]).toEqual([10, 11]);
  });

  it('ย้ายชื่อซ้ำในปลายทาง → ตั้งชื่อ copy(N) และรายงาน renamedTo', async () => {
    const files = [fileRow({ fileId: 70, folderId: 11, originalFileName: 'doc.pdf' })];
    const { svc, file } = await stored({ files });
    const res = await svc.moveMany(manager(), [file.fileId], 11);
    expect(res.items[0]).toMatchObject({ success: true, renamedTo: 'doc copy(1).pdf' });
  });

  it('ย้ายไปโฟลเดอร์เดิม = ไม่ทำอะไร', async () => {
    const { svc, file, fileRepo } = await stored();
    const before = filesOnDisk();
    const res = await svc.moveMany(manager(), [file.fileId], 10);
    expect(res.items[0].success).toBe(true);
    expect(fileRepo.called('relocate')).toHaveLength(0);
    expect(filesOnDisk()).toEqual(before);
  });

  it('DB ล้มหลังย้ายไฟล์กายภาพ → ย้ายไฟล์กลับที่เดิม', async () => {
    const { svc, file, fileRepo } = await stored();
    const before = filesOnDisk();
    fileRepo.failInsert = new Error('db down');
    const res = await svc.moveMany(manager(), [file.fileId], 11);
    expect(res.items[0]).toMatchObject({ success: false });
    expect(filesOnDisk()).toEqual(before);
    expect(fileRepo.rows[0].folderId).toBe(10);
  });

  it('ย้ายข้ามหน่วยงานตรวจโควตาของหน่วยงานปลายทาง · ปลายทางต้องมีสิทธิ์', async () => {
    const quota = { validateBatch: jest.fn(async () => undefined), enforceQuota: jest.fn(), sendAlertIfNeeded: jest.fn() };
    const { svc, file } = await stored({ quota });
    await svc.moveMany(manager(), [file.fileId], 21);
    expect(quota.validateBatch).toHaveBeenCalledWith(2, [Buffer.byteLength('เนื้อหา')]);

    const denied = await stored({ rule: (_u, folderId) => folderId !== 11 });
    expect(await errorCode(denied.svc.moveMany(officer(), [denied.file.fileId], 11))).toBe('FOLDER_MOVE_DENIED');
  });

  it('คัดลอก: สร้างแถวใหม่ + ไฟล์กายภาพใหม่ (checksum เดิม) และต้นฉบับยังอยู่', async () => {
    const { svc, file, fileRepo, aclRepo } = await stored();
    const copy = await svc.copy(manager(), file.fileId, { destinationFolderId: 11 });
    expect(copy).toMatchObject({ folderId: 11, originalFileName: 'doc.pdf', checksum: file.checksum, version: 1 });
    expect(copy.fileId).not.toBe(file.fileId);
    expect(fileRepo.rows).toHaveLength(2);
    expect(filesOnDisk()).toHaveLength(2);
    expect(aclRepo.copyFolderPermissionsToFile).toHaveBeenLastCalledWith(11, copy.fileId, manager().userId, expect.anything());
  });

  it('คัดลอกชื่อซ้ำ → copy(N) · overwrite → แทนที่และ Version+1', async () => {
    const { svc, file, fileRepo } = await stored();
    fileRepo.rows.push(fileRow({ fileId: 71, folderId: 11, originalFileName: 'doc.pdf', version: 2 }));
    expect((await svc.copy(manager(), file.fileId, { destinationFolderId: 11 })).originalFileName).toBe('doc copy(1).pdf');
    const replaced = await svc.copy(manager(), file.fileId, { destinationFolderId: 11, overwrite: true });
    expect(replaced).toMatchObject({ originalFileName: 'doc.pdf', version: 3 });
    expect(fileRepo.rows.find((r) => r.fileId === 71)?.fileStatus).toBe(3);
  });

  it('คัดลอกล้มที่ DB → ลบไฟล์กายภาพที่คัดลอกมา', async () => {
    const { svc, file, fileRepo } = await stored();
    fileRepo.failInsert = new Error('db down');
    await expect(svc.copy(manager(), file.fileId, { destinationFolderId: 11 })).rejects.toThrow('db down');
    expect(filesOnDisk()).toHaveLength(1);
  });

  it('คัดลอก: ตรวจโควตาปลายทาง · ต้องอ่านต้นทางได้และเพิ่มปลายทางได้ · ไฟล์จริงหาย → 409', async () => {
    const quota = {
      full: false,
      validateBatch: jest.fn(async () => {
        if (quota.full) throw new BusinessException('เต็ม', 'QUOTA_FULL');
      }),
      enforceQuota: jest.fn(),
      sendAlertIfNeeded: jest.fn(async () => undefined),
    };
    const c = await stored({ quota });
    quota.full = true;
    expect(await errorCode(c.svc.copy(manager(), c.file.fileId, { destinationFolderId: 11 }))).toBe('QUOTA_FULL');
    expect(filesOnDisk()).toHaveLength(1);

    const b = await stored();
    b.gate.open = false;
    expect(await errorCode(b.svc.copy(officer(), b.file.fileId, { destinationFolderId: 11 }))).toBe('FILE_VIEW_DENIED');

    const a = await stored();
    for (const f of filesOnDisk()) rmSync(f);
    expect(await errorCode(a.svc.copy(manager(), a.file.fileId, { destinationFolderId: 11 }))).toBe('FILE_CONTENT_MISSING');
  });
});

describe('FilesService — อ่านรายการ/เวอร์ชัน/ชื่อซ้ำ', () => {
  it('รายการไฟล์ต้องเห็นโฟลเดอร์ได้ · ประวัติเวอร์ชันระบุเวอร์ชันปัจจุบัน', async () => {
    const files = [
      fileRow({ fileId: 1, originalFileName: 'a.pdf', version: 1, fileStatus: 3 }),
      fileRow({ fileId: 2, originalFileName: 'a.pdf', version: 2 }),
    ];
    const { svc } = make({ files });
    const page = await svc.listByFolder(manager(), 10, { page: 1, pageSize: 20, sortDir: 'asc' } as never);
    expect(page.items.map((i) => i.fileId)).toEqual([2]);
    const v = await svc.versions(manager(), 2);
    expect(v.map((x) => [x.fileId, x.isCurrent])).toEqual([[1, false], [2, true]]);
    const denied = make({ files, rule: () => false });
    expect(await errorCode(denied.svc.listByFolder(officer(), 10, { page: 1, pageSize: 20 } as never))).toBe(
      'FOLDER_VIEW_DENIED',
    );
    expect((await svc.checkDuplicates(manager(), 10, ['a.pdf', 'z.pdf'])).duplicates).toEqual(['a.pdf']);
  });
});

describe('DMS_FILE_PORT adapter', () => {
  it('upload ผ่าน buffer ใช้กฎเดียวกับ HTTP · คืนข้อมูลไฟล์ · ล้มเมื่อไฟล์ไม่ผ่านกฎ', async () => {
    const { svc } = make();
    const port = new DmsFilePortAdapter(svc);
    const infos = await port.upload(manager(), 10, [
      { originalName: 'kb.pdf', buffer: Buffer.from('บทความ'), mimeType: 'application/pdf' },
    ]);
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({ folderId: 10, originalFileName: 'kb.pdf', version: 1 });
    expect(await port.listFolder(10)).toHaveLength(1);
    await expect(
      port.upload(manager(), 10, [{ originalName: 'x.exe', buffer: Buffer.from('MZ') }]),
    ).rejects.toMatchObject({ response: { code: 'FILE_EXTENSION_NOT_ALLOWED' } });
  });

  it('openRead ใช้เกณฑ์ดาวน์โหลดเดียวกับ HTTP · openReadUnchecked ข้ามสิทธิ์ผู้ใช้แต่ยัง log', async () => {
    const { svc, crud } = make();
    const port = new DmsFilePortAdapter(svc);
    const [info] = await port.upload(manager(), 10, [{ originalName: 'kb.pdf', buffer: Buffer.from('x') }]);
    const h = await port.openRead(manager(), info.fileId);
    expect(h).toMatchObject({ fileName: 'kb.pdf', size: 1, mimeType: 'application/pdf' });
    await drain(h.stream);

    const unchecked = new DmsFileUncheckedAdapter(svc);
    const u = await unchecked.openReadUnchecked(info.fileId);
    expect((await drain(u.stream)).toString()).toBe('x');
    expect((await logEvents(crud)).some((e) => e.operation === 'DOWNLOAD_FILE_UNCHECKED')).toBe(true);

    await port.remove(manager(), info.fileId);
    expect(await port.listFolder(10)).toHaveLength(0);
    expect(existsSync(root)).toBe(true);
  });
});
