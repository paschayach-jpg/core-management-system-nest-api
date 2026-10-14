import { WfeUserDirectory } from '../../../src/modules/wfe/common/wfe-user-directory';
import { InstanceStore } from '../../../src/modules/wfe/instance/instance.store';
import { SlaStore } from '../../../src/modules/wfe/sla/sla.store';
import { TemplateStore } from '../../../src/modules/wfe/template/template.store';

type Call = { sql: string; params: unknown[] };

/** EntityManager ปลอมที่จับ SQL + พารามิเตอร์ที่ส่งเข้าไป (ตรวจว่า parameterize / whitelist / ล็อกถูก — ไม่ได้ยืนยันว่า SQL Server รันผ่าน) */
function capture(reply: (sql: string) => unknown = () => []) {
  const calls: Call[] = [];
  const m = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return reply(sql);
    },
  };
  return { m: m as never, calls, last: () => calls[calls.length - 1] };
}
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('TemplateStore.listDefinitions', () => {
  const store = new TemplateStore();
  const base = { sortDir: 'asc' as const, page: 1, pageSize: 20 };

  it('ใส่ค่าจากผู้ใช้เป็นพารามิเตอร์ ไม่ต่อสตริง; escape ตัวอักษรพิเศษของ LIKE', async () => {
    const { m, last } = capture();
    await store.listDefinitions(m, { ...base, q: "100%_[x]'; DROP TABLE t;--", category: "a'b" });
    const { sql, params } = last();
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain("a'b");
    expect(params).toContain("a'b");
    expect(params).toContain("%100\\%\\_\\[x\\]'; DROP TABLE t;--%");
    expect(flat(sql)).toContain('LIKE @');
    expect(flat(sql)).toContain("ESCAPE '\\'");
  });

  it('ORDER BY ผ่าน whitelist: ชื่อที่ไม่รู้จัก/พยายามแทรก SQL ถูกแทนด้วยค่าเริ่มต้น', async () => {
    const { m, last } = capture();
    await store.listDefinitions(m, { ...base, sortBy: 'name; DROP TABLE x' });
    expect(flat(last().sql)).toContain('ORDER BY d.WFName ASC, d.WFDefinitionId ASC');
    await store.listDefinitions(m, { ...base, sortBy: 'createdDate', sortDir: 'desc' });
    expect(flat(last().sql)).toContain('ORDER BY d.CreatedDate DESC');
    await store.listDefinitions(m, { ...base, sortBy: 'constructor' });
    expect(flat(last().sql)).toContain('ORDER BY d.WFName ASC');
  });

  it('แบ่งหน้าด้วย OFFSET/FETCH และตัวกรองสถานะ/IsActive เป็นพารามิเตอร์', async () => {
    const { m, last } = capture();
    await store.listDefinitions(m, {
      ...base,
      page: 3,
      pageSize: 25,
      approvalStatus: 0,
      isActive: false,
    });
    const { sql, params } = last();
    expect(flat(sql)).toContain('OFFSET @');
    expect(params).toEqual(expect.arrayContaining([0, 50, 25]));
    expect(flat(sql)).toContain('d.ApprovalStatus = @0');
    expect(flat(sql)).toContain('d.IsActive = @1');
    expect(flat(sql)).toContain('d.IsDeleted = 0');
  });

  it('แปลงแถว: ตัดคอลัมน์ Total ออก, camelCase, total จากแถวแรก', async () => {
    const { m } = capture(() => [
      { Total: 7, WFDefinitionId: 1, WFName: 'A', StepCount: 3, ApprovalStatus: 2 },
    ]);
    const r = await store.listDefinitions(m, { ...base });
    expect(r.total).toBe(7);
    expect(r.rows[0]).toEqual({ wfDefinitionId: 1, wfName: 'A', stepCount: 3, approvalStatus: 2 });
  });

  it('นับ instance ที่ยังทำงานอยู่ใช้สถานะ 0,1,2,5', async () => {
    const { m, last } = capture(() => [{ c: 2 }]);
    expect(await store.countOpenInstances(m, 9)).toBe(2);
    expect(flat(last().sql)).toContain('Status IN (0,1,2,5)');
    expect(last().params).toEqual([9]);
  });
});

