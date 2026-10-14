import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type * as sql from 'mssql';
import type { DataSource, QueryRunner } from 'typeorm';
import type { SpDef } from './sp.types';
import { SpExecutionError } from './sp-execution.error';
import { toMssqlType } from './sql-type.util';

export type DbTarget = 'main' | 'project';

export interface SpOptions {
  /** ใส่เมื่อต้องการให้ SP รันใน transaction ของ QueryRunner เดียวกัน (ดู TransactionRunner) */
  queryRunner?: QueryRunner;
  /** ฐานที่เรียก (ค่าเริ่มต้น main = CMS_DB) */
  target?: DbTarget;
  timeoutMs?: number;
}

export interface SpResult<TRow = Record<string, unknown>> {
  /** recordset แรก */
  rows: TRow[];
  /** ทุก recordset (SP ที่ SELECT หลายชุด) */
  recordsets: Record<string, unknown>[][];
  /** ค่าจาก OUTPUT parameter */
  output: Record<string, unknown>;
  returnValue: number;
  rowsAffected: number[];
}

const DEADLOCK = 1205;

/**
 * เรียก Stored Procedure แบบมีชนิด (`Sp.EMS.insertOrgUnit` ฯลฯ) ด้วย mssql โดยตรง
 *
 * ทำไมไม่ใช้ `dataSource.query('EXEC ...')`: TypeORM คืนเฉพาะ recordset แรก และไม่รองรับ OUTPUT parameter,
 * แต่ SP ของระบบเดิมจำนวนมากคืนหลาย recordset → ต้องใช้ mssql Request เอง (เปรียบได้กับ SqlCommand + SqlDataReader.NextResult)
 */
@Injectable()
export class SpExecutor {
  private readonly logger = new Logger(SpExecutor.name);

  constructor(
    @InjectDataSource() private readonly mainDs: DataSource,
    @InjectDataSource('project') private readonly projectDs: DataSource,
  ) {}

  /** รัน SP แล้วคืนทุกอย่าง */
  async execute<TIn extends object, TOut extends object, TRow = Record<string, unknown>>(
    sp: SpDef<TIn, TOut>,
    input: TIn,
    options: SpOptions = {},
  ): Promise<SpResult<TRow>> {
    const inTransaction = Boolean(options.queryRunner?.isTransactionActive);
    // deadlock retry ทำได้เฉพาะนอก transaction (ใน transaction ต้องให้ผู้เรียกตัดสินใจ rollback เอง)
    const maxAttempts = inTransaction ? 1 : 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.run<TIn, TOut, TRow>(sp, input, options);
      } catch (err) {
        lastError = err;
        if (
          !(err instanceof SpExecutionError) ||
          err.sqlNumber !== DEADLOCK ||
          attempt === maxAttempts
        )
          throw err;
        this.logger.warn(`${sp.name} ชน deadlock ลองใหม่ครั้งที่ ${attempt + 1}`);
        await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
    throw lastError;
  }

