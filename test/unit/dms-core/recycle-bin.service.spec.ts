import 'reflect-metadata';
import { FoldersService } from '../../../src/modules/dms/core/folders/folders.service';
import type { FolderRow } from '../../../src/modules/dms/core/folders/folder.types';
import {
  AUTO_PURGE_CONFIG_KEY,
  PURGE_BATCH_CONFIG_KEY,
  RecycleBinPurgeJob,
} from '../../../src/modules/dms/core/recycle-bin/recycle-bin-purge.job';
import { RecycleBinService } from '../../../src/modules/dms/core/recycle-bin/recycle-bin.service';
import { makeCrudLog } from '../../helpers/stubs';
import {
  admin,
  errorCode,
  errorStatus,
  FakeFolderRepo,
  fakeAccess,
  fakeTx,
  fileRow,
  folderRow,
  logEvents,
  manager,
  officer,
} from './helpers';

const NOW = new Date('2026-06-30T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

// 1(2SC root) → 2(ลบ) → 3(ลบ) · 10(4PC root) · 20(2SC root ที่ถูกลบ)
const sample = (deletedAt: Date = daysAgo(3)): FolderRow[] => [
  folderRow({ folderId: 1, folderName: '2SC - A [2SC]', confidentialityLevel: 2, folderDepth: 1 }),
  folderRow({
    folderId: 2,
    folderName: 'งบประมาณ',
    parentFolderId: 1,
    confidentialityLevel: 2,
    folderDepth: 2,
    isDeleted: true,
    deletedBy: 100,
    deletedDate: deletedAt,
  }),
  folderRow({
    folderId: 3,
    folderName: 'รายงาน',
    parentFolderId: 2,
    confidentialityLevel: 2,
    folderDepth: 3,
    isDeleted: true,
    deletedBy: 100,
    deletedDate: deletedAt,
  }),
  folderRow({ folderId: 10, folderName: '4PC - A [4PC]', confidentialityLevel: 4, folderDepth: 1 }),
];

interface Loc {
  fileId: number;
  folderId: number;
  orgUnitId: number;
  storedFileName: string;
  physicalPath: string;
}

class FakeBinFileRepo {
  calls: string[] = [];
  locations: Loc[] = [];
  blockersResult = { kmsAttachments: 0, projectAttachments: 0, externalShares: 0 };
  failHardDelete: Error | null = null;
  deletedQueries: unknown[] = [];

  listDeleted = async (q: unknown) => {
    this.deletedQueries.push(q);
    return { items: [fileRow({ fileId: 7, fileStatus: 3 })], total: 1 };
  };
  locationsInFolders = async (ids: readonly number[]) => {
    this.calls.push('locationsInFolders');
    return this.locations.filter((l) => ids.includes(l.folderId));
  };
  blockers = async () => {
    this.calls.push('blockers');
    return this.blockersResult;
  };
  hardDeleteTree = async (folderIds: readonly number[], fileIds: readonly number[]) => {
    this.calls.push('hardDeleteTree');
    if (this.failHardDelete) throw this.failHardDelete;
    this.deletedQueries.push({ folderIds, fileIds });
  };
}

function make(
  opts: {
    rows?: FolderRow[];
    rule?: Parameters<typeof fakeAccess>[0];
    visible?: number[];
  } = {},
) {
  const repo = new FakeFolderRepo(opts.rows ?? sample());
  const files = new FakeBinFileRepo();
  const crud = makeCrudLog();
  const tx = fakeTx();
  const access = fakeAccess(opts.rule);
  const visibility = {
    visibleOrgUnitIds: jest.fn(async () => ({ mode: 'role', ids: new Set(opts.visible ?? [1]) })),
  };
  const folders = new FoldersService(
    crud.service,
    repo as never,
    access,
    visibility as never,
    { insertFolderPermission: jest.fn() } as never,
    tx as never,
    undefined,
    undefined,
  );
  const order: string[] = [];
  const storage = {
    candidatePaths: jest.fn((f: { storedFileName: string }) => [`/root/${f.storedFileName}`]),
    deleteFiles: jest.fn(async (groups: readonly (readonly string[])[]) => {
      order.push('deleteFiles');
      return { deleted: groups.length, missing: 0, failed: [] as string[] };
    }),
  };
  const origHard = files.hardDeleteTree;
  files.hardDeleteTree = async (a, b) => {
    order.push('hardDeleteTree');
    return origHard(a, b);
  };
  const svc = new RecycleBinService(
    crud.service,
    repo as never,
    files as never,
    folders,
    access,
    visibility as never,
    storage as never,
    tx as never,
  );
  return { svc, repo, files, crud, tx, storage, visibility, order };
}

describe('RecycleBinService.listFolders / listFiles', () => {
  it('Manager+ เห็นทั้งหมดในหน่วยงานที่มองเห็น · ใช้ช่วงกู้คืน 30 วัน', async () => {
    const { svc, repo } = make();
    const r = await svc.listFolders(manager(), { page: 1, pageSize: 20 } as never, NOW);
    expect(r.total).toBe(2);
    const q = repo.called('listDeleted')[0].args[0] as Record<string, unknown>;
    expect(q.orgUnitIds).toEqual([1]);
    expect(q.deletedBy).toBeUndefined();
    expect(q.topLevelOnly).toBe(true);
    expect((q.deletedSince as Date).getTime()).toBe(NOW.getTime() - 30 * 86_400_000);
  });

  it('ผู้ใช้ทั่วไปเห็นเฉพาะที่ตนลบเอง · includeDescendants=true แสดงโฟลเดอร์ย่อยด้วย', async () => {
    const { svc, repo } = make();
    const u = officer();
    await svc.listFolders(u, { page: 1, pageSize: 20, includeDescendants: true } as never, NOW);
    const q = repo.called('listDeleted')[0].args[0] as Record<string, unknown>;
    expect(q.deletedBy).toBe(u.userId);
    expect(q.topLevelOnly).toBe(false);
  });

  it('กรองหน่วยงานที่ผู้ใช้มองไม่เห็น → ไม่มีผลลัพธ์จากหน่วยงานนั้น', async () => {
    const { svc, repo } = make({ visible: [1] });
    await svc.listFolders(manager(), { page: 1, pageSize: 20, orgUnitId: 9 } as never, NOW);
    expect((repo.called('listDeleted')[0].args[0] as { orgUnitIds: number[] }).orgUnitIds).toEqual(
      [],
    );
  });

  it('listFiles กรองตามผู้ลบ (ผู้ใช้ทั่วไป) และหน่วยงานที่เห็น', async () => {
    const { svc, files } = make();
    const u = officer();
    const r = await svc.listFiles(u, { page: 1, pageSize: 20 } as never);
    expect(r.items).toHaveLength(1);
    expect(files.deletedQueries[0]).toMatchObject({ orgUnitIds: [1], deletedBy: u.userId });
  });
});

describe('RecycleBinService.restoreFolder — กู้คืนภายใน 30 วัน', () => {
  it('กู้คืนไปที่แม่เดิม: restoreTree ใน transaction + log RESTORE_FOLDER', async () => {
    const { svc, repo, tx, crud } = make();
    const r = await svc.restoreFolder(manager(), 2, undefined, NOW);
    expect(r.isDeleted).toBe(false);
    expect(repo.called('restoreTree')).toHaveLength(1);
    expect(tx.calls.runs).toBe(1);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'RESTORE_FOLDER');
    expect(ev).toMatchObject({ module: 'DMS', action: 'UPDATE', success: true, recordId: 2 });
  });

  it('ไม่ได้อยู่ในถังขยะ → 409 FOLDER_NOT_DELETED', async () => {
    const { svc } = make();
    expect(await errorCode(svc.restoreFolder(manager(), 1, undefined, NOW))).toBe(
      'FOLDER_NOT_DELETED',
    );
    expect(await errorStatus(svc.restoreFolder(manager(), 1, undefined, NOW))).toBe(409);
  });

  it('ไม่พบโฟลเดอร์ → 404', async () => {
    const { svc } = make();
    expect(await errorStatus(svc.restoreFolder(manager(), 999, undefined, NOW))).toBe(404);
  });

  it('เกิน 30 วัน → 422 RECYCLE_BIN_EXPIRED · พอดี 30 วันยังกู้ได้', async () => {
    const old = make({ rows: sample(daysAgo(31)) });
    expect(await errorCode(old.svc.restoreFolder(manager(), 2, undefined, NOW))).toBe(
      'RECYCLE_BIN_EXPIRED',
    );
    expect(old.repo.called('restoreTree')).toHaveLength(0);
    const edge = make({ rows: sample(daysAgo(30)) });
    await expect(edge.svc.restoreFolder(manager(), 2, undefined, NOW)).resolves.toBeDefined();
  });

  it('ไม่มีสิทธิ์ลบ (Modify) → 403 FOLDER_DELETE_DENIED', async () => {
    const { svc, repo } = make({ rule: () => false });
    expect(await errorCode(svc.restoreFolder(officer(), 2, undefined, NOW))).toBe(
      'FOLDER_DELETE_DENIED',
    );
    expect(repo.called('restoreTree')).toHaveLength(0);
  });

  it('แม่เดิมถูกลบ/ไม่อยู่ → 422 PARENT_FOLDER_MISSING', async () => {
    const rows = sample();
    rows[0].isDeleted = true;
    const { svc } = make({ rows });
    expect(await errorCode(svc.restoreFolder(manager(), 2, undefined, NOW))).toBe(
      'PARENT_FOLDER_MISSING',
    );
  });

  it('ชื่อซ้ำกับโฟลเดอร์ที่สร้างใหม่ใต้แม่เดิม → 409 FOLDER_NAME_DUPLICATE', async () => {
    const rows = sample();
    rows.push(
      folderRow({
        folderId: 30,
        folderName: ' งบประมาณ',
        parentFolderId: 1,
        confidentialityLevel: 2,
        folderDepth: 2,
      }),
    );
    const { svc, repo } = make({ rows });
    expect(await errorCode(svc.restoreFolder(manager(), 2, undefined, NOW))).toBe(
      'FOLDER_NAME_DUPLICATE',
    );
    expect(repo.called('restoreTree')).toHaveLength(0);
  });

  it('Root ที่ถูกลบ: มี Root ระดับเดียวกันอยู่แล้ว → 409 ROOT_FOLDER_EXISTS · 1HC ไม่จำกัดจำนวน', async () => {
    const rows = [
      folderRow({ folderId: 1, folderName: '2SC - A [2SC]', confidentialityLevel: 2 }),
      folderRow({
        folderId: 20,
        folderName: '2SC - A [2SC]',
        confidentialityLevel: 2,
        isDeleted: true,
        deletedDate: daysAgo(1),
      }),
      folderRow({
        folderId: 40,
        folderName: '1HC - X [1HC]',
        confidentialityLevel: 1,
        isDeleted: true,
        deletedDate: daysAgo(1),
      }),
      folderRow({ folderId: 41, folderName: '1HC - Y [1HC]', confidentialityLevel: 1 }),
    ];
    const { svc } = make({ rows });
    expect(await errorCode(svc.restoreFolder(manager(), 20, undefined, NOW))).toBe(
      'ROOT_FOLDER_EXISTS',
    );
    await expect(svc.restoreFolder(manager(), 40, undefined, NOW)).resolves.toBeDefined();
  });

  describe('กู้คืนไปแม่ใหม่ (newParentFolderId)', () => {
    it('reparent ทั้งต้นไม้ย่อย รับ OrgUnit/ชั้นความลับ/ความลึกของแม่ใหม่ แล้ว restoreTree', async () => {
      const { svc, repo } = make();
      await svc.restoreFolder(manager(), 2, 10, NOW);
      const args = repo.called('reparent')[0].args[0] as Record<string, unknown>;
      expect(args).toMatchObject({
        sourceId: 2,
        newParentId: 10,
        depthDelta: 0, // แม่ใหม่ depth 1 → ลูก depth 2 เท่าเดิม
        orgUnitId: 1,
        confidentialityLevel: 4,
        descendantIds: [3],
      });
      expect(repo.called('restoreTree')).toHaveLength(1);
    });

    it('แม่ใหม่อยู่ในต้นไม้ย่อยของตัวเอง → 422 FOLDER_MOVE_INTO_DESCENDANT', async () => {
      const rows = sample();
      rows[2].isDeleted = false; // 3 เป็นแม่ใหม่ที่ "ใช้ได้" แต่อยู่ใต้ 2
      const { svc } = make({ rows });
      expect(await errorCode(svc.restoreFolder(manager(), 2, 3, NOW))).toBe(
        'FOLDER_MOVE_INTO_DESCENDANT',
      );
    });

    it('แม่ใหม่ถูกลบ → 422 FOLDER_DELETED · ไม่พบ → 404', async () => {
      const { svc } = make();
      expect(await errorCode(svc.restoreFolder(manager(), 3, 2, NOW))).toBe('FOLDER_DELETED');
      expect(await errorStatus(svc.restoreFolder(manager(), 2, 999, NOW))).toBe(404);
    });

    it('ไม่มีสิทธิ์เพิ่มในแม่ใหม่ → 403 FOLDER_ADD_DENIED', async () => {
      const { svc, repo } = make({ rule: (_u, id, perm) => !(id === 10 && perm === 'Write') });
      expect(await errorCode(svc.restoreFolder(manager(), 2, 10, NOW))).toBe('FOLDER_ADD_DENIED');
      expect(repo.called('reparent')).toHaveLength(0);
    });

    it('แม่ใหม่ไม่ได้อยู่ใต้ Root หลัก → 422 FOLDER_NOT_UNDER_MAIN_ROOT', async () => {
      const rows = sample();
      rows.push(folderRow({ folderId: 50, folderName: 'โฟลเดอร์ลอย', confidentialityLevel: 4 }));
      const { svc } = make({ rows });
      expect(await errorCode(svc.restoreFolder(manager(), 2, 50, NOW))).toBe(
        'FOLDER_NOT_UNDER_MAIN_ROOT',
      );
    });

    it('ลึกเกิน 10 ชั้นหลังย้ายต้นไม้ → 422 FOLDER_DEPTH_EXCEEDED', async () => {
      const rows = sample();
      rows.push(
        folderRow({
          folderId: 60,
          folderName: 'ลึก',
          parentFolderId: 10,
          confidentialityLevel: 4,
          folderDepth: 9,
        }),
      );
      const { svc } = make({ rows });
      // 2 (depth 2) + ลูก 3 (depth 3) ใต้ 60 (depth 9) → 3 ลึก 11
      expect(await errorCode(svc.restoreFolder(manager(), 2, 60, NOW))).toBe(
        'FOLDER_DEPTH_EXCEEDED',
      );
    });

    it('ชื่อซ้ำใต้แม่ใหม่ → 409 FOLDER_NAME_DUPLICATE', async () => {
      const rows = sample();
      rows.push(
        folderRow({
          folderId: 61,
          folderName: 'งบประมาณ',
          parentFolderId: 10,
          confidentialityLevel: 4,
          folderDepth: 2,
        }),
      );
      const { svc } = make({ rows });
      expect(await errorCode(svc.restoreFolder(manager(), 2, 10, NOW))).toBe(
        'FOLDER_NAME_DUPLICATE',
      );
    });
  });
});

