import { AppRole } from '../../../src/common/constants/enums';
import { BusinessException } from '../../../src/common/exceptions/business.exception';
import { DmsQuotaPortProvider } from '../../../src/modules/dms/approvals/quota/dms-quota-port.provider';
import { QuotaService } from '../../../src/modules/dms/approvals/quota/quota.service';
import type {
  OrgQuota,
  QuotaRequestRow,
  QuotaUnitRow,
} from '../../../src/modules/dms/approvals/quota/quota.store';
import { fakeUser, makeCrudLog } from '../../helpers/stubs';
import { fakeNotifications } from './fakes';

const GB = 1024 ** 3;
const ADMIN = fakeUser({ userId: 20, appRole: AppRole.Admin, adUserName: 'DOM\\admin' });
const MGR = fakeUser({ userId: 10, appRole: AppRole.Manager, orgUnitId: 5 });
const OFFICER = fakeUser({ userId: 30, appRole: AppRole.Officer, orgUnitId: 7 });

interface State {
  org: Record<number, OrgQuota>;
  used: Record<number, number>;
  units: QuotaUnitRow[];
  requests: QuotaRequestRow[];
  recipients: number[];
  failMaster: boolean;
}

function make(config: Record<string, string | null> = {}) {
  const st: State = {
    org: {
      7: {
        orgUnitId: 7,
        orgUnitCode: 'DEP7',
        orgUnitName: 'แผนก 7',
        orgUnitType: 3,
        quotaBytes: 10 * GB,
        unitType: 3,
        unitId: 70,
      },
      8: {
        orgUnitId: 8,
        orgUnitCode: 'DEP8',
        orgUnitName: 'แผนก 8',
        orgUnitType: 3,
        quotaBytes: 0,
        unitType: 3,
        unitId: 80,
      },
      9: {
        orgUnitId: 9,
        orgUnitCode: 'DEP9',
        orgUnitName: 'แผนก 9',
        orgUnitType: 3,
        quotaBytes: 10 * GB,
        unitType: null,
        unitId: null,
      },
    },
    used: { 7: 0, 8: 50 * GB, 9: 0 },
    units: [
      {
        unitType: 3,
        unitId: 70,
        emsOrgUnitId: 7,
        code: 'DEP7',
        name: 'แผนก 7',
        parentUnitId: 1,
        quotaBytes: 10 * GB,
      },
      {
        unitType: 2,
        unitId: 1,
        emsOrgUnitId: 2,
        code: 'DIV1',
        name: 'ฝ่าย 1',
        parentUnitId: null,
        quotaBytes: 0,
      },
    ],
    requests: [],
    recipients: [10, 20],
    failMaster: false,
  };
  let nextReq = 1;
  const store = {
    resolveOrgQuota: async (id: number) => st.org[id] ?? null,
    orgUsedBytes: async (id: number) => st.used[id] ?? 0,
    alertRecipients: async () => st.recipients,
    listUnits: async () => st.units,
    fileStats: async () => new Map([['3:70', { fileCount: 12, usedBytes: 9 * GB }]]),
    getUnit: async (t: number, id: number) =>
      st.units.find((u) => u.unitType === t && u.unitId === id) ?? null,
    setQuota: async (_t: unknown, type: number, id: number, bytes: number) => {
      if (st.failMaster) return false;
      const u = st.units.find((x) => x.unitType === type && x.unitId === id);
      if (!u) return false;
      u.quotaBytes = bytes;
      for (const o of Object.values(st.org))
        if (o.unitType === type && o.unitId === id) o.quotaBytes = bytes;
      return true;
    },
    insertRequest: async (
      _t: unknown,
      r: {
        orgUnitId: number;
        currentQuotaBytes: number;
        requestedQuotaBytes: number;
        reason: string;
        requestedBy: number;
      },
    ) => {
      const row: QuotaRequestRow = {
        requestId: nextReq++,
        orgUnitName: null,
        status: 1,
        requestedByName: null,
        requestedDate: new Date(),
        reviewedBy: null,
        reviewedDate: null,
        reviewRemark: null,
        ...r,
      };
      st.requests.push(row);
      return row.requestId;
    },
    getRequest: async (id: number) => st.requests.find((r) => r.requestId === id) ?? null,
    pageRequests: async (
      f: { status?: number; requestedBy?: number },
      p: { skip: number; take: number },
    ) => {
      const all = st.requests.filter(
        (r) =>
          (!f.status || r.status === f.status) &&
          (!f.requestedBy || r.requestedBy === f.requestedBy),
      );
      return { items: all.slice(p.skip, p.skip + p.take), total: all.length };
    },
    resolveRequest: async (
      _t: unknown,
      id: number,
      status: number,
      by: number,
      remark: string | null,
    ) => {
      const r = st.requests.find((x) => x.requestId === id && x.status === 1);
      if (!r) return false;
      Object.assign(r, { status, reviewedBy: by, reviewRemark: remark, reviewedDate: new Date() });
      return true;
    },
  };
  // transaction จำลอง: rollback state ถ้า work ล้ม
  const tx = {
    run: async <T>(work: (s: object) => Promise<T>): Promise<T> => {
      const snap = structuredClone(st);
      try {
        return await work({ manager: {}, sp: {} });
      } catch (e) {
        Object.assign(st, snap);
        throw e;
      }
    },
  };
  const sys = { get: async (k: string) => (k in config ? config[k] : null) };
  const notif = fakeNotifications();
  const { service: crud, sink } = makeCrudLog();
  const svc = new QuotaService(crud, store as never, tx as never, notif as never, sys as never);
  return { st, svc, notif, crud, sink };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: BusinessException) => (e.getResponse() as { code: string }).code,
  );
