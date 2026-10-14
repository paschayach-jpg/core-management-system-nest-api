import type { KbCategoryRow } from '../codes/kb-category-tree';
import { DISPLAY_SLOTS } from '../import-templates/kb-column-catalog';

export interface SlotSetting {
  label: string;
  visible: boolean;
}

export const SLOT_KEYS: readonly string[] = DISPLAY_SLOTS.map((s) => s.slotKey);

/** ค่าเริ่มต้นของทุก slot (ใช้เมื่อหมวดไม่ผูก profile หรือ profile ไม่ได้ตั้ง slot นั้น) */
export function defaultSettings(): Record<string, SlotSetting> {
  const out: Record<string, SlotSetting> = {};
  for (const s of DISPLAY_SLOTS)
    out[s.slotKey] = { label: s.defaultLabel, visible: s.defaultVisible };
  return out;
}

/**
 * Profile ที่มีผลจริงของหมวด (GetEffectiveDisplaySettings เดิม): เดินจากหมวดขึ้นไปหาหมวดแม่ที่ตั้ง profile ไว้ **และ profile นั้นยังเปิดใช้งาน**
 * profile ที่ปิดไปแล้ว (หรือถูกลบ) ถือว่าไม่ได้ตั้งที่ระดับนั้น → เดินขึ้นไปต่อ · ไม่พบเลย = null (ใช้ค่าเริ่มต้นทั้งหมด)
 */
export function resolveEffectiveProfileId(
  categories: readonly KbCategoryRow[],
  profiles: ReadonlyMap<number, { isActive: boolean }>,
  categoryId: number,
): number | null {
  const byId = new Map(categories.map((c) => [c.categoryId, c]));
  const visited = new Set<number>();
  let id: number | null = categoryId;
  while (id !== null) {
    const cat = byId.get(id);
    if (!cat || visited.has(id)) return null;
    visited.add(id);
    if (cat.displayProfileId !== null && profiles.get(cat.displayProfileId)?.isActive)
      return cat.displayProfileId;
    id = cat.parentCategoryId;
  }
  return null;
}

/** ซ้อนค่าที่ profile ตั้งไว้ทับค่าเริ่มต้น (เฉพาะ slot ที่รู้จัก) */
export function mergeSettings(
  columns: readonly { slotKey: string; displayLabel: string; isVisible: boolean }[],
): Record<string, SlotSetting> {
  const result = defaultSettings();
  for (const c of columns) {
    const key = SLOT_KEYS.find((k) => k.toLowerCase() === c.slotKey.toLowerCase());
    if (key) result[key] = { label: c.displayLabel, visible: c.isVisible };
  }
  return result;
}
