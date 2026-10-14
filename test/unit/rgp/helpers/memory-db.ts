import { FindOperator, getMetadataArgsStorage } from 'typeorm';

/**
 * ฐานข้อมูลในหน่วยความจำสำหรับเทสต์ service ของ RGP (ไม่ต้องมี SQL Server)
 * จำลอง EntityManager / Repository เฉพาะส่วนที่ service ใช้: find*, count*, exists*, save, insert, update, delete, query
 * - รองรับ FindOperator: In, Not, IsNull, MoreThan(OrEqual), LessThan(OrEqual)
 * - ค่า update ที่เป็นฟังก์ชัน (เช่น `() => 'GETDATE()'`) ถือเป็น "เวลาตอนนี้"
 * - snapshot()/restore() ใช้จำลอง transaction rollback
 * ข้อจำกัด: ไม่รู้จัก DB default (createDate ฯลฯ ถูกใส่เวลาปัจจุบันให้) และไม่จำลอง SQL ดิบ — ใช้ `onQuery` กำหนดเอง
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type EntityClass = Function;

const AUTO_DATES = ['createDate', 'changeDate', 'actionDate', 'sendDate'];

function primaryKeyOf(entity: EntityClass): string {
  const col = getMetadataArgsStorage().columns.find(
    (c) => c.target === entity && c.options.primary,
  );
  if (!col) throw new Error(`ไม่พบ primary key ของ ${entity.name}`);
  return col.propertyName;
}

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof FindOperator) {
    switch (expected.type) {
      case 'equal':
        return matchValue(actual, expected.value);
      case 'not':
        return !matchValue(actual, expected.child ?? expected.value);
      case 'in':
        return (expected.value as unknown[]).includes(actual);
      case 'isNull':
        return actual === null || actual === undefined;
      case 'moreThan':
        return (actual as number) > (expected.value as number);
      case 'moreThanOrEqual':
        return (actual as number) >= (expected.value as number);
      case 'lessThan':
        return (actual as number) < (expected.value as number);
      case 'lessThanOrEqual':
        return (actual as number) <= (expected.value as number);
      default:
        throw new Error(`MemoryDb ยังไม่รองรับ FindOperator '${expected.type}'`);
    }
  }
  if (expected === null) return actual === null || actual === undefined;
  return actual === expected;
}

function matches(row: Row, where?: Row | Row[]): boolean {
  if (!where) return true;
  const alternatives = Array.isArray(where) ? where : [where];
  if (alternatives.length === 0) return true;
  return alternatives.some((w) =>
    Object.entries(w).every(([key, expected]) => matchValue(row[key], expected)),
  );
}

function applyOrder(rows: Row[], order?: Record<string, 'ASC' | 'DESC' | 'asc' | 'desc'>): Row[] {
  if (!order) return rows;
  const entries = Object.entries(order);
  return [...rows].sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = a[key];
      const bv = b[key];
      if (av === bv) continue;
      const cmp =
        av === undefined || av === null
          ? -1
          : bv === undefined || bv === null
            ? 1
            : av < bv
              ? -1
              : 1;
      return String(dir).toUpperCase() === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });
}

function applyPatch(row: Row, patch: Row): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    row[key] = typeof value === 'function' ? new Date() : value;
  }
}

export interface FindOpts {
  where?: Row | Row[];
  order?: Record<string, 'ASC' | 'DESC' | 'asc' | 'desc'>;
  take?: number;
  skip?: number;
  // รับ option อื่นของ TypeORM (select/lock ฯลฯ) แต่ไม่ใช้
  [key: string]: unknown;
}

export class MemoryDb {
  private tables = new Map<EntityClass, Row[]>();
  private sequences = new Map<EntityClass, number>();
  /** SQL ดิบที่ถูกเรียก (manager.query / dataSource.query) */
  queries: { sql: string; params: unknown[] }[] = [];
  /** จำลองผลของ SQL ดิบ — ไม่ตั้ง = คืน [] */
  onQuery?: (sql: string, params: unknown[], db: MemoryDb) => unknown;

  // ── ข้อมูล ───────────────────────────────────────────────

  rows<T = Row>(entity: EntityClass): T[] {
    let list = this.tables.get(entity);
    if (!list) {
      list = [];
      this.tables.set(entity, list);
    }
    return list as unknown as T[];
  }

  /** ใส่ข้อมูลตั้งต้น (ถ้าไม่มี PK จะรันเลขให้) */
  seed<T extends Row>(entity: EntityClass, rows: T[]): (T & Row)[] {
    const pk = primaryKeyOf(entity);
    const list = this.rows<Row>(entity);
    const stored: (T & Row)[] = [];
    for (const r of rows) {
      const row: Row = { ...r };
      if (row[pk] === undefined) row[pk] = this.nextId(entity);
      else this.sequences.set(entity, Math.max(this.sequences.get(entity) ?? 0, row[pk] as number));
      list.push(row);
      stored.push({ ...row } as T & Row);
    }
    return stored;
  }

  private nextId(entity: EntityClass): number {
    const n = (this.sequences.get(entity) ?? 0) + 1;
    this.sequences.set(entity, n);
    return n;
  }

  snapshot(): { tables: [EntityClass, Row[]][]; sequences: [EntityClass, number][] } {
    return {
      tables: [...this.tables.entries()].map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
      sequences: [...this.sequences.entries()],
    };
  }

  restore(snap: ReturnType<MemoryDb['snapshot']>): void {
    this.tables = new Map(snap.tables.map(([k, v]) => [k, v]));
    this.sequences = new Map(snap.sequences);
  }

  // ── EntityManager / Repository ──────────────────────────

  manager(): MemoryManager {
    return new MemoryManager(this);
  }

  repo(entity: EntityClass): MemoryRepository {
    return new MemoryRepository(this, entity);
  }

  /** ใช้แทน DataSource ในเทสต์ที่เรียก ds.query() */
  query(sql: string, params: unknown[] = []): Promise<unknown> {
    this.queries.push({ sql, params });
    return Promise.resolve(this.onQuery ? this.onQuery(sql, params, this) : []);
  }

  // ── ปฏิบัติการพื้นฐาน (ใช้ร่วมกันระหว่าง manager และ repo) ──

  find(entity: EntityClass, opts: FindOpts = {}): Row[] {
    let list = this.rows<Row>(entity).filter((r) => matches(r, opts.where));
    list = applyOrder(list, opts.order);
    if (opts.skip) list = list.slice(opts.skip);
    if (opts.take !== undefined) list = list.slice(0, opts.take);
    return list.map((r) => ({ ...r }));
  }

  save(entity: EntityClass, obj: Row): Row {
    const pk = primaryKeyOf(entity);
    if (obj[pk] !== undefined) {
      const existing = this.rows<Row>(entity).find((r) => r[pk] === obj[pk]);
      if (existing) {
        applyPatch(existing, obj);
        return obj;
      }
    }
    return this.insertOne(entity, obj);
  }

  insertOne(entity: EntityClass, obj: Row): Row {
    const pk = primaryKeyOf(entity);
    const row: Row = { ...obj };
    if (row[pk] === undefined) row[pk] = this.nextId(entity);
    for (const key of AUTO_DATES) {
      if (row[key] === undefined && this.hasProperty(entity, key)) row[key] = new Date();
    }
    this.rows<Row>(entity).push(row);
    obj[pk] = row[pk];
    for (const key of AUTO_DATES) if (obj[key] === undefined && row[key]) obj[key] = row[key];
    return obj;
  }

  private hasProperty(entity: EntityClass, property: string): boolean {
    return getMetadataArgsStorage().columns.some(
      (c) => c.target === entity && c.propertyName === property,
    );
  }

  update(entity: EntityClass, criteria: Row, patch: Row): { affected: number } {
    const targets = this.rows<Row>(entity).filter((r) => matches(r, criteria));
    for (const r of targets) applyPatch(r, patch);
    return { affected: targets.length };
  }

  delete(entity: EntityClass, criteria: Row): { affected: number } {
    const list = this.rows<Row>(entity);
    const keep = list.filter((r) => !matches(r, criteria));
    const affected = list.length - keep.length;
    this.tables.set(entity, keep);
    return { affected };
  }
}