describe('RecycleBinService.purgeFolder — ลบถาวร', () => {
  const loc = (fileId: number, folderId: number, name: string): Loc => ({
    fileId,
    folderId,
    orgUnitId: 1,
    storedFileName: name,
    physicalPath: '',
  });

  it('ต้องเป็น Manager ขึ้นไป → 403 ROLE_REQUIRED', async () => {
    const { svc, files } = make();
    expect(await errorCode(svc.purgeFolder(officer(), 2))).toBe('ROLE_REQUIRED');
    expect(await errorStatus(svc.purgeFolder(officer(), 2))).toBe(403);
    expect(files.calls).toHaveLength(0);
  });

  it('ต้องอยู่ในถังขยะก่อน → 422 FOLDER_NOT_IN_RECYCLE_BIN', async () => {
    const { svc } = make();
    expect(await errorCode(svc.purgeFolder(manager(), 1))).toBe('FOLDER_NOT_IN_RECYCLE_BIN');
  });

  it('ไม่มีสิทธิ์ Modify (ACL ปฏิเสธ) → 403 FOLDER_DELETE_DENIED', async () => {
    const { svc, files } = make({ rule: () => false });
    expect(await errorCode(svc.purgeFolder(manager(), 2))).toBe('FOLDER_DELETE_DENIED');
    expect(files.calls).not.toContain('hardDeleteTree');
  });

  it('ลบแถวใน DB (transaction เดียว) ก่อน แล้วค่อยลบไฟล์กายภาพ และรายงานจำนวน', async () => {
    const { svc, files, storage, tx, order, crud } = make();
    files.locations = [loc(100, 2, 'a_1.pdf'), loc(101, 3, 'b_2.pdf')];
    const r = await svc.purgeFolder(manager(), 2);
    expect(r).toEqual({ folders: 2, files: 2, physicalDeleted: 2, physicalFailed: 0 });
    expect(order).toEqual(['hardDeleteTree', 'deleteFiles']);
    expect(tx.calls.runs).toBe(1);
    expect(files.deletedQueries[0]).toEqual({ folderIds: [2, 3], fileIds: [100, 101] });
    expect(storage.candidatePaths).toHaveBeenCalledTimes(2);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'PURGE_FOLDER');
    expect(ev).toMatchObject({
      module: 'DMS',
      entity: 'RecycleBin',
      action: 'DELETE',
      success: true,
    });
  });

  it('ยังมีบทความ KMS / ไฟล์แนบโครงการ / ลิงก์แชร์ภายนอกอ้างอิง → 409 FOLDER_IN_USE และไม่ลบอะไรเลย', async () => {
    const { svc, files, storage } = make();
    files.locations = [loc(100, 2, 'a_1.pdf')];
    files.blockersResult = { kmsAttachments: 1, projectAttachments: 0, externalShares: 0 };
    expect(await errorCode(svc.purgeFolder(manager(), 2))).toBe('FOLDER_IN_USE');
    expect(await errorStatus(svc.purgeFolder(manager(), 2))).toBe(409);
    expect(files.calls).not.toContain('hardDeleteTree');
    expect(storage.deleteFiles).not.toHaveBeenCalled();
  });

  it('มีโฟลเดอร์ย่อยที่ยังไม่ถูกลบ → 409 FOLDER_SUBTREE_NOT_DELETED', async () => {
    const rows = sample();
    rows[2].isDeleted = false;
    const { svc, files } = make({ rows });
    expect(await errorCode(svc.purgeFolder(manager(), 2))).toBe('FOLDER_SUBTREE_NOT_DELETED');
    expect(files.calls).toHaveLength(0);
  });

  it('DB ล้ม → ไม่แตะไฟล์กายภาพ (ไม่เสียไฟล์ทั้งที่ข้อมูลยังอยู่)', async () => {
    const { svc, files, storage } = make();
    files.locations = [loc(100, 2, 'a_1.pdf')];
    files.failHardDelete = new Error('FK violation');
    await expect(svc.purgeFolder(manager(), 2)).rejects.toThrow('FK violation');
    expect(storage.deleteFiles).not.toHaveBeenCalled();
  });

  it('ลบไฟล์กายภาพบางไฟล์ไม่สำเร็จ → ไม่ย้อน DB แต่รายงาน physicalFailed', async () => {
    const { svc, files, storage } = make();
    files.locations = [loc(100, 2, 'a_1.pdf'), loc(101, 3, 'b_2.pdf')];
    storage.deleteFiles.mockResolvedValueOnce({
      deleted: 1,
      missing: 0,
      failed: ['/root/b_2.pdf'],
    });
    const r = await svc.purgeFolder(admin(), 2);
    expect(r).toMatchObject({ files: 2, physicalDeleted: 1, physicalFailed: 1 });
  });
});

