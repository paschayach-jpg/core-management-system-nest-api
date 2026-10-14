import { ArticleLinksService } from '../../../src/modules/kms/articles/article-links.service';
import { FakeTx, MANAGER, ScriptedDb, crudLogHarness } from './sql-script';

function make(
  opts: { status?: number; isDelete?: number; existing?: string[]; targets?: number[] } = {},
) {
  const db = new ScriptedDb();
  const tx = new FakeTx(db);
  const log = crudLogHarness();
  db.when(/SELECT ArticleID, ArticleCode, Status, IsDelete FROM KMS\.t_KBArticle/, [
    { ArticleID: 1, ArticleCode: 'X', Status: opts.status ?? 1, IsDelete: opts.isDelete ?? 0 },
  ]);
  db.when(/SELECT ArticleID FROM KMS\.t_KBArticle[\s\S]*IN \(/, (_s, params) =>
    (params as number[])
      .filter((id) => (opts.targets ?? [2, 3, 4, 5]).includes(id))
      .map((id) => ({ ArticleID: id })),
  );
  db.when(
    /SELECT EntityID FROM KMS\.t_KBArticleLink/,
    (opts.existing ?? []).map((e) => ({ EntityID: e })),
  );
  db.when(/IF NOT EXISTS \(SELECT 1 FROM KMS\.t_KBArticleLink/, [{ Inserted: 1 }]);
  db.when(/FROM KMS\.t_KBArticleLink l\s+JOIN/, []);
  const svc = new ArticleLinksService(log.service, db as never, tx as never);
  return { svc, db, tx, log };
}

const inserts = (db: ScriptedDb) =>
  db.find(/IF NOT EXISTS \(SELECT 1 FROM KMS\.t_KBArticleLink/).map((c) => c.params.slice(0, 3));

describe('ArticleLinksService — link Law สองทาง', () => {
  it('link: เพิ่มทั้ง A→B และ B→A (EntityType 4)', async () => {
    const { svc, db } = make();
    await svc.link(1, 2, MANAGER);
    expect(inserts(db)).toEqual([
      [1, 4, '2'],
      [2, 4, '1'],
    ]);
  });

  it('link ตัวเอง = 422 · ปลายทางไม่มี/ถูกลบ = 422 LINK_TARGET_NOT_FOUND', async () => {
    const { svc } = make();
    await expect(svc.link(1, 1, MANAGER)).rejects.toMatchObject({
      response: { code: 'LINK_SELF' },
    });
    await expect(svc.link(1, 99, MANAGER)).rejects.toMatchObject({
      response: { code: 'LINK_TARGET_NOT_FOUND', details: { missing: [99] } },
    });
  });

  it('บทความต้นทาง Archived แก้ link ไม่ได้ · ถูกลบ = 404', async () => {
    await expect(make({ status: 4 }).svc.link(1, 2, MANAGER)).rejects.toMatchObject({
      response: { code: 'ARTICLE_ARCHIVED' },
    });
    await expect(make({ isDelete: 1 }).svc.unlink(1, 2)).rejects.toMatchObject({ status: 404 });
  });

  it('unlink: ลบทั้งสองทางด้วยคำสั่งเดียว', async () => {
    const { svc, db } = make();
    await svc.unlink(1, 2);
    const del = db.find(/DELETE FROM KMS\.t_KBArticleLink/)[0];
    expect(del.params).toEqual([1, '2', 2, '1']);
    expect(del.sql).toMatch(/EntityType = 4/);
  });

  it('setRelated: ตัวที่หายไปถูกยกเลิกสองทาง · ตัวใหม่ผูกสองทาง · ตัวที่เหลือซ่อมสองทาง', async () => {
    // ปัจจุบัน 1 ผูกกับ 2 และ 3 · ชุดใหม่ = {3, 4}
    const { svc, db, tx } = make({ existing: ['2', '3'] });
    await svc.setRelated(1, [3, 4, 4, 1, 0, -2], MANAGER);
    expect(tx.runs).toBe(1);
    const dels = db.find(/DELETE FROM KMS\.t_KBArticleLink/);
    expect(dels).toHaveLength(1);
    expect(dels[0].params).toEqual([1, '2', 2, '1']); // เอา 2 ออก
    expect(inserts(db)).toEqual([
      [1, 4, '3'],
      [3, 4, '1'],
      [1, 4, '4'],
      [4, 4, '1'],
    ]);
  });

  it('setRelated: EntityID ที่ไม่ใช่เลข (ข้อมูลเก่าเสีย) ลบเฉพาะแถวนั้น ไม่ลบสองทางมั่ว', async () => {
    const { svc, db } = make({ existing: ['abc'] });
    await svc.setRelated(1, [], MANAGER);
    const dels = db.find(/DELETE FROM KMS\.t_KBArticleLink/);
    expect(dels).toHaveLength(1);
    expect(dels[0].params).toEqual([1, 'abc']);
  });

  it('setRelated: ปลายทางไม่มี → rollback ไม่แตะ link เดิม', async () => {
    const { svc, db, tx } = make({ existing: ['2'] });
    await expect(svc.setRelated(1, [99], MANAGER)).rejects.toMatchObject({
      response: { code: 'LINK_TARGET_NOT_FOUND' },
    });
    expect(tx.rolledBack).toBe(1);
    expect(db.count(/DELETE FROM KMS\.t_KBArticleLink/)).toBe(0);
  });

  it('CRUD-log: ชื่อ operation ของ link/unlink/save', async () => {
    const { svc, log } = make();
    await svc.link(1, 2, MANAGER);
    await svc.unlink(1, 2);
    await svc.setRelated(1, [], MANAGER);
    const ev = await log.events();
    expect(ev.map((e) => [e.entity, e.operation, e.success])).toEqual([
      ['KbArticleLink', 'LINK_KB_ARTICLES', true],
      ['KbArticleLink', 'UNLINK_KB_ARTICLES', true],
      ['KbArticleLink', 'SAVE_KB_ARTICLE_LINKS', true],
    ]);
  });
});
