import { ArticlesService } from '../../../src/modules/kms/articles/articles.service';
import { lawCode, nonLawCode, sampleCategories } from './kms-fixtures';
import { FakeTx, MANAGER, STAFF, ScriptedDb, crudLogHarness } from './sql-script';

type Row = Record<string, unknown>;

const articleRow = (over: Row = {}): Row => ({
  ArticleID: 10,
  ArticleCode: lawCode('PVI00', '0001', '535').substring(0, 24),
  Title: 'มาตรา 1',
  TitleCategory: null,
  ContentHTML: '<p>เดิม</p>',
  Summary: null,
  CategoryID: 2,
  CategoryName: 'หมวด PVI00',
  ArticleType: 4,
  Status: 1,
  ConfidentialityLevel: 1,
  CurrentVersion: 1,
  IsDelete: 0,
  AttachmentCount: 0,
  RelatedCount: 0,
  ...over,
});

function make(row: Row = articleRow()) {
  const db = new ScriptedDb();
  const tx = new FakeTx(db);
  const log = crudLogHarness();
  const categories = { allRows: async () => sampleCategories() };
  // อ่านบทความ (หลายรูปแบบ SQL ที่ service ใช้)
  db.when(/SELECT a\.\*, c\.CategoryName/, () => [row]);
  db.when(/SELECT \* FROM KMS\.t_KBArticle WHERE ArticleID/, () => [row]);
  db.when(/SELECT ArticleID, ArticleCode, Status, IsDelete FROM KMS\.t_KBArticle/, () => [
    {
      ArticleID: row.ArticleID,
      ArticleCode: row.ArticleCode,
      Status: row.Status,
      IsDelete: row.IsDelete,
    },
  ]);
  db.when(/SELECT ContentHTML, Status FROM KMS\.t_KBArticle WITH \(UPDLOCK\)/, () => [
    { ContentHTML: row.ContentHTML, Status: row.Status },
  ]);
  db.when(/SELECT ArticleCode, Title, Status, CategoryID/, () => [
    { ArticleCode: row.ArticleCode },
  ]);
  db.when(/MAX\(VersionNumber\)/, [{ N: 2 }]);
  db.when(/UPDATE KMS\.t_KBArticle SET[\s\S]*SELECT @@ROWCOUNT AS N/, [{ N: 1 }]);
  const svc = new ArticlesService(log.service, db as never, tx as never, categories as never);
  return { svc, db, tx, log, row };
}

/** service บน ScriptedDb ที่ผู้เทสต์ประกอบเอง (ไม่ใช้กฎสำเร็จรูปของ make) */
function bare(db: ScriptedDb) {
  const log = crudLogHarness();
  const tx = new FakeTx(db);
  const svc = new ArticlesService(
    log.service,
    db as never,
    tx as never,
    { allRows: async () => sampleCategories() } as never,
  );
  return { svc, tx, log };
}

const BASE_CREATE = { contentHtml: '<p>เนื้อหา</p>', articleType: 4 };

