import { KbCategoryResolver } from '../codes/kb-category-resolver';
import { KbLayout, isNonLawCodeFormat, tryParseLawReference } from '../codes/kb-layout';
import { KbImportRow } from './kb-import-row';
import type { ExistingArticleInfo, KbImportStore } from './kb-import.store';
import { isSqlDatetimeRange } from './kb-dates';
import { toPlainText } from './kb-text';
import { getUpdateColumns } from './kb-import-patch';

/** ความยาวสูงสุดของคอลัมน์ข้อความใน t_KBArticle (ตัวอักษร) — เกินจะ error ที่ SQL "string or binary data would be truncated" */
const MAX_TITLE = 500;
const MAX_TITLE_CATEGORY = 500;
const MAX_TAGS = 500;

const CHUNK = 1000; // SQL Server รับ parameter ได้ราว 2100 ต่อคำสั่ง

/** ข้อความ preview ของแถวที่บทความมีอยู่แล้ว: จะ update field ไหน */
export function buildUpdateNote(row: KbImportRow, isLaw: boolean): string {
  return `ArticleCode '${row.articleCode}' มีในระบบแล้ว (ArticleID ${row.existingArticleId}) — จะอัปเดต: ${getUpdateColumns(row, isLaw).join(', ')}`;
}

/** รวม ArticleCode (และกฎหมายแม่) ที่แถวจะใช้ เพื่อค้น DB ครั้งเดียวเป็นชุดแทนค้นทีละแถว */
function collectCodes(rows: KbImportRow[]): string[] {
  const codes = new Set<string>();
  const add = (c: string | null | undefined) => {
    if (c) codes.add(c);
  };

  for (const row of rows) {
    if (row.status === 'Error') continue;
    const raw = row.colA ?? '';
    if (row.rowKind === 'NonLaw') {
      const lines = raw
        .split(/\r\n|\n|\r/)
        .map((l) => l.trim())
        .filter(Boolean);
      const mapped = lines.find((l) => isNonLawCodeFormat(l)) ?? lines[0];
      add(mapped);
      if (mapped && mapped.length >= KbLayout.ParentCodeLength)
        add(mapped.substring(0, KbLayout.ParentCodeLength));
    } else {
      if (raw.length >= KbLayout.ParentCodeLength) add(raw.substring(0, KbLayout.ParentCodeLength));
      if (row.rawLawReference !== null) {
        const ref = tryParseLawReference(row.rawLawReference);
        for (const p of ref.parentCodes) add(p);
      }
    }
  }
  return [...codes];
}

/** ค้นทีละชุดแล้วรวมเป็น Map เดียว */
async function lookupAll(
  store: KbImportStore,
  codes: string[],
): Promise<Map<string, ExistingArticleInfo>> {
  const all = new Map<string, ExistingArticleInfo>();
  for (let i = 0; i < codes.length; i += CHUNK) {
    const part = await store.findArticlesByCodes(codes.slice(i, i + CHUNK));
    for (const [k, v] of part) all.set(k.toLowerCase(), v);
  }
  return all;
}

interface Ctx {
  resolver: KbCategoryResolver;
  articles: Map<string, ExistingArticleInfo>;
  seenCodes: Set<string>;
}

/** ArticleID ของบทความที่ไม่ถูกลบ (GetByCode เดิม) · 0 = ไม่พบ */
function liveArticleId(ctx: Ctx, code: string): number {
  const info = ctx.articles.get(code.toLowerCase());
  return info && !info.isDelete ? info.articleId : 0;
}

/**
 * ตรวจแต่ละแถวและตั้ง status/statusNote (พอร์ตจาก KBImportProcessor.ValidateRows) — อ่าน DB อย่างเดียว ไม่เขียน
 * CategoryID ของแต่ละแถวหาจาก ArticleCode ของแถวนั้น (ไม่ผูกกับ Template) แถวที่หาหมวดไม่ได้เป็น Error รายแถว
 * ArticleCode ที่มีในระบบแล้วไม่ใช่ Error/Skip: ตั้ง existingArticleId แล้วเป็น Valid (จะ UPDATE บทความเดิมตอน import)
 */
