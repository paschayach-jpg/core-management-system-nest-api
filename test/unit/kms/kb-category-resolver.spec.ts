import { KbCategoryResolver } from '../../../src/modules/kms/codes/kb-category-resolver';
import { cat, lawCode, nonLawCode, sampleCategories } from './kms-fixtures';

const resolver = (rows = sampleCategories()) => new KbCategoryResolver(rows);

describe('KbCategoryResolver — กฎหมาย', () => {
  it('กฎหมายที่ไม่แยกหมวดปี → ใช้หมวดกฎหมายเอง', () => {
    const r = resolver().tryResolveLawArticle(lawCode('PVI00', '0110', '535'));
    expect(r).toMatchObject({ ok: true, category: { categoryCode: 'PVI00' } });
  });

  it('กฎหมายแยกหมวดปี → เลือกหมวดปีตามตัวที่ 10-12 (535→PLI002535, 540→PLI002540)', () => {
    const rs = resolver();
    expect(rs.tryResolveLawArticle(lawCode('PLI00', '0001', '535'))).toMatchObject({
      ok: true,
      category: { categoryCode: 'PLI002535' },
    });
    expect(rs.tryResolveLawArticle(lawCode('PLI00', '0001', '540'))).toMatchObject({
      ok: true,
      category: { categoryCode: 'PLI002540' },
    });
  });

  it('กฎหมายแยกปีแต่ไม่มีหมวดของปีนั้น → Error + missing (ไม่ตกลงหมวดแม่แบบเงียบๆ)', () => {
    const r = resolver().tryResolveLawArticle(lawCode('PLI00', '0001', '551'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('ไม่พบหมวดปี 2551');
      expect(r.missing).toMatchObject({ categoryCode: 'PLI002551', parentCategoryCode: 'PLI00' });
    }
  });

  it('กฎหมายแยกปีแต่ตัวที่ 10-12 ไม่ใช่ตัวเลข → Error ไม่มี missing', () => {
    const r = resolver().tryResolveLawArticle('PLI00' + '0001' + 'ABC' + '0'.repeat(12) + '00000');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('หาปีไม่ได้');
      expect(r.missing).toBeUndefined();
    }
  });

  it('หมวดปีที่ปิดใช้งาน / ไม่ใช่ลูกโดยตรง → Error', () => {
    const inactive = sampleCategories().map((c) =>
      c.categoryCode === 'PLI002535' ? { ...c, isActive: false } : c,
    );
    const a = resolver(inactive).tryResolveLawArticle(lawCode('PLI00', '0001', '535'));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toContain('ถูกปิดใช้งาน');

    const wrongParent = sampleCategories().map((c) =>
      c.categoryCode === 'PLI002535' ? { ...c, parentCategoryId: 2 } : c,
    );
    const b = resolver(wrongParent).tryResolveLawArticle(lawCode('PLI00', '0001', '535'));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toContain('ไม่ได้อยู่ใต้หมวดกฎหมาย');
  });

  it('รหัสกฎหมายที่ไม่มีหมวด / เป็น LW เอง / ไม่อยู่ใต้ LW / ถูกปิด', () => {
    const rs = resolver([
      ...sampleCategories(),
      cat(20, 'XXX00', null),
      cat(21, 'OFF00', 1, { isActive: false }),
    ]);
    const none = rs.tryResolveLaw('ZZZ00');
    expect(none.ok === false && none.error).toContain('ไม่พบหมวดกฎหมายรหัส "ZZZ00"');
    const root = rs.tryResolveLaw('LW');
    expect(root.ok === false && root.error).toContain('หมวดรากของกฎหมาย');
    const outside = rs.tryResolveLaw('XXX00');
    expect(outside.ok === false && outside.error).toContain('ไม่อยู่ใต้หมวด "กฎหมาย"');
    const off = rs.tryResolveLaw('OFF00');
    expect(off.ok === false && off.error).toContain('ถูกปิดใช้งาน');
    expect(rs.tryResolveLaw('').ok).toBe(false);
  });

  it('CategoryCode ไม่สนตัวพิมพ์เล็กใหญ่ (UQ_KMS_KBCat_Code)', () => {
    expect(resolver().tryResolveLaw('pvi00').ok).toBe(true);
  });
});

