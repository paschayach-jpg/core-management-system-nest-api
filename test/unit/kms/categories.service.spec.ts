import { CategoriesService } from '../../../src/modules/kms/categories/categories.service';
import {
  assertUniqueCode,
  assertValidParent,
  normalizeImportTypeDigit,
} from '../../../src/modules/kms/categories/category-rules';
import type { KbCategory } from '../../../src/modules/kms/entities/kb-category.entity';
import { sampleCategories } from './kms-fixtures';
import { FakeTx, MANAGER, ScriptedDb, crudLogHarness } from './sql-script';

const entity = (r: ReturnType<typeof sampleCategories>[number]): KbCategory =>
  ({ ...r, createdBy: 'seed', icon: null, description: null }) as unknown as KbCategory;

function make(opts: { identity?: boolean } = {}) {
  const db = new ScriptedDb();
  const tx = new FakeTx(db);
  const store = sampleCategories().map(entity);
  const repo = { find: jest.fn(async () => store) };
  const log = crudLogHarness();
  db.when(/COLUMNPROPERTY/, [{ IsIdentity: opts.identity ? 1 : 0 }]);
  // INSERT สำเร็จ = แถวใหม่โผล่ในตาราง (params: parent, code, name, icon, desc, sort, createdBy, digit)
  const created = (id: number, p: unknown[]) => {
    store.push(
      entity({
        ...sampleCategories()[0],
        categoryId: id,
        parentCategoryId: p[0] as number | null,
        categoryCode: p[1] as string,
        categoryName: p[2] as string,
      }),
    );
    return [{ CategoryID: id }];
  };
  db.when(/SCOPE_IDENTITY\(\)\) AS CategoryID/, (_s, p) => created(77, p));
  db.when(/SELECT @NewID AS CategoryID/, (_s, p) => created(95, p));
  const svc = new CategoriesService(log.service, repo as never, db as never, tx as never);
  return { svc, db, tx, store, repo, log };
}

describe('category-rules', () => {
  const all = sampleCategories();

  it('assertValidParent: ห้ามเป็นตัวเอง / หมวดแม่ไม่มี / วนลูปเป็นลูกของตัวเอง', () => {
    expect(() =>
      assertValidParent({ categoryId: 3, parentCategoryId: 3, categoryCode: 'PLI00' }, all),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CATEGORY_PARENT_SELF' }),
      }),
    );
    expect(() =>
      assertValidParent({ categoryId: 0, parentCategoryId: 999, categoryCode: 'X' }, all),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CATEGORY_PARENT_NOT_FOUND' }),
      }),
    );
    // PLI00(3) มีลูก PLI002535(4) → ตั้ง 4 เป็นแม่ของ 3 = วนลูป
    expect(() =>
      assertValidParent({ categoryId: 3, parentCategoryId: 4, categoryCode: 'PLI00' }, all),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CATEGORY_PARENT_CYCLE' }),
      }),
    );
    expect(() =>
      assertValidParent({ categoryId: 0, parentCategoryId: 1, categoryCode: 'NEW' }, all),
    ).not.toThrow();
    expect(() =>
      assertValidParent({ categoryId: 0, parentCategoryId: null, categoryCode: 'NEW' }, all),
    ).not.toThrow();
  });

  it('assertUniqueCode: ซ้ำโดยไม่สนตัวพิมพ์ ยกเว้นตัวเอง', () => {
    expect(() =>
      assertUniqueCode({ categoryId: 0, parentCategoryId: null, categoryCode: 'pli00 ' }, all),
    ).toThrow(/ถูกใช้แล้ว/);
    expect(() =>
      assertUniqueCode({ categoryId: 3, parentCategoryId: 1, categoryCode: 'PLI00' }, all),
    ).not.toThrow();
  });

  describe('normalizeImportTypeDigit', () => {
    const top = { categoryId: 0, parentCategoryId: null, categoryCode: 'NEW00' };
    it('ว่าง = null · 1-9 ตัวเดียวเท่านั้น', () => {
      expect(normalizeImportTypeDigit(undefined, top, all)).toBeNull();
      expect(normalizeImportTypeDigit('  ', top, all)).toBeNull();
      expect(normalizeImportTypeDigit(' 5 ', top, all)).toBe('5');
      for (const bad of ['0', '10', 'a', '١'])
        expect(() => normalizeImportTypeDigit(bad, top, all)).toThrow(
          expect.objectContaining({
            response: expect.objectContaining({ code: 'IMPORT_TYPE_DIGIT_INVALID' }),
          }),
        );
    });
    it('ซ้ำกับหมวดอื่น = 409 แต่หมวดเดิมของตัวเองใช้ค่าเดิมได้', () => {
      expect(() => normalizeImportTypeDigit('2', top, all)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'IMPORT_TYPE_DIGIT_IN_USE' }),
        }),
      );
      const self = { categoryId: 10, parentCategoryId: null, categoryCode: 'OR00' };
      expect(normalizeImportTypeDigit('2', self, all)).toBe('2');
    });
    it('ห้ามตั้งที่ LW หรือหมวดใต้ LW (รวมหมวดที่กำลังจะย้ายเข้าไปใต้ LW)', () => {
      const lw = { categoryId: 1, parentCategoryId: null, categoryCode: 'LW' };
      const under = { categoryId: 0, parentCategoryId: 3, categoryCode: 'NEW' };
      const moving = { categoryId: 12, parentCategoryId: 1, categoryCode: 'AN00' };
      for (const c of [lw, under, moving])
        expect(() => normalizeImportTypeDigit('7', c, all)).toThrow(
          expect.objectContaining({
            response: expect.objectContaining({ code: 'IMPORT_TYPE_DIGIT_NOT_ALLOWED' }),
          }),
        );
    });
  });
});

