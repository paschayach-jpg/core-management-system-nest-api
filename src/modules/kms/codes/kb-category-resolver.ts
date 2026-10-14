import { KbCategoryRow, KbNonLawTypeMap, isRootOrUnder } from './kb-category-tree';
import { KbLayout, getLawYear, tryGetNonLawTypeDigit } from './kb-layout';

/** หมวดที่ต้องสร้างใน m_KBCategory ก่อนแถวใน Excel จะ import ได้ เช่น PLI002551 ใต้ PLI00 */
export interface KbMissingCategory {
  categoryCode: string;
  /** ว่าง = เป็นหมวดหลัก (ไม่มี parent) */
  parentCategoryCode?: string | null;
  parentCategoryName?: string | null;
}

export type CategoryResolution =
  { ok: true; category: KbCategoryRow } | { ok: false; error: string; missing?: KbMissingCategory };

const fail = (error: string, missing?: KbMissingCategory): CategoryResolution => ({
  ok: false,
  error,
  missing,
});

/**
 * หา CategoryID ของแต่ละแถวตอน import จาก ArticleCode — พอร์ตจาก `KBImportCategoryResolver`
 *  - กฎหมาย: 5 ตัวแรกของ Code รวม = CategoryCode ของหมวดใต้ LW · กฎหมายที่แยกหมวดตามปี (PLI00 › PLI002535) เลือกหมวดปีจากตัวที่ 10-12
 *  - ไม่ใช่กฎหมาย: ตัวที่ 25 = ImportTypeDigit ของหมวดประเภท (OR00) แล้วต่อด้วยปี → หมวดปี OR002535
 *  - พระราชกฤษฎีกา: หมวดกลุ่มมาจากรหัส 5 ตัวในคอลัมน์ "Code กฎหมายอ้างอิง" ต้องอยู่ใต้ DDD00
 * สร้างจากรายการหมวดทั้งหมดครั้งเดียวต่อการ validate หนึ่งไฟล์ (ไม่เรียก DB เอง) · CategoryCode เป็น UNIQUE จึงหาจากรหัสได้ตัวเดียว
 */
export class KbCategoryResolver {
  private readonly byCode = new Map<string, KbCategoryRow>();
  private readonly byId = new Map<number, KbCategoryRow>();
  private readonly children = new Map<number, KbCategoryRow[]>();
  readonly nonLawTypes: KbNonLawTypeMap;

  constructor(categories: Iterable<KbCategoryRow>) {
    const all = [...categories].filter(Boolean);
    this.nonLawTypes = new KbNonLawTypeMap(all);

    for (const c of all) {
      this.byId.set(c.categoryId, c);
      if (c.parentCategoryId !== null) {
        const list = this.children.get(c.parentCategoryId) ?? [];
        list.push(c);
        this.children.set(c.parentCategoryId, list);
      }
      const code = (c.categoryCode ?? '').trim().toUpperCase();
      if (code && !this.byCode.has(code)) this.byCode.set(code, c);
    }
  }

  private find(code: string): KbCategoryRow | undefined {
    return this.byCode.get(code.trim().toUpperCase());
  }

  private isUnder(category: KbCategoryRow, rootCode: string): boolean {
    return isRootOrUnder(this.byId, category.categoryId, rootCode);
  }

  /** หมวดกฎหมายจากรหัส 5 ตัวแรก — ต้องมีในระบบ, ใช้งานอยู่ และอยู่ใต้ LW (ไม่ใช่ LW เอง) */
  tryResolveLaw(lawCode: string | null | undefined): CategoryResolution {
    const code = (lawCode ?? '').trim();
    if (code.length === 0) return fail('ไม่พบรหัสกฎหมาย (5 ตัวแรกของ Code รวม)');

    const found = this.find(code);
    if (!found)
      return fail(
        `ไม่พบหมวดกฎหมายรหัส "${code}" ในระบบ (ต้องมีหมวดใต้ "กฎหมาย" ที่ CategoryCode = ${code})`,
      );

    if ((found.categoryCode ?? '').trim().toUpperCase() === KbLayout.LawRootCategoryCode)
      return fail(`"${code}" เป็นหมวดรากของกฎหมาย ไม่ใช่รหัสกฎหมายรายฉบับ`);

    if (!this.isUnder(found, KbLayout.LawRootCategoryCode))
      return fail(`รหัส "${code}" ไม่ใช่หมวดกฎหมาย (ไม่อยู่ใต้หมวด "กฎหมาย")`);

    if (!found.isActive) return fail(`หมวดกฎหมาย "${code}" ถูกปิดใช้งาน`);

    return { ok: true, category: found };
  }