describe('RecycleBinService.purgeExpired — ลบถาวรที่หมดอายุ', () => {
  it('ทำทีละโฟลเดอร์ · รายการที่ล้มไม่กระทบรายการอื่น · สรุปผล', async () => {
    const rows = sample();
    rows.push(
      folderRow({
        folderId: 70,
        folderName: 'หมดอายุ',
        parentFolderId: 1,
        confidentialityLevel: 2,
        folderDepth: 2,
        isDeleted: true,
        deletedDate: daysAgo(40),
      }),
    );
    const { svc, repo, files, crud } = make({ rows });
    repo.expiredRoots = [2, 70];
    files.locations = [
      { fileId: 100, folderId: 2, orgUnitId: 1, storedFileName: 'a.pdf', physicalPath: '' },
    ];
    // รอบแรก (โฟลเดอร์ 2) ถูกบล็อกด้วย KMS · รอบสอง (70) ผ่าน
    let n = 0;
    files.blockers = async () => {
      n++;
      return n === 1
        ? { kmsAttachments: 2, projectAttachments: 0, externalShares: 0 }
        : { kmsAttachments: 0, projectAttachments: 0, externalShares: 0 };
    };
    const s = await svc.purgeExpired(10);
    expect(repo.expiredRoots).toEqual([2, 70]);
    expect(s.attempted).toBe(2);
    expect(s.purged).toBe(1);
    expect(s.failed).toHaveLength(1);
    expect(s.failed[0].folderId).toBe(2);
    const ev = (await logEvents(crud)).filter((e) => e.operation === 'PURGE_FOLDER_EXPIRED');
    expect(ev).toHaveLength(2);
    expect(ev.map((e) => e.success).sort()).toEqual([false, true]);
    expect(ev.every((e) => e.meta?.auto === true)).toBe(true);
  });

  it('ไม่มีรายการหมดอายุ → ไม่ทำอะไร', async () => {
    const { svc } = make();
    expect(await svc.purgeExpired(10)).toEqual({ attempted: 0, purged: 0, failed: [] });
  });
});

