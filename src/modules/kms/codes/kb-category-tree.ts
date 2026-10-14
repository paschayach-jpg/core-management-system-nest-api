import { KbLayout, tryParseTypeDigit } from './kb-layout';

/**
 * หมวดหนึ่งแถวของ KMS.m_KBCategory (รูปแบบที่ฟังก์ชันล้วนในโฟลเดอร์ codes/ ใช้) — property ครบทุกตัว (ไม่มี optional)
 * เพื่อให้เทสต์ประกอบข้อมูลง่าย · แปลงจาก entity ด้วย `toCategoryRow`
 */
export interface KbCategoryRow {
  categoryId: number;
  parentCategoryId: number | null;
  categoryCode: string;
  categoryName: string;
  sortOrder: number;
  isActive: boolean;
  displayProfileId: number | null;
  importTypeDigit: string | null;
}

export interface KbCategoryTreeItem<T extends KbCategoryRow = KbCategoryRow> {
  category: T;
  /** 0 = root */
  depth: number;
}

/** แปลง entity/แถว SQL (property อาจเป็น undefined) เป็น KbCategoryRow */
export function toCategoryRow(c: {
  categoryId: number;
  parentCategoryId?: number | null;
  categoryCode: string;
  categoryName: string;
  sortOrder?: number | null;
  isActive?: boolean | null;
  displayProfileId?: number | null;
  importTypeDigit?: string | null;
}): KbCategoryRow {
  return {
    categoryId: c.categoryId,
    parentCategoryId: c.parentCategoryId ?? null,
    categoryCode: c.categoryCode,
    categoryName: c.categoryName,
    sortOrder: c.sortOrder ?? 0,
    isActive: c.isActive !== false,
    displayProfileId: c.displayProfileId ?? null,
    importTypeDigit: c.importTypeDigit === null ? null : (c.importTypeDigit?.trim() ?? null),
  };
}

const byName = (a: string, b: string) => (a ?? '').localeCompare(b ?? '', 'th');

function sorted<T extends KbCategoryRow>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => a.sortOrder - b.sortOrder || byName(a.categoryName, b.categoryName),
  );
}

/**
 * เรียงหมวดเป็นลำดับ tree: root ก่อน แต่ละหมวดตามด้วยลูกหลาน (เรียง SortOrder แล้วชื่อ) — พอร์ตจาก KBCategoryTree.Flatten
 * หมวดที่ parent ไม่อยู่ในรายการ (เช่น parent ถูกปิดใช้งานเมื่อ activeOnly) ถือเป็น root · กันวงวน parent
 * ลึกกี่ชั้นก็ได้ (ไม่ใช้ recursion เกินความจำเป็น: ความลึกจริงน้อย แต่กัน stack ด้วย visited)
 */
export function flattenTree<T extends KbCategoryRow>(
  categories: Iterable<T> | null | undefined,
  activeOnly: boolean,
): KbCategoryTreeItem<T>[] {
  const all = [...(categories ?? [])].filter((c) => c && (!activeOnly || c.isActive));
  const ids = new Set(all.map((c) => c.categoryId));

  const childrenOf = new Map<number, T[]>();
  const roots: T[] = [];
  for (const c of all) {
    const p = c.parentCategoryId;
    if (p !== null && p !== c.categoryId && ids.has(p)) {
      const list = childrenOf.get(p) ?? [];
      list.push(c);
      childrenOf.set(p, list);
    } else {
      roots.push(c);
    }
  }

  const result: KbCategoryTreeItem<T>[] = [];
  const visited = new Set<number>();

  const walk = (start: T, startDepth: number) => {
    // เดินแบบ stack เพื่อไม่ผูกกับความลึก
    const stack: { node: T; depth: number }[] = [{ node: start, depth: startDepth }];
    while (stack.length > 0) {
      const { node, depth } = stack.pop() as { node: T; depth: number };
      if (visited.has(node.categoryId)) continue;
      visited.add(node.categoryId);
      result.push({ category: node, depth });
      const kids = sorted(childrenOf.get(node.categoryId) ?? []);
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], depth: depth + 1 });
    }
  };

  for (const root of sorted(roots)) walk(root, 0);
  // เหลือ = อยู่ในวงวน parent (ไล่ไม่ถึงจาก root) — ใส่ท้ายเป็น root ไม่ให้หาย
  for (const rest of sorted(all.filter((c) => !visited.has(c.categoryId)))) walk(rest, 0);

  return result;
}

