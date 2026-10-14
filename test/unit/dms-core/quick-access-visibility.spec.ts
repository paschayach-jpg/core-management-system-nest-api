import { FoldersService } from '../../../src/modules/dms/core/folders/folders.service';
import type { FolderRow } from '../../../src/modules/dms/core/folders/folder.types';
import { QuickAccessService } from '../../../src/modules/dms/core/quick-access/quick-access.service';
import { UserOrgVisibilityService } from '../../../src/modules/dms/core/visibility/user-org-visibility.service';
import { makeCrudLog } from '../../helpers/stubs';
import {
  admin,
  errorCode,
  errorStatus,
  FakeFolderRepo,
  fakeAccess,
  fakeTx,
  folderRow,
  logEvents,
  manager,
  officer,
  srOfficer,
} from './helpers';

/** SpExecutor ปลอม: บันทึกการเรียก และคืน recordset ตามชื่อ SP */
function fakeSp(rowsByName: Record<string, Record<string, unknown>[]> = {}) {
  const execs: { name: string; params: Record<string, unknown> }[] = [];
  const reads: { name: string; params: Record<string, unknown> }[] = [];
  const state = { failExec: null as Error | null };
  return {
    execs,
    reads,
    get failExec() {
      return state.failExec;
    },
    set failExec(e: Error | null) {
      state.failExec = e;
    },
    call(def: { name: string }) {
      return {
        rows: async (params: Record<string, unknown>) => {
          reads.push({ name: def.name, params });
          return rowsByName[def.name] ?? [];
        },
        exec: async (params: Record<string, unknown>) => {
          if (state.failExec) throw state.failExec;
          execs.push({ name: def.name, params });
        },
      };
    },
  };
}

// ── ทางลัด ───────────────────────────────────────────────────────

const qaFolders = (): FolderRow[] => [
  folderRow({ folderId: 1, folderName: '2SC - A [2SC]', confidentialityLevel: 2 }),
  folderRow({
    folderId: 2,
    folderName: 'งบประมาณ',
    parentFolderId: 1,
    confidentialityLevel: 2,
    folderDepth: 2,
  }),
  folderRow({
    folderId: 3,
    folderName: 'ลับมาก',
    parentFolderId: 1,
    confidentialityLevel: 2,
    folderDepth: 2,
  }),
  folderRow({
    folderId: 4,
    folderName: 'ถูกลบ',
    parentFolderId: 1,
    confidentialityLevel: 2,
    folderDepth: 2,
    isDeleted: true,
  }),
];

function makeQa(rule?: Parameters<typeof fakeAccess>[0], sp = fakeSp()) {
  const repo = new FakeFolderRepo(qaFolders());
  const crud = makeCrudLog();
  const access = fakeAccess(rule);
  const folders = new FoldersService(
    crud.service,
    repo as never,
    access,
    { visibleOrgUnitIds: async () => ({ mode: 'role', ids: new Set([1]) }) } as never,
    { insertFolderPermission: jest.fn() } as never,
    fakeTx() as never,
    undefined,
    undefined,
  );
  const svc = new QuickAccessService(crud.service, sp as never, repo as never, folders, access);
  return { svc, sp, crud };
}

describe('QuickAccessService', () => {
  it('add: เรียก sp_AddQuickAccess ด้วย UserID ของผู้เรียก (ไม่รับ userId จาก client) + log', async () => {
    const { svc, sp, crud } = makeQa();
    const u = officer();
    await svc.add(u, 2);
    expect(sp.execs).toEqual([
      { name: 'storage.sp_AddQuickAccess', params: { UserID: u.userId, FolderID: 2 } },
    ]);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'ADD_QUICK_ACCESS');
    expect(ev).toMatchObject({
      module: 'DMS',
      entity: 'QuickAccessFolder',
      action: 'CREATE',
      success: true,
      recordId: 2,
    });
  });

  it('add: โฟลเดอร์ถูกลบ → 422 FOLDER_DELETED · ไม่มีสิทธิ์เห็น → 403 · ไม่พบ → 404', async () => {
    const a = makeQa();
    expect(await errorCode(a.svc.add(officer(), 4))).toBe('FOLDER_DELETED');
    const b = makeQa(() => false);
    expect(await errorCode(b.svc.add(officer(), 2))).toBe('FOLDER_VIEW_DENIED');
    expect(b.sp.execs).toHaveLength(0);
    expect(await errorStatus(a.svc.add(officer(), 999))).toBe(404);
  });

  it('remove: เรียก sp_RemoveQuickAccess ของฉันเท่านั้น', async () => {
    const { svc, sp } = makeQa();
    const u = officer();
    await svc.remove(u, 2);
    expect(sp.execs).toEqual([
      { name: 'storage.sp_RemoveQuickAccess', params: { UserID: u.userId, FolderID: 2 } },
    ]);
  });

  it('list: ซ่อนโฟลเดอร์ที่ไม่มีสิทธิ์เห็น · โฟลเดอร์ที่ถูกลบยังแสดงพร้อมธง isDeleted', async () => {
    const sp = fakeSp({
      'storage.sp_GetQuickAccessByUser': [
        { QuickAccessID: 1, FolderID: 2, AddedDate: new Date('2026-02-01') },
        { QuickAccessID: 2, FolderID: 3, AddedDate: new Date('2026-02-02') },
        { QuickAccessID: 3, FolderID: 4, AddedDate: new Date('2026-02-03') },
        { QuickAccessID: 4, FolderID: 999, AddedDate: new Date('2026-02-04') },
      ],
    });
    const { svc } = makeQa((_u, id) => id !== 3, sp);
    const u = officer();
    const items = await svc.list(u);
    expect(sp.reads[0].params).toEqual({ UserID: u.userId });
    expect(items.map((i) => i.folderId)).toEqual([2, 4]);
    expect(items[1].folder.isDeleted).toBe(true);
  });

  it('list: ว่าง → ไม่ query โฟลเดอร์', async () => {
    const { svc } = makeQa();
    expect(await svc.list(officer())).toEqual([]);
  });
});

