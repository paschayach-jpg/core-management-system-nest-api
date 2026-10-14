import { DisplayProfilesService } from '../../../src/modules/kms/display-profiles/display-profiles.service';
import {
  SLOT_KEYS,
  defaultSettings,
  mergeSettings,
  resolveEffectiveProfileId,
} from '../../../src/modules/kms/display-profiles/effective-display';
import { DISPLAY_SLOTS } from '../../../src/modules/kms/import-templates/kb-column-catalog';
import { cat, sampleCategories } from './kms-fixtures';
import { FakeTx, MANAGER, ScriptedDb, crudLogHarness } from './sql-script';

describe('effective-display', () => {
  const profiles = new Map([
    [5, { isActive: true }],
    [6, { isActive: false }],
  ]);

  it('สืบ profile จากหมวดแม่ใกล้สุดที่ตั้งไว้', () => {
    const cats = [
      cat(1, 'LW', null, { displayProfileId: 5 }),
      cat(2, 'A00', 1),
      cat(3, 'A002535', 2),
    ];
    expect(resolveEffectiveProfileId(cats, profiles, 3)).toBe(5);
    const own = [
      cat(1, 'LW', null, { displayProfileId: 5 }),
      cat(2, 'A00', 1, { displayProfileId: 5 }),
    ];
    expect(resolveEffectiveProfileId(own, profiles, 2)).toBe(5);
  });

  it('profile ที่ปิดใช้งาน (หรือไม่มี) ถือว่าไม่ได้ตั้งที่ระดับนั้น → เดินขึ้นต่อ', () => {
    const cats = [
      cat(1, 'LW', null, { displayProfileId: 5 }),
      cat(2, 'A00', 1, { displayProfileId: 6 }),
    ];
    expect(resolveEffectiveProfileId(cats, profiles, 2)).toBe(5);
    const dangling = [cat(1, 'LW', null, { displayProfileId: 99 })];
    expect(resolveEffectiveProfileId(dangling, profiles, 1)).toBeNull();
  });

  it('ต้นไม้วนลูป/หมวดไม่มี ไม่ทำให้ค้าง', () => {
    const loop = [cat(1, 'A', 2), cat(2, 'B', 1)];
    expect(resolveEffectiveProfileId(loop, profiles, 1)).toBeNull();
    expect(resolveEffectiveProfileId(loop, profiles, 99)).toBeNull();
  });

  it('mergeSettings: ซ้อนบนค่าเริ่มต้น ไม่สนตัวพิมพ์ของ slotKey และเมิน slot ที่ไม่รู้จัก', () => {
    const merged = mergeSettings([
      { slotKey: 'title', displayLabel: 'หัวเรื่อง', isVisible: false },
      { slotKey: 'Unknown', displayLabel: 'x', isVisible: true },
    ]);
    expect(merged.Title).toEqual({ label: 'หัวเรื่อง', visible: false });
    expect(Object.keys(merged)).toEqual(Object.keys(defaultSettings()));
    expect(Object.keys(merged).sort()).toEqual([...SLOT_KEYS].sort());
  });
});

function make() {
  const db = new ScriptedDb();
  const tx = new FakeTx(db);
  const log = crudLogHarness();
  const cats = sampleCategories();
  const categories = { allRows: async () => cats };
  const profile = {
    ProfileID: 5,
    ProfileName: 'มาตรฐาน',
    Description: null,
    IsActive: 1,
    CreatedBy: 'x',
    CreatedDate: null,
  };
  db.when(/FROM KMS\.m_KBArticleDisplayProfile WHERE ProfileID = @0/, [profile]);
  db.when(/SELECT SlotKey, SlotDescription, DisplayLabel, IsVisible/, [
    { SlotKey: 'title', SlotDescription: null, DisplayLabel: 'ชื่อเรื่อง', IsVisible: 0 },
  ]);
  db.when(/SCOPE_IDENTITY\(\)\) AS ProfileID/, [{ ProfileID: 5 }]);
  const svc = new DisplayProfilesService(
    log.service,
    db as never,
    tx as never,
    categories as never,
  );
  return { svc, db, tx, log, profile };
}

