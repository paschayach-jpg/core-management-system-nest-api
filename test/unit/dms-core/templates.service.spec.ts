import { BusinessException } from '../../../src/common/exceptions/business.exception';
import { FoldersService } from '../../../src/modules/dms/core/folders/folders.service';
import type { FolderRow } from '../../../src/modules/dms/core/folders/folder.types';
import { FolderTemplatesService } from '../../../src/modules/dms/core/templates/folder-templates.service';
import { makeCrudLog } from '../../helpers/stubs';
import {
  errorCode,
  errorStatus,
  FakeFolderRepo,
  fakeAccess,
  fakeTx,
  folderRow,
  logEvents,
  manager,
  officer,
} from './helpers';

interface TItem {
  itemId: number;
  templateId: number;
  parentItemId: number | null;
  folderName: string;
  confidentialityLevel: number;
  sortOrder: number;
  inheritPermission: boolean;
}
interface TTemplate {
  templateId: number;
  templateCode: string;
  templateName: string;
  targetType: string;
  description: string | null;
  orgUnitId: number | null;
  orgUnitName: string | null;
  isActive: boolean;
  createdBy: number;
  createdDate: Date | null;
}

class FakeTemplateRepo {
  templates: TTemplate[] = [];
  items_: TItem[] = [];
  usedBy = 0;
  calls: string[] = [];
  private nextTemplate = 50;
  private nextItem = 500;

  list = async (includeInactive: boolean) =>
    this.templates.filter((t) => includeInactive || t.isActive);
  getById = async (id: number) => this.templates.find((t) => t.templateId === id) ?? null;
  items = async (templateId: number) => this.items_.filter((i) => i.templateId === templateId);
  getItem = async (id: number) => this.items_.find((i) => i.itemId === id) ?? null;
  codeExists = async (code: string, exclude?: number) =>
    this.templates.some((t) => t.templateCode === code && t.templateId !== exclude);
  foldersUsing = async () => this.usedBy;
  insert = async (d: Partial<TTemplate>) => {
    const id = this.nextTemplate++;
    this.templates.push({
      templateId: id,
      templateCode: d.templateCode as string,
      templateName: d.templateName as string,
      targetType: d.targetType as string,
      description: d.description ?? null,
      orgUnitId: d.orgUnitId ?? null,
      orgUnitName: null,
      isActive: true,
      createdBy: d.createdBy as number,
      createdDate: new Date(),
    });
    return id;
  };
  update = async (id: number, d: Partial<TTemplate>) => {
    this.calls.push('update');
    Object.assign(this.templates.find((t) => t.templateId === id) as TTemplate, d);
  };
  delete = async (id: number) => {
    this.calls.push('delete');
    this.templates = this.templates.filter((t) => t.templateId !== id);
    this.items_ = this.items_.filter((i) => i.templateId !== id);
  };
  insertItem = async (d: Omit<TItem, 'itemId'>) => {
    const id = this.nextItem++;
    this.items_.push({ itemId: id, ...d });
    return id;
  };
  updateItem = async (id: number, d: Partial<TItem>) => {
    Object.assign(this.items_.find((i) => i.itemId === id) as TItem, d);
  };
  deleteItemTree = async (id: number) => {
    this.calls.push('deleteItemTree');
    const gone = new Set<number>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of this.items_) {
        if (i.parentItemId !== null && gone.has(i.parentItemId) && !gone.has(i.itemId)) {
          gone.add(i.itemId);
          grew = true;
        }
      }
    }
    this.items_ = this.items_.filter((i) => !gone.has(i.itemId));
    return gone.size;
  };
}

const template = (over: Partial<TTemplate> = {}): TTemplate => ({
  templateId: 1,
  templateCode: 'STD',
  templateName: 'มาตรฐาน',
  targetType: 'Folder',
  description: null,
  orgUnitId: null,
  orgUnitName: null,
  isActive: true,
  createdBy: 1,
  createdDate: null,
  ...over,
});