export class MemoryManager {
  constructor(private readonly db: MemoryDb) {}

  getRepository(entity: EntityClass): MemoryRepository {
    return new MemoryRepository(this.db, entity);
  }
  find(e: EntityClass, opts?: FindOpts): Promise<Row[]> {
    return Promise.resolve(this.db.find(e, opts));
  }
  findBy(e: EntityClass, where: Row | Row[]): Promise<Row[]> {
    return this.find(e, { where });
  }
  async findOne(e: EntityClass, opts: FindOpts): Promise<Row | null> {
    return (await this.find(e, { ...opts, take: 1 }))[0] ?? null;
  }
  async findOneBy(e: EntityClass, where: Row | Row[]): Promise<Row | null> {
    return this.findOne(e, { where });
  }
  async count(e: EntityClass, opts?: FindOpts): Promise<number> {
    return (await this.find(e, opts)).length;
  }
  countBy(e: EntityClass, where: Row | Row[]): Promise<number> {
    return this.count(e, { where });
  }
  async exists(e: EntityClass, opts?: FindOpts): Promise<boolean> {
    return (await this.count(e, opts)) > 0;
  }
  existsBy(e: EntityClass, where: Row | Row[]): Promise<boolean> {
    return this.exists(e, { where });
  }
  save(e: EntityClass, obj: Row): Promise<Row> {
    return Promise.resolve(this.db.save(e, obj));
  }
  insert(e: EntityClass, obj: Row | Row[]): Promise<{ identifiers: Row[] }> {
    const list = Array.isArray(obj) ? obj : [obj];
    const pk = primaryKeyOf(e);
    return Promise.resolve({
      identifiers: list.map((o) => {
        const saved = this.db.insertOne(e, { ...o });
        return { [pk]: saved[pk] };
      }),
    });
  }
  update(e: EntityClass, criteria: Row, patch: Row): Promise<{ affected: number }> {
    return Promise.resolve(this.db.update(e, criteria, patch));
  }
  delete(e: EntityClass, criteria: Row): Promise<{ affected: number }> {
    return Promise.resolve(this.db.delete(e, criteria));
  }
  query(sql: string, params?: unknown[]): Promise<unknown> {
    return this.db.query(sql, params);
  }
}

