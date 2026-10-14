import {
  DashboardService,
  buildMonthSeries,
  monthLabel,
} from '../../../src/modules/kms/dashboard/dashboard.service';
import { ScriptedDb, crudLogHarness } from './sql-script';

describe('dashboard — ชุดเดือน', () => {
  it('monthLabel: เดือนไทยย่อ + พ.ศ.', () => {
    expect(monthLabel(2026, 10)).toBe('ต.ค. 2569');
    expect(monthLabel(2026, 1)).toBe('ม.ค. 2569');
  });

  it('buildMonthSeries: เติม 0 เดือนที่ไม่มี เรียงเก่า→ใหม่ ข้ามปีได้ รวมเดือนปัจจุบัน', () => {
    const now = new Date(2026, 1, 15); // ก.พ. 2026
    const s = buildMonthSeries(
      [
        { year: 2025, month: 12, count: 7 },
        { year: 2026, month: 2, count: 3 },
        { year: 2024, month: 1, count: 99 }, // นอกช่วง ไม่ถูกนับ
      ],
      4,
      now,
    );
    expect(s.map((x) => [x.year, x.month, x.articleCount])).toEqual([
      [2025, 11, 0],
      [2025, 12, 7],
      [2026, 1, 0],
      [2026, 2, 3],
    ]);
    expect(s[1].monthName).toBe('ธ.ค. 2568');
  });
});

describe('DashboardService', () => {
  function make() {
    const db = new ScriptedDb();
    const svc = new DashboardService(crudLogHarness().service, db as never);
    return { svc, db };
  }

  it('stats: คำนวณจากแถวสรุปจริง ไม่นับบทความที่ถูกลบ · bigint ส่งเป็นสตริง', async () => {
    const { svc, db } = make();
    db.when(/COUNT\(\*\) AS Total/, [
      {
        Total: 19000,
        Draft: 10,
        Review: 20,
        Published: 18900,
        Archived: 70,
        Expiring: 4,
        Expired: 2,
        Overdue: 5,
        TotalViews: '9007199254740993',
        TotalLikes: 12,
        AvgLikes: 0.3333,
      },
    ]);
    db.when(/GROUP BY ArticleType/, [
      { ArticleType: 4, Cnt: 18000 },
      { ArticleType: 5, Cnt: 1000 },
      { ArticleType: 9, Cnt: 1 },
    ]);
    const s = await svc.stats();
    expect(s).toMatchObject({
      totalArticles: 19000,
      draftArticles: 10,
      reviewArticles: 20,
      pendingApprovals: 20,
      publishedArticles: 18900,
      archivedArticles: 70,
      expiringArticles: 4,
      expiredArticles: 2,
      overdueReviews: 5,
      totalViews: '9007199254740993',
      averageLikesPublished: 0.33,
    });
    expect(s.byStatus.map((x) => [x.status, x.statusName, x.count])).toEqual([
      [1, 'Draft', 10],
      [2, 'Review', 20],
      [3, 'Published', 18900],
      [4, 'Archived', 70],
    ]);
    expect(s.byType.map((t) => [t.articleType, t.articleTypeName])).toEqual([
      [4, 'แม่แบบ'],
      [5, 'กฎ/นโยบาย'],
      [9, '9'],
    ]);
    for (const c of db.calls) expect(c.sql).toMatch(/IsDelete = 0 OR IsDelete IS NULL/);
  });

  it('stats: ตารางว่าง (ไม่มีแถว) → ศูนย์ทั้งหมด ไม่ throw', async () => {
    const { svc } = make();
    const s = await svc.stats();
    expect(s.totalArticles).toBe(0);
    expect(s.totalViews).toBe('0');
    expect(s.byType).toEqual([]);
  });

  it('monthly: ส่งวันเริ่มต้นเป็น parameter และเติมเดือนที่ไม่มี', async () => {
    const { svc, db } = make();
    db.when(/GROUP BY YEAR\(CreatedDate\)/, [{ Y: 2026, M: 3, N: 8 }]);
    const r = await svc.monthly(3, new Date(2026, 2, 20));
    expect(r.map((x) => x.articleCount)).toEqual([0, 0, 8]);
    expect(db.calls[0].params[0]).toEqual(new Date(2026, 0, 1));
    expect(db.calls[0].sql).not.toContain('2026');
  });

  it('top: เฉพาะ Published เรียงตามยอดอ่าน · จำนวนเป็น parameter', async () => {
    const { svc, db } = make();
    db.when(/SELECT TOP \(@0\)/, [
      {
        ArticleID: 1,
        ArticleCode: 'A',
        Title: 'ก',
        ArticleType: 2,
        CategoryName: 'x',
        ViewCount: 50,
        LikeCount: null,
      },
    ]);
    const r = await svc.top(5);
    expect(r).toEqual([
      expect.objectContaining({
        articleId: 1,
        articleTypeName: 'FAQ',
        viewCount: 50,
        likeCount: 0,
      }),
    ]);
    expect(db.calls[0].params).toEqual([5]);
    expect(db.calls[0].sql).toMatch(/Status = 3/);
  });
});
