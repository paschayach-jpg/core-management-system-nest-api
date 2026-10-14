/**
 * ชนิดไฟล์/รูปแบบ Code รวม (ArticleCode 29 ตัว) ของ KMS Import — พอร์ตจาก `KBImportLayoutTypeCatalog` (CMS.Domain)
 * ฟังก์ชันล้วน ไม่แตะ DB · ตัวเลขตำแหน่ง/ความยาวทุกตัวอยู่ที่นี่ที่เดียว (อย่า hard-code ที่อื่น)
 *
 * รูปแบบ Code รวม (index เริ่ม 0):
 *   กฎหมาย (Law)       [รหัสกฎหมาย 5: ตัวอักษร 3 + ลำดับ "00"][มาตรา 4][ปี 3 (ตัวที่ 10-12)] ... [00000]
 *   พระราชกฤษฎีกา      เหมือนกฎหมายแต่ตัวที่ 4-5 ไม่ใช่ "00" (เช่น ETR01) · ลงท้าย 00000
 *   ไม่ใช่กฎหมาย       24 ตัวแรก = Code มาตราของกฎหมายแม่ · ตัวที่ 25 = รหัสประเภทเอกสาร (1-9) · 5 ตัวสุดท้ายไม่ใช่ 00000
 */

export type KbLayoutType = 'Law' | 'Decree' | 'NonLaw';

export const KbLayout = {
  Law: 'Law',
  Decree: 'Decree',
  NonLaw: 'NonLaw',

  /** ความยาว Code รวม */
  LawCodeLength: 29,
  /** รหัสกฎหมายที่ขึ้นต้น Code รวม (= CategoryCode ของหมวดกฎหมาย เช่น PVI00) */
  LawCodePrefixLength: 5,
  /** ความยาว ArticleCode ที่เก็บของมาตรา = Code รวมตัด suffix 5 ตัวสุดท้าย */
  ParentCodeLength: 24,
  /** ตำแหน่งที่เลขมาตราเริ่ม (ตัวที่ 6) และจำนวนหลัก */
  LawSectionStartIndex: 5,
  LawSectionDigits: 4,
  /** 5 ตัวสุดท้ายที่บอกว่าเป็นตัวมาตราเอง */
  LawCodeSuffix: '00000',
  /** เลขลำดับรหัสกฎหมาย (ตัวที่ 4-5): "00" = กฎหมาย · อื่นๆ = พระราชกฤษฎีกา */
  LawSeriesStartIndex: 3,
  LawSeriesDigits: 2,
  LawSeriesLaw: '00',
  /** ปีใน Code รวม: ตัวที่ 10-12 (+ "2" นำหน้า = พ.ศ. 4 หลัก) */
  LawYearStartIndex: 9,
  LawYearDigits: 3,
  /** CategoryCode ของหมวดรากกฎหมาย และหมวดรากพระราชกฤษฎีกา */
  LawRootCategoryCode: 'LW',
  DecreeRootCategoryCode: 'DDD00',
  /** ตำแหน่งรหัสประเภทเอกสาร (ตัวที่ 25) ของไฟล์ที่ไม่ใช่กฎหมาย */
  NonLawTypeDigitIndex: 24,
  MinTypeDigit: '1',
  MaxTypeDigit: '9',

  NonLawCodeFormatMessage:
    'Code รวม: ต้องยาว 29 ตัว, 5 ตัวสุดท้ายห้ามเป็น 00000 และตัวที่ 25 ต้องเป็นรหัสประเภทเอกสาร (ตัวเลข 1-9)',
} as const;

/** true ถ้าเป็น Code รวมของกฎหมาย: ยาว 29 ตัว และ 5 ตัวสุดท้ายเป็น "00000" */
export function isLawCode(code: string | null | undefined): boolean {
  return (
    !!code &&
    code.length === KbLayout.LawCodeLength &&
    code.substring(KbLayout.LawCodeLength - 5) === KbLayout.LawCodeSuffix
  );
}

/** true ถ้าเป็น Code รวมของพระราชกฤษฎีกา: รูปแบบกฎหมาย แต่ตัวที่ 4-5 ไม่ใช่ "00" */
export function isDecreeCode(code: string | null | undefined): boolean {
  return (
    isLawCode(code) &&
    (code as string).substring(
      KbLayout.LawSeriesStartIndex,
      KbLayout.LawSeriesStartIndex + KbLayout.LawSeriesDigits,
    ) !== KbLayout.LawSeriesLaw
  );
}

/** true ตัวอักษรเดียวเป็นรหัสประเภทเอกสาร 1-9 */
export function isTypeDigit(ch: string): boolean {
  return ch.length === 1 && ch >= KbLayout.MinTypeDigit && ch <= KbLayout.MaxTypeDigit;
}

/** แปลงข้อความ (ตัดช่องว่างหัวท้าย) เป็นรหัสประเภทเอกสาร — null ถ้าว่างหรือไม่ใช่ตัวเลข 1-9 ตัวเดียว */
export function tryParseTypeDigit(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 1 && isTypeDigit(trimmed) ? trimmed : null;
}

/** รหัสประเภทเอกสารจากตัวที่ 25 ของ Code รวมแบบไม่ใช่กฎหมาย — null ถ้ารูปแบบไม่ใช่ */
export function tryGetNonLawTypeDigit(code: string | null | undefined): string | null {
  if (!code || code.length !== KbLayout.LawCodeLength) return null;
  if (code.substring(KbLayout.LawCodeLength - 5) === KbLayout.LawCodeSuffix) return null;
  const ch = code[KbLayout.NonLawTypeDigitIndex];
  return isTypeDigit(ch) ? ch : null;
}