const q = { page: 1, pageSize: 20, sortDir: 'asc', skip: 0 } as never;

describe('QuotaService — บังคับโควตา (port ให้ DMS-core)', () => {
  it('enforce: ยังไม่ตั้งโควตาไม่จำกัด · เต็ม 100% → QUOTA_FULL · วิกฤต (95%) ยังสร้างได้', async () => {
    const { svc, st } = make();
    await expect(svc.enforce(8)).resolves.toBeUndefined(); // quota 0 แม้ใช้ไป 50GB
    await expect(svc.enforce(404)).resolves.toBeUndefined(); // ไม่พบหน่วยงาน = ไม่บล็อก
    st.used[7] = 9.6 * GB;
    await expect(svc.enforce(7)).resolves.toBeUndefined();
    st.used[7] = 10 * GB;
    await expect(svc.enforce(7)).rejects.toMatchObject({ response: { code: 'QUOTA_FULL' } });
    await expect(svc.enforce(7)).rejects.toThrow(/พื้นที่ folder เต็ม/);
  });

  it('validateBatch: ผลรวมไฟล์เกินโควตา → ล้มทั้งชุด (QUOTA_EXCEEDED)', async () => {
    const { svc, st } = make();
    st.used[7] = 9 * GB;
    await expect(svc.validateBatch(7, [0.4 * GB, 0.5 * GB])).resolves.toBeUndefined();
    expect(await code(svc.validateBatch(7, [0.6 * GB, 0.5 * GB]))).toBe('QUOTA_EXCEEDED');
    await expect(svc.validateBatch(8, [100 * GB])).resolves.toBeUndefined(); // ไม่จำกัด
  });

  it('เกณฑ์ Warning/Critical อ่านจาก SystemConfig; ตั้งผิดกลับไป 80/95', async () => {
    const { svc, st } = make({
      DmsQuotaWarnThresholdPct: '50',
      DmsQuotaCriticalThresholdPct: '60',
    });
    st.used[7] = 6 * GB;
    expect((await svc.usageForOrgUnit(7)).alertName).toBe('Critical');
    const bad = make({ DmsQuotaWarnThresholdPct: '99', DmsQuotaCriticalThresholdPct: '60' });
    bad.st.used[7] = 6 * GB;
    expect((await bad.svc.usageForOrgUnit(7)).alertName).toBe('Normal');
    expect(await bad.svc.thresholds()).toEqual({ warnPct: 80, criticalPct: 95 });
  });

  it('sendAlertIfNeeded: แจ้ง Manager/Admin ของหน่วยงานเมื่อเกินเกณฑ์ · ระดับเดิมไม่ส่งซ้ำภายใน 1 ชม. · Normal ไม่ส่ง · ไม่โยน error', async () => {
    const { svc, st, notif } = make();
    const t0 = Date.now();
    await svc.sendAlertIfNeeded(7, t0);
    expect(notif.sent).toHaveLength(0); // Normal
    st.used[7] = 8.5 * GB;
    await svc.sendAlertIfNeeded(7, t0);
    expect(notif.sent.map((n) => [n.recipientUserId, n.eventType])).toEqual([
      [10, 'QUOTA_ALERT'],
      [20, 'QUOTA_ALERT'],
    ]);
    expect(notif.sent[0].messageText).toContain('[QUOTA เตือน] แผนก 7');
    await svc.sendAlertIfNeeded(7, t0 + 60_000); // ซ้ำเร็วเกิน
    expect(notif.sent).toHaveLength(2);
    st.used[7] = 9.7 * GB; // ระดับเปลี่ยนเป็น Critical → ส่งใหม่
    await svc.sendAlertIfNeeded(7, t0 + 120_000);
    expect(notif.sent).toHaveLength(4);
    await svc.sendAlertIfNeeded(7, t0 + 3 * 3_600_000); // เลย 1 ชม.
    expect(notif.sent).toHaveLength(6);
    st.org = null as never; // store พัง
    await expect(svc.sendAlertIfNeeded(7, t0 + 9e9)).resolves.toBeUndefined();
  });

  it('port provider ส่งต่อไปที่ QuotaService ครบ 3 เมธอด', async () => {
    const { svc, st } = make();
    const port = new DmsQuotaPortProvider(svc);
    st.used[7] = 10 * GB;
    await expect(port.enforceQuota(7)).rejects.toMatchObject({ response: { code: 'QUOTA_FULL' } });
    await expect(port.validateBatch(7, [1])).rejects.toMatchObject({
      response: { code: 'QUOTA_EXCEEDED' },
    });
    await expect(port.sendAlertIfNeeded(7)).resolves.toBeUndefined();
  });
});

