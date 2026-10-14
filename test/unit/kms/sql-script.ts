import type { UserContext } from '../../../src/common/interfaces/user-context';
import { AppRole } from '../../../src/common/constants/enums';
import { fakeUser, makeCrudLog } from '../../helpers/stubs';

export interface SqlCall {
  sql: string;
  params: unknown[];
}

type Matcher = RegExp | ((sql: string, params: unknown[]) => boolean);
type ReplyFn = (sql: string, params: unknown[]) => unknown;
type Reply = unknown;

interface Rule {
  match: Matcher;
  reply: Reply;
  once: boolean;
  used: boolean;
}

/**
 * DataSource/EntityManager ปลอมแบบ "สคริปต์": กำหนดคำตอบตามรูปแบบของ SQL (RegExp) แล้วบันทึกทุกคำสั่งที่ถูกเรียก
 * — ไม่มี SQL Server จริง จึงตรวจได้เฉพาะ "service ส่ง SQL อะไรและตัดสินใจอย่างไรจากคำตอบ"
 * กฎที่ลงทะเบียนก่อนมีลำดับก่อน · ไม่ตรงกฎใด = คืน [] (หรือโยน error ถ้า strict)
 */
export class ScriptedDb {
  readonly calls: SqlCall[] = [];
  private readonly rules: Rule[] = [];
  strict = false;

  when(match: Matcher, reply: ReplyFn): this;
  when(match: Matcher, reply?: Reply): this;
  when(match: Matcher, reply: Reply = []): this {
    this.rules.push({ match, reply, once: false, used: false });
    return this;
  }

  /** ตอบครั้งเดียว (เรียกครั้งต่อไปจะข้ามไปกฎถัดไป) */
  whenOnce(match: Matcher, reply: ReplyFn): this;
  whenOnce(match: Matcher, reply?: Reply): this;
  whenOnce(match: Matcher, reply: Reply = []): this {
    this.rules.push({ match, reply, once: true, used: false });
    return this;
  }

  /** ให้ SQL ที่ตรงกับ match โยน error นี้ — มีลำดับก่อนกฎอื่นทั้งหมด (ใช้ทับคำตอบปกติได้) */
  failWhen(match: Matcher, error: unknown): this {
    this.rules.unshift({
      match,
      reply: () => {
        throw error;
      },
      once: false,
      used: false,
    });
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly query = async (sql: string, params: unknown[] = []): Promise<any> => {
    this.calls.push({ sql, params });
    for (const r of this.rules) {
      if (r.once && r.used) continue;
      const hit = typeof r.match === 'function' ? r.match(sql, params) : r.match.test(sql);
      if (!hit) continue;
      r.used = true;
      return typeof r.reply === 'function' ? (r.reply as ReplyFn)(sql, params) : r.reply;
    }
    if (this.strict) throw new Error(`ScriptedDb: ไม่มีกฎสำหรับ SQL: ${sql.slice(0, 120)}`);
    return [];
  };

  /** คำสั่งที่ SQL ตรงกับรูปแบบ */
  find(match: RegExp): SqlCall[] {
    return this.calls.filter((c) => match.test(c.sql));
  }

  count(match: RegExp): number {
    return this.find(match).length;
  }

  /** ล้างประวัติการเรียก (คงกฎไว้) */
  clear(): void {
    this.calls.length = 0;
  }
}

/** TransactionRunner ปลอม: รัน callback ด้วย manager = db เดียวกัน · บันทึก isolation/จำนวนครั้ง และ rollback เมื่อ throw */
export class FakeTx {
  runs = 0;
  rolledBack = 0;
  committed = 0;
  isolations: (string | undefined)[] = [];

  constructor(private readonly db: ScriptedDb) {}

  async run<T>(
    work: (scope: { manager: ScriptedDb; queryRunner: object; sp: object }) => Promise<T>,
    options: { isolation?: string } = {},
  ): Promise<T> {
    this.runs++;
    this.isolations.push(options.isolation);
    try {
      const r = await work({ manager: this.db, queryRunner: {}, sp: {} });
      this.committed++;
      return r;
    } catch (e) {
      this.rolledBack++;
      throw e;
    }
  }
}

export const MANAGER: UserContext = fakeUser({ appRole: AppRole.Manager, adUserName: 'DOM\\mgr' });
export const STAFF: UserContext = fakeUser({ appRole: AppRole.Officer, adUserName: 'DOM\\staff' });

/** CrudLogService จริง + sink ในหน่วยความจำ — `events()` รอให้เขียนเสร็จก่อนคืน */
export function crudLogHarness() {
  const h = makeCrudLog({ level: 'all' });
  return {
    service: h.service,
    events: async () => {
      await h.service.drain();
      return h.sink.events;
    },
  };
}
