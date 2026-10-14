import { ImportTemplatesService } from '../../../src/modules/kms/import-templates/import-templates.service';
import { sampleCategories } from './kms-fixtures';
import { FakeTx, MANAGER, ScriptedDb, crudLogHarness } from './sql-script';

type Row = Record<string, unknown>;

const col = (targetColumnName: string, excelColumnRef: string | null) => ({
  targetColumnName,
  excelColumnRef,
});
const LAW_COLS = [col('LayoutType', 'Law'), col('ArticleType', '4'), col('ArticleCode', 'A')];

function make(
  opts: { saved?: Row[]; active?: boolean; cats?: ReturnType<typeof sampleCategories> } = {},
) {
  const db = new ScriptedDb();
  const tx = new FakeTx(db);
  const log = crudLogHarness();
  const tpl = {
    TemplateID: 3,
    TemplateName: 'กฎหมาย',
    Description: null,
    SortOrder: 0,
    IsActive: opts.active === false ? 0 : 1,
    CreatedBy: 'x',
  };
  db.when(/FROM KMS\.m_KBImportTemplate WHERE TemplateID = @0/, [tpl]);
  db.when(/FROM KMS\.m_KBImportTemplateColumn WHERE TemplateID = @0/, opts.saved ?? []);
  db.when(/SCOPE_IDENTITY\(\)\) AS TemplateID/, [{ TemplateID: 3 }]);
  const svc = new ImportTemplatesService(
    log.service,
    db as never,
    tx as never,
    {
      allRows: async () => opts.cats ?? sampleCategories(),
    } as never,
  );
  return { svc, db, tx, log };
}

const saved = (pairs: [string, string][]): Row[] =>
  pairs.map(([TargetColumnName, ExcelColumnRef], i) => ({
    TargetColumnName,
    ExcelColumnRef,
    DisplayOrder: i,
  }));

