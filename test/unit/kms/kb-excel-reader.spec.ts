import {
  readImportRows,
  KbExcelReadError,
  resolveTemplateExpression,
  columnLetterToIndex,
  columnIndexToLetters,
} from '../../../src/modules/kms/import/kb-excel-reader';
import type { TemplateColumnRow } from '../../../src/modules/kms/import/kb-import-row';
import { lawCode, nonLawCode } from './kms-fixtures';
import { LAW_HEADER, NONLAW_HEADER, gridOf, lawRow, nonLawRow } from './xlsx-helper';

const t = (target: string, ref: string | null): TemplateColumnRow => ({
  targetColumnName: target,
  excelColumnRef: ref,
});
const lawTemplate = [t('ArticleCode', 'A'), t('LayoutType', 'Law'), t('ArticleType', '5')];
const nonLawTemplate = [
  t('ArticleCode', 'A'),
  t('Title', 'E'),
  t('TitleCategory', 'F'),
  t('PublishedDate', 'G'),
  t('EffectiveDate', 'H'),
  t('ContentHTML', 'I'),
  t('Summary', 'J'),
  t('Attachment', 'K'),
  t('LayoutType', 'NonLaw'),
  t('ArticleType', '3'),
];

const ymd = (d: Date | null) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null);

describe('readImportRows — ไฟล์กฎหมาย', () => {
  const code1 = lawCode('PVI00', '0110', '535');
  const code2 = lawCode('PVI00', '0111', '535');

  it('ตรวจชนิด Law จาก Code รวมแถวแรก และอ่านคอลัมน์ตามตำแหน่งตายตัว (M N O P S)', async () => {
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({
        code: code1,
        summary: ' ชื่อ ',
        published: '9/4/2535',
        effective: '1 ม.ค. 2536',
        content: '  บรรทัด 1\nบรรทัด 2 ',
        titleCategory: 'พ.ร.บ.\nประกัน',
      }),
      lawRow({ code: code2, content: 'x' }),
    ]);
    const r = readImportRows(grid, lawTemplate);
    expect(r.detectedLayout).toBe('Law');
    expect(r.mappingProblems).toEqual([]);
    expect(r.rows).toHaveLength(2);

    const row = r.rows[0];
    expect(row).toMatchObject({
      rowNumber: 2,
      rowKind: 'Law',
      colA: code1,
      codeIndex: 1,
      codeCount: 1,
      rawLawReference: null,
      attachmentFileName: null,
    });
    // ข้อความล้วนไม่ trim (เก็บเว้นวรรค/ขึ้นบรรทัดใหม่ตามต้นฉบับ)
    expect(row.rawSummary).toBe(' ชื่อ ');
    expect(row.rawContent).toBe('  บรรทัด 1\nบรรทัด 2 ');
    expect(row.rawTitleCategory).toBe('พ.ร.บ.\nประกัน');
    // วันที่ trim แล้วแปลง
    expect(row.rawPublishedDate).toBe('9/4/2535');
    expect(ymd(row.publishedDateParsed)).toEqual([1992, 4, 9]);
    expect(ymd(row.effectiveDateParsed)).toEqual([1993, 1, 1]);
    expect(r.rows[1].rowNumber).toBe(3);
  });

  it('เซลล์วันที่แบบ native (Date) ใช้ได้ และปี พ.ศ. ที่พิมพ์ลงช่องวันที่ถูกแก้เป็น ค.ศ.', async () => {
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({
        code: code1,
        published: new Date(Date.UTC(2020, 5, 30)),
        effective: new Date(Date.UTC(2535, 3, 9)),
        content: 'x',
      }),
    ]);
    const row = readImportRows(grid, lawTemplate).rows[0];
    expect(ymd(row.publishedDateParsed)).toEqual([2020, 6, 30]);
    expect(ymd(row.effectiveDateParsed)).toEqual([1992, 4, 9]);
    expect(row.rawPublishedDate).toBe('30/06/2020');
  });

  it('Template mapping ทับตำแหน่งตายตัว (Title/Summary/ContentHTML จากคอลัมน์ที่เลือก)', async () => {
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({
        code: code1,
        summary: 'จาก M',
        content: 'จาก P',
        extra: { 3: 'จาก D', 4: 'เนื้อหาจาก E' },
      }),
    ]);
    const r = readImportRows(grid, [
      ...lawTemplate,
      t('Summary', 'D'),
      t('ContentHTML', 'E'),
      t('Title', 'A'),
    ]);
    expect(r.rows[0].rawSummary).toBe('จาก D');
    expect(r.rows[0].rawContent).toBe('เนื้อหาจาก E');
    expect(r.rows[0].rawTitle).toBe(code1);
  });

  it('ข้ามแถวว่างทั้งแถว (แต่ RowNumber ยังนับตามแถว Excel จริง)', async () => {
    const grid = await gridOf([LAW_HEADER, lawRow({ code: code1 }), [], lawRow({ code: code2 })]);
    const rows = readImportRows(grid, lawTemplate).rows;
    expect(rows.map((x) => x.rowNumber)).toEqual([2, 4]);
  });

  it('ไฟล์ไม่มีแถวข้อมูล → ไม่มี layout ไม่มีแถว (ไม่ error)', async () => {
    const r = readImportRows(await gridOf([LAW_HEADER]), lawTemplate);
    expect(r.detectedLayout).toBeNull();
    expect(r.rows).toEqual([]);
  });
});