describe('ArticlesService.create', () => {
  function makeCreate() {
    const h = make();
    h.db.when(/SELECT TOP 1 1 AS X FROM KMS\.t_KBArticle WHERE ArticleCode/, []); // ไม่ซ้ำ
    h.db.when(/INSERT INTO KMS\.t_KBArticle/, [{ ArticleID: 10 }]);
    h.db.when(/IF NOT EXISTS \(SELECT 1 FROM KMS\.t_KBArticleLink/, [{ Inserted: 1 }]);
    return h;
  }

  it('กฎหมาย: เก็บ 24 ตัวแรก ชื่อ "มาตรา N" หมวดปีจาก Code · Draft + version 1 ใน transaction เดียว', async () => {
    const { svc, db, tx } = makeCreate();
    const code = lawCode('PLI00', '0007', '540');
    await svc.create(
      { ...BASE_CREATE, articleCode: code, title: 'ชื่อที่ client ส่งมา (ต้องถูกเมิน)' } as never,
      STAFF,
    );

    const ins = db.find(/INSERT INTO KMS\.t_KBArticle/)[0];
    expect(ins.sql).toMatch(/VALUES\s*\(@0[\s\S]*1, 1, @7/); // Status=Draft(1), CurrentVersion=1
    expect(ins.params.slice(0, 7)).toEqual([
      code.substring(0, 24),
      'มาตรา 7',
      '<p>เนื้อหา</p>',
      null,
      null,
      5,
      4,
    ]);
    expect(ins.params[12]).toBe(STAFF.adUserName);
    const ver = db.find(/INSERT INTO KMS\.t_KBVersion/)[0];
    expect(ver.params).toEqual([10, '<p>เนื้อหา</p>', 'บทความใหม่', STAFF.adUserName]);
    expect(tx.runs).toBe(1);
    expect(tx.rolledBack).toBe(0);
  });

  it('ไม่ใช่กฎหมาย: เก็บเต็ม 29 ตัว · ต้องตั้งชื่อเอง · ผูกมาตราแม่ให้ทั้งสองทางเมื่อมีในระบบ', async () => {
    const { svc, db } = makeCreate();
    const parent = lawCode('PLI00', '0007', '535').substring(0, 24);
    db.when(/WHERE ArticleCode = @0 AND \(IsDelete = 0 OR IsDelete IS NULL\)/, [{ ArticleID: 55 }]);
    const code = nonLawCode(parent, '2');
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: code } as never, STAFF),
    ).rejects.toMatchObject({
      response: { code: 'TITLE_REQUIRED' },
    });
    await svc.create({ ...BASE_CREATE, articleCode: code, title: 'คำสั่ง ก' } as never, STAFF);
    const ins = db.find(/INSERT INTO KMS\.t_KBArticle/)[0];
    expect(ins.params[0]).toBe(code);
    expect(ins.params[1]).toBe('คำสั่ง ก');
    const links = db
      .find(/IF NOT EXISTS \(SELECT 1 FROM KMS\.t_KBArticleLink/)
      .map((c) => c.params.slice(0, 3));
    expect(links).toEqual([
      [10, 4, '55'],
      [55, 4, '10'],
    ]);
  });

  it('Code ซ้ำ (รวมที่ถูกลบ) = 409 และไม่เขียนอะไร', async () => {
    const { svc, db, tx } = make();
    db.when(/SELECT TOP 1 1 AS X FROM KMS\.t_KBArticle WHERE ArticleCode = @0$/, [{ X: 1 }]);
    db.when(/SELECT TOP 1 1 AS X/, [{ X: 1 }]);
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: lawCode('PVI00', '0001', '535') } as never, STAFF),
    ).rejects.toMatchObject({ status: 409, response: { code: 'ARTICLE_CODE_EXISTS' } });
    expect(tx.runs).toBe(0);
    // ExistsByCode ต้องไม่กรอง IsDelete
    expect(db.find(/SELECT TOP 1 1 AS X/)[0].sql).not.toMatch(/IsDelete/);
  });

  it('ผู้ใช้อื่นสร้าง Code เดียวกันพร้อมกัน (unique violation) → 409 ไม่ใช่ 500', async () => {
    const { svc, db } = makeCreate();
    db.failWhen(/INSERT INTO KMS\.t_KBArticle/, { number: 2627 });
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: lawCode('PVI00', '0002', '535') } as never, STAFF),
    ).rejects.toMatchObject({ status: 409, response: { code: 'ARTICLE_CODE_EXISTS' } });
  });

  it('Code ผิดกฎ → 422 ARTICLE_CODE_INVALID พร้อม missingCategory เมื่อขาดหมวดปี', async () => {
    const { svc, tx } = makeCreate();
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: lawCode('PLI00', '0007', '560') } as never, STAFF),
    ).rejects.toMatchObject({
      response: {
        code: 'ARTICLE_CODE_INVALID',
        details: { missingCategory: expect.objectContaining({ categoryCode: 'PLI002560' }) },
      },
    });
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: 'สั้นไป' } as never, STAFF),
    ).rejects.toMatchObject({ response: { code: 'ARTICLE_CODE_INVALID' } });
    expect(tx.runs).toBe(0);
  });

  it('พระราชกฤษฎีกา: ต้องเลือกหมวดกลุ่มและผูกมาตรากฎหมายอย่างน้อย 1', async () => {
    const { svc } = makeCreate();
    const code = lawCode('ETR01', '0003', '540');
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: code, groupCategoryId: 999 } as never, STAFF),
    ).rejects.toMatchObject({ response: { code: 'DECREE_GROUP_NOT_FOUND' } });
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: code, groupCategoryId: 7 } as never, STAFF),
    ).rejects.toMatchObject({ response: { code: 'DECREE_REQUIRES_LAW_LINK' } });
  });

  it('ผูกมาตราที่ไม่มีอยู่ → 422 LINK_TARGET_NOT_FOUND และ rollback', async () => {
    const { svc, db, tx } = makeCreate();
    const code = lawCode('ETR01', '0003', '540');
    db.when(/SELECT ArticleID FROM KMS\.t_KBArticle[\s\S]*IN \(/, []);
    await expect(
      svc.create(
        {
          ...BASE_CREATE,
          articleCode: code,
          groupCategoryId: 7,
          relatedArticleIds: [901],
        } as never,
        STAFF,
      ),
    ).rejects.toMatchObject({ response: { code: 'LINK_TARGET_NOT_FOUND' } });
    expect(tx.rolledBack).toBe(1);
    expect(db.count(/INSERT INTO KMS\.t_KBArticle/)).toBe(0);
  });

  it('CRUD-log: บันทึก CREATE_KB_ARTICLE พร้อม recordId และ log ความล้มเหลวด้วย', async () => {
    const { svc, log } = makeCreate();
    await svc.create(
      { ...BASE_CREATE, articleCode: lawCode('PVI00', '0002', '535') } as never,
      STAFF,
    );
    await expect(
      svc.create({ ...BASE_CREATE, articleCode: 'x' } as never, STAFF),
    ).rejects.toBeDefined();
    const ev = await log.events();
    expect(ev[0]).toMatchObject({
      module: 'KMS',
      entity: 'KbArticle',
      action: 'CREATE',
      operation: 'CREATE_KB_ARTICLE',
      recordId: 10,
      success: true,
    });
    expect(ev[1]).toMatchObject({ success: false, operation: 'CREATE_KB_ARTICLE' });
  });
});