describe('InstanceStore', () => {
  const store = new InstanceStore();

  it('findInstance/findStepInstance: ล็อกแถวด้วย UPDLOCK เฉพาะเมื่อขอ', async () => {
    const { m, calls } = capture(() => [{ WFInstanceId: 1, Status: 2 }]);
    await store.findInstance(m, 1);
    await store.findInstance(m, 1, true);
    await store.findStepInstance(m, 2, true);
    expect(calls[0].sql).not.toContain('UPDLOCK');
    expect(calls[1].sql).toContain('WITH (UPDLOCK, ROWLOCK)');
    expect(calls[2].sql).toContain('WITH (UPDLOCK, ROWLOCK)');
    expect(calls[1].sql).toContain('IsDeleted = 0');
  });

  it('updateInstance: SET เฉพาะ field ที่ระบุ (null เขียนเป็น NULL, undefined ข้าม), WHERE ด้วย id, คืน @@ROWCOUNT', async () => {
    const { m, last } = capture(() => [{ n: 1 }]);
    const done = new Date('2026-04-01T10:00:00');
    const n = await store.updateInstance(m, 5, {
      status: 3,
      currentStepId: null,
      completedDate: done,
    });
    expect(n).toBe(1);
    expect(flat(last().sql)).toBe(
      'UPDATE WFE.t_WFInstance SET Status = @0, CurrentStepId = @1, CompletedDate = @2 WHERE WFInstanceId = @3 AND IsDeleted = 0; SELECT @@ROWCOUNT AS n;',
    );
    expect(last().params).toEqual([3, null, done, 5]);

    const { m: m2, calls } = capture();
    expect(await store.updateInstance(m2, 5, {})).toBe(0);
    expect(await store.updateInstance(m2, 5, { status: undefined })).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('updateStepInstance: map ชื่อ property → คอลัมน์ (SLAStatus/SLADeadline ฯลฯ) ด้วยพารามิเตอร์', async () => {
    const { m, last } = capture(() => [{ n: 1 }]);
    await store.updateStepInstance(m, 8, {
      status: 3,
      slaStatus: 1,
      outputData: "x'; --",
      completedBy: 'u',
    });
    expect(flat(last().sql)).toContain(
      'SET Status = @0, CompletedBy = @1, OutputData = @2, SLAStatus = @3 WHERE WFStepInstanceId = @4',
    );
    expect(last().sql).not.toContain("x'");
    expect(last().params).toEqual([3, 'u', "x'; --", 1, 8]);
  });

  it('listInstances: ผู้ที่ไม่ใช่ Manager ถูกจำกัดเฉพาะ instance ที่ตนเริ่มหรือมี step; Manager ไม่จำกัด', async () => {
    const f = { sortDir: 'desc' as const, page: 2, pageSize: 10 };
    const officer = capture();
    await store.listInstances(officer.m, {
      ...f,
      viewer: { userName: 'DOM\\alice', seesAll: false },
    });
    expect(flat(officer.last().sql)).toContain('wi.InitiatedBy = @0 OR EXISTS');
    expect(flat(officer.last().sql)).toContain('v.AssignedTo = @0');
    expect(officer.last().params[0]).toBe('DOM\\alice');

    const manager = capture();
    await store.listInstances(manager.m, {
      ...f,
      viewer: { userName: 'DOM\\boss', seesAll: true },
    });
    expect(manager.last().sql).not.toContain('EXISTS (SELECT 1 FROM WFE.t_WFStepInstance v');
  });

  it('listInstances: status=0 ยังถูกกรอง, ORDER BY ผ่าน whitelist, ค้นหา escape LIKE', async () => {
    const { m, last } = capture();
    await store.listInstances(m, {
      sortDir: 'asc',
      sortBy: 'wi.InitiatedDate; DROP TABLE x',
      page: 1,
      pageSize: 5,
      status: 0,
      q: '50%',
      viewer: { userName: 'u', seesAll: true },
    });
    const { sql, params } = last();
    expect(flat(sql)).toContain('wi.Status = @0');
    expect(params[0]).toBe(0);
    expect(params).toContain('%50\\%%');
    expect(flat(sql)).toContain('ORDER BY wi.InitiatedDate DESC, wi.WFInstanceId DESC'); // ค่าเริ่มต้นเมื่อ sortBy ไม่อยู่ใน whitelist
    expect(sql).not.toContain('DROP');
  });

  it('myTasks: onlyOpen กรอง 1,2,5; ไม่ใช่ onlyOpen เพิ่ม 3 (Completed); ส่งชื่อผู้ใช้/ออฟเซ็ตเป็นพารามิเตอร์', async () => {
    const open = capture();
    await store.myTasks(open.m, { userName: 'DOM\\bob', onlyOpen: true, page: 3, pageSize: 20 });
    expect(flat(open.last().sql)).toContain('si.Status IN (1,2,5)');
    expect(open.last().params).toEqual(['DOM\\bob', 40, 20]);
    const all = capture();
    await store.myTasks(all.m, { userName: 'DOM\\bob', onlyOpen: false, page: 1, pageSize: 20 });
    expect(flat(all.last().sql)).toContain('si.Status IN (1,2,5,3)');
    expect(flat(all.last().sql)).toContain('PARTITION BY si.WFInstanceId');
    expect(flat(all.last().sql)).toContain('WHERE rn = 1');
  });

  it('listStepInstances เรียงตามลำดับ step แล้วเวลามอบหมาย (เหมือน GetStepInstancesByWorkflow)', async () => {
    const { m, last } = capture();
    await store.listStepInstances(m, 4);
    expect(flat(last().sql)).toContain(
      'ORDER BY COALESCE(st.SequenceNumber, 999) ASC, si.AssignedDate ASC',
    );
  });
});

describe('SlaStore', () => {
  const store = new SlaStore();

  it('setSlaStatus แบ่งชุดละ 500 id', async () => {
    const { m, calls } = capture();
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1);
    await store.setSlaStatus(m, ids, 3);
    expect(calls).toHaveLength(3);
    expect(calls[0].params).toHaveLength(501); // สถานะ + 500 id
    expect(calls[0].params[0]).toBe(3);
    expect(calls[2].params).toHaveLength(202);
  });

  it('openSlaRows: keyset (id > @0) + TOP (@1) และกรอง workflow ที่กำลังทำ (0,1,2)', async () => {
    const { m, last } = capture();
    await store.openSlaRows(m, 10, 500);
    expect(flat(last().sql)).toContain('TOP (@1)');
    expect(flat(last().sql)).toContain('wi.Status IN (0,1,2)');
    expect(flat(last().sql)).toContain('si.Status IN (1,2,5)');
    expect(last().params).toEqual([10, 500]);
  });

  describe('ล็อกงานเบื้องหลัง (sp_getapplock)', () => {
    function fakeDs(rc: number) {
      const log: string[] = [];
      const qr = {
        connect: async () => void log.push('connect'),
        query: async (sql: string) => {
          log.push(sql.includes('sp_releaseapplock') ? 'release-lock' : 'acquire');
          return sql.includes('sp_getapplock') ? [{ rc }] : [];
        },
        release: async () => void log.push('release-connection'),
      };
      return { ds: { createQueryRunner: () => qr } as never, log };
    }

    it('ได้ล็อก (rc ≥ 0) → คืน handle; release() ปล่อยทั้งล็อกและ connection', async () => {
      const { ds, log } = fakeDs(0);
      const lock = await store.tryAcquireJobLock(ds);
      expect(lock).not.toBeNull();
      expect(log).toEqual(['connect', 'acquire']);
      await lock!.release();
      expect(log).toEqual(['connect', 'acquire', 'release-lock', 'release-connection']);
    });

    it('มีคนถืออยู่ (rc < 0) → null และคืน connection ทันที', async () => {
      const { ds, log } = fakeDs(-1);
      expect(await store.tryAcquireJobLock(ds)).toBeNull();
      expect(log).toEqual(['connect', 'acquire', 'release-connection']);
    });
  });
});

describe('WfeUserDirectory', () => {
  it('ค้นเป็นชุดด้วยพารามิเตอร์ คืน Map ที่ key ตัวพิมพ์เล็กและชื่อตามที่ระบบเก็บ', async () => {
    const { m, calls } = capture(() => [
      { UserID: 12, ADUserName: 'DOM\\Bob', DisplayName: 'Bob', IsActive: true, AppRole: 1 },
    ]);
    const dir = new WfeUserDirectory({ manager: m } as never);
    const map = await dir.findMany(['dom\\bob', ' DOM\\BOB ', 'DOM\\x']);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(
      ['dom\\bob', 'DOM\\BOB', 'DOM\\x'].filter((v, i, a) => a.indexOf(v) === i),
    );
    expect(calls[0].sql).toContain('IN (@0,@1,@2)');
    expect(map.get('dom\\bob')).toMatchObject({
      userId: 12,
      adUserName: 'DOM\\Bob',
      isActive: true,
    });
    expect(await dir.findByAdUserName('DOM\\BOB')).not.toBeNull();
  });

  it('ไม่มีชื่อ → ไม่ยิง query', async () => {
    const { m, calls } = capture();
    const dir = new WfeUserDirectory({ manager: m } as never);
    expect((await dir.findMany(['', '  '])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