  /** หมวดของแถวกฎหมายจาก Code รวมเต็ม: หมวดกฎหมาย (5 ตัวแรก) แล้วเลือกหมวดปีถ้ากฎหมายนั้นแยกหมวดตามปี */
  tryResolveLawArticle(articleCode: string | null | undefined): CategoryResolution {
    const code = (articleCode ?? '').trim();
    if (code.length < KbLayout.LawCodePrefixLength)
      return fail('ไม่พบรหัสกฎหมาย (5 ตัวแรกของ Code รวม)');

    const law = this.tryResolveLaw(code.substring(0, KbLayout.LawCodePrefixLength));
    if (!law.ok) return law;
    return this.resolveLawYearCategory(law.category, code);
  }

  /**
   * เลือกหมวดที่บทความจะลงใต้ `law` (หมวดกฎหมายหรือหมวดกลุ่มพระราชกฤษฎีกา): ถ้ามีหมวดลูกรูปแบบปีต้องใช้หมวดปีตามปีใน code
   * ไม่มีหมวดลูกรูปแบบปีเลย = ใช้หมวด law เอง · แยกปีแล้วแต่ไม่พบหมวดปีนั้น = ไม่ผ่าน (กันบทความไปลงหมวดแม่ผิดที่เงียบๆ)
   */
  private resolveLawYearCategory(law: KbCategoryRow, code: string): CategoryResolution {
    const lawCode = law.categoryCode.trim();
    const splitByYear = (this.children.get(law.categoryId) ?? []).some((c) =>
      isYearCategoryCode(c.categoryCode, lawCode),
    );

    const year = getLawYear(code);
    const yearCode = year === null ? null : lawCode + year;

    if (yearCode !== null) {
      const found = this.find(yearCode);
      if (found) {
        if (found.parentCategoryId !== law.categoryId)
          return fail(
            `หมวด "${yearCode}" มีอยู่แต่ไม่ได้อยู่ใต้หมวดกฎหมาย "${law.categoryName}" (ต้องเป็นหมวดย่อยโดยตรงของหมวดนี้)`,
          );
        if (!found.isActive) return fail(`หมวดปี "${yearCode}" ถูกปิดใช้งาน`);
        return { ok: true, category: found };
      }
    }

    if (!splitByYear) return { ok: true, category: law };

    const missing: KbMissingCategory | undefined =
      year === null
        ? undefined
        : {
            categoryCode: yearCode as string,
            parentCategoryCode: lawCode,
            parentCategoryName: law.categoryName,
          };

    return fail(
      year === null
        ? `กฎหมาย "${lawCode}" แยกหมวดตามปี แต่ตัวที่ 10-12 ของ Code รวมไม่ใช่ตัวเลข จึงหาปีไม่ได้`
        : `กฎหมาย "${lawCode}" แยกหมวดตามปี แต่ไม่พบหมวดปี ${year} (ต้องสร้างหมวดย่อยรหัส ${yearCode} ใต้ "${law.categoryName}")`,
      missing,
    );
  }

  /**
   * หมวดของแถวพระราชกฤษฎีกา: หมวดมาจากรหัส 5 ตัวของคอลัมน์ "Code กฎหมายอ้างอิง (ออกตาม)" (เช่น ETR00)
   * ต้องเป็นหมวดย่อยของ DDD00 และเปิดใช้งาน · ถ้าหมวดกลุ่มแยกตามปีให้เลือกหมวดปีเหมือนกฎหมาย
   */
  tryResolveDecreeArticle(
    articleCode: string | null | undefined,
    categoryCode: string | null | undefined,
  ): CategoryResolution {
    const code = (articleCode ?? '').trim();
    const groupCode = (categoryCode ?? '').trim();
    const rootCode = KbLayout.DecreeRootCategoryCode;

    const root = this.find(rootCode);
    if (!root) {
      const lawRoot = this.find(KbLayout.LawRootCategoryCode);
      return fail(
        `ไม่พบหมวด "พระราชกฤษฎีกา" (${rootCode}) ในระบบ — กรุณาสร้างหมวดนี้ใต้ "กฎหมาย" (${KbLayout.LawRootCategoryCode}) ก่อน`,
        {
          categoryCode: rootCode,
          parentCategoryCode: KbLayout.LawRootCategoryCode,
          parentCategoryName: lawRoot?.categoryName ?? null,
        },
      );
    }

    const group = this.find(groupCode);
    if (!group)
      return fail(
        `ไม่พบหมวดพระราชกฤษฎีกา รหัส "${groupCode}" ในระบบ — กรุณาสร้างเป็นหมวดย่อยของ "${root.categoryName}" (${rootCode}) ก่อน`,
        {
          categoryCode: groupCode,
          parentCategoryCode: rootCode,
          parentCategoryName: root.categoryName,
        },
      );

    if (group.categoryId === root.categoryId)
      return fail(`"${groupCode}" เป็นหมวดรากของพระราชกฤษฎีกา ไม่ใช่รหัสหมวดกลุ่มของพระราชกฤษฎีกา`);

    if (!this.isUnder(group, rootCode))
      return fail(
        `หมวด "${groupCode}" ไม่ได้อยู่ใต้หมวดพระราชกฤษฎีกา "${root.categoryName}" (${rootCode})`,
      );

    if (!group.isActive) return fail(`หมวดพระราชกฤษฎีกา "${groupCode}" ถูกปิดใช้งาน`);

    return this.resolveLawYearCategory(group, code);
  }

