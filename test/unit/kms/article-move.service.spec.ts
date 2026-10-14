import { ArticleMoveService } from '../../../src/modules/kms/moves/article-move.service';
import { computeMoveWarnings } from '../../../src/modules/kms/moves/move-warnings';
import { cat, sampleCategories } from './kms-fixtures';
import { FakeTx, MANAGER, ScriptedDb, crudLogHarness } from './sql-script';

const all = sampleCategories();
const byCode = (code: string) => all.find((c) => c.categoryCode === code)!;

describe('computeMoveWarnings', () => {
  it('ไม่มีบทความที่ต้องย้าย = ไม่มีคำเตือน', () => {
    expect(computeMoveWarnings(all, byCode('PVI00'), [])).toEqual([]);
  });

  it('ย้ายภายในกฎหมายเดียวกัน (ปลายทางไม่มีหมวดย่อย/โปรไฟล์เท่าเดิม) = ไม่มีคำเตือน', () => {
    expect(
      computeMoveWarnings(all, byCode('PLI002540'), [{ articleId: 1, categoryId: 4 }]),
    ).toEqual([]);
  });

  it('ข้ามกฎหมาย ↔ ไม่ใช่กฎหมาย → เตือนพร้อมจำนวน', () => {
    const w = computeMoveWarnings(all, byCode('OR002535'), [
      { articleId: 1, categoryId: 4 },
      { articleId: 2, categoryId: 11 },
    ]);
    expect(w.some((x) => x.startsWith('1 บทความจะย้ายข้ามระหว่างกฎหมาย'))).toBe(true);
  });

  it('ปลายทางเป็น LW หรือมีหมวดย่อยที่เปิดอยู่ → เตือน (หมวดย่อยที่ปิดไม่นับ)', () => {
    const toMove = [{ articleId: 1, categoryId: 2 }];
    const lw = computeMoveWarnings(all, byCode('LW'), toMove);
    expect(lw.some((x) => x.includes('หมวดกฎหมายหลัก (LW)'))).toBe(true);
    expect(lw.some((x) => x.includes('มีหมวดย่อย'))).toBe(true);

    const pli = computeMoveWarnings(all, byCode('PLI00'), toMove);
    expect(pli.some((x) => x.includes('มีหมวดย่อย 2 หมวด'))).toBe(true);

    const closed = all.map((c) => (c.parentCategoryId === 3 ? { ...c, isActive: false } : c));
    expect(
      computeMoveWarnings(
        closed,
        closed.find((c) => c.categoryId === 3)!,
        toMove,
      ).some((x) => x.includes('มีหมวดย่อย')),
    ).toBe(false);
  });

  it('Display Profile ที่มีผลต่างจากเดิม → เตือน', () => {
    const cats = [
      cat(1, 'LW', null, { displayProfileId: 5 }),
      cat(2, 'A00', 1),
      cat(3, 'B00', 1, { displayProfileId: 6 }),
    ];
    const w = computeMoveWarnings(cats, cats[2], [{ articleId: 1, categoryId: 2 }]);
    expect(w.some((x) => x.includes('Display Profile ต่างจากเดิม'))).toBe(true);
  });
});

function make(rows: { ArticleID: number; CategoryID: number }[]) {
  const db = new ScriptedDb();
  const tx = new FakeTx(db);
  const log = crudLogHarness();
  db.when(/SELECT ArticleID, CategoryID FROM KMS\.t_KBArticle WITH \(UPDLOCK\)/, (_s, p) =>
    rows.filter(
      (r) => (p as number[]).slice(1).includes(r.ArticleID) && r.CategoryID !== (p as number[])[0],
    ),
  );
  db.when(/SELECT ArticleID, CategoryID FROM KMS\.t_KBArticle\s+WHERE/, (_s, p) =>
    rows.filter((r) => (p as number[]).includes(r.ArticleID)),
  );
  const svc = new ArticleMoveService(
    log.service,
    db as never,
    tx as never,
    { allRows: async () => sampleCategories() } as never,
  );
  return { svc, db, tx, log };
}

