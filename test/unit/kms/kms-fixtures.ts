import type { KbCategoryRow } from '../../../src/modules/kms/codes/kb-category-tree';

let nextId = 1;
export function cat(
  categoryId: number,
  categoryCode: string,
  parentCategoryId: number | null,
  extra: Partial<KbCategoryRow> = {},
): KbCategoryRow {
  nextId = Math.max(nextId, categoryId + 1);
  return {
    categoryId,
    parentCategoryId,
    categoryCode,
    categoryName: `หมวด ${categoryCode}`,
    sortOrder: 0,
    isActive: true,
    displayProfileId: null,
    importTypeDigit: null,
    ...extra,
  };
}

/**
 * หมวดตัวอย่างที่เลียนแบบข้อมูลจริง:
 *  LW(1) › PVI00(2) · PLI00(3) › PLI002535(4), PLI002540(5) · DDD00(6) › ETR00(7)
 *  OR00(10, ประเภท 2) › OR002535(11) · AN00(12, ประเภท 1) (ไม่มีหมวดปี)
 */
export function sampleCategories(): KbCategoryRow[] {
  return [
    cat(1, 'LW', null),
    cat(2, 'PVI00', 1),
    cat(3, 'PLI00', 1),
    cat(4, 'PLI002535', 3),
    cat(5, 'PLI002540', 3),
    cat(6, 'DDD00', 1),
    cat(7, 'ETR00', 6),
    cat(10, 'OR00', null, { importTypeDigit: '2', categoryName: 'คำสั่ง' }),
    cat(11, 'OR002535', 10),
    cat(12, 'AN00', null, { importTypeDigit: '1', categoryName: 'ประกาศ' }),
  ];
}

/** Code รวมของกฎหมาย/พระราชกฤษฎีกา: [prefix 5][มาตรา 4][ปี 3] เติมศูนย์ให้ครบ 24 แล้วต่อ 00000 */
export function lawCode(prefix5: string, section4: string, year3: string): string {
  return (prefix5 + section4 + year3).padEnd(24, '0') + '00000';
}

/** Code รวมของเอกสารที่ไม่ใช่กฎหมาย: [กฎหมายแม่ 24][ประเภท 1][เลขเอกสาร 4] */
export function nonLawCode(
  parent24: string,
  typeDigit: string,
  docNo4 = '0001',
  year3?: string,
): string {
  const p = year3 ? parent24.substring(0, 9) + year3 + parent24.substring(12) : parent24;
  return p + typeDigit + docNo4;
}