  /** หมวดประเภทเอกสารที่ไม่ใช่กฎหมายจากรหัสประเภท (ตัวที่ 25) — ต้องใช้งานอยู่ และไม่อยู่ใต้ LW */
  tryResolveNonLawType(typeDigit: string): CategoryResolution {
    const found = this.nonLawTypes.findByDigit(typeDigit);
    if (!found) {
      return fail(
        this.nonLawTypes.isEmpty
          ? 'ยังไม่ได้ตั้งรหัสประเภทเอกสารให้หมวดใดเลย (ตั้งที่หน้าหมวดหมู่ ช่อง "รหัสประเภทเอกสาร")'
          : `ไม่มีหมวดประเภทเอกสารที่ใช้รหัส "${typeDigit}" (รหัสที่ตั้งไว้แล้ว: ${this.nonLawTypes.describeDigits()}) — ประเภทใหม่ให้สร้างหมวดแล้วตั้งรหัสที่หน้าหมวดหมู่ ช่อง "รหัสประเภทเอกสาร"`,
      );
    }

    const code = (found.categoryCode ?? '').trim();
    if (this.isUnder(found, KbLayout.LawRootCategoryCode))
      return fail(`หมวด "${code}" อยู่ใต้หมวด "กฎหมาย" ไม่ใช่ประเภทเอกสารที่ไม่ใช่กฎหมาย`);
    if (!found.isActive) return fail(`หมวดประเภทเอกสาร "${code}" ถูกปิดใช้งาน`);

    return { ok: true, category: found };
  }

  /**
   * หมวดของแถวที่ไม่ใช่กฎหมาย: (1) ตัวที่ 25 → หมวดประเภท เช่น OR00 (2) ต่อปี "2"+ตัวที่ 10-12 → หมวดปี OR002535 ต้องเป็นลูกโดยตรงและเปิดใช้งาน
   * หมวดปีไม่พบ = ไม่ผ่านพร้อม missing · หมวดประเภทไม่พบ = ไม่มี missing (ไม่มีรหัสหมวดให้แนะนำ)
   */
  tryResolveNonLawArticle(articleCode: string | null | undefined): CategoryResolution {
    const code = (articleCode ?? '').trim();
    const typeDigit = tryGetNonLawTypeDigit(code);
    if (typeDigit === null) return fail(KbLayout.NonLawCodeFormatMessage);

    const type = this.tryResolveNonLawType(typeDigit);
    if (!type.ok) return type;

    const year = getLawYear(code);
    if (year === null)
      return fail('ตัวที่ 10-12 ของ Code รวมไม่ใช่ตัวเลข จึงหาปีเพื่อเลือกหมวดไม่ได้');

    const typeCategoryCode = type.category.categoryCode.trim();
    const yearCode = typeCategoryCode + year;

    const found = this.find(yearCode);
    if (!found)
      return fail(
        `ไม่พบหมวดรหัส "${yearCode}" ในระบบ — กรุณาสร้างเป็นหมวดย่อยของ "${type.category.categoryName}" (${typeCategoryCode}) ก่อน`,
        {
          categoryCode: yearCode,
          parentCategoryCode: typeCategoryCode,
          parentCategoryName: type.category.categoryName,
        },
      );

    if (found.parentCategoryId !== type.category.categoryId)
      return fail(
        `หมวด "${yearCode}" มีอยู่แต่ไม่ได้อยู่ใต้หมวดประเภทเอกสาร "${type.category.categoryName}" (ต้องเป็นหมวดย่อยโดยตรงของหมวดนี้)`,
      );
    if (!found.isActive) return fail(`หมวดปี "${yearCode}" ถูกปิดใช้งาน`);

    return { ok: true, category: found };
  }
}

/** true ถ้า categoryCode เป็นรหัสหมวดปีของกฎหมาย lawCode: [รหัสกฎหมาย] ตามด้วยตัวเลข 4 หลัก */
export function isYearCategoryCode(
  categoryCode: string | null | undefined,
  lawCode: string,
): boolean {
  const code = (categoryCode ?? '').trim();
  if (code.length !== lawCode.length + 4) return false;
  if (!code.toUpperCase().startsWith(lawCode.toUpperCase())) return false;
  return /^\d{4}$/.test(code.substring(lawCode.length));
}