describe('ArticlesService.update', () => {
  it('ContentHTML เปลี่ยน → เพิ่ม version (MAX+1) และตั้ง CurrentVersion', async () => {
    const { svc, db } = make(
      articleRow({
        ArticleCode: nonLawCode(lawCode('PLI00', '0007', '535').substring(0, 24), '2'),
      }),
    );
    await svc.update(
      10,
      { contentHtml: '<p>ใหม่</p>', changeDescription: ' แก้ไขตามประกาศ ' } as never,
      STAFF,
    );
    const ver = db.find(/INSERT INTO KMS\.t_KBVersion/)[0];
    expect(ver.params).toEqual([10, 2, '<p>ใหม่</p>', 'แก้ไขตามประกาศ', STAFF.adUserName]);
    const upd = db.find(/UPDATE KMS\.t_KBArticle SET/)[0];
    expect(upd.sql).toMatch(/CurrentVersion = @/);
    expect(upd.params).toContain(2);
  });

  it('ContentHTML เท่าเดิม → ไม่สร้าง version และไม่แตะ CurrentVersion', async () => {
    const { svc, db } = make(
      articleRow({
        ArticleCode: nonLawCode(lawCode('PLI00', '0007', '535').substring(0, 24), '2'),
        Title: 'คำสั่ง',
      }),
    );
    await svc.update(10, { contentHtml: '<p>เดิม</p>', summary: 'สรุปใหม่' } as never, STAFF);
    expect(db.count(/INSERT INTO KMS\.t_KBVersion/)).toBe(0);
    expect(db.find(/UPDATE KMS\.t_KBArticle SET/)[0].sql).not.toMatch(/CurrentVersion/);
  });

  it('UPDATE เขียนเฉพาะคอลัมน์ใน whitelist — ไม่มี ArticleCode/CategoryID/Status/ReviewDueDate/IsOfficialPolicy', async () => {
    const { svc, db } = make(
      articleRow({
        ArticleCode: nonLawCode(lawCode('PLI00', '0007', '535').substring(0, 24), '2'),
      }),
    );
    // ฟิลด์ต้องห้ามที่ client แอบส่งมา ต้องไม่ไปถึง SQL
    await svc.update(
      10,
      {
        title: 'ใหม่',
        articleCode: 'X',
        categoryId: 99,
        status: 3,
        reviewDueDate: new Date(),
        isOfficialPolicy: true,
      } as never,
      STAFF,
    );
    const sql = db.find(/UPDATE KMS\.t_KBArticle SET/)[0].sql.split(' WHERE ')[0]; // เฉพาะส่วน SET
    for (const forbidden of [
      'ArticleCode',
      'CategoryID',
      'Status',
      'ReviewDueDate',
      'IsOfficialPolicy',
      'IsDelete',
    ])
      expect(sql).not.toContain(forbidden);
    expect(sql).toMatch(/UpdatedBy = @\d+, UpdatedDate = GETDATE\(\)/);
  });

  it('กฎหมาย/พระราชกฤษฎีกา (Code 24 ตัว) แก้ชื่อไม่ได้ แต่ส่งชื่อเดิมกลับมาได้', async () => {
    const { svc } = make();
    await expect(svc.update(10, { title: 'ชื่ออื่น' } as never, STAFF)).rejects.toMatchObject({
      response: { code: 'TITLE_LOCKED' },
    });
    await expect(
      svc.update(10, { title: ' มาตรา 1 ', summary: 'x' } as never, STAFF),
    ).resolves.toBeDefined();
  });

  it('Archived แก้ไม่ได้ (ทั้งตอนอ่านแรกและตอนล็อกแถวใน transaction)', async () => {
    const { svc, db } = make(articleRow({ Status: 4 }));
    await expect(svc.update(10, { summary: 'x' } as never, STAFF)).rejects.toMatchObject({
      response: { code: 'ARTICLE_ARCHIVED' },
    });
    expect(db.count(/UPDATE KMS\.t_KBArticle SET/)).toBe(0);
  });

  it('สถานะกลายเป็น Archived ระหว่างทาง: ล็อกแถวใน transaction แล้วปฏิเสธ ไม่ UPDATE', async () => {
    const db = new ScriptedDb();
    db.when(/SELECT ContentHTML, Status FROM KMS\.t_KBArticle WITH \(UPDLOCK\)/, [
      { ContentHTML: '<p>เดิม</p>', Status: 4 },
    ]);
    db.when(/SELECT \* FROM KMS\.t_KBArticle WHERE ArticleID/, [articleRow({ Status: 1 })]);
    const { svc, tx } = bare(db);
    await expect(svc.update(10, { summary: 'x' } as never, STAFF)).rejects.toMatchObject({
      response: { code: 'ARTICLE_ARCHIVED' },
    });
    expect(db.count(/UPDATE KMS\.t_KBArticle SET/)).toBe(0);
    expect(tx.rolledBack).toBe(1);
  });

  it('ไม่พบ / ถูกลบแล้ว = 404', async () => {
    const { svc } = bare(new ScriptedDb());
    await expect(svc.update(1, {} as never, STAFF)).rejects.toMatchObject({ status: 404 });
  });

  it('CRUD-log: UPDATE_KB_ARTICLE มี before (ภาพสรุป ไม่ใส่เนื้อหาเต็ม)', async () => {
    const { svc, log } = make(
      articleRow({
        ArticleCode: nonLawCode(lawCode('PLI00', '0007', '535').substring(0, 24), '2'),
      }),
    );
    await svc.update(10, { summary: 'x' } as never, STAFF);
    const ev = await log.events();
    expect(ev[0]).toMatchObject({
      operation: 'UPDATE_KB_ARTICLE',
      action: 'UPDATE',
      recordId: 10,
      success: true,
    });
    expect(ev[0].before).toBeDefined();
  });
});