describe('DisplayProfilesService', () => {
  it('get: grid ครบทุก slot — ที่ไม่เคยบันทึกใช้ค่าเริ่มต้น · ที่บันทึกไว้ (ไม่สนตัวพิมพ์) ใช้ค่าที่บันทึก', async () => {
    const { svc } = make();
    const d = await svc.get(5);
    expect(d.columns.map((c) => c.slotKey)).toEqual(SLOT_KEYS);
    expect(d.columns.find((c) => c.slotKey === 'Title')).toMatchObject({
      displayLabel: 'ชื่อเรื่อง',
      isVisible: false,
    });
    const others = d.columns.filter((c) => c.slotKey !== 'Title');
    // slot ที่ไม่เคยบันทึก = ค่าเริ่มต้นของ catalog (หัวคอลัมน์ TitleCategory ของระบบเดิมว่างโดยตั้งใจ)
    for (const c of others) {
      const def = DISPLAY_SLOTS.find((x) => x.slotKey === c.slotKey)!;
      expect([c.displayLabel, c.isVisible]).toEqual([def.defaultLabel, def.defaultVisible]);
    }
  });

  it('get: ไม่พบ = 404', async () => {
    const db = new ScriptedDb();
    const svc = new DisplayProfilesService(
      crudLogHarness().service,
      db as never,
      new FakeTx(db) as never,
      {} as never,
    );
    await expect(svc.get(1)).rejects.toMatchObject({ status: 404 });
  });

  it('create: ชื่อซ้ำ = 409 · slot ซ้ำ (ไม่สนตัวพิมพ์) = 422 · สำเร็จแล้วเขียน profile + แถว slot ใน transaction เดียว', async () => {
    const { svc, db, tx } = make();
    db.whenOnce(/SELECT TOP 1 1 AS X FROM KMS\.m_KBArticleDisplayProfile/, [{ X: 1 }]);
    await expect(
      svc.create({ profileName: 'มาตรฐาน', columns: [] } as never, MANAGER),
    ).rejects.toMatchObject({
      response: { code: 'PROFILE_NAME_DUPLICATE' },
    });
    await expect(
      svc.create(
        {
          profileName: 'ใหม่',
          columns: [
            { slotKey: 'Title', displayLabel: 'a', isVisible: true },
            { slotKey: 'title', displayLabel: 'b', isVisible: true },
          ],
        } as never,
        MANAGER,
      ),
    ).rejects.toMatchObject({ response: { code: 'PROFILE_SLOT_DUPLICATE' } });

    await svc.create(
      {
        profileName: 'ใหม่',
        columns: [
          { slotKey: 'title', displayLabel: 'หัว', isVisible: false, slotDescription: ' d ' },
        ],
      } as never,
      MANAGER,
    );
    expect(tx.runs).toBe(1);
    const col = db.find(/INSERT INTO KMS\.m_KBArticleDisplayProfileColumn/)[0];
    expect(col.params).toEqual([5, 'Title', 'd', 'หัว', 0]); // slotKey ถูกแปลงเป็นรูปแบบมาตรฐาน
  });

  it('update: ลบ-ใส่ slot ทั้งชุดใน transaction เดียว', async () => {
    const { svc, db } = make();
    await svc.update(
      5,
      {
        profileName: 'มาตรฐาน2',
        columns: [{ slotKey: 'Title', displayLabel: 'x', isVisible: true }],
      } as never,
      MANAGER,
    );
    expect(db.count(/DELETE FROM KMS\.m_KBArticleDisplayProfileColumn/)).toBe(1);
    expect(db.count(/INSERT INTO KMS\.m_KBArticleDisplayProfileColumn/)).toBe(1);
  });

  it('deactivate/activate: เปลี่ยน IsActive เท่านั้น ไม่ลบแถว', async () => {
    const { svc, db } = make();
    await svc.deactivate(5);
    await svc.activate(5);
    expect(db.find(/SET IsActive/).map((c) => c.sql)).toEqual([
      'UPDATE KMS.m_KBArticleDisplayProfile SET IsActive = 0 WHERE ProfileID = @0',
      'UPDATE KMS.m_KBArticleDisplayProfile SET IsActive = 1 WHERE ProfileID = @0',
    ]);
    expect(db.count(/DELETE FROM KMS\.m_KBArticleDisplayProfile\b(?!Column)/)).toBe(0);
  });

  it('assignToCategory: เขียนเฉพาะ DisplayProfileID · profile ที่ปิดอยู่ผูกไม่ได้ · หมวดไม่มี = 404 · null = ยกเลิกผูก', async () => {
    const { svc, db } = make();
    db.when(/SELECT ProfileID, IsActive FROM KMS\.m_KBArticleDisplayProfile$/, [
      { ProfileID: 5, IsActive: 1 },
    ]);
    const eff = await svc.assignToCategory(4, 5, MANAGER);
    const upd = db.find(/UPDATE KMS\.m_KBCategory SET DisplayProfileID/)[0];
    expect(upd.params).toEqual([5, 4]);
    expect(upd.sql).not.toMatch(/CategoryName|CategoryCode|IsActive/);
    expect(eff.categoryId).toBe(4);

    await svc.assignToCategory(4, null, MANAGER);
    expect(db.find(/UPDATE KMS\.m_KBCategory SET DisplayProfileID/)[1].params).toEqual([null, 4]);

    await expect(svc.assignToCategory(999, 5, MANAGER)).rejects.toMatchObject({ status: 404 });

    const off = new ScriptedDb();
    off.when(/FROM KMS\.m_KBArticleDisplayProfile WHERE ProfileID = @0/, [
      { ProfileID: 5, ProfileName: 'ปิดอยู่', IsActive: 0 },
    ]);
    const s2 = new DisplayProfilesService(
      crudLogHarness().service,
      off as never,
      new FakeTx(off) as never,
      { allRows: async () => sampleCategories() } as never,
    );
    await expect(s2.assignToCategory(4, 5, MANAGER)).rejects.toMatchObject({
      response: { code: 'PROFILE_INACTIVE' },
    });
  });

  it('effective: ไม่มี profile ในสายหมวด = ค่าเริ่มต้นทั้งหมด (profileId null)', async () => {
    const { svc, db } = make();
    db.when(/SELECT ProfileID, IsActive FROM KMS\.m_KBArticleDisplayProfile$/, []);
    const e = await svc.effective(4);
    expect(e).toMatchObject({ categoryId: 4, profileId: null });
    expect(e.settings).toEqual(defaultSettings());
  });

  it('CRUD-log: operation ตามระบบเดิม และ assign บันทึกที่ entity KbCategory', async () => {
    const { svc, log, db } = make();
    db.when(/SELECT ProfileID, IsActive FROM KMS\.m_KBArticleDisplayProfile$/, []);
    await svc.deactivate(5);
    await svc.assignToCategory(4, 5, MANAGER);
    const ev = await log.events();
    expect(ev.map((e) => [e.entity, e.operation])).toEqual([
      ['KbArticleDisplayProfile', 'DEACTIVATE_KB_ARTICLE_DISPLAY_PROFILE'],
      ['KbCategory', 'ASSIGN_KB_ARTICLE_DISPLAY_PROFILE'],
    ]);
  });
});