export async function validateImportRows(rows: KbImportRow[], store: KbImportStore): Promise<void> {
  const categories = await store.loadCategories();
  const ctx: Ctx = {
    resolver: new KbCategoryResolver(categories),
    articles: await lookupAll(store, collectCodes(rows)),
    seenCodes: new Set<string>(),
  };

  for (const row of rows) {
    // แถวที่ตัวอ่านไฟล์ตั้ง Error ไว้แล้ว (อ่านไม่ได้) คงเดิม
    if (row.status === 'Error') continue;

    if (row.rowKind === 'NonLaw') validateNonLawRow(row, ctx);
    else if (row.rowKind === 'Law') validateLawRow(row, ctx);
    else {
      row.status = 'Error';
      row.statusNote = `ไม่รู้จัก RowKind '${String(row.rowKind)}'`;
    }
  }
}

/** ตรวจวันที่ที่กรอกมาต้องแปลงได้ และอยู่ในช่วงที่ DB เก็บได้ */
function checkDates(
  row: KbImportRow,
  errors: string[],
  label: { published: string; effective: string },
) {
  if (row.rawPublishedDate && !row.publishedDateParsed)
    errors.push(`${label.published}: ไม่สามารถแปลงวันที่ได้ — '${row.rawPublishedDate}'`);
  else if (row.publishedDateParsed && !isSqlDatetimeRange(row.publishedDateParsed))
    errors.push(
      `${label.published}: วันที่อยู่นอกช่วงที่ระบบเก็บได้ (ต้องตั้งแต่ ค.ศ. 1753) — '${row.rawPublishedDate}'`,
    );

  if (row.rawEffectiveDate && !row.effectiveDateParsed)
    errors.push(`${label.effective}: ไม่สามารถแปลงวันที่ได้ — '${row.rawEffectiveDate}'`);
  else if (row.effectiveDateParsed && !isSqlDatetimeRange(row.effectiveDateParsed))
    errors.push(
      `${label.effective}: วันที่อยู่นอกช่วงที่ระบบเก็บได้ (ต้องตั้งแต่ ค.ศ. 1753) — '${row.rawEffectiveDate}'`,
    );
}

function checkLength(value: string | null, max: number, label: string, errors: string[]) {
  if (value && value.length > max)
    errors.push(`${label}: ยาวเกิน ${max} ตัวอักษร (พบ ${value.length})`);
}

// ── กฎหมาย / พระราชกฤษฎีกา ──────────────────────────────────────────