describe('QuotaService — ภาพรวม/ตั้งค่า', () => {
  it('list: รวมตารางหลัก + FileStats + ระดับ (bigint เป็นสตริง)', async () => {
    const { svc } = make();
    const list = await svc.list();
    expect(list[0]).toMatchObject({
      unitType: 3,
      unitId: 70,
      quotaBytes: String(10 * GB),
      usedBytes: String(9 * GB),
      fileCount: 12,
      usedPercent: 90,
      alertName: 'Warning',
    });
    expect(list[1]).toMatchObject({
      unitType: 2,
      quotaBytes: '0',
      alertName: 'Normal',
      fileCount: 0,
    });
  });

  it('ตั้ง/ลบโควตา: Admin เท่านั้น, ต้อง > 0, ไม่มีหน่วยงาน → 404, เขียน CRUD-log', async () => {
    const { svc, st, crud, sink } = make();
    expect(await code(svc.setQuota(3, 70, '1000', MGR))).toBe('ROLE_REQUIRED');
    expect(await code(svc.setQuota(3, 70, '0', ADMIN))).toBe('QUOTA_INVALID');
    await expect(svc.setQuota(3, 999, '1000', ADMIN)).rejects.toMatchObject({ status: 404 });
    const set = await svc.setQuota(3, 70, String(20 * GB), ADMIN);
    expect(set.quotaBytes).toBe(String(20 * GB));
    const cleared = await svc.clearQuota(3, 70, ADMIN);
    expect(cleared.quotaBytes).toBe('0');
    expect(st.units[0].quotaBytes).toBe(0);
    await crud.drain();
    expect(sink.events.filter((e) => e.success).map((e) => e.operation)).toEqual([
      'SAVE_QUOTA_CONFIG',
      'DELETE_QUOTA_CONFIG',
    ]);
  });
});