describe('readImportRows — พระราชกฤษฎีกา', () => {
  it('Code ตัวที่ 4-5 ไม่ใช่ 00 → detectedLayout = Decree แต่อ่านแถวแบบ Law และเก็บ rawLawReference', async () => {
    const decree = lawCode('ETR01', '0003', '540');
    const ref = `ETR00\n${lawCode('PVI00', '0029', '535').substring(0, 24)}`;
    const grid = await gridOf([
      [...LAW_HEADER, 'อ้างอิง'],
      [...lawRow({ code: decree, content: 'เนื้อหา' }), ref],
    ]);
    const r = readImportRows(grid, [...lawTemplate, t('LawReference', 'U')]);
    expect(r.detectedLayout).toBe('Decree');
    expect(r.rows[0].rowKind).toBe('Law');
    expect(r.rows[0].rawLawReference).toBe(ref);
  });
});

describe('readImportRows — ไฟล์ที่ไม่ใช่กฎหมาย', () => {
  const parent = lawCode('PVI00', '0110', '535').substring(0, 24);
  const c1 = nonLawCode(parent, '2', '0001');
  const c2 = nonLawCode(parent, '2', '0002');

  it('อ่านทุกฟิลด์จาก Template mapping และตรวจชนิด NonLaw', async () => {
    const grid = await gridOf([
      NONLAW_HEADER,
      nonLawRow({
        code: c1,
        title: ' คำสั่งที่ 1 ',
        titleCategory: '1/2535',
        published: '9/4/2535',
        content: 'เนื้อหา',
        summary: 'สรุป',
        file: 'a.pdf',
      }),
    ]);
    const r = readImportRows(grid, nonLawTemplate);
    expect(r.detectedLayout).toBe('NonLaw');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      rowKind: 'NonLaw',
      colA: c1,
      rawTitle: ' คำสั่งที่ 1 ', // ไม่ trim
      rawTitleCategory: '1/2535',
      rawContent: 'เนื้อหา',
      rawSummary: 'สรุป',
      attachmentFileName: 'a.pdf',
    });
    expect(ymd(r.rows[0].publishedDateParsed)).toEqual([1992, 4, 9]);
  });

  it('เซลล์ Code รวมที่มีหลาย Code (บรรทัดละ 1 Code) → แตกเป็น 1 แถวต่อ Code ใช้ RowNumber เดียวกัน', async () => {
    const grid = await gridOf([
      NONLAW_HEADER,
      nonLawRow({ code: `${c1}\n${c2}\n\n`, title: 'ชื่อ', content: 'x', file: 'a.pdf' }),
    ]);
    const rows = readImportRows(grid, nonLawTemplate).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => [x.colA, x.codeIndex, x.codeCount, x.rowNumber])).toEqual([
      [c1, 1, 2, 2],
      [c2, 2, 2, 2],
    ]);
    expect(rows[1].rawTitle).toBe('ชื่อ');
    expect(rows[0]).not.toBe(rows[1]);
    expect(rows[0].parentCodes).not.toBe(rows[1].parentCodes);
  });

  it('hyperlink ของเซลล์ไฟล์แนบถูกอ่านเก็บไว้ (ไม่ถูกใช้ค้นไฟล์)', async () => {
    const grid = await gridOf([
      NONLAW_HEADER,
      nonLawRow({
        code: c1,
        title: 't',
        content: 'c',
        file: { text: 'a.pdf', hyperlink: 'http://x/a.pdf' },
      }),
    ]);
    const row = readImportRows(grid, nonLawTemplate).rows[0];
    expect(row.attachmentFileName).toBe('a.pdf');
    expect(row.attachmentUrl).toBe('http://x/a.pdf');
  });

  it('Code รวมเป็นสูตรที่ Excel เก็บค่าที่คำนวณไว้ → อ่านค่า result ได้', async () => {
    const grid = await gridOf([
      NONLAW_HEADER,
      nonLawRow({
        code: { formula: 'B2&D2', result: c1 },
        title: 't',
        content: 'c',
        file: 'a.pdf',
      }),
    ]);
    const r = readImportRows(grid, nonLawTemplate);
    expect(r.detectedLayout).toBe('NonLaw');
    expect(r.rows[0].colA).toBe(c1);
  });

  it('สูตรที่ไม่มีค่าที่คำนวณไว้ → error บอกให้เปิดด้วย Excel แล้วบันทึกซ้ำ', async () => {
    const grid = await gridOf([
      NONLAW_HEADER,
      nonLawRow({ code: { formula: 'B2&D2' }, title: 't', content: 'c' }),
    ]);
    expect(() => readImportRows(grid, nonLawTemplate)).toThrow(/บันทึกซ้ำ/);
  });
});

