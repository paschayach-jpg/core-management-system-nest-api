import {
  KbCategoryRow,
  getEffectiveDisplayProfileId,
  isLawRootOrUnder,
} from '../codes/kb-category-tree';
import { KbLayout } from '../codes/kb-layout';

export interface MoveCandidate {
  articleId: number;
  categoryId: number;
}

/**
 * คำเตือนก่อนย้ายบทความ (ไม่บล็อก — ผู้ใช้ต้องยืนยัน) พอร์ตจาก KBArticleMoveService.PreviewMove:
 *  - ย้ายข้าม กฎหมาย ↔ ไม่ใช่กฎหมาย: cross-reference ใน KB tree อาจหาย/เปลี่ยน
 *  - ปลายทางคือหมวดกฎหมายหลัก (LW)
 *  - ปลายทางมีหมวดย่อยที่เปิดใช้งาน (เช่น หมวดรายปี): import ครั้งต่อไปจะนำบทความใหม่ไปลงหมวดย่อย
 *  - Display Profile ที่มีผลต่างจากเดิม
 * @param toMove บทความที่จะถูกย้ายจริง (ไม่รวมที่อยู่หมวดปลายทางอยู่แล้ว)
 */
export function computeMoveWarnings(
  all: readonly KbCategoryRow[],
  dest: KbCategoryRow,
  toMove: readonly MoveCandidate[],
): string[] {
  const warnings: string[] = [];
  if (toMove.length === 0) return warnings;

  const destIsLaw = isLawRootOrUnder(all, dest.categoryId);
  const crossKind = toMove.filter((a) => isLawRootOrUnder(all, a.categoryId) !== destIsLaw).length;
  if (crossKind > 0)
    warnings.push(
      `${crossKind} บทความจะย้ายข้ามระหว่างกฎหมายกับเอกสารที่ไม่ใช่กฎหมาย — ความเชื่อมโยง (cross-reference) ของบทความเหล่านี้ใน KB tree อาจหายหรือเปลี่ยนไป`,
    );

  if ((dest.categoryCode ?? '').trim().toUpperCase() === KbLayout.LawRootCategoryCode)
    warnings.push('หมวดปลายทางคือหมวดกฎหมายหลัก (LW) — ปกติบทความกฎหมายอยู่ใต้หมวดกฎหมายแต่ละฉบับ');

  const activeChildren = all.filter(
    (c) => c.isActive && c.parentCategoryId === dest.categoryId,
  ).length;
  if (activeChildren > 0)
    warnings.push(
      `หมวดปลายทางมีหมวดย่อย ${activeChildren} หมวด (เช่น หมวดแยกตามปี) — การนำเข้า Excel ครั้งต่อไปจะนำบทความใหม่ไปลงหมวดย่อย ไม่ใช่หมวดนี้`,
    );

  const destProfile = getEffectiveDisplayProfileId(all, dest.categoryId);
  const diffProfile = toMove.filter(
    (a) => getEffectiveDisplayProfileId(all, a.categoryId) !== destProfile,
  ).length;
  if (diffProfile > 0)
    warnings.push(
      `${diffProfile} บทความจะใช้รูปแบบการแสดงผลของหมวดปลายทาง (Display Profile ต่างจากเดิม)`,
    );

  return warnings;
}