describe('ImportTemplatesService — บันทึก Template', () => {
  it('บันทึกเฉพาะแถวที่ map แล้ว เรียงตามตาราง · LayoutType เก็บค่ามาตรฐาน · ลบ-ใส่ใหม่ทั้งชุดใน transaction เดียว', async () => {
    const { svc, db, tx } = make();
    await svc.update(
      3,
      {
        templateName: ' กฎหมาย ',
        columns: [
          col('articlecode', ' B '),
          col('layouttype', ' LAW '),
          col('ArticleType', '4'),
          col('Title', '  '),
        ],
      } as never,
      MANAGER,
    );
    expect(tx.runs).toBe(1);
    expect(db.count(/DELETE FROM KMS\.m_KBImportTemplateColumn/)).toBe(1);
    const ins = db
      .find(/INSERT INTO KMS\.m_KBImportTemplateColumn/)
      .map((c) => c.params.slice(1, 3));
    // Title ที่ว่างไม่ถูกเก็บ · ชื่อคอลัมน์ถูกแปลงเป็นรูปแบบมาตรฐาน · ' LAW ' ถูกแปลงเป็น 'Law'
    expect(ins).toEqual(
      expect.arrayContaining([
        ['ArticleCode', 'B'],
        ['LayoutType', 'Law'],
        ['ArticleType', '4'],
      ]),
    );
    expect(ins.some((r) => r[0] === 'Title')).toBe(false);
  });

  it('Template ยังไม่ครบ → 422 TEMPLATE_INCOMPLETE พร้อมรายการปัญหา และไม่เขียน DB', async () => {
    const { svc, db, tx } = make();
    await expect(
      svc.create({ templateName: 'ใหม่', columns: [col('Title', 'A')] } as never, MANAGER),
    ).rejects.toMatchObject({
      response: {
        code: 'TEMPLATE_INCOMPLETE',
        details: { problems: expect.arrayContaining([expect.stringContaining('ArticleCode')]) },
      },
    });
    expect(tx.runs).toBe(0);
    expect(db.count(/INSERT/)).toBe(0);
  });

  it('พระราชกฤษฎีกาต้อง map LawReference · กฎหมาย/ไม่ใช่กฎหมายห้าม map', async () => {
    const { svc } = make();
    const decree = [col('LayoutType', 'Decree'), col('ArticleType', '4'), col('ArticleCode', 'A')];
    await expect(
      svc.create({ templateName: 'พรฎ', columns: decree } as never, MANAGER),
    ).rejects.toMatchObject({
      response: { code: 'TEMPLATE_INCOMPLETE' },
    });
    await expect(
      svc.create(
        { templateName: 'พรฎ', columns: [...decree, col('LawReference', 'D')] } as never,
        MANAGER,
      ),
    ).resolves.toBeDefined();
    await expect(
      svc.create(
        { templateName: 'ก', columns: [...LAW_COLS, col('LawReference', 'D')] } as never,
        MANAGER,
      ),
    ).rejects.toMatchObject({
      response: { code: 'TEMPLATE_INCOMPLETE' },
    });
  });

  it('คอลัมน์เป้าหมายที่ไม่รู้จัก / ซ้ำ (ไม่สนตัวพิมพ์) → 422 ก่อนแตะ DB', async () => {
    const { svc, tx } = make();
    await expect(
      svc.create(
        { templateName: 'x', columns: [...LAW_COLS, col('IsDelete', '1')] } as never,
        MANAGER,
      ),
    ).rejects.toMatchObject({
      response: { code: 'TEMPLATE_COLUMN_UNKNOWN' },
    });
    await expect(
      svc.create(
        {
          templateName: 'x',
          columns: [...LAW_COLS, col('title', 'A'), col('Title', 'B')],
        } as never,
        MANAGER,
      ),
    ).rejects.toMatchObject({
      response: { code: 'TEMPLATE_COLUMN_DUPLICATE' },
    });
    expect(tx.runs).toBe(0);
  });

  it('ชื่อซ้ำ → 409 (ตรวจก่อน และดักตอนชน unique index)', async () => {
    const dupFirst = make();
    dupFirst.db.when(/SELECT TOP 1 1 AS X FROM KMS\.m_KBImportTemplate/, [{ X: 1 }]);
    await expect(
      dupFirst.svc.create({ templateName: 'กฎหมาย', columns: LAW_COLS } as never, MANAGER),
    ).rejects.toMatchObject({
      response: { code: 'TEMPLATE_NAME_DUPLICATE' },
    });
    const race = make();
    race.db.failWhen(/INSERT INTO KMS\.m_KBImportTemplate \(/, { number: 2601 });
    await expect(
      race.svc.create({ templateName: 'กฎหมาย', columns: LAW_COLS } as never, MANAGER),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'TEMPLATE_NAME_DUPLICATE' },
    });
  });

  it('activate/deactivate: เปลี่ยน IsActive + UpdatedBy ไม่ลบ · ไม่พบ = 404', async () => {
    const { svc, db } = make();
    await svc.deactivate(3, MANAGER);
    const upd = db.find(/UPDATE KMS\.m_KBImportTemplate SET IsActive/)[0];
    expect(upd.params).toEqual([0, MANAGER.adUserName, 3]);
    expect(db.count(/DELETE/)).toBe(0);
    const none = new ScriptedDb();
    const s = new ImportTemplatesService(
      crudLogHarness().service,
      none as never,
      new FakeTx(none) as never,
      { allRows: async () => [] } as never,
    );
    await expect(s.activate(9, MANAGER)).rejects.toMatchObject({ status: 404 });
  });

  it('CRUD-log: operation ของ Template', async () => {
    const { svc, log } = make();
    await svc.create({ templateName: 'ใหม่', columns: LAW_COLS } as never, MANAGER);
    await svc.update(3, { templateName: 'กฎหมาย', columns: LAW_COLS } as never, MANAGER);
    await svc.deactivate(3, MANAGER);
    await svc.activate(3, MANAGER);
    const ev = await log.events();
    expect(ev.map((e) => e.operation)).toEqual([
      'CREATE_KB_IMPORT_TEMPLATE',
      'UPDATE_KB_IMPORT_TEMPLATE',
      'DEACTIVATE_KB_IMPORT_TEMPLATE',
      'ACTIVATE_KB_IMPORT_TEMPLATE',
    ]);
    expect(ev.every((e) => e.entity === 'KbImportTemplate' && e.success)).toBe(true);
  });
});