/** CategoryID ของลูกหลานทุกชั้นของ categoryId (ไม่รวมตัวเอง · รวมหมวดที่ปิดใช้งาน) */
export function getDescendantIds(
  categories: Iterable<KbCategoryRow> | null | undefined,
  categoryId: number,
): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const c of categories ?? []) {
    if (c && c.parentCategoryId !== null) {
      const list = childrenOf.get(c.parentCategoryId) ?? [];
      list.push(c.categoryId);
      childrenOf.set(c.parentCategoryId, list);
    }
  }

  const result = new Set<number>();
  const queue: number[] = [categoryId];
  while (queue.length > 0) {
    const children = childrenOf.get(queue.shift() as number);
    if (!children) continue;
    for (const child of children) {
      if (child !== categoryId && !result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

function indexById<T extends KbCategoryRow>(categories: Iterable<T> | null | undefined) {
  const byId = new Map<number, T>();
  for (const c of categories ?? []) if (c) byId.set(c.categoryId, c);
  return byId;
}

/** เส้นทางจาก root ถึงหมวด เช่น "กฎหมาย › พ.ร.บ. ประกันชีวิต › พ.ร.บ. ประกันชีวิต2535" — ว่างถ้าไม่พบหมวด */
export function getPath(
  categories: Iterable<KbCategoryRow> | null | undefined,
  categoryId: number,
  separator = ' > ',
): string {
  const byId = indexById(categories);
  const names: string[] = [];
  const visited = new Set<number>();
  let id: number | null = categoryId;
  while (id !== null) {
    const current = byId.get(id);
    if (!current || visited.has(id)) break;
    visited.add(id);
    names.unshift(current.categoryName ?? '');
    id = current.parentCategoryId;
  }
  return names.join(separator);
}

/** true ถ้า categoryId คือหมวดกฎหมายราก (LW) หรืออยู่ใต้หมวดนั้น */
export function isLawRootOrUnder(
  categories: Iterable<KbCategoryRow> | null | undefined,
  categoryId: number,
): boolean {
  return isRootOrUnder(indexById(categories), categoryId, KbLayout.LawRootCategoryCode);
}

/** true ถ้าหมวด categoryId คือหมวดที่ CategoryCode = rootCode เอง หรืออยู่ใต้หมวดนั้น (กันวงวน) */
export function isRootOrUnder(
  byId: Map<number, KbCategoryRow>,
  categoryId: number,
  rootCode: string,
): boolean {
  const visited = new Set<number>();
  let id: number | null = categoryId;
  while (id !== null) {
    const current = byId.get(id);
    if (!current || visited.has(id)) return false;
    visited.add(id);
    if ((current.categoryCode ?? '').trim().toUpperCase() === rootCode.toUpperCase()) return true;
    id = current.parentCategoryId;
  }
  return false;
}

/** DisplayProfileID ที่มีผลจริงของหมวด = ของหมวดเองหรือหมวดแม่ใกล้สุดที่ตั้งไว้ (null = ไม่มี profile) */
export function getEffectiveDisplayProfileId(
  categories: Iterable<KbCategoryRow> | null | undefined,
  categoryId: number,
): number | null {
  const byId = indexById(categories);
  const visited = new Set<number>();
  let id: number | null = categoryId;
  while (id !== null) {
    const current = byId.get(id);
    if (!current || visited.has(id)) break;
    visited.add(id);
    if (current.displayProfileId !== null) return current.displayProfileId;
    id = current.parentCategoryId;
  }
  return null;
}

/**
 * ตาราง "รหัสประเภทเอกสาร (ตัวที่ 25 ของ Code รวม) → หมวดประเภทเอกสารที่ไม่ใช่กฎหมาย" สร้างจากรายการหมวด
 * (master = m_KBCategory.ImportTypeDigit) · รวมหมวดที่ปิดใช้งานด้วย · รหัสซ้ำ (ไม่ควรเกิดเพราะมี unique index) ใช้หมวดแรกที่เจอ
 */
export class KbNonLawTypeMap {
  private readonly byDigit = new Map<string, KbCategoryRow>();

  constructor(categories: Iterable<KbCategoryRow>) {
    for (const c of categories) {
      const digit = c ? tryParseTypeDigit(c.importTypeDigit) : null;
      if (digit && !this.byDigit.has(digit)) this.byDigit.set(digit, c);
    }
  }

  get isEmpty(): boolean {
    return this.byDigit.size === 0;
  }

  /** หมวดประเภทเอกสารทั้งหมดเรียงตามรหัส (1, 2, 3, ...) */
  get types(): KbCategoryRow[] {
    return [...this.byDigit.keys()].sort().map((d) => this.byDigit.get(d) as KbCategoryRow);
  }

  findByDigit(digit: string): KbCategoryRow | null {
    return this.byDigit.get(digit) ?? null;
  }

  /** หมวดประเภทเอกสารของ Code รวมแบบไม่ใช่กฎหมาย — null ถ้ารูปแบบไม่ใช่หรือไม่มีหมวดที่ใช้รหัสตัวที่ 25 นั้น */
  findByArticleCode(articleCode: string | null | undefined): KbCategoryRow | null {
    const code = articleCode?.trim();
    if (!code || code.length !== KbLayout.LawCodeLength) return null;
    if (code.endsWith(KbLayout.LawCodeSuffix)) return null;
    return this.findByDigit(code[KbLayout.NonLawTypeDigitIndex]);
  }

  getTypeLabel(digit: string): string {
    return this.findByDigit(digit)?.categoryName?.trim() ?? '';
  }

  /** รหัสที่ตั้งไว้แล้วแบบอ่านง่าย เช่น "1-6", "1, 2", "1-3, 5" — ว่างถ้ายังไม่มี */
  describeDigits(): string {
    const digits = [...this.byDigit.keys()].sort().map(Number);
    const runs: string[] = [];
    let start = -1;
    let end = -1;
    const flush = () => {
      if (start < 0) return;
      if (end === start) runs.push(String(start));
      else if (end === start + 1) runs.push(`${start}, ${end}`);
      else runs.push(`${start}-${end}`);
    };
    for (const d of digits) {
      if (start >= 0 && d === end + 1) {
        end = d;
        continue;
      }
      flush();
      start = end = d;
    }
    flush();
    return runs.join(', ');
  }
}
