import {
  BusinessException,
  ConflictBusinessException,
} from '../../../common/exceptions/business.exception';
import { KbCategoryRow, getDescendantIds, isRootOrUnder } from '../codes/kb-category-tree';
import { KbLayout, tryParseTypeDigit } from '../codes/kb-layout';

/** หมวดที่กำลังสร้าง (categoryId <= 0) หรือแก้ไข — ใช้ตรวจกฎก่อนเขียน */
export interface CategoryCandidate {
  categoryId: number;
  parentCategoryId: number | null;
  categoryCode: string;
}

/** ตรวจ parent: ต้องมีอยู่จริง · ห้ามเป็นตัวเอง · ห้ามเป็นหมวดย่อยของตัวเอง (ต้นไม้ไม่จำกัดความลึกจึงวนลูปได้) */
export function assertValidParent(
  candidate: CategoryCandidate,
  all: readonly KbCategoryRow[],
): void {
  const parentId = candidate.parentCategoryId;
  if (parentId === null) return;

  if (candidate.categoryId > 0 && parentId === candidate.categoryId)
    throw new BusinessException('ไม่สามารถตั้ง Parent ให้ตัวเองได้', 'CATEGORY_PARENT_SELF');

  if (!all.some((c) => c.categoryId === parentId))
    throw new BusinessException(
      `ไม่พบหมวดแม่ (CategoryID ${parentId})`,
      'CATEGORY_PARENT_NOT_FOUND',
    );

  if (candidate.categoryId > 0 && getDescendantIds(all, candidate.categoryId).has(parentId))
    throw new BusinessException(
      'ไม่สามารถตั้ง Parent เป็นหมวดย่อยของตัวเองได้',
      'CATEGORY_PARENT_CYCLE',
    );
}

/** CategoryCode ต้องไม่ซ้ำ (UQ_KMS_KBCat_Code — เทียบแบบไม่สนตัวพิมพ์เล็ก-ใหญ่ตาม collation) */
export function assertUniqueCode(
  candidate: CategoryCandidate,
  all: readonly KbCategoryRow[],
): void {
  const code = candidate.categoryCode.trim().toUpperCase();
  const dup = all.find(
    (c) => c.categoryId !== candidate.categoryId && c.categoryCode.trim().toUpperCase() === code,
  );
  if (dup)
    throw new ConflictBusinessException(
      `รหัสหมวด "${candidate.categoryCode.trim()}" ถูกใช้แล้วโดยหมวด "${dup.categoryName}"`,
      'CATEGORY_CODE_DUPLICATE',
    );
}

/**
 * ตรวจ "รหัสประเภทเอกสาร" (ImportTypeDigit = ตัวที่ 25 ของ Code รวมตอน import ไฟล์ที่ไม่ใช่กฎหมาย) แล้วคืนค่ามาตรฐาน:
 * ว่าง = ไม่ใช่หมวดประเภทเอกสาร (null) · ไม่ว่างต้องเป็นตัวเลข 1-9 ตัวเดียว · ห้ามซ้ำกับหมวดอื่น (1 รหัส = 1 ประเภท)
 * · ห้ามเป็นหมวด "กฎหมาย" (LW) หรือหมวดที่อยู่ใต้กฎหมาย (ไฟล์กฎหมายไม่ใช้ตัวที่ 25 แยกประเภท)
 */
export function normalizeImportTypeDigit(
  raw: string | null | undefined,
  candidate: CategoryCandidate,
  all: readonly KbCategoryRow[],
): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;

  const digit = tryParseTypeDigit(raw);
  if (digit === null)
    throw new BusinessException(
      `รหัสประเภทเอกสารต้องเป็นตัวเลข ${KbLayout.MinTypeDigit}-${KbLayout.MaxTypeDigit} ตัวเดียว`,
      'IMPORT_TYPE_DIGIT_INVALID',
    );

  const owner = all.find(
    (c) => c.categoryId !== candidate.categoryId && (c.importTypeDigit ?? '').trim() === digit,
  );
  if (owner)
    throw new ConflictBusinessException(
      `รหัสประเภทเอกสาร ${digit} ถูกใช้แล้วโดยหมวด "${owner.categoryName}" (${owner.categoryCode.trim()}) — 1 รหัสใช้ได้กับ 1 หมวดเท่านั้น`,
      'IMPORT_TYPE_DIGIT_IN_USE',
    );

  // หมวดนี้เป็น LW หรืออยู่ใต้ LW หรือไม่ (ไล่ ParentCategoryID ขึ้นไป โดยใช้ค่า parent/code ใหม่ของหมวดที่กำลังบันทึก)
  const byId = new Map<number, KbCategoryRow>(all.map((c) => [c.categoryId, c]));
  const probeId = candidate.categoryId > 0 ? candidate.categoryId : -1;
  byId.set(probeId, {
    categoryId: probeId,
    parentCategoryId: candidate.parentCategoryId,
    categoryCode: candidate.categoryCode,
    categoryName: '',
    sortOrder: 0,
    isActive: true,
    displayProfileId: null,
    importTypeDigit: null,
  });
  if (isRootOrUnder(byId, probeId, KbLayout.LawRootCategoryCode))
    throw new BusinessException(
      'หมวดกฎหมาย (LW) และหมวดที่อยู่ใต้กฎหมายตั้งรหัสประเภทเอกสารไม่ได้ — รหัสนี้ใช้กับประเภทเอกสารที่ไม่ใช่กฎหมายเท่านั้น',
      'IMPORT_TYPE_DIGIT_NOT_ALLOWED',
    );

  return digit;
}