describe('KbCategoryResolver — พระราชกฤษฎีกา', () => {
  const code = lawCode('ETR01', '0003', '540');

  it('หมวดกลุ่มใต้ DDD00 → ผ่าน (ไม่แยกปี = ใช้หมวดกลุ่มเอง)', () => {
    expect(resolver().tryResolveDecreeArticle(code, 'ETR00')).toMatchObject({
      ok: true,
      category: { categoryCode: 'ETR00' },
    });
  });

  it('ไม่มี DDD00 → Error + missing DDD00 ใต้ LW', () => {
    const rows = sampleCategories().filter(
      (c) => c.categoryCode !== 'DDD00' && c.categoryCode !== 'ETR00',
    );
    const r = new KbCategoryResolver(rows).tryResolveDecreeArticle(code, 'ETR00');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toMatchObject({ categoryCode: 'DDD00', parentCategoryCode: 'LW' });
  });

  it('ไม่มีหมวดกลุ่ม → missing ใต้ DDD00 · เป็น DDD00 เอง → Error · อยู่นอก DDD00 → Error · ปิดใช้งาน → Error', () => {
    const rs = resolver();
    const none = rs.tryResolveDecreeArticle(code, 'EXM00');
    expect(none.ok === false && none.missing).toMatchObject({
      categoryCode: 'EXM00',
      parentCategoryCode: 'DDD00',
    });
    const root = rs.tryResolveDecreeArticle(code, 'DDD00');
    expect(root.ok === false && root.error).toContain('หมวดรากของพระราชกฤษฎีกา');
    const outside = rs.tryResolveDecreeArticle(code, 'PVI00');
    expect(outside.ok === false && outside.error).toContain('ไม่ได้อยู่ใต้หมวดพระราชกฤษฎีกา');
    const off = resolver(
      sampleCategories().map((c) => (c.categoryCode === 'ETR00' ? { ...c, isActive: false } : c)),
    ).tryResolveDecreeArticle(code, 'ETR00');
    expect(off.ok === false && off.error).toContain('ถูกปิดใช้งาน');
  });

  it('หมวดกลุ่มแยกปี → เลือกหมวดปีเหมือนกฎหมาย', () => {
    const rows = [...sampleCategories(), cat(30, 'ETR002540', 7)];
    expect(new KbCategoryResolver(rows).tryResolveDecreeArticle(code, 'ETR00')).toMatchObject({
      ok: true,
      category: { categoryCode: 'ETR002540' },
    });
  });
});

describe('KbCategoryResolver — ไม่ใช่กฎหมาย', () => {
  const parent = lawCode('PVI00', '0110', '535').substring(0, 24);

  it('ตัวที่ 25 → หมวดประเภท แล้วต่อปี → หมวดปี (OR00 + 2535)', () => {
    const r = resolver().tryResolveNonLawArticle(nonLawCode(parent, '2'));
    expect(r).toMatchObject({ ok: true, category: { categoryCode: 'OR002535' } });
  });

  it('รหัสประเภทที่ไม่มี → Error บอกรหัสที่ตั้งไว้แล้ว (ไม่มี missing)', () => {
    const r = resolver().tryResolveNonLawArticle(nonLawCode(parent, '7'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('ไม่มีหมวดประเภทเอกสารที่ใช้รหัส "7"');
      expect(r.error).toContain('1, 2');
      expect(r.missing).toBeUndefined();
    }
  });

  it('ยังไม่ได้ตั้งรหัสประเภทเลย → ข้อความเฉพาะ', () => {
    const rows = sampleCategories().map((c) => ({ ...c, importTypeDigit: null }));
    const r = new KbCategoryResolver(rows).tryResolveNonLawArticle(nonLawCode(parent, '2'));
    expect(r.ok === false && r.error).toContain('ยังไม่ได้ตั้งรหัสประเภทเอกสาร');
  });

  it('ไม่มีหมวดปี → Error + missing (OR002540 ใต้ OR00 · AN002535 ใต้ AN00)', () => {
    const rs = resolver();
    const a = rs.tryResolveNonLawArticle(
      nonLawCode(lawCode('PVI00', '0110', '540').substring(0, 24), '2'),
    );
    expect(a.ok === false && a.missing).toMatchObject({
      categoryCode: 'OR002540',
      parentCategoryCode: 'OR00',
    });
    const b = rs.tryResolveNonLawArticle(nonLawCode(parent, '1'));
    expect(b.ok === false && b.missing).toMatchObject({
      categoryCode: 'AN002535',
      parentCategoryCode: 'AN00',
    });
  });

  it('หมวดประเภทอยู่ใต้ LW (ผิด) / ปิดใช้งาน → Error · ปีไม่ใช่ตัวเลข → Error', () => {
    const underLaw = sampleCategories().map((c) =>
      c.categoryCode === 'OR00' ? { ...c, parentCategoryId: 1 } : c,
    );
    const a = new KbCategoryResolver(underLaw).tryResolveNonLawArticle(nonLawCode(parent, '2'));
    expect(a.ok === false && a.error).toContain('อยู่ใต้หมวด "กฎหมาย"');

    const off = sampleCategories().map((c) =>
      c.categoryCode === 'OR00' ? { ...c, isActive: false } : c,
    );
    const b = new KbCategoryResolver(off).tryResolveNonLawArticle(nonLawCode(parent, '2'));
    expect(b.ok === false && b.error).toContain('ถูกปิดใช้งาน');

    const badYear = parent.substring(0, 9) + 'XYZ' + parent.substring(12) + '2' + '0001';
    expect(resolver().tryResolveNonLawArticle(badYear).ok).toBe(false);
  });

  it('รูปแบบไม่ใช่ NonLaw → ข้อความรูปแบบ', () => {
    const r = resolver().tryResolveNonLawArticle(lawCode('PVI00', '0110', '535'));
    expect(r.ok === false && r.error).toContain('ต้องยาว 29 ตัว');
  });
});
