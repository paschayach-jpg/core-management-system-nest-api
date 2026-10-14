import {
  KbLayout,
  describeFileKind,
  detectLayoutFromCode,
  getLawYear,
  isDecreeCode,
  isLawCode,
  isNonLawCodeFormat,
  normalizeLayout,
  tryGetNonLawTypeDigit,
  tryParseLawReference,
  tryParseTypeDigit,
} from '../../../src/modules/kms/codes/kb-layout';
import { lawCode, nonLawCode } from './kms-fixtures';

describe('KbLayout — ชนิดไฟล์จาก Code รวม 29 ตัว', () => {
  const law = lawCode('PVI00', '0110', '535');
  const decree = lawCode('ETR01', '0003', '540');
  const parent24 = law.substring(0, 24);
  const nonLaw = nonLawCode(parent24, '2');

  it('สร้าง Code ตัวอย่างได้ยาว 29 ตัวตามสเปก', () => {
    expect(law).toHaveLength(29);
    expect(decree).toHaveLength(29);
    expect(nonLaw).toHaveLength(29);
    expect(law.endsWith('00000')).toBe(true);
    expect(nonLaw.endsWith('00000')).toBe(false);
  });

  it('Law: ลงท้าย 00000 และตัวที่ 4-5 = 00', () => {
    expect(detectLayoutFromCode(law)).toBe('Law');
    expect(isLawCode(law)).toBe(true);
    expect(isDecreeCode(law)).toBe(false);
  });

  it('Decree: ลงท้าย 00000 แต่ตัวที่ 4-5 ไม่ใช่ 00 (ETR01)', () => {
    expect(detectLayoutFromCode(decree)).toBe('Decree');
    expect(isDecreeCode(decree)).toBe(true);
  });

  it('NonLaw: ไม่ลงท้าย 00000 และตัวที่ 25 เป็น 1-9', () => {
    expect(detectLayoutFromCode(nonLaw)).toBe('NonLaw');
    expect(isNonLawCodeFormat(nonLaw)).toBe(true);
    expect(tryGetNonLawTypeDigit(nonLaw)).toBe('2');
  });

  it.each([
    ['ว่าง', ''],
    ['สั้นกว่า 29', law.substring(0, 28)],
    ['ยาวกว่า 29 (ไม่รับ 27/30)', law + '0'],
    ['รูปแบบเก่า 27 ตัว', law.substring(0, 27)],
    ['ตัวที่ 25 เป็น 0 และไม่ลงท้าย 00000', parent24 + '0' + '0001'],
    ['ตัวที่ 25 ไม่ใช่ตัวเลข', parent24 + 'A' + '0001'],
  ])('ผิดรูปแบบ (%s) → null', (_label, code) => {
    expect(detectLayoutFromCode(code)).toBeNull();
  });

  it('null/undefined ไม่ throw', () => {
    expect(detectLayoutFromCode(null)).toBeNull();
    expect(detectLayoutFromCode(undefined)).toBeNull();
    expect(isLawCode(null)).toBe(false);
  });

  it('getLawYear: ตัวที่ 10-12 นำหน้าด้วย 2 · ไม่ใช่ตัวเลข/สั้นไป = null', () => {
    expect(getLawYear(law)).toBe('2535');
    expect(getLawYear(decree)).toBe('2540');
    expect(getLawYear('PVI000110ABC' + '0'.repeat(17))).toBeNull();
    expect(getLawYear('PVI00')).toBeNull();
    expect(getLawYear(null)).toBeNull();
  });

  it('tryParseTypeDigit ตัดช่องว่าง และรับเฉพาะ 1-9 ตัวเดียว', () => {
    expect(tryParseTypeDigit(' 3 ')).toBe('3');
    expect(tryParseTypeDigit('0')).toBeNull();
    expect(tryParseTypeDigit('12')).toBeNull();
    expect(tryParseTypeDigit('')).toBeNull();
    expect(tryParseTypeDigit(null)).toBeNull();
  });

  it('normalizeLayout ไม่สนตัวพิมพ์ใหญ่เล็ก/ช่องว่าง', () => {
    expect(normalizeLayout(' law ')).toBe('Law');
    expect(normalizeLayout('DECREE')).toBe('Decree');
    expect(normalizeLayout('nonlaw')).toBe('NonLaw');
    expect(normalizeLayout('x')).toBeNull();
    expect(normalizeLayout('')).toBeNull();
  });

  it('describeFileKind ใช้ในข้อความ mismatch', () => {
    expect(describeFileKind('Law')).toBe('กฎหมาย');
    expect(describeFileKind('Decree')).toBe('พระราชกฤษฎีกา');
    expect(describeFileKind('NonLaw')).toBe('ที่ไม่ใช่กฎหมาย');
  });

  it('ค่าคงที่ตำแหน่งสอดคล้องกัน (ไม่ hard-code)', () => {
    expect(KbLayout.ParentCodeLength + 5).toBe(KbLayout.LawCodeLength);
    expect(KbLayout.NonLawTypeDigitIndex).toBe(KbLayout.ParentCodeLength);
  });
});

describe('tryParseLawReference — Code กฎหมายอ้างอิงของพระราชกฤษฎีกา', () => {
  const cat5 = 'ETR00';
  const sec24 = lawCode('PVI00', '0029', '535').substring(0, 24);
  const sec24b = lawCode('PVI00', '0030', '535').substring(0, 24);

  it('หมวด 5 ตัว 1 บรรทัด + มาตรา 24 ตัวอย่างน้อย 1 → ผ่าน (ซ้ำนับครั้งเดียว ไม่สนตัวพิมพ์)', () => {
    const r = tryParseLawReference(`${cat5}\r\n${sec24}\n${sec24.toLowerCase()}\n${sec24b}\n\n`);
    expect(r.ok).toBe(true);
    expect(r.categoryCode).toBe(cat5);
    expect(r.parentCodes).toEqual([sec24, sec24b]);
  });

  it('ความยาวบรรทัดผิด → error บอกบรรทัดและความยาว', () => {
    const r = tryParseLawReference(`${cat5}\nXYZ`);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("บรรทัด 'XYZ' ยาว 3 ตัว");
  });

  it('ไม่มีรหัสหมวด / มีหมวดเกิน 1 / ไม่มีมาตรา → error', () => {
    expect(tryParseLawReference(sec24).error).toContain('ไม่พบรหัสหมวดพระราชกฤษฎีกา');
    expect(tryParseLawReference(`${cat5}\nEXM00\n${sec24}`).error).toContain('มากกว่า 1 รายการ');
    expect(tryParseLawReference(cat5).error).toContain('ต้องอ้างอิงกฎหมายอย่างน้อย 1 มาตรา');
    expect(tryParseLawReference(null).ok).toBe(false);
  });
});