describe('RecycleBinPurgeJob — ปิดเป็นค่าเริ่มต้น', () => {
  function makeJob(opts: { enabled?: boolean; batch?: number; purge?: jest.Mock } = {}) {
    const bin = {
      purgeExpired:
        opts.purge ?? jest.fn(async () => ({ attempted: 3, purged: 3, failed: [] as never[] })),
    };
    const config = {
      getBool: jest.fn(async (key: string, fallback: boolean) =>
        key === AUTO_PURGE_CONFIG_KEY ? (opts.enabled ?? fallback) : fallback,
      ),
      getNumber: jest.fn(async (key: string, fallback: number) =>
        key === PURGE_BATCH_CONFIG_KEY ? (opts.batch ?? fallback) : fallback,
      ),
    };
    const ctx = { run: jest.fn(<T>(fn: () => T) => fn()) };
    const job = new RecycleBinPurgeJob(bin as never, config as never, ctx as never);
    return { job, bin, config, ctx };
  }

  it('ค่าตั้งระบบไม่ได้เปิด (fallback = false) → ไม่ลบอะไร', async () => {
    const { job, bin, config } = makeJob();
    expect(await job.runOnce()).toBeNull();
    expect(config.getBool).toHaveBeenCalledWith(AUTO_PURGE_CONFIG_KEY, false);
    expect(bin.purgeExpired).not.toHaveBeenCalled();
  });

  it('เปิด Dms.RecycleBin.AutoPurge → ลบด้วยขนาดชุดเริ่มต้น 20 ภายใน context ของงานเบื้องหลัง', async () => {
    const { job, bin, ctx } = makeJob({ enabled: true });
    const r = await job.runOnce();
    expect(r).toEqual({ attempted: 3, purged: 3, failed: [] });
    expect(bin.purgeExpired).toHaveBeenCalledWith(20);
    expect(ctx.run).toHaveBeenCalledTimes(1);
  });

  it('ขนาดชุดถูกจำกัด 1–200', async () => {
    const big = makeJob({ enabled: true, batch: 5000 });
    await big.job.runOnce();
    expect(big.bin.purgeExpired).toHaveBeenCalledWith(200);
    const zero = makeJob({ enabled: true, batch: 0 });
    await zero.job.runOnce();
    expect(zero.bin.purgeExpired).toHaveBeenCalledWith(1);
  });

  it('รอบก่อนยังไม่จบ → ข้ามรอบนี้ และปลดล็อกเมื่อจบ', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const purge = jest.fn(async () => {
      await gate;
      return { attempted: 0, purged: 0, failed: [] as never[] };
    });
    const { job } = makeJob({ enabled: true, purge });
    const first = job.runOnce();
    await new Promise((r) => setImmediate(r));
    expect(await job.runOnce()).toBeNull();
    release();
    await first;
    await job.runOnce();
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it('error ไม่หลุดออกจากงาน (คืน null) และรอบถัดไปยังรันได้', async () => {
    const purge = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ attempted: 0, purged: 0, failed: [] });
    const { job } = makeJob({ enabled: true, purge });
    expect(await job.runOnce()).toBeNull();
    expect(await job.runOnce()).not.toBeNull();
  });

  it('handleCron ผูก @Cron ตอน 02:30 และเรียก runOnce', async () => {
    const meta = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      RecycleBinPurgeJob.prototype.handleCron,
    ) as { name?: string };
    expect(meta?.name).toBe('dms-recycle-bin-purge');
    const { job } = makeJob();
    const spy = jest.spyOn(job, 'runOnce');
    await job.handleCron();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