describe('CategoriesService', () => {
  it('create (CategoryID เป็น IDENTITY): INSERT ไม่ระบุ CategoryID ใน Serializable transaction', async () => {
    const { svc, db, tx } = make({ identity: true });
    const r = await svc.create(
      { categoryCode: ' NEW00 ', categoryName: ' ใหม่ ' } as never,
      MANAGER,
    );
    expect(r.categoryId).toBe(77);
    expect(tx.isolations).toEqual(['SERIALIZABLE']);
    const ins = db.find(/INSERT INTO KMS\.m_KBCategory/)[0];
    expect(ins.sql).not.toMatch(/MAX\(CategoryID\)/);
    expect(ins.params).toEqual([null, 'NEW00', 'ใหม่', null, null, 0, MANAGER.adUserName, null]);
  });

  it('create (ไม่ใช่ IDENTITY): ใช้ MAX(CategoryID)+1 พร้อม UPDLOCK/HOLDLOCK ใน transaction เดียว', async () => {
    const { svc, db, tx } = make({ identity: false });
    const r = await svc.create({ categoryCode: 'NEW00', categoryName: 'ใหม่' } as never, MANAGER);
    expect(r.categoryId).toBe(95);
    const ins = db.find(/DECLARE @NewID/)[0];
    expect(ins.sql).toMatch(/MAX\(CategoryID\), 0\) \+ 1[\s\S]*UPDLOCK, HOLDLOCK/);
    expect(tx.runs).toBe(1);
    expect(tx.isolations).toEqual(['SERIALIZABLE']);
  });

  it('create: รหัสซ้ำ → 409 และไม่เปิด transaction', async () => {
    const { svc, tx } = make();
    await expect(
      svc.create({ categoryCode: 'PVI00', categoryName: 'x' } as never, MANAGER),
    ).rejects.toMatchObject({ response: { code: 'CATEGORY_CODE_DUPLICATE' } });
    expect(tx.runs).toBe(0);
  });

  it('create: ชนกับผู้เพิ่มพร้อมกัน (unique violation) → 409 ภาษาไทย', async () => {
    const { svc, db } = make({ identity: true });
    db.failWhen(/INSERT INTO KMS\.m_KBCategory/, { number: 2627 });
    await expect(
      svc.create({ categoryCode: 'ZZ00', categoryName: 'x' } as never, MANAGER),
    ).rejects.toMatchObject({ response: { code: 'CATEGORY_CODE_DUPLICATE' } });
  });

  it('update: ไม่แตะ DisplayProfileID และ IsActive ในคำสั่ง UPDATE · ใช้ค่าเดิมของฟิลด์ที่ไม่ส่งมา', async () => {
    const { svc, db } = make();
    await svc.update(2, { categoryName: 'ชื่อใหม่' } as never, MANAGER);
    const upd = db.find(/UPDATE KMS\.m_KBCategory SET/)[0];
    expect(upd.sql).not.toMatch(/DisplayProfileID|IsActive/);
    // [parent, code, name, icon, description, sortOrder, digit, id]
    expect(upd.params).toEqual([1, 'PVI00', 'ชื่อใหม่', null, null, 0, null, 2]);
  });

  it('update: ย้ายหมวดไปเป็นลูกของลูกตัวเอง → 422 และไม่ UPDATE', async () => {
    const { svc, db } = make();
    await expect(svc.update(3, { parentCategoryId: 4 } as never, MANAGER)).rejects.toMatchObject({
      response: { code: 'CATEGORY_PARENT_CYCLE' },
    });
    expect(db.count(/UPDATE KMS\.m_KBCategory/)).toBe(0);
  });

  it('update: หมวดไม่มี = 404', async () => {
    const { svc } = make();
    await expect(svc.update(999, {} as never, MANAGER)).rejects.toMatchObject({ status: 404 });
  });

  it('deactivate: ตั้ง IsActive=0 ไม่ลบแถว · ทำซ้ำได้', async () => {
    const { svc, db } = make();
    await svc.deactivate(2);
    await svc.deactivate(2);
    expect(db.count(/UPDATE KMS\.m_KBCategory SET IsActive = 0/)).toBe(2);
    expect(db.count(/DELETE FROM KMS\.m_KBCategory/)).toBe(0);
  });

  it('list: เรียงตามต้นไม้พร้อม depth/path · activeOnly ตัดหมวดที่ปิด', async () => {
    const { svc, store } = make();
    store.find((e) => e.categoryId === 5)!.isActive = false;
    const all = await svc.list();
    const ids = all.map((c) => c.categoryId);
    expect(ids).toHaveLength(10);
    // ลูกอยู่ต่อท้ายแม่ทันที: LW(1) ก่อน PLI00(3) ก่อน PLI002535(4)
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(3));
    expect(ids.indexOf(4)).toBe(ids.indexOf(3) + 1);
    const pli = all.find((c) => c.categoryId === 4)!;
    expect(pli.depth).toBe(2);
    expect(pli.path).toBe('หมวด LW › หมวด PLI00 › หมวด PLI002535');
    const active = await svc.list({ activeOnly: true });
    expect(active.some((c) => c.categoryId === 5)).toBe(false);
    const roots = await svc.list({ rootsOnly: true });
    expect(roots.every((c) => c.parentCategoryId === null)).toBe(true);
  });

  it('summary: รวมจำนวนบทความของหมวดย่อยเข้าหมวดแม่', async () => {
    const { svc, db } = make();
    db.when(/GROUP BY CategoryID/, [
      { CategoryID: 4, Cnt: 10 },
      { CategoryID: 5, Cnt: 5 },
      { CategoryID: 3, Cnt: 1 },
    ]);
    const s = await svc.summary();
    const pli = s.find((x) => x.categoryId === 3)!;
    expect(pli).toEqual({ categoryId: 3, ownCount: 1, totalCount: 16 });
    expect(s.find((x) => x.categoryId === 1)!.totalCount).toBe(16);
  });

  it('CRUD-log: create/update/deactivate บันทึก operation ตามระบบเดิม', async () => {
    const { svc, log } = make({ identity: true });
    await svc.create({ categoryCode: 'NEW00', categoryName: 'ใหม่' } as never, MANAGER);
    await svc.update(2, { categoryName: 'แก้' } as never, MANAGER);
    await svc.deactivate(2);
    await expect(
      svc.create({ categoryCode: 'PVI00', categoryName: 'ซ้ำ' } as never, MANAGER),
    ).rejects.toBeDefined();
    const ev = await log.events();
    expect(ev.map((e) => [e.module, e.entity, e.operation, e.success])).toEqual([
      ['KMS', 'KbCategory', 'CREATE_KB_CATEGORY', true],
      ['KMS', 'KbCategory', 'UPDATE_KB_CATEGORY', true],
      ['KMS', 'KbCategory', 'DEACTIVATE_KB_CATEGORY', true],
      ['KMS', 'KbCategory', 'CREATE_KB_CATEGORY', false],
    ]);
    expect(ev[1]).toMatchObject({
      recordId: 2,
      before: expect.objectContaining({ categoryId: 2 }),
    });
    expect(ev[3].errorCode).toBe('HTTP_409');
  });
});