export class MemoryRepository {
  constructor(
    private readonly db: MemoryDb,
    private readonly entity: EntityClass,
  ) {}

  find(opts?: FindOpts): Promise<Row[]> {
    return Promise.resolve(this.db.find(this.entity, opts));
  }
  findBy(where: Row | Row[]): Promise<Row[]> {
    return this.find({ where });
  }
  async findOne(opts: FindOpts): Promise<Row | null> {
    return (await this.find({ ...opts, take: 1 }))[0] ?? null;
  }
  async findOneBy(where: Row | Row[]): Promise<Row | null> {
    return this.findOne({ where });
  }
  async findOneByOrFail(where: Row | Row[]): Promise<Row> {
    const row = await this.findOneBy(where);
    if (!row) throw new Error('EntityNotFound');
    return row;
  }
  async count(opts?: FindOpts): Promise<number> {
    return (await this.find(opts)).length;
  }
  countBy(where: Row | Row[]): Promise<number> {
    return this.count({ where });
  }
  async exists(opts?: FindOpts): Promise<boolean> {
    return (await this.count(opts)) > 0;
  }
  existsBy(where: Row | Row[]): Promise<boolean> {
    return this.exists({ where });
  }
  save(obj: Row): Promise<Row> {
    return Promise.resolve(this.db.save(this.entity, obj));
  }
  insert(obj: Row | Row[]): Promise<{ identifiers: Row[] }> {
    const list = Array.isArray(obj) ? obj : [obj];
    const pk = primaryKeyOf(this.entity);
    return Promise.resolve({
      identifiers: list.map((o) => ({ [pk]: this.db.insertOne(this.entity, { ...o })[pk] })),
    });
  }
  update(criteria: Row, patch: Row): Promise<{ affected: number }> {
    return Promise.resolve(this.db.update(this.entity, criteria, patch));
  }
  delete(criteria: Row): Promise<{ affected: number }> {
    return Promise.resolve(this.db.delete(this.entity, criteria));
  }
}

/** TransactionRunner ปลอม: รัน work กับ MemoryDb ของฐานที่เลือก, rollback (restore snapshot) เมื่อ throw */
export class FakeTransactionRunner {
  commits = 0;
  rollbacks = 0;
  /** ลำดับ 'begin:main' / 'commit:project' ฯลฯ — ตรวจการซ้อน transaction */
  trace: string[] = [];

  constructor(
    readonly main: MemoryDb,
    readonly project: MemoryDb,
  ) {}

  async run<T>(
    work: (scope: { queryRunner: object; manager: MemoryManager; sp: object }) => Promise<T>,
    options: { target?: 'main' | 'project' } = {},
  ): Promise<T> {
    const name = options.target === 'project' ? 'project' : 'main';
    const db = name === 'project' ? this.project : this.main;
    const snap = db.snapshot();
    this.trace.push(`begin:${name}`);
    try {
      const result = await work({ queryRunner: {}, manager: db.manager(), sp: {} });
      this.commits += 1;
      this.trace.push(`commit:${name}`);
      return result;
    } catch (err) {
      db.restore(snap);
      this.rollbacks += 1;
      this.trace.push(`rollback:${name}`);
      throw err;
    }
  }
}
