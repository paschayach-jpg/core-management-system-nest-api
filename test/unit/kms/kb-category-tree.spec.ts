import {
  KbNonLawTypeMap,
  flattenTree,
  getDescendantIds,
  getEffectiveDisplayProfileId,
  getPath,
  isLawRootOrUnder,
  toCategoryRow,
} from '../../../src/modules/kms/codes/kb-category-tree';
import { cat, sampleCategories } from './kms-fixtures';

describe('KbCategoryTree — ต้นไม้หมวดไม่จำกัดความลึก', () => {
  it('flattenTree: root ก่อน ตามด้วยลูกหลานตามลำดับ SortOrder แล้วชื่อ พร้อม depth', () => {
    const items = flattenTree(
      [
        cat(3, 'C', 1, { sortOrder: 2 }),
        cat(2, 'B', 1, { sortOrder: 1 }),
        cat(1, 'A', null),
        cat(4, 'B1', 2),
        cat(5, 'B11', 4),
        cat(9, 'Z', null, { sortOrder: 5 }),
      ],
      false,
    );
    expect(items.map((i) => [i.category.categoryCode, i.depth])).toEqual([
      ['A', 0],
      ['B', 1],
      ['B1', 2],
      ['B11', 3],
      ['C', 1],
      ['Z', 0],
    ]);
  });

  it('รองรับความลึกมาก (เช่น 500 ชั้น) โดยไม่ stack overflow', () => {
    const rows = [cat(1, 'L1', null)];
    for (let i = 2; i <= 500; i++) rows.push(cat(i, `L${i}`, i - 1));
    const items = flattenTree(rows, false);
    expect(items).toHaveLength(500);
    expect(items[499].depth).toBe(499);
  });

  it('activeOnly: ลูกของหมวดที่ถูกปิดใช้งานกลายเป็น root (ไม่หายจากรายการ)', () => {
    const items = flattenTree(
      [cat(1, 'P', null, { isActive: false }), cat(2, 'K', 1), cat(3, 'Q', null)],
      true,
    );
    expect(items.map((i) => [i.category.categoryCode, i.depth])).toEqual([
      ['K', 0],
      ['Q', 0],
    ]);
  });

  it('วงวน parent (A→B→A) ไม่ค้างและไม่ทำให้หมวดหาย', () => {
    const items = flattenTree([cat(1, 'A', 2), cat(2, 'B', 1), cat(3, 'S', 3)], false);
    expect(items.map((i) => i.category.categoryCode).sort()).toEqual(['A', 'B', 'S']);
  });

  it('getDescendantIds: ทุกชั้น ไม่รวมตัวเอง และรวมหมวดที่ปิดใช้งาน', () => {
    const rows = [
      cat(1, 'R', null),
      cat(2, 'A', 1),
      cat(3, 'B', 2, { isActive: false }),
      cat(4, 'C', 3),
      cat(5, 'X', null),
    ];
    expect([...getDescendantIds(rows, 1)].sort()).toEqual([2, 3, 4]);
    expect([...getDescendantIds(rows, 5)]).toEqual([]);
  });

  it('getDescendantIds: วงวนไม่ทำให้วนไม่รู้จบ', () => {
    const rows = [cat(1, 'A', 2), cat(2, 'B', 1)];
    expect([...getDescendantIds(rows, 1)]).toEqual([2]);
  });

  it('getPath ต่อชื่อจาก root และว่างถ้าไม่พบหมวด', () => {
    const rows = sampleCategories();
    expect(getPath(rows, 4, ' › ')).toBe('หมวด LW › หมวด PLI00 › หมวด PLI002535');
    expect(getPath(rows, 999)).toBe('');
  });

  it('isLawRootOrUnder: LW เอง/ลูก/หลาน = true · ประเภทเอกสาร = false', () => {
    const rows = sampleCategories();
    expect(isLawRootOrUnder(rows, 1)).toBe(true);
    expect(isLawRootOrUnder(rows, 4)).toBe(true);
    expect(isLawRootOrUnder(rows, 7)).toBe(true);
    expect(isLawRootOrUnder(rows, 11)).toBe(false);
    expect(isLawRootOrUnder(rows, 999)).toBe(false);
  });

  it('getEffectiveDisplayProfileId: สืบจากหมวดแม่ใกล้สุดที่ตั้งไว้', () => {
    const rows = [
      cat(1, 'R', null, { displayProfileId: 9 }),
      cat(2, 'A', 1),
      cat(3, 'B', 2, { displayProfileId: 4 }),
      cat(4, 'C', 3),
    ];
    expect(getEffectiveDisplayProfileId(rows, 4)).toBe(4);
    expect(getEffectiveDisplayProfileId(rows, 2)).toBe(9);
    expect(getEffectiveDisplayProfileId([cat(1, 'X', null)], 1)).toBeNull();
  });

  it('toCategoryRow แปลง property ที่เป็น optional ของ entity', () => {
    expect(
      toCategoryRow({
        categoryId: 1,
        categoryCode: 'A',
        categoryName: 'ก',
        importTypeDigit: ' 3 ',
      }),
    ).toEqual({
      categoryId: 1,
      parentCategoryId: null,
      categoryCode: 'A',
      categoryName: 'ก',
      sortOrder: 0,
      isActive: true,
      displayProfileId: null,
      importTypeDigit: '3',
    });
  });
});

describe('KbNonLawTypeMap — รหัสประเภทเอกสาร (ImportTypeDigit)', () => {
  const rows = [
    cat(1, 'OR00', null, { importTypeDigit: '2' }),
    cat(2, 'AN00', null, { importTypeDigit: '1' }),
    cat(3, 'X', null, { importTypeDigit: '0' }),
    cat(4, 'DUP', null, { importTypeDigit: '2' }),
    cat(5, 'OFF', null, { importTypeDigit: '5', isActive: false }),
  ];
  const map = new KbNonLawTypeMap(rows);

  it('ใช้หมวดแรกที่เจอเมื่อรหัสซ้ำ · ข้ามรหัสที่ไม่ใช่ 1-9 · รวมหมวดที่ปิดใช้งาน', () => {
    expect(map.findByDigit('2')?.categoryCode).toBe('OR00');
    expect(map.findByDigit('0')).toBeNull();
    expect(map.findByDigit('5')?.categoryCode).toBe('OFF');
    expect(map.types.map((t) => t.categoryCode)).toEqual(['AN00', 'OR00', 'OFF']);
  });

  it('findByArticleCode อ่านตัวที่ 25', () => {
    const parent = 'A'.repeat(24);
    expect(map.findByArticleCode(`${parent}20001`)?.categoryCode).toBe('OR00');
    expect(map.findByArticleCode(`${parent}00000`)).toBeNull();
    expect(map.findByArticleCode('short')).toBeNull();
  });

  it('describeDigits ย่อช่วงเลขติดกัน', () => {
    expect(map.describeDigits()).toBe('1, 2, 5');
    const many = new KbNonLawTypeMap(
      ['1', '2', '3', '4', '6'].map((d, i) => cat(i + 1, `T${d}`, null, { importTypeDigit: d })),
    );
    expect(many.describeDigits()).toBe('1-4, 6');
    expect(new KbNonLawTypeMap([]).describeDigits()).toBe('');
    expect(new KbNonLawTypeMap([]).isEmpty).toBe(true);
  });
});