describe('ArticlesService.changeStatus', () => {
  it('Draft → Review: ทุกคนทำได้ · ตั้ง ReviewedBy/UpdatedBy · เงื่อนไข WHERE Status เดิม (กันชนกัน)', async () => {
    const { svc, db } = make(articleRow({ Status: 1 }));
    await svc.changeStatus(10, 2, STAFF);
    const upd = db.find(/UPDATE KMS\.t_KBArticle SET[\s\S]*Status\s+= @0/)[0];
    expect(upd.params).toEqual([2, STAFF.adUserName, 10, 1]);
    expect(upd.sql).toMatch(/WHERE ArticleID = @2 AND Status = @3/);
  });

  it('Review → Published: เจ้าหน้าที่ทั่วไป 403 · Manager ทำได้ · PublishedDate ไม่ทับค่าเดิม (ISNULL)', async () => {
    const { svc, db } = make(articleRow({ Status: 2 }));
    await expect(svc.changeStatus(10, 3, STAFF)).rejects.toMatchObject({
      status: 403,
      response: { code: 'ARTICLE_STATUS_ROLE_DENIED' },
    });
    expect(db.count(/UPDATE KMS\.t_KBArticle SET/)).toBe(0);
    await svc.changeStatus(10, 3, MANAGER);
    expect(db.find(/UPDATE KMS\.t_KBArticle SET/)[0].sql).toMatch(
      /ISNULL\(PublishedDate, GETDATE\(\)\)/,
    );
  });

  it('ข้ามขั้น/ย้อนกลับ = 422 INVALID_STATUS_TRANSITION · Archived เปลี่ยนไม่ได้อีก', async () => {
    const draft = make(articleRow({ Status: 1 }));
    await expect(draft.svc.changeStatus(10, 3, MANAGER)).rejects.toMatchObject({
      response: { code: 'INVALID_STATUS_TRANSITION' },
    });
    const pub = make(articleRow({ Status: 3 }));
    await expect(pub.svc.changeStatus(10, 2, MANAGER)).rejects.toMatchObject({
      response: { code: 'INVALID_STATUS_TRANSITION' },
    });
    const arch = make(articleRow({ Status: 4 }));
    await expect(arch.svc.changeStatus(10, 3, MANAGER)).rejects.toMatchObject({
      response: { code: 'ARTICLE_ARCHIVED' },
    });
  });

  it('บทความถูกลบ = 404 · มีผู้อื่นเปลี่ยนสถานะระหว่างทาง (0 แถว) = 409', async () => {
    const del = make(articleRow({ IsDelete: 1 }));
    await expect(del.svc.changeStatus(10, 2, STAFF)).rejects.toMatchObject({ status: 404 });

    const db = new ScriptedDb();
    db.when(/SELECT ArticleID, ArticleCode, Status, IsDelete/, [
      { ArticleID: 10, ArticleCode: 'X', Status: 1, IsDelete: 0 },
    ]);
    db.when(/UPDATE KMS\.t_KBArticle SET/, [{ N: 0 }]);
    await expect(bare(db).svc.changeStatus(10, 2, STAFF)).rejects.toMatchObject({
      status: 409,
      response: { code: 'ARTICLE_STATUS_CHANGED' },
    });
  });

  it('ชื่อ audit เดิม SUBMIT_REVIEW / PUBLISH / ARCHIVE', async () => {
    const ops: string[] = [];
    for (const [from, to] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ]) {
      const { svc, log } = make(articleRow({ Status: from }));
      await svc.changeStatus(10, to, MANAGER);
      ops.push(String((await log.events())[0].operation));
    }
    expect(ops).toEqual(['SUBMIT_REVIEW', 'PUBLISH', 'ARCHIVE']);
  });
});