describe('readImportRows — ข้อผิดพลาดระดับไฟล์', () => {
  it('Template ไม่ map ArticleCode → KbExcelReadError', async () => {
    const grid = await gridOf([LAW_HEADER, lawRow({ code: lawCode('PVI00', '0001', '535') })]);
    expect(() => readImportRows(grid, [t('LayoutType', 'Law')])).toThrow(KbExcelReadError);
    expect(() => readImportRows(grid, [t('LayoutType', 'Law')])).toThrow(
      /ไม่ได้ map คอลัมน์ ArticleCode/,
    );
  });

  it('Code รวมแถวแรกผิดรูปแบบ → error บอกแถวและความยาว พร้อมรูปแบบที่ถูก', async () => {
    const grid = await gridOf([LAW_HEADER, lawRow({ code: 'PVI0001' })]);
    try {
      readImportRows(grid, lawTemplate);
      fail('ต้อง throw');
    } catch (e) {
      expect(e).toBeInstanceOf(KbExcelReadError);
      expect((e as Error).message).toContain('แถว 2');
      expect((e as Error).message).toContain('ยาว 7 ตัว');
      expect((e as Error).message).toContain('• กฎหมาย');
      expect((e as Error).message).toContain('• พระราชกฤษฎีกา');
    }
  });

  it('มีข้อมูลแต่ไม่มี Code รวมเลย → error', async () => {
    const grid = await gridOf([LAW_HEADER, lawRow({ code: '', content: 'x' })]);
    expect(() => readImportRows(grid, lawTemplate)).toThrow(/ไม่พบ Code รวม/);
  });

  it('Code แถวแรกว่าง ใช้ Code ของแถวที่สองตัดสินชนิด (แถวแรกกลายเป็นแถว Error ในขั้น validate)', async () => {
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({ code: '', content: 'x' }),
      lawRow({ code: lawCode('PVI00', '0002', '535') }),
    ]);
    const r = readImportRows(grid, lawTemplate);
    expect(r.detectedLayout).toBe('Law');
    expect(r.rows).toHaveLength(2);
  });
});

