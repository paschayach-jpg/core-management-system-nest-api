import {
  ARTICLE_EDITABLE_COLUMNS,
  IMPORT_UPDATABLE_COLUMNS,
  buildArticleUpdate,
  shouldCreateVersion,
} from '../../../src/modules/kms/articles/article-columns';

describe('whitelist คอลัมน์ที่แก้ไข/อัปเดตจาก import', () => {
  it('ไม่มีคอลัมน์ต้องห้าม: ArticleCode, CategoryID, Status, ReviewDueDate, IsOfficialPolicy, CurrentVersion, ViewCount, Created*', () => {
    const forbidden = [
      'ArticleCode',
      'CategoryID',
      'Status',
      'ReviewDueDate',
      'IsOfficialPolicy',
      'CurrentVersion',
      'ViewCount',
      'LikeCount',
      'CreatedBy',
      'CreatedDate',
      'IsDelete',
      'ArticleID',
    ];
    for (const col of forbidden) {
      expect(ARTICLE_EDITABLE_COLUMNS as readonly string[]).not.toContain(col);
      expect(IMPORT_UPDATABLE_COLUMNS as readonly string[]).not.toContain(col);
    }
  });

  it('import ไม่แตะ ExpiryDate / ConfidentialityLevel ส่วน editor แก้ได้', () => {
    expect(IMPORT_UPDATABLE_COLUMNS as readonly string[]).not.toContain('ExpiryDate');
    expect(IMPORT_UPDATABLE_COLUMNS as readonly string[]).not.toContain('ConfidentialityLevel');
    expect(ARTICLE_EDITABLE_COLUMNS as readonly string[]).toContain('ExpiryDate');
    expect(ARTICLE_EDITABLE_COLUMNS as readonly string[]).toContain('ConfidentialityLevel');
  });

  it('buildArticleUpdate: ตั้งเฉพาะคอลัมน์ที่ขอ + UpdatedBy/UpdatedDate เสมอ + ไม่แตะแถวที่ลบแล้ว', () => {
    const { sql, params } = buildArticleUpdate(
      7,
      ['Title', 'ContentHTML'],
      { title: 'มาตรา 1', contentHtml: '<br>' },
      IMPORT_UPDATABLE_COLUMNS,
      'DOM\\x',
      null,
    );
    expect(sql).toBe(
      'UPDATE KMS.t_KBArticle SET Title = @0, ContentHTML = @1, UpdatedBy = @2, UpdatedDate = GETDATE() WHERE ArticleID = @3 AND (IsDelete = 0 OR IsDelete IS NULL)',
    );
    expect(params).toEqual(['มาตรา 1', '<br>', 'DOM\\x', 7]);
    expect(sql).not.toMatch(/CategoryID|ArticleCode|Status|CurrentVersion/);
  });

  it('มี version ใหม่ → ตั้ง CurrentVersion ด้วย', () => {
    const { sql, params } = buildArticleUpdate(
      1,
      ['Title'],
      { title: 'x' },
      IMPORT_UPDATABLE_COLUMNS,
      'u',
      5,
    );
    expect(sql).toContain('CurrentVersion = @1');
    expect(params).toEqual(['x', 5, 'u', 1]);
  });

  it('คอลัมน์นอก whitelist → throw (กัน SQL injection ผ่านชื่อคอลัมน์)', () => {
    for (const bad of ['ArticleCode', 'CategoryID', 'Status; DROP TABLE x', 'Title = 1 --']) {
      expect(() => buildArticleUpdate(1, [bad], {}, IMPORT_UPDATABLE_COLUMNS, 'u', null)).toThrow(
        /ไม่อยู่ในรายการที่เขียนทับได้/,
      );
    }
    // คอลัมน์ที่ editor แก้ได้ แต่ import แก้ไม่ได้
    expect(() =>
      buildArticleUpdate(1, ['ExpiryDate'], {}, IMPORT_UPDATABLE_COLUMNS, 'u', null),
    ).toThrow();
  });

  it('คอลัมน์ซ้ำนับครั้งเดียว · ค่า undefined เขียนเป็น NULL', () => {
    const { sql, params } = buildArticleUpdate(
      1,
      ['Summary', 'Summary'],
      {},
      ARTICLE_EDITABLE_COLUMNS,
      'u',
      null,
    );
    expect(sql.match(/Summary/g)).toHaveLength(1);
    expect(params[0]).toBeNull();
  });

  it('shouldCreateVersion: เฉพาะเมื่อ ContentHTML ต่างกันแบบ ordinal (null = ว่าง)', () => {
    expect(shouldCreateVersion('<br>a', '<br>a')).toBe(false);
    expect(shouldCreateVersion('a', 'A')).toBe(true);
    expect(shouldCreateVersion('a ', 'a')).toBe(true);
    expect(shouldCreateVersion(null, '')).toBe(false);
    expect(shouldCreateVersion(undefined, 'x')).toBe(true);
  });
});
