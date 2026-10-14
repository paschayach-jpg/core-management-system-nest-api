/**
 * 'ConfigID' → 'configId', 'OrgUnitNameTH' → 'orgUnitNameTh', 'ADUserName' → 'adUserName', 'URLPath' → 'urlPath'
 * กติกาเดียวกับ tools/codegen/naming.ts (ที่ตั้งชื่อ property ของ entity) เพื่อให้ผลจาก SP กับ entity ใช้ชื่อตรงกัน
 */
export function camelKey(key: string): string {
  const parts = key
    .split(/[_\s]+/)
    .filter(Boolean)
    .flatMap((p) => p.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+|[A-Z]/g) ?? [p]);
  return parts
    .map((p, i) => {
      const lower = p.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/** แปลงชื่อคอลัมน์ PascalCase จาก Stored Procedure เป็น camelCase (รองรับ array) — ค่า Date/Buffer ไม่ถูกแตะ */
export function camelizeKeys<T = Record<string, unknown>>(row: unknown): T {
  if (Array.isArray(row)) return row.map((r) => camelizeKeys(r)) as unknown as T;
  if (row === null || typeof row !== 'object' || row instanceof Date || Buffer.isBuffer(row)) return row as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) out[camelKey(k)] = v;
  return out as T;
}
