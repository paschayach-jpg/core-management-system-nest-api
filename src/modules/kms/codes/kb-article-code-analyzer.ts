import { KbCategoryResolver, KbMissingCategory } from './kb-category-resolver';
import { KbCategoryRow } from './kb-category-tree';
import { KbLayout, KbLayoutType, describeFileKind, detectLayoutFromCode } from './kb-layout';

/** ผลวิเคราะห์ Code รวม (ArticleCode 29 ตัว) ของบทความที่พิมพ์จากหน้า editor — กฎเดียวกับตอน import */
export interface KbArticleCodeAnalysis {
  /** ชนิดจาก Code · null = ผิดรูปแบบ */
  layout: KbLayoutType | null;
  /** หมวดที่ใช้เก็บบทความ (หมวดกฎหมาย/หมวดปี/หมวดประเภทเอกสาร) · null ถ้ายังหาไม่ได้ */
  category: KbCategoryRow | null;
  /** ชื่อบทความที่คำนวณจาก Code ("มาตรา N" ของกฎหมาย/พระราชกฤษฎีกา) · null = ผู้ใช้ตั้งชื่อเอง (ไม่ใช่กฎหมาย) */
  title: string | null;
  /** ArticleCode ที่เก็บลง DB: กฎหมาย/พระราชกฤษฎีกาเก็บ 24 ตัวแรก · ไม่ใช่กฎหมายเก็บเต็ม 29 ตัว (เหมือน import เพื่อให้ import ซ้ำเจอบทความเดิม) */
  storedCode: string | null;
  /** true = หมวดคำนวณจาก Code ผู้ใช้เลือกเองไม่ได้ (กฎหมาย/ไม่ใช่กฎหมาย) · false = พระราชกฤษฎีกาต้องเลือกหมวดกลุ่มเอง */
  categoryFromCode: boolean;
  /** Code มาตราของกฎหมายแม่ (24 ตัวแรก) ของบทความที่ไม่ใช่กฎหมาย — ใช้ผูก link อัตโนมัติ */
  parentCode: string | null;
  /** ข้อความไทยบอกเหตุที่ใช้ไม่ได้/ยังต้องทำอะไรต่อ · null = ผ่านทั้งหมด */
  error: string | null;
  /** หมวดที่ต้องสร้างก่อน (ถ้าเป็นสาเหตุที่ไม่ผ่าน) */
  missingCategory: KbMissingCategory | null;
  isValid: boolean;
  layoutLabel: string;
}

export const CODE_FORMAT_MESSAGE =
  'Code รวมต้องยาว 29 ตัว — กฎหมาย: ตัวที่ 4-5 = 00 และ 5 ตัวสุดท้าย = 00000; พระราชกฤษฎีกา: ตัวที่ 4-5 ไม่ใช่ 00 และ 5 ตัวสุดท้าย = 00000; ' +
  'ที่ไม่ใช่กฎหมาย: 5 ตัวสุดท้ายไม่ใช่ 00000 และตัวที่ 25 เป็นรหัสประเภทเอกสาร (1-9)';

function appendMissing(error: string, missing: KbMissingCategory | undefined): string {
  if (!missing?.categoryCode) return error;
  return `${error} (ต้องสร้างหมวด ${missing.categoryCode}${
    missing.parentCategoryCode ? ' ใต้ ' + missing.parentCategoryCode : ''
  } ก่อน)`;
}

/** ผลที่ยังไม่มีข้อสรุปใด ๆ ใช้เป็นฐานแล้วเติมทีละขั้น */
function blank(): KbArticleCodeAnalysis {
  return {
    layout: null,
    category: null,
    title: null,
    storedCode: null,
    categoryFromCode: false,
    parentCode: null,
    error: null,
    missingCategory: null,
    isValid: false,
    layoutLabel: '',
  };
}

function finish(r: KbArticleCodeAnalysis): KbArticleCodeAnalysis {
  r.isValid = r.error === null;
  r.layoutLabel = describeFileKind(r.layout);
  return r;
}

