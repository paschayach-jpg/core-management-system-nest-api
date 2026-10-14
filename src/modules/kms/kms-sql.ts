function sqlErrorNumber(err: unknown): number | undefined {
  const e = err as { driverError?: { number?: number }; number?: number } | null;
  return e?.driverError?.number ?? e?.number;
}

/** SQL Server error 2627/2601 = ชน unique constraint/index */
export function isUniqueViolation(err: unknown): boolean {
  const n = sqlErrorNumber(err);
  return n === 2627 || n === 2601;
}

/** SQL Server error 547 = ชน FOREIGN KEY / CHECK constraint */
export function isConstraintViolation(err: unknown): boolean {
  return sqlErrorNumber(err) === 547;
}

const IN_CHUNK = 1000;

/** SQL Server จำกัด 2100 parameter ต่อคำสั่ง — แบ่งชุดเมื่อใช้ IN (...) */
export function chunkArray<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