describe('ArticlesService.softDelete', () => {
  it('soft delete (IsDelete=1) พร้อมลบ link Law ทั้งสองทางใน transaction เดียว · ไม่ DELETE แถวบทความ', async () => {
    const { svc, db, tx } = make();
    db.when(/DELETE FROM KMS\.t_KBArticleLink[\s\S]*SELECT @@ROWCOUNT AS N/, [{ N: 3 }]);
    await svc.softDelete(10, MANAGER);
    const del = db.find(/DELETE FROM KMS\.t_KBArticleLink/)[0];
    expect(del.sql).toMatch(/EntityType = 4 AND \(ArticleID = @0 OR EntityID = @1\)/);
    expect(del.params).toEqual([10, '10']);
    const upd = db.find(/SET IsDelete = 1/)[0];
    expect(upd.params).toEqual([10, MANAGER.adUserName]);
    expect(db.count(/DELETE FROM KMS\.t_KBArticle\b(?!Link)/)).toBe(0);
    expect(tx.runs).toBe(1);
  });

  it('ไม่พบ = 404 (rollback ไม่ลบ link) · CRUD-log DELETE_KB_ARTICLE', async () => {
    const empty = new ScriptedDb();
    const { svc, log } = bare(empty);
    await expect(svc.softDelete(10, MANAGER)).rejects.toMatchObject({ status: 404 });
    expect(empty.count(/DELETE FROM KMS\.t_KBArticleLink/)).toBe(0);
    expect((await log.events())[0]).toMatchObject({
      operation: 'DELETE_KB_ARTICLE',
      action: 'DELETE',
      success: false,
    });
  });
});