const item = (over: Partial<TItem> & { itemId: number }): TItem => ({
  templateId: 1,
  parentItemId: null,
  folderName: `รายการ ${over.itemId}`,
  confidentialityLevel: 4,
  sortOrder: over.itemId,
  inheritPermission: true,
  ...over,
});

// โครงสร้าง: 1(2SC root org 1) → 2 ; 10(4PC root)
const folders = (): FolderRow[] => [
  folderRow({ folderId: 1, folderName: '2SC - A [2SC]', confidentialityLevel: 2, folderDepth: 1 }),
  folderRow({
    folderId: 2,
    folderName: 'งบประมาณ',
    parentFolderId: 1,
    confidentialityLevel: 2,
    folderDepth: 2,
  }),
  folderRow({ folderId: 10, folderName: '4PC - A [4PC]', confidentialityLevel: 4, folderDepth: 1 }),
];

function make(
  opts: { rows?: FolderRow[]; quota?: unknown; rule?: Parameters<typeof fakeAccess>[0] } = {},
) {
  const folderRepo = new FakeFolderRepo(opts.rows ?? folders());
  const repo = new FakeTemplateRepo();
  repo.templates.push(template());
  repo.items_.push(
    item({ itemId: 1, folderName: 'สัญญา' }),
    item({ itemId: 2, folderName: '2569', parentItemId: 1 }),
    item({ itemId: 3, folderName: 'รายงาน' }),
  );
  const crud = makeCrudLog();
  const tx = fakeTx();
  const access = fakeAccess(opts.rule);
  const foldersSvc = new FoldersService(
    crud.service,
    folderRepo as never,
    access,
    { visibleOrgUnitIds: async () => ({ mode: 'role', ids: new Set([1]) }) } as never,
    { insertFolderPermission: jest.fn() } as never,
    tx as never,
    undefined,
    undefined,
  );
  const svc = new FolderTemplatesService(
    crud.service,
    repo as never,
    folderRepo as never,
    foldersSvc,
    access,
    tx as never,
    opts.quota as never,
  );
  return { svc, repo, folderRepo, crud, tx };
}

describe('FolderTemplatesService — สิทธิ์และ CRUD แม่แบบ', () => {
  it('อ่านรายการได้ทุกคน แต่ includeInactive ใช้ได้เฉพาะ Manager+', async () => {
    const { svc, repo } = make();
    repo.templates.push(template({ templateId: 2, templateCode: 'OLD', isActive: false }));
    expect(await svc.list(officer(), true)).toHaveLength(1);
    expect(await svc.list(manager(), true)).toHaveLength(2);
    expect(await svc.list(manager())).toHaveLength(1);
  });

  it('get: คืนแม่แบบพร้อมรายการ · ไม่พบ → 404', async () => {
    const { svc } = make();
    expect((await svc.get(1)).items).toHaveLength(3);
    expect(await errorStatus(svc.get(99))).toBe(404);
  });

  it('จัดการแม่แบบต้องเป็น Manager+ → 403 ROLE_REQUIRED', async () => {
    const { svc, repo } = make();
    const dto = { templateCode: 'N', templateName: 'ใหม่', targetType: 'Folder' };
    expect(await errorCode(svc.create(officer(), dto as never))).toBe('ROLE_REQUIRED');
    expect(await errorCode(svc.update(officer(), 1, { templateName: 'x' }))).toBe('ROLE_REQUIRED');
    expect(await errorCode(svc.remove(officer(), 1))).toBe('ROLE_REQUIRED');
    expect(await errorCode(svc.createItem(officer(), 1, { folderName: 'x' }))).toBe(
      'ROLE_REQUIRED',
    );
    expect(await errorCode(svc.updateItem(officer(), 1, 1, { folderName: 'x' }))).toBe(
      'ROLE_REQUIRED',
    );
    expect(await errorCode(svc.removeItem(officer(), 1, 1))).toBe('ROLE_REQUIRED');
    expect(repo.templates).toHaveLength(1);
  });

  it('create: รหัสซ้ำ → 409 TEMPLATE_CODE_DUPLICATE · สำเร็จแล้วบันทึก CRUD-log', async () => {
    const { svc, crud } = make();
    const dto = { templateCode: 'STD', templateName: 'ซ้ำ', targetType: 'Folder' };
    expect(await errorCode(svc.create(manager(), dto as never))).toBe('TEMPLATE_CODE_DUPLICATE');
    const created = await svc.create(manager(), { ...dto, templateCode: 'NEW' } as never);
    expect(created.templateCode).toBe('NEW');
    const ev = (await logEvents(crud)).filter((e) => e.operation === 'CREATE_FOLDER_TEMPLATE');
    expect(ev.map((e) => e.success)).toEqual([false, true]);
    expect(ev[1]).toMatchObject({ module: 'DMS', entity: 'FolderTemplate', action: 'CREATE' });
  });

  it('update: เปลี่ยนรหัสไปชนของอื่น → 409 · ไม่ส่งฟิลด์ใด = คงค่าเดิม', async () => {
    const { svc, repo } = make();
    repo.templates.push(template({ templateId: 2, templateCode: 'B' }));
    expect(await errorCode(svc.update(manager(), 1, { templateCode: 'B' }))).toBe(
      'TEMPLATE_CODE_DUPLICATE',
    );
    const r = await svc.update(manager(), 1, { isActive: false });
    expect(r).toMatchObject({ templateCode: 'STD', templateName: 'มาตรฐาน', isActive: false });
  });

  it('remove: ยังมีโฟลเดอร์อ้างอิง → 409 TEMPLATE_IN_USE · ไม่มี → ลบพร้อมรายการ', async () => {
    const { svc, repo } = make();
    repo.usedBy = 2;
    expect(await errorCode(svc.remove(manager(), 1))).toBe('TEMPLATE_IN_USE');
    expect(repo.calls).not.toContain('delete');
    repo.usedBy = 0;
    await svc.remove(manager(), 1);
    expect(repo.templates).toHaveLength(0);
  });
});

