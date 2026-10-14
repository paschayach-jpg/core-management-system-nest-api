/** เลข error ของ SQL Server เมื่อถูกเลือกเป็น deadlock victim */
const DEADLOCK = 1205;

/**
 * เป็น deadlock หรือไม่ — รองรับทั้ง SpExecutionError (`sqlNumber`), QueryFailedError ของ TypeORM (`driverError.number`)
 * และ RequestError ของ mssql (`number` / `originalError.info.number`)
 */
export function isDeadlockError(err: unknown): boolean {
  const e = err as {
    sqlNumber?: number;
    number?: number;
    driverError?: { number?: number };
    originalError?: { number?: number; info?: { number?: number } };
  } | null;
  if (!e || typeof e !== 'object') return false;
  return [
    e.sqlNumber,
    e.number,
    e.driverError?.number,
    e.originalError?.number,
    e.originalError?.info?.number,
  ].includes(DEADLOCK);
}

/**
 * รันงานที่เป็น transaction เดียวซ้ำเมื่อถูกเลือกเป็น deadlock victim (SQL 1205) — ต้องส่งฟังก์ชันที่อ่านสถานะใหม่ทุกรอบ
 * (transaction ถูก rollback ทั้งก้อนแล้วจึงรันซ้ำได้อย่างปลอดภัย)
 *
 * ทำไมต้องมี: `WFE.sp_CreateWFStepInstance` ล็อกทั้งตาราง (TABLOCKX,HOLDLOCK) ถึงจบ transaction
 * ระบบเดิมแต่ละคำสั่งคอมมิตแยกกันจึงไม่ชนกัน แต่ API รวมเป็น transaction เดียว (อ่าน/ล็อกแถว → SP) สองคำขอพร้อมกัน
 * อาจ deadlock ได้ การรันซ้ำทำให้ผู้ใช้ไม่เห็นข้อผิดพลาดชั่วคราวนี้
 */
export async function withDeadlockRetry<T>(
  work: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 40;
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      if (!isDeadlockError(err) || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, base * attempt + Math.floor(Math.random() * base)));
    }
  }
}
