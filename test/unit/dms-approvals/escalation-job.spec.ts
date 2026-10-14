import { ApprovalEscalationJob } from '../../../src/modules/dms/approvals/approvals/approval-escalation.job';

function make(
  opts: { interval?: string | null; lock?: number; throwConfig?: boolean; nodeEnv?: string } = {},
) {
  const queries: string[] = [];
  let releases = 0;
  const runner = {
    connect: async () => undefined,
    release: async () => void releases++,
    query: async (sql: string) => {
      queries.push(sql.includes('sp_getapplock') ? 'getapplock' : 'releaseapplock');
      return sql.includes('sp_getapplock') ? [{ R: opts.lock ?? 0 }] : [];
    },
  };
  const approvals = {
    escalateExpired: jest.fn(async () => ({ checked: 0, escalated: 0, skipped: 0, failed: 0 })),
  };
  const sys = {
    getNumber: async (_k: string, def: number) => {
      if (opts.throwConfig) throw new Error('DB ล่ม');
      return opts.interval === undefined || opts.interval === null ? def : Number(opts.interval);
    },
  };
  const cfg = { get: () => opts.nodeEnv ?? 'development' };
  const ctx = { run: (fn: () => unknown) => fn() };
  const ds = { createQueryRunner: () => runner };
  const job = new ApprovalEscalationJob(
    approvals as never,
    sys as never,
    cfg as never,
    ctx as never,
    ds as never,
  );
  return { job, approvals, queries, releases: () => releases };
}

describe('ApprovalEscalationJob — งาน escalation เดียวของฝั่ง API', () => {
  it('รอบแรกทำงานทันที ได้ application lock แล้วคืน lock เสมอ', async () => {
    const t = make();
    expect(await t.job.runIfDue(1_000_000)).toBe('ran');
    expect(t.approvals.escalateExpired).toHaveBeenCalledTimes(1);
    expect(t.queries).toEqual(['getapplock', 'releaseapplock']);
    expect(t.releases()).toBe(1);
  });

  it('ช่วงเวลาอ่านจาก EscalationTimerIntervalSeconds: ยังไม่ถึงรอบ → ไม่ทำ; ถึงรอบ → ทำ', async () => {
    const t = make({ interval: '120' });
    await t.job.runIfDue(1_000_000);
    expect(await t.job.runIfDue(1_000_000 + 60_000)).toBe('not-due');
    expect(await t.job.runIfDue(1_000_000 + 121_000)).toBe('ran');
    expect(t.approvals.escalateExpired).toHaveBeenCalledTimes(2);
  });

  it('ค่าตั้งไม่มี/ไม่สมเหตุผล/อ่านไม่ได้ → ใช้ 60 วินาที', async () => {
    for (const o of [{ interval: null }, { interval: '3' }, { throwConfig: true }]) {
      const t = make(o);
      await t.job.runIfDue(1_000_000);
      expect(await t.job.runIfDue(1_000_000 + 59_000)).toBe('not-due');
      expect(await t.job.runIfDue(1_000_000 + 61_000)).toBe('ran');
    }
  });

  it('instance อื่นถือ lock อยู่ → ข้าม ไม่ทำงานซ้อน (กัน instance ทับซ้อน)', async () => {
    const t = make({ lock: -1 });
    expect(await t.job.runIfDue(1_000_000)).toBe('locked');
    expect(t.approvals.escalateExpired).not.toHaveBeenCalled();
    expect(t.queries).toEqual(['getapplock']); // ไม่ได้ lock ก็ไม่ต้องคืน
    expect(t.releases()).toBe(1); // แต่ต้องคืน connection
  });

  it('งานก่อนหน้ายังไม่จบ → busy (ไม่รันซ้อนในโปรเซสเดียวกัน)', async () => {
    const t = make();
    let release!: () => void;
    t.approvals.escalateExpired.mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r({ checked: 0, escalated: 0, skipped: 0, failed: 0 });
        }),
    );
    const first = t.job.runIfDue(1_000_000);
    await new Promise((r) => setImmediate(r));
    expect(await t.job.runIfDue(2_000_000)).toBe('busy');
    release();
    await first;
  });

  it('งานล้ม → คืน lock และรอบถัดไปยังทำได้ (ไม่ค้าง running)', async () => {
    const t = make();
    t.approvals.escalateExpired.mockRejectedValueOnce(new Error('ล้ม'));
    await t.job.runIfDue(1_000_000);
    expect(t.queries).toEqual(['getapplock', 'releaseapplock']);
    expect(await t.job.runIfDue(1_000_000 + 61_000)).toBe('ran');
  });

  it('cron tick ไม่ทำงานในโหมดเทสต์ และหยุดเมื่อ shutdown', async () => {
    const t = make({ nodeEnv: 'test' });
    await t.job.tick();
    expect(t.approvals.escalateExpired).not.toHaveBeenCalled();
    const u = make();
    u.job.onModuleDestroy();
    expect(await u.job.runIfDue(1_000_000)).toBe('stopped');
  });
});