describe('FolderTemplatesService — รายการในแม่แบบ', () => {
  it('createItem: ใช้ค่าเริ่มต้น (ชั้น 4, InheritPermission=true) และตัดช่องว่างชื่อ', async () => {
    const { svc } = make();
    const r = await svc.createItem(manager(), 1, { folderName: '  เอกสาร  ' });
    expect(r).toMatchObject({
      folderName: 'เอกสาร',
      parentItemId: null,
      confidentialityLevel: 4,
      inheritPermission: true,
    });
  });

  it('createItem: ชื่อต้องห้าม → 422 · ชื่อซ้ำระดับเดียวกัน → 409 · ซ้ำคนละระดับได้', async () => {
    const { svc } = make();
    expect(await errorCode(svc.createItem(manager(), 1, { folderName: 'a/b' }))).toBe(
      'FOLDER_NAME_INVALID',
    );
    expect(await errorCode(svc.createItem(manager(), 1, { folderName: ' สัญญา ' }))).toBe(
      'TEMPLATE_ITEM_DUPLICATE',
    );
    await expect(
      svc.createItem(manager(), 1, { folderName: 'สัญญา', parentItemId: 3 }),
    ).resolves.toBeDefined();
  });

  it('createItem: แม่ไม่อยู่ในแม่แบบนี้ → 422 TEMPLATE_PARENT_NOT_FOUND · แม่แบบไม่มี → 404', async () => {
    const { svc, repo } = make();
    repo.templates.push(template({ templateId: 2, templateCode: 'B' }));
    repo.items_.push(item({ itemId: 90, templateId: 2, folderName: 'ของแม่แบบอื่น' }));
    expect(
      await errorCode(svc.createItem(manager(), 1, { folderName: 'x', parentItemId: 90 })),
    ).toBe('TEMPLATE_PARENT_NOT_FOUND');
    expect(await errorStatus(svc.createItem(manager(), 99, { folderName: 'x' }))).toBe(404);
  });

  it('updateItem: ชื่อชนพี่น้องเดิม → 409 · item ของแม่แบบอื่น → 404', async () => {
    const { svc, repo } = make();
    expect(await errorCode(svc.updateItem(manager(), 1, 3, { folderName: 'สัญญา' }))).toBe(
      'TEMPLATE_ITEM_DUPLICATE',
    );
    repo.items_.push(item({ itemId: 90, templateId: 2 }));
    expect(await errorStatus(svc.updateItem(manager(), 1, 90, { folderName: 'x' }))).toBe(404);
    const r = await svc.updateItem(manager(), 1, 3, { sortOrder: 9 });
    expect(r).toMatchObject({ folderName: 'รายงาน', sortOrder: 9 });
  });

  it('removeItem: ลบพร้อมลูกหลานทุกชั้น', async () => {
    const { svc, repo } = make();
    await svc.removeItem(manager(), 1, 1);
    expect(repo.items_.map((i) => i.itemId)).toEqual([3]);
  });
});