describe('QuotaService — คำขอเพิ่มโควตา', () => {
  const req = (orgUnitId: number, gb: number, reason = 'ไฟล์เพิ่ม') => ({
    orgUnitId,
    requestedQuotaBytes: String(gb * GB),
    reason,
  });

  it('ยื่น: ต้อง > ปัจจุบัน + มีเหตุผล; Officer ยื่นได้เฉพาะหน่วยงานตัวเอง; เก็บโควตาปัจจุบันไว้', async () => {
    const { svc } = make();
    expect(await code(svc.submitRequest(req(5, 20), OFFICER))).toBe('QUOTA_REQUEST_OTHER_ORG');
    expect(await code(svc.submitRequest(req(7, 10), OFFICER))).toBe('QUOTA_REQUEST_NOT_GREATER');
    expect(await code(svc.submitRequest(req(7, 20, ' '), OFFICER))).toBe('QUOTA_REASON_REQUIRED');
    await expect(svc.submitRequest(req(404, 20), MGR)).rejects.toMatchObject({ status: 404 });
    const ok = await svc.submitRequest(req(7, 20), OFFICER);
    expect(ok).toMatchObject({
      status: 1,
      currentQuotaBytes: String(10 * GB),
      requestedQuotaBytes: String(20 * GB),
      requestedBy: 30,
    });
    await expect(svc.submitRequest(req(8, 5), MGR)).resolves.toBeDefined(); // Manager ยื่นแทนหน่วยงานอื่นได้
  });

  it('อนุมัติ: Admin เท่านั้น; ตั้ง quota_size ของหน่วยงานหลักพร้อมกัน แล้วแจ้งผู้ขอ', async () => {
    const { svc, st, notif } = make();
    const r = await svc.submitRequest(req(7, 20), OFFICER);
    expect(await code(svc.approveRequest(r.requestId, 'ok', MGR))).toBe('ROLE_REQUIRED');
    const done = await svc.approveRequest(r.requestId, 'เห็นชอบ', ADMIN);
    expect(done).toMatchObject({ status: 2, reviewedBy: 20, reviewRemark: 'เห็นชอบ' });
    expect(st.units[0].quotaBytes).toBe(20 * GB);
    expect(notif.sent.at(-1)).toMatchObject({
      recipientUserId: 30,
      eventType: 'QUOTA_REQUEST_APPROVED',
    });
    expect(notif.sent.at(-1)?.messageText).toContain('20.0 GB');
    expect(await code(svc.approveRequest(r.requestId, 'อีก', ADMIN))).toBe(
      'QUOTA_REQUEST_NOT_PENDING',
    );
  });

  it('อนุมัติแล้วตั้งโควตาไม่ได้ (ไม่พบหน่วยงานหลัก) → rollback คำขอยัง Pending (เดิมตั้ง Approved แต่ไม่มีอะไรเปลี่ยน)', async () => {
    const { svc, st } = make();
    st.org[9].quotaBytes = 5 * GB;
    const r = await svc.submitRequest(req(9, 20), MGR);
    expect(await code(svc.approveRequest(r.requestId, 'ok', ADMIN))).toBe('QUOTA_UNIT_NOT_FOUND');
    expect(st.requests.find((x) => x.requestId === r.requestId)?.status).toBe(1);

    // ตั้งโควตาล้มกลางทาง (UPDATE ไม่เจอแถว) หลังเปลี่ยนสถานะคำขอไปแล้ว → rollback สถานะคำขอด้วย
    const r2 = await svc.submitRequest(req(7, 30), OFFICER);
    st.failMaster = true;
    await expect(svc.approveRequest(r2.requestId, 'ok', ADMIN)).rejects.toThrow();
  });

  it('โควตาปัจจุบันขยับไปเท่ากับ/เกินที่ขอระหว่างรอ → ไม่ให้อนุมัติ (กันลดโควตาโดยไม่ตั้งใจ)', async () => {
    const { svc, st } = make();
    const r = await svc.submitRequest(req(7, 20), OFFICER);
    st.org[7].quotaBytes = 25 * GB;
    expect(await code(svc.approveRequest(r.requestId, 'ok', ADMIN))).toBe('QUOTA_REQUEST_OUTDATED');
  });

  it('ปฏิเสธต้องมีเหตุผล; ยกเลิกได้เฉพาะของตนเองที่ยัง Pending', async () => {
    const { svc, notif } = make();
    const r = await svc.submitRequest(req(7, 20), OFFICER);
    expect(await code(svc.rejectRequest(r.requestId, undefined, ADMIN))).toBe(
      'QUOTA_REASON_REQUIRED',
    );
    await expect(svc.cancelRequest(r.requestId, MGR)).rejects.toMatchObject({ status: 403 });
    expect((await svc.cancelRequest(r.requestId, OFFICER)).status).toBe(4);
    expect(await code(svc.cancelRequest(r.requestId, OFFICER))).toBe('QUOTA_REQUEST_NOT_PENDING');

    const r2 = await svc.submitRequest(req(7, 20), OFFICER);
    const rejected = await svc.rejectRequest(r2.requestId, 'งบไม่พอ', ADMIN);
    expect(rejected).toMatchObject({ status: 3, reviewRemark: 'งบไม่พอ' });
    expect(notif.sent.at(-1)).toMatchObject({ eventType: 'QUOTA_REQUEST_REJECTED' });
    expect(notif.sent.at(-1)?.messageText).toContain('งบไม่พอ');
  });

  it('รายการ: ของฉัน / ทั้งหมดกรองสถานะ', async () => {
    const { svc } = make();
    await svc.submitRequest(req(7, 20), OFFICER);
    await svc.submitRequest(req(8, 5), MGR);
    expect((await svc.listMyRequests(OFFICER, q)).total).toBe(1);
    expect((await svc.listRequests(q)).total).toBe(2);
    expect((await svc.listRequests({ ...(q as object), status: 2 } as never)).total).toBe(0);
  });
});
