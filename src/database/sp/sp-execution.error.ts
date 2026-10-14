/** ข้อผิดพลาดจากการเรียก Stored Procedure — เก็บเลข error ของ SQL Server ไว้ให้ ExceptionFilter แปลงเป็น HTTP */
export class SpExecutionError extends Error {
  constructor(
    public readonly spName: string,
    message: string,
    public readonly sqlNumber?: number,
    public readonly sqlState?: string,
    public readonly original?: unknown,
  ) {
    super(message);
    this.name = 'SpExecutionError';
  }

  static from(spName: string, err: unknown): SpExecutionError {
    if (err instanceof SpExecutionError) return err;
    const e = err as {
      message?: string;
      number?: number;
      originalError?: { info?: { number?: number } };
      state?: string;
    };
    const num = e?.number ?? e?.originalError?.info?.number;
    return new SpExecutionError(spName, e?.message ?? String(err), num, e?.state, err);
  }

  /** RAISERROR/THROW ที่นักพัฒนา SP ตั้งใจส่งข้อความถึงผู้ใช้ (เลข >= 50000) */
  get isUserRaised(): boolean {
    return (this.sqlNumber ?? 0) >= 50000;
  }
}