export function isNonLawCodeFormat(code: string | null | undefined): boolean {
  return tryGetNonLawTypeDigit(code) !== null;
}

/** ชนิดไฟล์จาก Code รวม: Decree → Law → NonLaw → null (ผิดรูปแบบทุกแบบ) */
export function detectLayoutFromCode(code: string | null | undefined): KbLayoutType | null {
  if (isDecreeCode(code)) return KbLayout.Decree;
  if (isLawCode(code)) return KbLayout.Law;
  if (isNonLawCodeFormat(code)) return KbLayout.NonLaw;
  return null;
}

/**
 * ปี พ.ศ. 4 หลักจาก Code รวม: ตัวที่ 10-12 (เช่น "535") นำหน้า "2" → "2535"
 * null ถ้า Code สั้นเกินไปหรือตัวที่ 10-12 ไม่ใช่ตัวเลข
 */
export function getLawYear(code: string | null | undefined): string | null {
  if (!code || code.length < KbLayout.LawYearStartIndex + KbLayout.LawYearDigits) return null;
  const digits = code.substring(
    KbLayout.LawYearStartIndex,
    KbLayout.LawYearStartIndex + KbLayout.LawYearDigits,
  );
  return /^\d{3}$/.test(digits) ? `2${digits}` : null;
}

/** ค่า LayoutType มาตรฐานจากข้อความ (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) หรือ null ถ้าว่าง/ไม่รู้จัก */
export function normalizeLayout(value: string | null | undefined): KbLayoutType | null {
  const t = (value ?? '').trim().toLowerCase();
  if (t === 'law') return KbLayout.Law;
  if (t === 'decree') return KbLayout.Decree;
  if (t === 'nonlaw') return KbLayout.NonLaw;
  return null;
}

export function describeLayout(layout: string | null | undefined): string {
  switch (normalizeLayout(layout)) {
    case KbLayout.Law:
      return 'พระราชบัญญัติ';
    case KbLayout.Decree:
      return 'พระราชกฤษฎีกา';
    case KbLayout.NonLaw:
      return 'คำสั่ง,หมวดภายใน/ประกาศ,หนังสือเวียน,ระเบียบ,คำสั่งพิเศษ,กฎกระทรวง';
    default:
      return layout ?? '';
  }
}

/** ชื่อชนิดไฟล์แบบสั้นสำหรับข้อความ error */
export function describeFileKind(layout: string | null | undefined): string {
  switch (normalizeLayout(layout)) {
    case KbLayout.Law:
      return 'กฎหมาย';
    case KbLayout.Decree:
      return 'พระราชกฤษฎีกา';
    case KbLayout.NonLaw:
      return 'ที่ไม่ใช่กฎหมาย';
    default:
      return layout ?? '';
  }
}

export const LAYOUT_OPTIONS: { layoutType: KbLayoutType; description: string }[] = [
  KbLayout.Law,
  KbLayout.Decree,
  KbLayout.NonLaw,
].map((l) => ({ layoutType: l, description: describeLayout(l) }));

export interface LawReferenceParse {
  ok: boolean;
  categoryCode?: string;
  parentCodes: string[];
  error?: string;
}

/**
 * แยกคอลัมน์ "Code กฎหมายอ้างอิง (ออกตาม)" ของพระราชกฤษฎีกา (หลายบรรทัดในเซลล์เดียว):
 * บรรทัดยาว 5 = CategoryCode ของหมวดกลุ่ม (ต้องมี 1 บรรทัดพอดี) · ยาว 24 = ArticleCode ของมาตราที่อ้างอิง (ต้องมีอย่างน้อย 1, ซ้ำนับครั้งเดียว)
 * ความยาวอื่น = ผิดรูปแบบ
 */
export function tryParseLawReference(raw: string | null | undefined): LawReferenceParse {
  const categoryCodes: string[] = [];
  const parentCodes: string[] = [];
  const seen = new Set<string>();

  for (const part of (raw ?? '').split(/\r\n|\n|\r/)) {
    const line = part.trim();
    if (line.length === 0) continue;
    if (line.length === KbLayout.LawCodePrefixLength) {
      categoryCodes.push(line);
    } else if (line.length === KbLayout.ParentCodeLength) {
      const key = line.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        parentCodes.push(line);
      }
    } else {
      return {
        ok: false,
        parentCodes: [],
        error: `Code กฎหมายอ้างอิง: บรรทัด '${line}' ยาว ${line.length} ตัว (ต้องเป็นรหัสหมวด ${KbLayout.LawCodePrefixLength} ตัว หรือรหัสมาตรา ${KbLayout.ParentCodeLength} ตัว)`,
      };
    }
  }

  if (categoryCodes.length === 0)
    return {
      ok: false,
      parentCodes: [],
      error: `Code กฎหมายอ้างอิง: ไม่พบรหัสหมวดพระราชกฤษฎีกา (${KbLayout.LawCodePrefixLength} ตัว) ในเซลล์`,
    };
  if (categoryCodes.length > 1)
    return {
      ok: false,
      parentCodes: [],
      error: `Code กฎหมายอ้างอิง: พบรหัสหมวด ${KbLayout.LawCodePrefixLength} ตัวมากกว่า 1 รายการ (${categoryCodes.join(', ')})`,
    };
  if (parentCodes.length === 0)
    return {
      ok: false,
      parentCodes: [],
      error: `Code กฎหมายอ้างอิง: ไม่พบรหัสมาตราของกฎหมายที่อ้างอิง (${KbLayout.ParentCodeLength} ตัว) — พระราชกฤษฎีกาต้องอ้างอิงกฎหมายอย่างน้อย 1 มาตรา`,
    };

  return { ok: true, categoryCode: categoryCodes[0], parentCodes };
}
