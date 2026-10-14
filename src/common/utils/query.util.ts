import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { PaginationQueryDto } from '../dto/pagination.dto';

/** escape ตัวอักษรพิเศษของ LIKE ใน SQL Server (% _ [ ]) แล้วครอบด้วย % สำหรับค้นแบบมีคำนี้อยู่ */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_[\]]/g, (c) => `\\${c}`)}%`;
}

/** SQL Server ต้องใช้ ESCAPE clause เมื่อมี escape char — ใช้คู่กับ likeContains: `col LIKE :q ESCAPE '\\'` */
export const LIKE_ESCAPE = "ESCAPE '\\'";

/**
 * ใส่ ORDER BY จาก ?sortBy=&sortDir= โดยอนุญาตเฉพาะ field ใน whitelist (กัน SQL injection ผ่านชื่อคอลัมน์)
 * @param whitelist แผนที่ชื่อ field ใน API → นิพจน์คอลัมน์ เช่น { name: 'f.FolderName' }
 */
export function applySort<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  q: Pick<PaginationQueryDto, 'sortBy' | 'sortDir'>,
  whitelist: Record<string, string>,
  fallback: { column: string; dir?: 'ASC' | 'DESC' },
): SelectQueryBuilder<T> {
  const column =
    q.sortBy && Object.prototype.hasOwnProperty.call(whitelist, q.sortBy)
      ? whitelist[q.sortBy]
      : undefined;
  if (column) return qb.orderBy(column, q.sortDir === 'desc' ? 'DESC' : 'ASC');
  return qb.orderBy(fallback.column, fallback.dir ?? 'ASC');
}

/** SQL Server ต้องมี ORDER BY เมื่อใช้ OFFSET/FETCH — helper นี้ใส่ skip/take ให้ */
export function applyPaging<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  q: Pick<PaginationQueryDto, 'page' | 'pageSize'>,
): SelectQueryBuilder<T> {
  return qb.offset((q.page - 1) * q.pageSize).limit(q.pageSize);
}