  /**
   * ผูก SP กับ options เพื่อให้ input ถูกตรวจชนิดตาม catalog และเลือกชนิดของแถวผลลัพธ์ได้ในตัวเอง
   *
   * ```ts
   * const rows = await this.sp.call(Sp.ems.getAllUserAccounts).rows<UserRow>({});
   * const id   = await this.sp.call(Sp.ems.insertOrgUnit, scope.sp).scalar<number>({ OrgUnitCode: 'X', ... });
   * ```
   * (TypeScript ไม่รองรับ partial generic inference จึงแยกเป็น 2 ขั้น: call(sp) ตรึงชนิด input, แล้ว rows<Row>() กำหนดชนิดแถว)
   */
  call<TIn extends object>(sp: SpDef<TIn, object>, options: SpOptions = {}): SpCall<TIn> {
    return new SpCall<TIn>(this, sp, options);
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async run<TIn extends object, TOut extends object, TRow>(
    sp: SpDef<TIn, TOut>,
    input: TIn,
    options: SpOptions,
  ): Promise<SpResult<TRow>> {
    const started = Date.now();
    const ds = options.target === 'project' ? this.projectDs : this.mainDs;
    // ใช้คลาส Request/Types จาก instance ของ mssql ที่ TypeORM ใช้อยู่ เพื่อกัน instanceof ไม่ตรงกัน
    const driver = ds.driver as unknown as { mssql: typeof sql; master?: sql.ConnectionPool };
    const mssql = driver.mssql;
    const qr = options.queryRunner as unknown as
      { isTransactionActive?: boolean; databaseConnection?: sql.Transaction } | undefined;
    const target: sql.ConnectionPool | sql.Transaction | undefined =
      qr?.isTransactionActive && qr.databaseConnection ? qr.databaseConnection : driver.master;
    if (!target) throw new SpExecutionError(sp.name, 'ยังไม่ได้เชื่อมต่อฐานข้อมูล');

    const request = new mssql.Request(target as sql.ConnectionPool);
    if (options.timeoutMs) (request as unknown as { timeout: number }).timeout = options.timeoutMs;

    const values = input as Record<string, unknown>;
    for (const p of sp.params) {
      const type = toMssqlType(mssql, p.sqlType);
      if (p.output) {
        request.output(p.name, type);
        continue;
      }
      const v = values[p.name];
      if (v === undefined) {
        if (p.required) request.input(p.name, type, null);
        continue; // พารามิเตอร์ที่มี default ใน SP ไม่ต้องส่ง
      }
      request.input(p.name, type, v);
    }

    try {
      const res = await request.execute(sp.name);
      const ms = Date.now() - started;
      if (ms > 1000) this.logger.warn(`SP ช้า: ${sp.name} ใช้เวลา ${ms} ms`);
      else this.logger.debug(`${sp.name} ${ms} ms`);
      return {
        rows: ((res.recordset as unknown as TRow[]) ?? []) as TRow[],
        recordsets: (res.recordsets as unknown as Record<string, unknown>[][]) ?? [],
        output: (res.output as Record<string, unknown>) ?? {},
        returnValue: Number(res.returnValue ?? 0),
        rowsAffected: res.rowsAffected ?? [],
      };
    } catch (err) {
      throw SpExecutionError.from(sp.name, err);
    }
  }
}

/** ตัวช่วยที่ได้จาก SpExecutor.call() */
export class SpCall<TIn extends object> {
  constructor(
    private readonly executor: SpExecutor,
    private readonly sp: SpDef<TIn, object>,
    private readonly options: SpOptions,
  ) {}

  /** ผลลัพธ์ครบ: ทุก recordset + OUTPUT + return value */
  execute<TRow = Record<string, unknown>>(input: TIn): Promise<SpResult<TRow>> {
    return this.executor.execute<TIn, object, TRow>(this.sp, input, this.options);
  }

  /** แถวทั้งหมดของ recordset แรก */
  async rows<TRow = Record<string, unknown>>(input: TIn): Promise<TRow[]> {
    return (await this.execute<TRow>(input)).rows;
  }

  /** แถวแรก หรือ null */
  async one<TRow = Record<string, unknown>>(input: TIn): Promise<TRow | null> {
    return (await this.rows<TRow>(input))[0] ?? null;
  }

  /** ค่าคอลัมน์แรกของแถวแรก (เช่น `SELECT SCOPE_IDENTITY() AS NewId`) หรือ null */
  async scalar<T = unknown>(input: TIn): Promise<T | null> {
    const row = await this.one<Record<string, unknown>>(input);
    if (!row) return null;
    return (Object.values(row)[0] ?? null) as T | null;
  }

  /** รันโดยไม่สนผลลัพธ์ */
  async exec(input: TIn): Promise<void> {
    await this.execute(input);
  }
}