describe('FolderTemplatesService.applyToFolder — สร้างโฟลเดอร์จากแม่แบบ', () => {
  it('สร้างตามแม่แบบทั้งต้นไม้ใน transaction เดียว: ความลึก/ชั้นความลับ/แม่ ถูกต้อง', async () => {
    const { svc, folderRepo, tx } = make();
    const r = await svc.applyToFolder(manager(), 2, 1);
    expect(r.createdCount).toBe(3);
    expect(r.folders.map((f) => f.folderName).sort()).toEqual(['รายงาน', 'สัญญา']);
    expect(tx.calls.runs).toBe(1);
    const inserts = folderRepo.called('insert').map((c) => c.args[0] as Record<string, unknown>);
    expect(inserts).toHaveLength(3);
    const contract = inserts.find((i) => i.folderName === 'สัญญา') as Record<string, unknown>;
    const year = inserts.find((i) => i.folderName === '2569') as Record<string, unknown>;
    expect(contract).toMatchObject({
      parentFolderId: 2,
      folderDepth: 3,
      confidentialityLevel: 2,
      orgUnitId: 1,
    });
    expect(year).toMatchObject({ folderDepth: 4, confidentialityLevel: 2 });
    expect(year.parentFolderId).not.toBe(2); // ลูกของ 'สัญญา' ที่เพิ่งสร้าง
    expect(year.parentFolderId).toBe(
      folderRepo.rows.find((x) => x.folderName === 'สัญญา')?.folderId,
    );
  });

  it('บันทึก CRUD-log APPLY_TEMPLATE (entity Folder)', async () => {
    const { svc, crud } = make();
    await svc.applyToFolder(manager(), 2, 1);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'APPLY_TEMPLATE');
    expect(ev).toMatchObject({
      module: 'DMS',
      entity: 'Folder',
      action: 'CREATE',
      success: true,
      recordId: 2,
    });
  });

  it('ต้องเป็น Manager+ · ต้องมีสิทธิ์เพิ่มในปลายทาง', async () => {
    const a = make();
    expect(await errorCode(a.svc.applyToFolder(officer(), 2, 1))).toBe('ROLE_REQUIRED');
    const b = make({ rule: () => false });
    expect(await errorCode(b.svc.applyToFolder(manager(), 2, 1))).toBe('FOLDER_ADD_DENIED');
    expect(b.folderRepo.called('insert')).toHaveLength(0);
  });

  it('ปลายทางไม่ได้อยู่ใต้ Root หลัก → 422 FOLDER_NOT_UNDER_MAIN_ROOT', async () => {
    const rows = folders();
    rows.push(folderRow({ folderId: 50, folderName: 'ลอย', confidentialityLevel: 4 }));
    const { svc } = make({ rows });
    expect(await errorCode(svc.applyToFolder(manager(), 50, 1))).toBe('FOLDER_NOT_UNDER_MAIN_ROOT');
  });

  it('ชื่อชั้นบนสุดซ้ำกับโฟลเดอร์ที่มีอยู่ → 409 FOLDER_NAME_DUPLICATE และไม่สร้างอะไร', async () => {
    const rows = folders();
    rows.push(
      folderRow({
        folderId: 20,
        folderName: 'สัญญา',
        parentFolderId: 2,
        confidentialityLevel: 2,
        folderDepth: 3,
      }),
    );
    const { svc, folderRepo } = make({ rows });
    expect(await errorCode(svc.applyToFolder(manager(), 2, 1))).toBe('FOLDER_NAME_DUPLICATE');
    expect(folderRepo.called('insert')).toHaveLength(0);
  });

  it('แม่แบบปิดใช้งาน / ว่าง / ไม่พบ', async () => {
    const a = make();
    a.repo.templates[0].isActive = false;
    expect(await errorCode(a.svc.applyToFolder(manager(), 2, 1))).toBe('TEMPLATE_INACTIVE');
    const b = make();
    b.repo.items_ = [];
    expect(await errorCode(b.svc.applyToFolder(manager(), 2, 1))).toBe('TEMPLATE_EMPTY');
    const c = make();
    expect(await errorStatus(c.svc.applyToFolder(manager(), 2, 99))).toBe(404);
  });

  it('แม่แบบลึกเกิน 10 ชั้นเมื่อวางใต้ปลายทาง → 422 FOLDER_DEPTH_EXCEEDED (ไม่ข้ามเงียบๆ เหมือนระบบเดิม)', async () => {
    const rows = folders();
    rows.push(
      folderRow({
        folderId: 30,
        folderName: 'ลึก',
        parentFolderId: 2,
        confidentialityLevel: 2,
        folderDepth: 9,
      }),
    );
    const { svc, folderRepo } = make({ rows });
    // สัญญา = 10 ผ่าน · 2569 = 11 เกิน
    expect(await errorCode(svc.applyToFolder(manager(), 30, 1))).toBe('FOLDER_DEPTH_EXCEEDED');
    expect(folderRepo.called('insert')).toHaveLength(0);
  });

  it('ชื่อซ้ำกันเองในแม่แบบ → 422 TEMPLATE_DUPLICATE_NAMES · ชั้นความลับที่ระบุไม่ตรงปลายทาง → 422 TEMPLATE_LEVEL_MISMATCH', async () => {
    const a = make();
    a.repo.items_.push(item({ itemId: 4, folderName: 'สัญญา' }));
    expect(await errorCode(a.svc.applyToFolder(manager(), 2, 1))).toBe('TEMPLATE_DUPLICATE_NAMES');
    const b = make();
    b.repo.items_[2] = item({
      itemId: 3,
      folderName: 'รายงาน',
      inheritPermission: false,
      confidentialityLevel: 3,
    });
    expect(await errorCode(b.svc.applyToFolder(manager(), 2, 1))).toBe('TEMPLATE_LEVEL_MISMATCH');
  });

  it('โควตาเต็มผ่าน DMS_QUOTA_PORT → ไม่สร้างอะไร · enforceQuota รับ OrgUnit ของปลายทาง', async () => {
    const quota = {
      enforceQuota: jest.fn(async () => {
        throw new BusinessException('พื้นที่เต็ม', 'QUOTA_FULL');
      }),
      validateBatch: jest.fn(),
      sendAlertIfNeeded: jest.fn(),
    };
    const { svc, folderRepo } = make({ quota });
    expect(await errorCode(svc.applyToFolder(manager(), 2, 1))).toBe('QUOTA_FULL');
    expect(quota.enforceQuota).toHaveBeenCalledWith(1);
    expect(folderRepo.called('insert')).toHaveLength(0);
  });

  it('insert ล้มกลางทาง → error ถูกส่งต่อ (ให้ transaction ย้อนทั้งชุด)', async () => {
    const { svc, folderRepo } = make();
    let n = 0;
    const orig = folderRepo.insert;
    folderRepo.insert = async (f) => {
      if (++n === 2) throw new Error('deadlock');
      return orig(f);
    };
    await expect(svc.applyToFolder(manager(), 2, 1)).rejects.toThrow('deadlock');
  });
});

