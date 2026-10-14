import {
  ARTICLE_SORT_WHITELIST,
  SqlParams,
  buildArticleWhere,
  buildKeywordPredicate,
  normalizeKeyword,
} from '../../../src/modules/kms/articles/article-query';

describe('article-query', () => {
  it('normalizeKeyword ตัดช่องว่างทุกชนิด (ระบบเดิมค้นแบบไม่สนช่องว่าง)', () => {
    expect(normalizeKeyword(' ผู้ ถือ\tหุ้น\n ')).toBe('ผู้ถือหุ้น');
    expect(normalizeKeyword(undefined)).toBe('');
  });

  it('ไม่มีคำค้น → ไม่มี predicate · ไม่เพิ่ม parameter', () => {
    const p = new SqlParams();
    expect(buildKeywordPredicate('   ', 'all', p)).toBeNull();
    expect(p.values).toEqual([]);
  });

  it('คำค้นเป็น parameter เสมอ ไม่ถูกต่อเข้า SQL · escape wildcard ของ LIKE', () => {
    const p = new SqlParams();
    const sql = buildKeywordPredicate("100%_[x]'; DROP TABLE a;--", 'title', p) as string;
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('@0');
    expect(p.values).toHaveLength(1);
    const v = String(p.values[0]);
    expect(v).toContain('DROPTABLEa'); // อยู่ใน parameter ได้ (ช่องว่างถูกตัดตามกฎค้นแบบไม่สนช่องว่าง)
    expect(v).toMatch(/\\%|\[%\]/); // % ถูก escape
  });

  it('ทุกฟิลด์ (all): OR ของ code/title/tags/titleCategory/summary/content และใช้ parameter เดียว', () => {
    const p = new SqlParams();
    const sql = buildKeywordPredicate('มาตรา', 'all', p) as string;
    for (const col of [
      'a.ArticleCode',
      'a.Title',
      'a.Tags',
      'a.TitleCategory',
      'a.Summary',
      'a.ContentHTML',
    ])
      expect(sql).toContain(col);
    expect(sql.match(/ OR /g)).toHaveLength(5);
    expect(p.values).toHaveLength(1);
  });

  it('ค้นเนื้อหา: ตัด <br> และ &nbsp; ก่อนเทียบ เพื่อให้ข้อความข้ามบรรทัดเจอ', () => {
    const p = new SqlParams();
    const sql = buildKeywordPredicate('x', 'content', p) as string;
    expect(sql).toContain("N'&nbsp;'");
    expect(sql).toContain("N'<br>'");
  });

  it('buildArticleWhere: ไม่รวมบทความที่ถูกลบเสมอ · เติมเงื่อนไขตามที่ขอ ด้วย parameter ทั้งหมด', () => {
    const p = new SqlParams();
    const where = buildArticleWhere(
      {
        status: 3,
        articleType: 4,
        title: "มาตรา 1'; --",
        ids: [5, 6],
        q: 'ภาษี',
        searchField: 'title',
      },
      [2, 3, 4],
      p,
    );
    expect(where).toContain('(a.IsDelete = 0 OR a.IsDelete IS NULL)');
    expect(where).toContain('a.CategoryID IN (@0,@1,@2)');
    expect(where).toContain('a.Status = @3');
    expect(where).toContain('a.ArticleType = @4');
    expect(where).toContain('a.Title = @5');
    expect(where).toContain('a.ArticleID IN (@6,@7)');
    expect(where).not.toContain("'; --");
    expect(p.values.slice(0, 8)).toEqual([2, 3, 4, 3, 4, "มาตรา 1'; --", 5, 6]);
  });

  it('รายการหมวด/ids ว่าง = ไม่มีผลลัพธ์ (1 = 0) ไม่ใช่ทุกแถว', () => {
    expect(buildArticleWhere({ ids: [] }, [], new SqlParams())).toContain('1 = 0');
    expect(buildArticleWhere({}, [], new SqlParams())).toContain('1 = 0');
    expect(buildArticleWhere({}, null, new SqlParams())).not.toContain('1 = 0');
  });

  it('sort whitelist: เป็นนิพจน์คอลัมน์ที่รู้จัก ไม่มีอักขระที่ใช้ฉีด SQL', () => {
    for (const expr of Object.values(ARTICLE_SORT_WHITELIST))
      expect(expr).toMatch(/^[a-z]\.[A-Za-z]+$/);
    expect(Object.prototype.hasOwnProperty.call(ARTICLE_SORT_WHITELIST, 'constructor')).toBe(false);
  });
});