/**
 * ตรวจ/แยก Code รวม (29 ตัว) ของบทความใหม่ที่สร้างจากหน้า editor ด้วยกฎเดียวกับตอน import (`KBArticleCodeAnalyzer.Analyze`)
 * — ชนิดจาก `detectLayoutFromCode` และหมวดจาก `KbCategoryResolver` ทำให้ editor สร้างบทความที่ import รับได้เสมอ
 * ไม่เรียก DB (รับรายการหมวดจากผู้เรียก) · ตรวจ Code ซ้ำ/กฎหมายแม่มีจริงที่ชั้น service
 *
 * @param categories หมวดทั้งหมด (รวมที่ปิดใช้งาน เพื่อให้ resolver ตัดสินเอง)
 * @param chosenGroupCategory หมวดกลุ่มพระราชกฤษฎีกาที่ผู้ใช้เลือก (ใช้เฉพาะ Decree)
 */
export function analyzeArticleCode(
  categories: Iterable<KbCategoryRow>,
  articleCode: string | null | undefined,
  chosenGroupCategory: KbCategoryRow | null | undefined,
): KbArticleCodeAnalysis {
  const r = blank();
  const code = (articleCode ?? '').trim();

  if (code.length === 0) {
    r.error = 'กรุณากรอก Code รวม (29 ตัว)';
    return finish(r);
  }

  r.layout = detectLayoutFromCode(code);
  if (r.layout === null) {
    r.error = CODE_FORMAT_MESSAGE;
    return finish(r);
  }

  r.storedCode = r.layout === KbLayout.NonLaw ? code : code.substring(0, KbLayout.ParentCodeLength);
  const resolver = new KbCategoryResolver(categories ?? []);

  if (r.layout === KbLayout.NonLaw) {
    const res = resolver.tryResolveNonLawArticle(code);
    if (!res.ok) {
      r.error = appendMissing(res.error, res.missing);
      r.missingCategory = res.missing ?? null;
      return finish(r);
    }
    r.category = res.category;
    r.categoryFromCode = true;
    r.parentCode = code.substring(0, KbLayout.ParentCodeLength);
    return finish(r);
  }

  // Law / Decree: ชื่อ = "มาตรา N" จากตัวที่ 6-9 (เหมือน validateLawRow ตอน import)
  const sectionDigits = code.substring(
    KbLayout.LawSectionStartIndex,
    KbLayout.LawSectionStartIndex + KbLayout.LawSectionDigits,
  );
  const sectionNumber = /^\d{4}$/.test(sectionDigits) ? parseInt(sectionDigits, 10) : 0;
  if (sectionNumber <= 0) {
    r.error = `เลขมาตราไม่ถูกต้อง: ตัวที่ 6-9 ของ '${code}' ต้องเป็นตัวเลข 4 หลักและมากกว่า 0`;
    return finish(r);
  }
  r.title = `มาตรา ${sectionNumber}`;

  if (r.layout === KbLayout.Law) {
    const res = resolver.tryResolveLawArticle(code);
    if (!res.ok) {
      r.error = appendMissing(res.error, res.missing);
      r.missingCategory = res.missing ?? null;
      return finish(r);
    }
    r.category = res.category;
    r.categoryFromCode = true;
    return finish(r);
  }

  // Decree: หมวดมาจากหมวดกลุ่มที่ผู้ใช้เลือก (ต้องอยู่ใต้ DDD00) ไม่ใช่จาก 5 ตัวแรกของ Code
  if (!chosenGroupCategory) {
    r.error = `เลือกหมวดกลุ่มพระราชกฤษฎีกา (หมวดย่อยของ ${KbLayout.DecreeRootCategoryCode}) ก่อน`;
    return finish(r);
  }

  const res = resolver.tryResolveDecreeArticle(code, chosenGroupCategory.categoryCode);
  if (!res.ok) {
    r.error = appendMissing(res.error, res.missing);
    r.missingCategory = res.missing ?? null;
    return finish(r);
  }
  r.category = res.category;
  return finish(r);
}
