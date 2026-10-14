import type { EntityManager } from 'typeorm';
import type { SpOptions } from '../../../../database/sp/sp-executor.service';

/**
 * บริบทของ transaction ที่ store ใช้ — เป็นส่วนย่อยของ TransactionScope (TransactionRunner.run)
 * ไม่ส่ง = รันนอก transaction บน connection pool
 */
export interface Tx {
  manager: EntityManager;
  sp: SpOptions;
}

/** ตัวแบ่งหน้าแบบ OFFSET/FETCH */
export interface PageArgs {
  skip: number;
  take: number;
}

/** แถวที่ query มาจาก SQL ตรง (ชื่อคอลัมน์ PascalCase ตาม DB) */
export type Row = Record<string, unknown>;

export const num = (v: unknown): number => Number(v);
export const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
export const str = (v: unknown): string => String(v ?? '');
export const strOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);
export const dateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
export const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';

/** อ่าน recordset ที่ TypeORM คืน (UPDATE/INSERT ที่ไม่มีผลลัพธ์อาจได้ undefined) */
export const rowsOf = (raw: unknown): Row[] => (Array.isArray(raw) ? (raw as Row[]) : []);