describe('ImportTemplatesService — อ่านและตีความ Template รุ่นเก่า', () => {
  it('get: ตารางครบทุกคอลัมน์เป้าหมาย (ที่ไม่ map เป็น null) + problems', async () => {
    const { svc } = make({
      saved: saved([
        ['LayoutType', 'Law'],
        ['ArticleType', '4'],
      ]),
    });
    const d = await svc.get(3);
    expect(d.layoutType).toBe('Law');
    expect(d.articleType).toBe(4);
    expect(d.columns.length).toBeGreaterThan(8);
    expect(d.columns.find((c) => c.targetColumnName === 'ArticleCode')?.excelColumnRef).toBeNull();
    expect(d.problems.some((p) => p.includes('ArticleCode'))).toBe(true);
  });

  it('Template เก่าไม่มี LayoutType แต่มี CategoryID: derive จากหมวด (ใต้ LW = Law, นอกนั้น NonLaw)', async () => {
    const underLaw = make({
      saved: saved([
        ['CategoryID', '2'],
        ['ArticleCode', 'A'],
      ]),
    });
    expect(
      (await underLaw.svc.columnRows(3)).find((r) => r.targetColumnName === 'LayoutType')
        ?.excelColumnRef,
    ).toBe('Law');
    const notLaw = make({
      saved: saved([
        ['CategoryID', '10'],
        ['ArticleCode', 'A'],
      ]),
    });
    expect(
      (await notLaw.svc.columnRows(3)).find((r) => r.targetColumnName === 'LayoutType')
        ?.excelColumnRef,
    ).toBe('NonLaw');
    const unknown = make({ saved: saved([['CategoryID', '9999']]) });
    expect(
      (await unknown.svc.columnRows(3)).find((r) => r.targetColumnName === 'LayoutType')
        ?.excelColumnRef,
    ).toBeNull();
  });

  it('Template เก่า Law + LawReference ถูกอ่านเป็น Decree', async () => {
    const { svc } = make({
      saved: saved([
        ['LayoutType', 'Law'],
        ['LawReference', 'D'],
        ['ArticleCode', 'A'],
      ]),
    });
    expect((await svc.get(3)).layoutType).toBe('Decree');
  });

  it('requireActiveForImport: ปิดใช้งาน = 422 TEMPLATE_INACTIVE · เปิดอยู่คืนชื่อ+mapping', async () => {
    const off = make({ active: false });
    await expect(off.svc.requireActiveForImport(3)).rejects.toMatchObject({
      response: { code: 'TEMPLATE_INACTIVE' },
    });
    const on = make({ saved: saved([['LayoutType', 'Law']]) });
    const r = await on.svc.requireActiveForImport(3);
    expect(r.name).toBe('กฎหมาย');
    expect(r.columns.find((c) => c.targetColumnName === 'LayoutType')?.excelColumnRef).toBe('Law');
  });

  it('emptyGrid/options: ตารางว่างสำหรับสร้างใหม่ และตัวเลือกประเภทไฟล์/ArticleType', () => {
    const { svc } = make();
    expect(svc.emptyGrid().every((c) => c.excelColumnRef === null)).toBe(true);
    const o = svc.options();
    expect(o.layouts.map((l) => l.layoutType)).toEqual(['Law', 'Decree', 'NonLaw']);
    expect(o.articleTypes.length).toBe(5);
  });
});