describe('ArticlesService.analyzeCode / list / get', () => {
  it('analyzeCode: ซ้ำ → isValid=false แม้ Code ถูกรูปแบบ · พบมาตราแม่ของ NonLaw', async () => {
    const { svc, db } = make();
    const parent = lawCode('PLI00', '0007', '535').substring(0, 24);
    db.when(/SELECT TOP 1 1 AS X/, [{ X: 1 }]);
    db.when(/SELECT TOP 1 ArticleID FROM KMS\.t_KBArticle/, [{ ArticleID: 55 }]);
    const r = await svc.analyzeCode({ code: nonLawCode(parent, '2') } as never);
    expect(r).toMatchObject({
      layout: 'NonLaw',
      codeExists: true,
      isValid: false,
      parentArticleId: 55,
    });
  });

  it('list: ใช้พารามิเตอร์ทุกค่า · หมวด+หมวดย่อย · sortBy นอก whitelist ถูกเมิน', async () => {
    const { svc, db } = make();
    db.when(/COUNT\(\*\) AS N FROM KMS\.t_KBArticle a/, [{ N: 19000 }]);
    db.when(/OFFSET/, [articleRow({ SummaryPreview: 's', ContentPreview: 'c' })]);
    const r = await svc.list({
      page: 2,
      pageSize: 50,
      categoryId: 3,
      q: "'; DROP TABLE x; --",
      sortBy: 'ArticleCode; DROP TABLE x',
      sortDir: 'desc',
    } as never);
    expect(r).toMatchObject({ total: 19000, page: 2, pageSize: 50 });
    expect(r.items).toHaveLength(1);
    const page = db.find(/OFFSET/)[0];
    expect(page.sql).not.toContain('DROP TABLE');
    expect(page.sql).toMatch(/ORDER BY a\.ArticleCode DESC, a\.ArticleID ASC/);
    expect(page.params).toEqual(expect.arrayContaining([3, 4, 5, 50]));
    expect(page.params).toContain(50);
  });

  it('get: ไม่พบ = 404 · มี categoryPath', async () => {
    const { svc } = make(articleRow({ CategoryID: 4 }));
    const d = await svc.get(10);
    expect(d.categoryPath).toBe('หมวด LW › หมวด PLI00 › หมวด PLI002535');
    await expect(bare(new ScriptedDb()).svc.get(1)).rejects.toMatchObject({ status: 404 });
  });
});