function validateLawRow(row: KbImportRow, ctx: Ctx): void {
  const raw = row.colA;

  // Code รวมว่าง ⇒ Skip
  if (!raw) {
    row.status = 'Skip';
    row.statusNote = 'คอลัมน์ A (Code รวม) ว่าง — ข้ามแถวนี้';
    return;
  }

  if (raw.length !== KbLayout.LawCodeLength) {
    row.status = 'Error';
    row.statusNote = `Code รวม: ความยาวไม่ถูกต้อง (ต้อง ${KbLayout.LawCodeLength} ตัว แต่พบ ${raw.length}) — '${raw}'`;
    return;
  }
  if (raw.substring(KbLayout.ParentCodeLength) !== KbLayout.LawCodeSuffix) {
    row.status = 'Error';
    row.statusNote = `Code รวม: 5 ตัวสุดท้ายต้องเป็น 00000 — '${raw}'`;
    return;
  }

  // พระราชกฤษฎีกา (Template ที่ map LawReference): หมวดมาจากรหัส 5 ตัวของ "Code กฎหมายอ้างอิง" ไม่ใช่ 5 ตัวแรกของ Code รวม
  const isDecree = row.rawLawReference !== null;
  let decreeParentCodes: string[] = [];

  let resolution;
  if (isDecree) {
    const ref = tryParseLawReference(row.rawLawReference);
    if (!ref.ok) {
      row.status = 'Error';
      row.statusNote = ref.error ?? 'Code กฎหมายอ้างอิงผิดรูปแบบ';
      return;
    }
    decreeParentCodes = ref.parentCodes;
    resolution = ctx.resolver.tryResolveDecreeArticle(raw, ref.categoryCode);
  } else {
    resolution = ctx.resolver.tryResolveLawArticle(raw);
  }

  if (!resolution.ok) {
    row.missingCategory = resolution.missing ?? null;
    row.status = 'Error';
    row.statusNote = `${isDecree ? 'Code กฎหมายอ้างอิง' : 'Code รวม'}: ${resolution.error} — '${raw}'`;
    return;
  }
  const lawCategory = resolution.category;
  const code = raw.substring(0, KbLayout.ParentCodeLength);

  // ซ้ำกับแถวก่อนหน้าในไฟล์ ⇒ Skip
  if (ctx.seenCodes.has(code.toLowerCase())) {
    row.status = 'Skip';
    row.statusNote = `ArticleCode '${code}' ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน — ข้ามแถวนี้`;
    return;
  }

  // มีในระบบแล้ว → UPDATE บทความเดิมตอน import (ถูก soft delete = Error)
  const info = ctx.articles.get(code.toLowerCase());
  if (info) {
    if (info.isDelete) {
      row.status = 'Error';
      row.statusNote = `ArticleCode '${code}' มีอยู่ในระบบแต่ถูกลบ (IsDelete) — อัปเดตข้อมูลไม่ได้`;
      ctx.seenCodes.add(code.toLowerCase());
      return;
    }
    row.existingArticleId = info.articleId;
  }
  ctx.seenCodes.add(code.toLowerCase());

  // บทความเดิม: เซลล์เนื้อหาว่าง = คงเนื้อหาเดิม จึงไม่บังคับกรอก
  const isExisting = row.existingArticleId > 0;
  const errors: string[] = [];

  // เลขมาตรา: ตัวที่ 6-9 ของค่า Title ที่ Template map ไว้ (ถ้ามี) ไม่งั้นของ Code รวม
  const titleSource = row.rawTitle && row.rawTitle.trim() ? row.rawTitle.trim() : raw;
  const sectionDigits =
    titleSource.length >= KbLayout.LawSectionStartIndex + KbLayout.LawSectionDigits
      ? titleSource.substring(
          KbLayout.LawSectionStartIndex,
          KbLayout.LawSectionStartIndex + KbLayout.LawSectionDigits,
        )
      : '';
  const sectionNumber = /^\d{4}$/.test(sectionDigits) ? parseInt(sectionDigits, 10) : 0;
  if (sectionNumber <= 0)
    errors.push(
      `เลขมาตราไม่ถูกต้อง: ตัวที่ 6-9 ของ '${titleSource}' ต้องเป็นตัวเลข 4 หลักและมากกว่า 0`,
    );

  // พระราชกฤษฎีกา: กฎหมายที่อ้างอิง (24 ตัว) ต้องมีบทความในระบบ — ใช้ link ไป-กลับตอน import
  if (isDecree) {
    const resolvedIds = decreeParentCodes.map((p) => liveArticleId(ctx, p));
    const notFound = decreeParentCodes.filter((_p, i) => resolvedIds[i] === 0);
    row.parentCodes = [...decreeParentCodes];
    row.resolvedParentArticleIds = resolvedIds;
    // บทความเดิม (re-upload): ไม่ใช่ Error — ข้าม link ที่หาไม่พบแล้วแจ้งเป็น Warn ตอน import
    if (notFound.length > 0 && !isExisting)
      errors.push('ไม่พบกฎหมายที่อ้างอิงในระบบ: ' + notFound.join(', '));
  }

  if (!isExisting && (!row.rawContent || !row.rawContent.trim()))
    errors.push('คอลัมน์ P (บัญญัติไว้ว่า): จำเป็นต้องระบุ');

  // ไฟล์แนบ (เฉพาะ Template ที่ map Attachment): บทความใหม่ต้องมีชื่อไฟล์ — ตัวไฟล์หาตอนนำเข้า
  if (!isExisting && row.attachmentFileName !== null && !row.attachmentFileName.trim())
    errors.push('Attachment (ชื่อไฟล์แนบ) ห้ามว่าง — ตรวจสอบว่า Template Map Attachment แล้ว');

  checkDates(row, errors, {
    published: 'คอลัมน์ N (วันที่ประกาศ)',
    effective: 'คอลัมน์ O (วันที่มีผลบังคับใช้)',
  });

  const summary = row.rawSummary && row.rawSummary.trim() ? toPlainText(row.rawSummary) : null;
  const titleCategory =
    row.rawTitleCategory && row.rawTitleCategory.trim() ? toPlainText(row.rawTitleCategory) : null;
  checkLength(titleCategory, MAX_TITLE_CATEGORY, 'กฎหมายอ้างอิง (TitleCategory)', errors);

  if (errors.length > 0) {
    row.status = 'Error';
    row.statusNote = errors.join('; ');
    return;
  }

  row.status = 'Valid';
  row.statusNote = null;
  row.articleCode = code;
  row.title = `มาตรา ${sectionNumber}`;
  row.tags = row.title;
  row.summary = summary;
  row.titleCategory = titleCategory;
  row.resolvedCategoryId = lawCategory.categoryId;
  row.resolvedCategoryName = lawCategory.categoryName;
  row.documentTypeCode = lawCategory.categoryCode;
  row.documentTypeLabel = isDecree ? 'พระราชกฤษฎีกา' : 'มาตรา';

  if (isExisting) row.statusNote = buildUpdateNote(row, true);
}

