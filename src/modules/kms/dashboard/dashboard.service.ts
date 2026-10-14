import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { KB_STATUS_NAME } from '../articles/article-status';
import type {
  KbDashboardStatsDto,
  KbMonthlyArticleDto,
  KbTopArticleDto,
} from './dto/dashboard.dto';

type Row = Record<string, unknown>;

export const ARTICLE_TYPE_NAME: Record<number, string> = {
  1: 'ขั้นตอนงาน',
  2: 'FAQ',
  3: 'แนวทางปฏิบัติ',
  4: 'แม่แบบ',
  5: 'กฎ/นโยบาย',
};

const THAI_MONTH_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

/** ป้ายเดือน "ต.ค. 2569" (พ.ศ.) */
export function monthLabel(year: number, month: number): string {
  return `${THAI_MONTH_SHORT[month - 1]} ${year + 543}`;
}

/**
 * เติมเดือนที่ไม่มีบทความเป็น 0 ให้ครบ `months` เดือนล่าสุด (รวมเดือนปัจจุบัน) เรียงจากเก่าไปใหม่
 * @param now เวลาปัจจุบัน (ส่งเข้ามาเพื่อให้เทสต์ได้)
 */
export function buildMonthSeries(
  counts: { year: number; month: number; count: number }[],
  months: number,
  now: Date,
): KbMonthlyArticleDto[] {
  const byKey = new Map(counts.map((c) => [`${c.year}-${c.month}`, c.count]));
  const out: KbMonthlyArticleDto[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    out.push({
      year,
      month,
      monthName: monthLabel(year, month),
      articleCount: byKey.get(`${year}-${month}`) ?? 0,
    });
  }
  return out;
}

/**
 * ตัวเลขหน้า Dashboard ของ KMS — ระบบเดิมเป็น mock (KBDashboardRepository คืนค่าคงที่) จึงนิยาม query จริงใหม่จาก KMS.t_KBArticle
 * (ไม่นับบทความที่ถูกลบ) · "ยอดอ่านรายเดือน"/"คะแนนเฉลี่ย" ของ mock ทำจริงไม่ได้เพราะไม่มีประวัติรายวัน/คะแนน → ให้ยอดสะสมและค่าเฉลี่ย LikeCount แทน
 */