describe('ArticleMoveService', () => {
  const rows = [
    { ArticleID: 1, CategoryID: 2 }, // PVI00
    { ArticleID: 2, CategoryID: 2 },
    { ArticleID: 3, CategoryID: 7 }, // อยู่ในปลายทางอยู่แล้ว
  ];

  it('ย้ายเฉพาะ CategoryID + UpdatedBy/UpdatedDate (ไม่แตะ version/status/content) · ข้ามบทความที่อยู่ปลายทางแล้ว', async () => {
    const { svc, db, tx } = make(rows);
    const r = await svc.move({ articleIds: [1, 2, 3], toCategoryId: 7 } as never, MANAGER);
    expect(r).toMatchObject({ requestedCount: 3, movedCount: 2, skippedCount: 1 });
    const upd = db.find(/UPDATE KMS\.t_KBArticle SET/)[0];
    expect(upd.sql).toMatch(/SET CategoryID = @0, UpdatedBy = @1, UpdatedDate = GETDATE\(\)/);
    expect(upd.sql).not.toMatch(/Status|ContentHTML|CurrentVersion/);
    expect(upd.params).toEqual([7, MANAGER.adUserName, 1, 2]);
    expect(db.count(/t_KBVersion/)).toBe(0);
    expect(tx.runs).toBe(1);
  });

  it('มีคำเตือนแต่ไม่ยืนยัน → 409 MOVE_WARNINGS_NOT_CONFIRMED พร้อมรายการคำเตือน และไม่เขียนอะไร', async () => {
    const { svc, db } = make(rows);
    // PVI00(กฎหมาย) → OR00 (ไม่ใช่กฎหมาย) ข้ามประเภท
    await expect(
      svc.move({ articleIds: [1, 2], toCategoryId: 10 } as never, MANAGER),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'MOVE_WARNINGS_NOT_CONFIRMED', details: { warnings: expect.any(Array) } },
    });
    expect(db.count(/UPDATE KMS\.t_KBArticle/)).toBe(0);
  });

  it('ยืนยันคำเตือนแล้วย้ายได้ · audit MOVE_KB_ARTICLE ต่อบทความ พร้อม before/after', async () => {
    const { svc, log } = make(rows);
    const r = await svc.move(
      { articleIds: [1, 2], toCategoryId: 10, confirmWarnings: true } as never,
      MANAGER,
    );
    expect(r.movedCount).toBe(2);
    expect(r.warnings.length).toBeGreaterThan(0);
    const ev = await log.events();
    const perArticle = ev.filter((e) => e.operation === 'MOVE_KB_ARTICLE');
    expect(perArticle.map((e) => [e.recordId, e.before, e.after])).toEqual([
      [1, { categoryId: 2 }, { categoryId: 10 }],
      [2, { categoryId: 2 }, { categoryId: 10 }],
    ]);
    expect(ev.some((e) => e.operation === 'MOVE_KB_ARTICLES' && e.success)).toBe(true);
  });

  it('ปลายทางไม่มี / ปิดใช้งาน / ไม่ได้เลือกบทความ = 422', async () => {
    const { svc } = make(rows);
    await expect(
      svc.move({ articleIds: [1], toCategoryId: 999 } as never, MANAGER),
    ).rejects.toMatchObject({
      response: { code: 'MOVE_DESTINATION_NOT_FOUND' },
    });
    await expect(
      svc.move({ articleIds: [], toCategoryId: 7 } as never, MANAGER),
    ).rejects.toMatchObject({
      response: { code: 'MOVE_NO_ARTICLES' },
    });
    const db = new ScriptedDb();
    const closed = sampleCategories().map((c) =>
      c.categoryId === 7 ? { ...c, isActive: false } : c,
    );
    const s2 = new ArticleMoveService(
      crudLogHarness().service,
      db as never,
      new FakeTx(db) as never,
      { allRows: async () => closed } as never,
    );
    await expect(
      s2.move({ articleIds: [1], toCategoryId: 7 } as never, MANAGER),
    ).rejects.toMatchObject({
      response: { code: 'MOVE_DESTINATION_INACTIVE' },
    });
  });

  it('บทความที่ถูกลบ/ไม่มี ถูกข้ามอย่างเงียบ (นับเป็น skipped)', async () => {
    const { svc } = make(rows);
    const r = await svc.move(
      { articleIds: [1, 404], toCategoryId: 7, confirmWarnings: true } as never,
      MANAGER,
    );
    expect(r).toMatchObject({ requestedCount: 2, movedCount: 1, skippedCount: 1 });
  });

  it('preview: นับที่จะย้าย/อยู่ปลายทางแล้ว โดยไม่เขียน DB', async () => {
    const { svc, db } = make(rows);
    const p = await svc.preview([1, 2, 3], 7);
    expect(p).toMatchObject({ toMoveCount: 2, alreadyInDestinationCount: 1 });
    expect(db.count(/UPDATE/)).toBe(0);
  });

  it('ชุดใหญ่ (>1000 id) ถูกแบ่งชุดตามขีดจำกัด parameter ของ SQL Server', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ ArticleID: i + 1, CategoryID: 2 }));
    const { svc, db } = make(many);
    const r = await svc.move(
      { articleIds: many.map((m) => m.ArticleID), toCategoryId: 7, confirmWarnings: true } as never,
      MANAGER,
    );
    expect(r.movedCount).toBe(2500);
    for (const c of db.calls) expect(c.params.length).toBeLessThanOrEqual(1002);
  });
});
