import { analyzeArticleCode } from '../../../src/modules/kms/codes/kb-article-code-analyzer';
import { lawCode, nonLawCode, sampleCategories } from './kms-fixtures';

const cats = sampleCategories();
const group = (code: string) => cats.find((c) => c.categoryCode === code) ?? null;

describe('analyzeArticleCode — กฎเดียวกับตอน import', () => {
  it('ว่าง → ขอให้กรอก', () => {
    const r = analyzeArticleCode(cats, '  ', null);
    expect(r).toMatchObject({ isValid: false, layout: null, error: 'กรุณากรอก Code รวม (29 ตัว)' });
  });

  it('ผิดรูปแบบ (สั้น/ยาว/27 ตัว) → ข้อความรูปแบบ ไม่มี layout', () => {
    for (const code of [
      'PVI001',
      lawCode('PVI00', '0001', '535').substring(0, 27),
      lawCode('PVI00', '0001', '535') + '0',
    ]) {
      const r = analyzeArticleCode(cats, code, null);
      expect(r.layout).toBeNull();
      expect(r.error).toContain('Code รวมต้องยาว 29 ตัว');
    }
  });

  it('กฎหมาย: เก็บ 24 ตัวแรก · ชื่อ "มาตรา N" ตัด 0 นำหน้า · หมวดจาก Code · ล็อกหมวด', () => {
    const code = lawCode('PVI00', '0110', '535');
    const r = analyzeArticleCode(cats, code, null);
    expect(r).toMatchObject({
      isValid: true,
      layout: 'Law',
      layoutLabel: 'กฎหมาย',
      storedCode: code.substring(0, 24),
      title: 'มาตรา 110',
      categoryFromCode: true,
      parentCode: null,
      error: null,
    });
    expect(r.category?.categoryCode).toBe('PVI00');
  });

  it('กฎหมายแยกปี → หมวดปี · ปีที่ไม่มีหมวด → error พร้อมบอกให้สร้างหมวด + missingCategory', () => {
    expect(
      analyzeArticleCode(cats, lawCode('PLI00', '0007', '540'), null).category?.categoryCode,
    ).toBe('PLI002540');
    const r = analyzeArticleCode(cats, lawCode('PLI00', '0007', '560'), null);
    expect(r.isValid).toBe(false);
    expect(r.error).toContain('(ต้องสร้างหมวด PLI002560 ใต้ PLI00 ก่อน)');
    expect(r.missingCategory).toMatchObject({ categoryCode: 'PLI002560' });
  });

  it('เลขมาตราเป็น 0000 หรือไม่ใช่ตัวเลข → error เลขมาตรา', () => {
    const zero = analyzeArticleCode(cats, lawCode('PVI00', '0000', '535'), null);
    expect(zero.error).toContain('เลขมาตราไม่ถูกต้อง');
    expect(zero.title).toBeNull();
    const text = analyzeArticleCode(cats, lawCode('PVI00', '01A0', '535'), null);
    expect(text.error).toContain('เลขมาตราไม่ถูกต้อง');
  });

  it('พระราชกฤษฎีกา: ต้องเลือกหมวดกลุ่มก่อน · เลือกแล้วใช้หมวดกลุ่ม · ไม่ล็อกหมวด · เก็บ 24 ตัว', () => {
    const code = lawCode('ETR01', '0003', '540');
    const noGroup = analyzeArticleCode(cats, code, null);
    expect(noGroup.layout).toBe('Decree');
    expect(noGroup.error).toContain('เลือกหมวดกลุ่มพระราชกฤษฎีกา');
    expect(noGroup.title).toBe('มาตรา 3');

    const ok = analyzeArticleCode(cats, code, group('ETR00'));
    expect(ok).toMatchObject({
      isValid: true,
      categoryFromCode: false,
      storedCode: code.substring(0, 24),
    });
    expect(ok.category?.categoryCode).toBe('ETR00');

    const bad = analyzeArticleCode(cats, code, group('PVI00'));
    expect(bad.isValid).toBe(false);
    expect(bad.error).toContain('ไม่ได้อยู่ใต้หมวดพระราชกฤษฎีกา');
  });

  it('ไม่ใช่กฎหมาย: เก็บเต็ม 29 ตัว · หมวดปีของประเภท · ผูกกฎหมายแม่ (24 ตัวแรก) · ไม่มีชื่อ derive', () => {
    const parent = lawCode('PVI00', '0110', '535').substring(0, 24);
    const code = nonLawCode(parent, '2');
    const r = analyzeArticleCode(cats, code, null);
    expect(r).toMatchObject({
      isValid: true,
      layout: 'NonLaw',
      layoutLabel: 'ที่ไม่ใช่กฎหมาย',
      storedCode: code,
      title: null,
      parentCode: parent,
      categoryFromCode: true,
    });
    expect(r.category?.categoryCode).toBe('OR002535');
  });

  it('ไม่ใช่กฎหมาย: ประเภทที่ไม่รู้จัก / ไม่มีหมวดปี → error', () => {
    const parent = lawCode('PVI00', '0110', '535').substring(0, 24);
    expect(analyzeArticleCode(cats, nonLawCode(parent, '8'), null).error).toContain(
      'ไม่มีหมวดประเภทเอกสาร',
    );
    const noYear = analyzeArticleCode(cats, nonLawCode(parent, '1'), null);
    expect(noYear.error).toContain('(ต้องสร้างหมวด AN002535 ใต้ AN00 ก่อน)');
  });

  it('Code มีช่องว่างหัวท้ายถูกตัดก่อนตรวจ', () => {
    const code = lawCode('PVI00', '0001', '535');
    expect(analyzeArticleCode(cats, `  ${code} `, null).storedCode).toBe(code.substring(0, 24));
  });
});