// ── การมองเห็นหน่วยงาน ──────────────────────────────────────────

interface OrgRow {
  OrgUnitID: number;
  OrgUnitCode: string;
  OrgUnitNameTH: string;
  OrgUnitType: number;
  ParentOrgUnitID: number | null;
  IsActive: boolean;
  IsDeleted: boolean;
}
const org = (id: number, parent: number | null, over: Partial<OrgRow> = {}): OrgRow => ({
  OrgUnitID: id,
  OrgUnitCode: `O${id}`,
  OrgUnitNameTH: `หน่วย ${id}`,
  OrgUnitType: 1,
  ParentOrgUnitID: parent,
  IsActive: true,
  IsDeleted: false,
  ...over,
});

// 1 → (2 → 4), 3 ; 9 ถูกลบ
const orgs = (): OrgRow[] => [
  org(1, null),
  org(2, 1),
  org(3, 1),
  org(4, 2),
  org(9, 1, { IsDeleted: true }),
];

function makeVis(
  opts: {
    granted?: Record<number, number[]>;
    users?: Record<number, { AppRole: number; OrgUnitID: number }>;
    hidden?: number[];
  } = {},
) {
  const crud = makeCrudLog();
  const sp = fakeSp({
    'EMS.sp_GetOrgUnitHierarchy': orgs() as never,
    'EMS.sp_GetHiddenOrgUnitIds': (opts.hidden ?? []).map((id) => ({ OrgUnitId: id })),
  });
  const queries: { sql: string; params: unknown[] }[] = [];
  const ds = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/FROM security\.UserOrgVisibility WHERE UserID/.test(sql)) {
        return (opts.granted?.[params[0] as number] ?? []).map((id) => ({ OrgUnitID: id }));
      }
      if (/FROM EMS\.UserAccount WHERE UserID/.test(sql)) {
        const u = opts.users?.[params[0] as number];
        return u ? [u] : [];
      }
      if (/COUNT\(\*\) AS C FROM EMS\.OrgUnit/.test(sql)) {
        return [{ C: [1, 2, 3, 4].includes(params[0] as number) ? 1 : 0 }];
      }
      if (/FROM security\.UserOrgVisibility v/.test(sql)) return [];
      return [];
    }),
  };
  const svc = new UserOrgVisibilityService(crud.service, sp as never, ds as never);
  return { svc, sp, ds, queries, crud };
}

describe('UserOrgVisibilityService — อ่าน', () => {
  it('ไม่มี grant → ตามบทบาท: Admin เห็นทุกหน่วยงานที่ใช้งาน · Manager เห็นตัวเอง+ลูกหลาน · Officer เห็นหน่วยตัวเอง', async () => {
    const { svc } = makeVis();
    expect([...(await svc.visibleOrgUnitIds(admin())).ids].sort()).toEqual([1, 2, 3, 4]);
    const m = await svc.visibleOrgUnitIds(manager({ orgUnitId: 2 }));
    expect(m.mode).toBe('role');
    expect([...m.ids].sort()).toEqual([2, 4]);
    expect([...(await svc.visibleOrgUnitIds(officer({ orgUnitId: 3 }))).ids]).toEqual([3]);
  });

  it('มี grant → เห็นเฉพาะที่ grant (ชัดแจ้งชนะบทบาท) ไม่รวมหน่วยงานที่ถูกลบ', async () => {
    const u = officer({ orgUnitId: 3 });
    const { svc } = makeVis({ granted: { [u.userId]: [2, 9] } });
    const r = await svc.visibleOrgUnitIds(u);
    expect(r.mode).toBe('explicit');
    expect([...r.ids]).toEqual([2]);
  });

  it('visibleHierarchy: ใส่ธง isHidden จากรายการที่ซ่อน', async () => {
    const { svc } = makeVis({ hidden: [4] });
    const r = await svc.visibleHierarchy(manager({ orgUnitId: 2 }));
    expect(r.orgUnits.map((o) => [o.orgUnitId, o.isHidden])).toEqual([
      [2, false],
      [4, true],
    ]);
  });

  it('detailFor: ไม่พบผู้ใช้ → 404', async () => {
    const { svc } = makeVis();
    expect(await errorStatus(svc.detailFor(777))).toBe(404);
  });
});

