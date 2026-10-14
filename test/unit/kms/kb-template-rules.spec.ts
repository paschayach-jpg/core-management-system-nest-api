import type { TemplateColumnRow } from '../../../src/modules/kms/import/kb-import-row';
import {
  getTemplateProblems,
  hasAttachmentMapping,
  resolveArticleType,
  resolveTemplateLayout,
  validateFormulaSyntax,
} from '../../../src/modules/kms/import-templates/kb-template-rules';

const t = (target: string, ref: string | null): TemplateColumnRow => ({
  targetColumnName: target,
  excelColumnRef: ref,
});
const base = (layout: string) => [
  t('LayoutType', layout),
  t('ArticleType', '5'),
  t('ArticleCode', 'A'),
];

describe('getTemplateProblems — กฎตรวจ Template (ใช้ทั้งตอนบันทึกและตอน import)', () => {
  it('Law ที่ครบ → ไม่มีปัญหา', () => {
    expect(getTemplateProblems(base('Law'))).toEqual([]);
  });

  it('ขาดประเภทไฟล์ / ArticleType / ArticleCode → รายงานทุกข้อพร้อมกัน', () => {
    const p = getTemplateProblems([]);
    expect(p).toEqual([
      'ยังไม่ได้เลือกประเภทไฟล์ (LayoutType: กฎหมาย / พระราชกฤษฎีกา / ไม่ใช่กฎหมาย)',
      'ยังไม่ได้เลือกประเภทบทความ (ArticleType)',
      'ยังไม่ได้ Map คอลัมน์ ArticleCode (Code รวม)',
    ]);
    expect(getTemplateProblems(null)).toEqual(['ไม่พบข้อมูล mapping ของ Template']);
  });

  it('LayoutType ที่ไม่รู้จัก = ยังไม่ได้เลือก · ArticleType ต้อง 1-5', () => {
    expect(
      getTemplateProblems([
        t('LayoutType', 'XYZ'),
        t('ArticleType', '5'),
        t('ArticleCode', 'A'),
      ])[0],
    ).toContain('ยังไม่ได้เลือกประเภทไฟล์');
    expect(
      getTemplateProblems([t('LayoutType', 'Law'), t('ArticleType', '9'), t('ArticleCode', 'A')]),
    ).toEqual(['ประเภทบทความ (ArticleType) ต้องเป็นตัวเลข 1-5']);
  });

  it('NonLaw ต้อง map Title, ContentHTML, Attachment', () => {
    expect(getTemplateProblems(base('NonLaw'))).toEqual([
      'Template ที่ไม่ใช่กฎหมายต้อง Map คอลัมน์ Title',
      'Template ที่ไม่ใช่กฎหมายต้อง Map คอลัมน์ ContentHTML',
      'Template ที่ไม่ใช่กฎหมายต้อง Map คอลัมน์ Attachment',
    ]);
    expect(
      getTemplateProblems([
        ...base('NonLaw'),
        t('Title', 'E'),
        t('ContentHTML', 'I'),
        t('Attachment', 'K'),
      ]),
    ).toEqual([]);
  });

  it('Decree ต้อง map LawReference · Law/NonLaw ห้าม map', () => {
    expect(getTemplateProblems(base('Decree'))).toEqual([
      'Template ประเภทพระราชกฤษฎีกาต้อง Map คอลัมน์ LawReference (Code กฎหมายอ้างอิง)',
    ]);
    expect(getTemplateProblems([...base('Decree'), t('LawReference', 'U')])).toEqual([]);
    expect(getTemplateProblems([...base('Law'), t('LawReference', 'U')])[0]).toContain(
      'ใช้ได้เฉพาะ Template ประเภทพระราชกฤษฎีกา',
    );
  });

  it('ห้าม map คอลัมน์ Excel ซ้ำ ยกเว้นสูตรและค่าคงที่ (LayoutType/ArticleType)', () => {
    const dup = getTemplateProblems([...base('Law'), t('Title', 'C'), t('Summary', 'c')]);
    expect(dup).toEqual(['มีการ Map คอลัมน์ Excel ซ้ำกัน: C']);
    expect(
      getTemplateProblems([...base('Law'), t('Title', 'มาตรา {C}'), t('Summary', '{C}')]),
    ).toEqual([]);
    expect(
      getTemplateProblems([
        t('LayoutType', 'Law'),
        t('ArticleType', 'Law'),
        t('ArticleCode', 'A'),
      ]).join(),
    ).not.toContain('ซ้ำ');
  });

  it('สูตร {X} วงเล็บไม่ครบคู่ → รายงานชื่อคอลัมน์', () => {
    const p = getTemplateProblems([...base('Law'), t('Title', 'มาตรา {C')]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('คอลัมน์ "Title": รูปแบบ {ชื่อคอลัมน์} ไม่ถูกต้อง');
    expect(validateFormulaSyntax('{A}{B}')).toBeNull();
    expect(validateFormulaSyntax('A')).toBeNull();
    expect(validateFormulaSyntax('{}')).not.toBeNull();
  });

  it('CategoryID ที่ Template เก่าเคยบันทึกไว้ไม่นับ', () => {
    expect(getTemplateProblems([...base('Law'), t('CategoryID', '12')])).toEqual([]);
  });

  it('ตัวช่วย resolve ค่าคงที่ของ Template', () => {
    const rows = [...base('decree'), t('Attachment', 'K')];
    expect(resolveTemplateLayout(rows)).toBe('Decree');
    expect(resolveArticleType(rows)).toBe(5);
    expect(hasAttachmentMapping(rows)).toBe(true);
    expect(hasAttachmentMapping(base('Law'))).toBe(false);
    expect(resolveArticleType([t('ArticleType', '0')])).toBeNull();
    expect(resolveArticleType([t('ArticleType', 'x')])).toBeNull();
  });
});