// ── ไม่ใช่กฎหมาย ─────────────────────────────────────────────────────

function validateNonLawRow(row: KbImportRow, ctx: Ctx): void {
  // ถ้าเซลล์มีหลายบรรทัด เลือกบรรทัดแรกที่เป็นรูปแบบ Code ที่ถูกต้อง (ไม่มี = บรรทัดแรก เพื่อรายงาน error)
  let mappedCode: string | null = null;
  if (row.colA !== null) {
    const lines = row.colA
      .split(/\r\n|\n|\r/)
      .map((l) => l.trim())
      .filter(Boolean);
    mappedCode = lines.find((l) => isNonLawCodeFormat(l)) ?? lines[0] ?? null;
  }
  row.articleCode = mappedCode;

  const errors: string[] = [];

  // หมวดของแถว — ตรวจก่อนอย่างอื่น: ตัวที่ 25 → หมวดประเภท แล้วต่อปีจากตัวที่ 10-12 → หมวดปี (ไม่ผูกกับ Template)
  if (mappedCode && mappedCode.trim()) {
    if (!isNonLawCodeFormat(mappedCode)) {
      errors.push(`${KbLayout.NonLawCodeFormatMessage} — '${mappedCode}'`);
    } else {
      const res = ctx.resolver.tryResolveNonLawArticle(mappedCode);
      if (res.ok) {
        row.resolvedCategoryId = res.category.categoryId;
        row.resolvedCategoryName = res.category.categoryName;
        row.documentTypeCode = res.category.categoryCode;
      } else {
        row.missingCategory = res.missing ?? null;
        const typeCategory = ctx.resolver.nonLawTypes.findByArticleCode(mappedCode);
        const typeCodeNote = typeCategory ? ` (${typeCategory.categoryCode.trim()})` : '';
        errors.push(
          `Code รวม: ตัวที่ 25 = ${mappedCode[KbLayout.NonLawTypeDigitIndex]}${typeCodeNote} — ${res.error} — '${mappedCode}'`,
        );
      }
      row.documentTypeLabel = ctx.resolver.nonLawTypes.getTypeLabel(
        mappedCode[KbLayout.NonLawTypeDigitIndex],
      );
      // กฎหมายแม่ = 24 ตัวแรกของ Code รวม (ใช้ resolve + สร้าง link ไป-กลับ)
      row.parentCodes = [mappedCode.substring(0, KbLayout.ParentCodeLength)];
    }
  }

  if (row.colA === null) {
    errors.push('Template ไม่ได้ Map ArticleCode (Code รวม)');
  } else if (!mappedCode || !mappedCode.trim()) {
    errors.push('Code รวม (ArticleCode ที่ Template map ไว้) ว่าง');
  } else if (ctx.seenCodes.has(mappedCode.toLowerCase())) {
    errors.push(`ArticleCode '${mappedCode}' ซ้ำกับแถวอื่นในไฟล์`);
  } else {
    ctx.seenCodes.add(mappedCode.toLowerCase());
    const info = ctx.articles.get(mappedCode.toLowerCase());
    if (info) {
      if (info.isDelete)
        errors.push(
          `ArticleCode '${mappedCode}' มีอยู่ในระบบแต่ถูกลบ (IsDelete) — เติมข้อมูลไม่ได้`,
        );
      else row.existingArticleId = info.articleId;
    }
  }

  // บทความเดิม: ไม่บังคับกรอก Title/เนื้อหา/ไฟล์ (ว่าง = คงค่าเดิม) — วันที่ที่กรอกมาต้องแปลงได้
  const isExisting = row.existingArticleId > 0;

  if (!isExisting) {
    if (!row.rawTitle || !row.rawTitle.trim())
      errors.push('Title (ชื่อ) ห้ามว่าง — ตรวจสอบว่า Template Map Title แล้ว');
    if (!row.rawContent || !row.rawContent.trim())
      errors.push(
        'ContentHTML (บัญญัติไว้ว่า) ห้ามว่าง — ตรวจสอบว่า Template Map ContentHTML แล้ว',
      );
    if (!row.attachmentFileName || !row.attachmentFileName.trim())
      errors.push('Attachment (ชื่อไฟล์แนบ) ห้ามว่าง — ตรวจสอบว่า Template Map Attachment แล้ว');
  }

  // ParentCodes ว่าง = Code รวมผิดรูปแบบ ซึ่งรายงาน error ไปแล้วด้านบน
  if (row.parentCodes.length > 0) {
    const ids = row.parentCodes.map((p) => liveArticleId(ctx, p));
    const notFound = row.parentCodes.filter((_p, i) => ids[i] === 0);
    row.resolvedParentArticleIds = ids.filter((id) => id > 0);
    // บทความเดิมที่หากฎหมายแม่ไม่พบ: ไม่ใช่ Error — แค่ไม่มี link กฎหมายแม่ให้เติม
    if (notFound.length > 0 && !isExisting)
      errors.push('ไม่พบกฎหมายแม่ในระบบ: ' + notFound.join(', '));
  }

  checkDates(row, errors, {
    published: 'PublishedDate (วันที่ประกาศ)',
    effective: 'EffectiveDate (วันที่มีผลบังคับใช้)',
  });

  const title = toPlainText(row.rawTitle);
  const titleCategory = toPlainText(row.rawTitleCategory);
  checkLength(title, MAX_TITLE, 'Title (ชื่อ)', errors);
  checkLength(titleCategory, MAX_TITLE_CATEGORY, 'TitleCategory', errors);
  checkLength(row.tags, MAX_TAGS, 'Tags', errors);

  if (errors.length > 0) {
    row.status = 'Error';
    row.statusNote = errors.join('; ');
    return;
  }

  row.title = title;
  row.summary = toPlainText(row.rawSummary);
  row.titleCategory = titleCategory;

  row.status = 'Valid';
  row.statusNote = isExisting ? buildUpdateNote(row, false) : null;
}