describe('UserOrgVisibilityService — grant/revoke (Admin เท่านั้น)', () => {
  it('grant: Manager ลงไปไม่ได้ → 403 ADMIN_REQUIRED และไม่เขียน DB', async () => {
    const { svc, queries } = makeVis({ users: { 55: { AppRole: 1, OrgUnitID: 3 } } });
    expect(await errorCode(svc.grant(55, 2, manager()))).toBe('ADMIN_REQUIRED');
    expect(await errorStatus(svc.grant(55, 2, manager()))).toBe(403);
    expect(queries.some((q) => /UPDATE security\.UserOrgVisibility/.test(q.sql))).toBe(false);
  });

  it('grant: Admin → upsert พร้อม GrantedBy = ผู้เรียก (parameterized) + log GRANT_VISIBILITY', async () => {
    const { svc, queries, crud } = makeVis({ users: { 55: { AppRole: 1, OrgUnitID: 3 } } });
    const a = admin();
    await svc.grant(55, 2, a);
    const w = queries.find((q) => /UPDATE security\.UserOrgVisibility/.test(q.sql));
    expect(w?.params).toEqual([55, 2, a.userId]);
    expect(w?.sql).not.toContain('55');
    const ev = (await logEvents(crud)).find((e) => e.operation === 'GRANT_VISIBILITY');
    expect(ev).toMatchObject({
      module: 'DMS',
      entity: 'UserOrgVisibility',
      action: 'CREATE',
      success: true,
      recordId: 55,
    });
  });

  it('grant: ไม่พบผู้ใช้/หน่วยงาน → 404', async () => {
    const { svc } = makeVis({ users: { 55: { AppRole: 1, OrgUnitID: 3 } } });
    expect(await errorStatus(svc.grant(77, 2, admin()))).toBe(404);
    expect(await errorStatus(svc.grant(55, 9, admin()))).toBe(404);
  });

  it('revoke: Admin เท่านั้น', async () => {
    const { svc, queries } = makeVis();
    expect(await errorCode(svc.revoke(55, 2, srOfficer()))).toBe('ADMIN_REQUIRED');
    await svc.revoke(55, 2, admin());
    const w = queries.find((q) => /DELETE FROM security\.UserOrgVisibility/.test(q.sql));
    expect(w?.params).toEqual([55, 2]);
  });
});

describe('UserOrgVisibilityService.saveHiddenOrgUnitIds', () => {
  it('ของตัวเอง: สร้าง XML <ids><id>..</id></ids> จากตัวเลขที่ไม่ซ้ำและถูกต้องเท่านั้น', async () => {
    const { svc, sp } = makeVis();
    const u = officer();
    await svc.saveHiddenOrgUnitIds(u.userId, [3, 3, 2, -1, 0, 1.5, NaN], u);
    expect(sp.execs).toEqual([
      {
        name: 'EMS.sp_SaveHiddenOrgUnitIds',
        params: { UserId: u.userId, XmlIds: '<ids><id>3</id><id>2</id></ids>' },
      },
    ]);
  });

  it('รายการว่าง → ส่ง XmlIds = null (ล้างการซ่อนทั้งหมด)', async () => {
    const { svc, sp } = makeVis();
    const u = officer();
    await svc.saveHiddenOrgUnitIds(u.userId, [], u);
    expect(sp.execs[0].params.XmlIds).toBeNull();
  });

  it('ของคนอื่น: Admin ทำได้ · ผู้ใช้อื่นไม่ได้ → 403 HIDDEN_ORG_FORBIDDEN', async () => {
    const { svc, sp } = makeVis();
    expect(await errorCode(svc.saveHiddenOrgUnitIds(55, [2], manager()))).toBe(
      'HIDDEN_ORG_FORBIDDEN',
    );
    expect(sp.execs).toHaveLength(0);
    await svc.saveHiddenOrgUnitIds(55, [2], admin());
    expect(sp.execs).toHaveLength(1);
  });

  it('SP ล้ม → error ถูกส่งต่อและ log success=false', async () => {
    const { svc, sp, crud } = makeVis();
    sp.failExec = new Error('sp failed');
    const u = officer();
    await expect(svc.saveHiddenOrgUnitIds(u.userId, [2], u)).rejects.toThrow('sp failed');
    const ev = (await logEvents(crud)).find((e) => e.operation === 'SAVE_HIDDEN_ORG_UNITS');
    expect(ev?.success).toBe(false);
  });
});