describe('readImportRows — mapping ที่ไม่ตรงกับไฟล์', () => {
  it('คอลัมน์เกินความกว้างของไฟล์ และหัวตารางที่ไม่มี → รายงานล่วงหน้า', async () => {
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({ code: lawCode('PVI00', '0001', '535'), content: 'x' }),
    ]);
    const r = readImportRows(grid, [
      ...lawTemplate,
      t('Summary', 'Z'),
      t('TitleCategory', 'ไม่มีหัวนี้'),
      t('ContentHTML', '{P} {ZZ}'),
    ]);
    expect(r.mappingProblems).toHaveLength(3);
    expect(r.mappingProblems[0]).toContain(
      'Summary → "Z": ไม่พบคอลัมน์นี้ในไฟล์ (ไฟล์มี 20 คอลัมน์: A–T)',
    );
    expect(r.mappingProblems[1]).toContain('TitleCategory → "ไม่มีหัวนี้": ไม่พบหัวตารางนี้ในไฟล์');
    expect(r.mappingProblems[2]).toContain('"ZZ"');
  });

  it('map ด้วยชื่อหัวตารางได้ (ไม่สนตัวพิมพ์) และไม่ถือเป็นปัญหา', async () => {
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({ code: lawCode('PVI00', '0001', '535'), content: 'เนื้อหา' }),
    ]);
    const r = readImportRows(grid, [...lawTemplate, t('ContentHTML', 'บัญญัติไว้ว่า')]);
    expect(r.mappingProblems).toEqual([]);
    expect(r.rows[0].rawContent).toBe('เนื้อหา');
  });
});

describe('resolveTemplateExpression — นิพจน์ {X}', () => {
  const header = [
    { text: 'A', date: null, hyperlink: null },
    { text: 'B', date: null, hyperlink: null },
    { text: 'C', date: null, hyperlink: null },
  ];
  const cell = (text: string) => ({ text, date: null, hyperlink: null });
  const data = [cell('x'), cell(' ข้อความ '), cell('0001')];

  it('ref ตรง: คืน raw text (ไม่ normalize เลขศูนย์นำหน้า) และ trim ตามค่าเริ่มต้น', () => {
    expect(resolveTemplateExpression('C', header, data)).toBe('0001');
    expect(resolveTemplateExpression('B', header, data)).toBe('ข้อความ');
    expect(resolveTemplateExpression('B', header, data, true)).toBe(' ข้อความ ');
  });

  it('สูตร {X}: แทน token และ normalize ตัวเลขล้วน ("0001" → "1")', () => {
    expect(resolveTemplateExpression('มาตรา {C}', header, data)).toBe('มาตรา 1');
    expect(resolveTemplateExpression('{A}-{C}', header, data)).toBe('x-1');
  });

  it('ตัวเลขใหญ่กว่า int32 ไม่ถูก normalize · ref ที่หาไม่เจอ = ว่าง', () => {
    expect(
      resolveTemplateExpression('{C}', header, [cell(''), cell(''), cell('99999999999')]),
    ).toBe('99999999999');
    expect(resolveTemplateExpression('Q', header, data)).toBe('');
    expect(resolveTemplateExpression('', header, data)).toBe('');
  });

  it('แปลงตัวอักษรคอลัมน์ ↔ index', () => {
    expect(columnLetterToIndex('A')).toBe(0);
    expect(columnLetterToIndex('Z')).toBe(25);
    expect(columnLetterToIndex('AA')).toBe(26);
    expect(columnLetterToIndex('A1')).toBe(-1);
    expect(columnIndexToLetters(26)).toBe('AA');
    expect(columnIndexToLetters(19)).toBe('T');
  });
});