describe('FolderTemplatesService.applyToOrgUnit — Root ใหม่ของหน่วยงาน', () => {
  const dto = (over: Record<string, unknown> = {}) =>
    ({ orgUnitId: 1, rootFolderName: '3NC - A [3NC]', confidentialityLevel: 3, ...over }) as never;

  it('สร้าง Root 3NC + โครงสร้างจากแม่แบบ (Root ไม่สืบทอดสิทธิ์)', async () => {
    const { svc, folderRepo } = make();
    const r = await svc.applyToOrgUnit(manager(), 1, dto());
    expect(r.createdCount).toBe(4);
    expect(r.folders).toHaveLength(1);
    expect(r.folders[0]).toMatchObject({
      folderName: '3NC - A [3NC]',
      confidentialityLevel: 3,
      folderDepth: 1,
      parentFolderId: null,
    });
    const inserts = folderRepo.called('insert').map((c) => c.args[0] as Record<string, unknown>);
    expect(inserts[0]).toMatchObject({ inheritPermission: false, parentFolderId: null });
    expect(inserts.slice(1).every((i) => i.confidentialityLevel === 3)).toBe(true);
  });

  it('1HC สร้างตรงจากแม่แบบไม่ได้ → 422 HC_ROOT_REQUIRES_APPROVAL · ชั้นนอก 1–4 → ไม่อนุญาต', async () => {
    const { svc } = make();
    expect(
      await errorCode(
        svc.applyToOrgUnit(
          manager(),
          1,
          dto({ confidentialityLevel: 1, rootFolderName: '1HC - A' }),
        ),
      ),
    ).toBe('HC_ROOT_REQUIRES_APPROVAL');
    expect(
      await errorCode(svc.applyToOrgUnit(manager(), 1, dto({ confidentialityLevel: 7 }))),
    ).toBe('HC_ROOT_REQUIRES_APPROVAL');
  });

  it('ชื่อ Root ไม่ขึ้นต้นตามรหัสชั้น → ROOT_FOLDER_NAME_INVALID · มี Root ชั้นเดียวกันแล้ว → 409 ROOT_FOLDER_EXISTS', async () => {
    const { svc } = make();
    expect(
      await errorCode(svc.applyToOrgUnit(manager(), 1, dto({ rootFolderName: 'ทั่วไป' }))),
    ).toBe('ROOT_FOLDER_NAME_INVALID');
    expect(
      await errorCode(
        svc.applyToOrgUnit(
          manager(),
          1,
          dto({ confidentialityLevel: 2, rootFolderName: '2SC - B [2SC]' }),
        ),
      ),
    ).toBe('ROOT_FOLDER_EXISTS');
  });

  it('หน่วยงานไม่พร้อมใช้ → 404 · แม่แบบว่าง → TEMPLATE_EMPTY · Manager+ เท่านั้น', async () => {
    const a = make();
    a.folderRepo.orgUsable = false;
    expect(await errorStatus(a.svc.applyToOrgUnit(manager(), 1, dto()))).toBe(404);
    const b = make();
    b.repo.items_ = [];
    expect(await errorCode(b.svc.applyToOrgUnit(manager(), 1, dto()))).toBe('TEMPLATE_EMPTY');
    const c = make();
    expect(await errorCode(c.svc.applyToOrgUnit(officer(), 1, dto()))).toBe('ROLE_REQUIRED');
  });

  it('โควตาเต็ม → ไม่สร้าง Root', async () => {
    const quota = {
      enforceQuota: jest.fn(async () => {
        throw new BusinessException('พื้นที่เต็ม', 'QUOTA_FULL');
      }),
      validateBatch: jest.fn(),
      sendAlertIfNeeded: jest.fn(),
    };
    const { svc, folderRepo } = make({ quota });
    expect(await errorCode(svc.applyToOrgUnit(manager(), 1, dto()))).toBe('QUOTA_FULL');
    expect(quota.enforceQuota).toHaveBeenCalledWith(1);
    expect(folderRepo.called('insert')).toHaveLength(0);
  });
});