@Injectable()
export class DashboardService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbDashboard';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {
    super(crudLog);
  }

  async stats(): Promise<KbDashboardStatsDto> {
    const notDeleted = '(IsDelete = 0 OR IsDelete IS NULL)';
    const [agg]: Row[] = await this.ds.query(
      `SELECT COUNT(*) AS Total,
              SUM(CASE WHEN Status = 1 THEN 1 ELSE 0 END) AS Draft,
              SUM(CASE WHEN Status = 2 THEN 1 ELSE 0 END) AS Review,
              SUM(CASE WHEN Status = 3 THEN 1 ELSE 0 END) AS Published,
              SUM(CASE WHEN Status = 4 THEN 1 ELSE 0 END) AS Archived,
              SUM(CASE WHEN Status = 3 AND ExpiryDate IS NOT NULL AND ExpiryDate > GETDATE()
                        AND ExpiryDate <= DATEADD(DAY, 30, GETDATE()) THEN 1 ELSE 0 END) AS Expiring,
              SUM(CASE WHEN Status = 3 AND ExpiryDate IS NOT NULL AND ExpiryDate <= GETDATE() THEN 1 ELSE 0 END) AS Expired,
              SUM(CASE WHEN Status = 3 AND ReviewDueDate IS NOT NULL AND ReviewDueDate < GETDATE() THEN 1 ELSE 0 END) AS Overdue,
              SUM(CAST(ISNULL(ViewCount, 0) AS BIGINT)) AS TotalViews,
              SUM(CAST(ISNULL(LikeCount, 0) AS BIGINT)) AS TotalLikes,
              AVG(CASE WHEN Status = 3 THEN CAST(ISNULL(LikeCount, 0) AS DECIMAL(18, 2)) END) AS AvgLikes
         FROM KMS.t_KBArticle WHERE ${notDeleted}`,
    );
    const types: Row[] = await this.ds.query(
      `SELECT ArticleType, COUNT(*) AS Cnt FROM KMS.t_KBArticle WHERE ${notDeleted} GROUP BY ArticleType ORDER BY ArticleType`,
    );

    const a = camelizeKeys<Row>(agg ?? {});
    const n = (v: unknown) => Number(v ?? 0);
    const status = [1, 2, 3, 4].map((s) => ({
      status: s,
      statusName: KB_STATUS_NAME[s],
      count: n([a.draft, a.review, a.published, a.archived][s - 1]),
    }));
    return {
      totalArticles: n(a.total),
      draftArticles: n(a.draft),
      reviewArticles: n(a.review),
      publishedArticles: n(a.published),
      archivedArticles: n(a.archived),
      pendingApprovals: n(a.review),
      expiringArticles: n(a.expiring),
      expiredArticles: n(a.expired),
      overdueReviews: n(a.overdue),
      totalViews: String(a.totalViews ?? 0),
      totalLikes: String(a.totalLikes ?? 0),
      averageLikesPublished: Math.round(n(a.avgLikes) * 100) / 100,
      byStatus: status,
      byType: types.map((t) => {
        const r = camelizeKeys<Row>(t);
        return {
          articleType: n(r.articleType),
          articleTypeName: ARTICLE_TYPE_NAME[n(r.articleType)] ?? String(r.articleType),
          count: n(r.cnt),
        };
      }),
      lastUpdated: new Date(),
    };
  }

  /** จำนวนบทความที่สร้างต่อเดือนใน `months` เดือนล่าสุด (เติม 0 ให้เดือนที่ไม่มี) */
  async monthly(months = 12, now = new Date()): Promise<KbMonthlyArticleDto[]> {
    const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const rows: { Y: number; M: number; N: number }[] = await this.ds.query(
      `SELECT YEAR(CreatedDate) AS Y, MONTH(CreatedDate) AS M, COUNT(*) AS N
         FROM KMS.t_KBArticle
        WHERE (IsDelete = 0 OR IsDelete IS NULL) AND CreatedDate >= @0
        GROUP BY YEAR(CreatedDate), MONTH(CreatedDate)`,
      [from],
    );
    return buildMonthSeries(
      rows.map((r) => ({ year: Number(r.Y), month: Number(r.M), count: Number(r.N) })),
      months,
      now,
    );
  }

  /** บทความ Published ที่มียอดเปิดอ่านสูงสุด */
  async top(limit = 10): Promise<KbTopArticleDto[]> {
    const rows: Row[] = await this.ds.query(
      `SELECT TOP (@0) a.ArticleID, a.ArticleCode, a.Title, a.ArticleType, c.CategoryName, a.ViewCount, a.LikeCount
         FROM KMS.t_KBArticle a LEFT JOIN KMS.m_KBCategory c ON c.CategoryID = a.CategoryID
        WHERE a.Status = 3 AND (a.IsDelete = 0 OR a.IsDelete IS NULL)
        ORDER BY a.ViewCount DESC, a.ArticleID`,
      [limit],
    );
    return rows.map((raw) => {
      const r = camelizeKeys<Row>(raw);
      return {
        articleId: Number(r.articleId),
        articleCode: String(r.articleCode),
        title: String(r.title),
        articleType: Number(r.articleType),
        articleTypeName: ARTICLE_TYPE_NAME[Number(r.articleType)] ?? String(r.articleType),
        categoryName: (r.categoryName as string | null) ?? null,
        viewCount: Number(r.viewCount ?? 0),
        likeCount: Number(r.likeCount ?? 0),
      };
    });
  }
}
