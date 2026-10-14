import { SlaStatus, WorkflowStepType as T } from '../../../src/common/constants/enums';
import { Sp } from '../../../src/database/sp/sp-catalog.generated';
import { WFE_CONFIG_KEY, WFE_OP } from '../../../src/modules/wfe/common/wfe.constants';
import { alice, makeWfe, seedTemplate, type Wfe } from './fakes';

const H = 3_600_000;

/** instance ของ alice ที่มี step เปิดอยู่ 3 ตัว: A ยังไม่เสี่ยง · B ใช้เวลา ~83% · C เลยกำหนด (ค่าที่เก็บทั้งหมดยังเป็น OnTime) */
async function withOpenSteps() {
  const w = makeWfe();
  const { defId, step } = seedTemplate(
    w.db,
    [
      { key: 'start', type: T.Start },
      { key: 'a', type: T.Approval, assignedUser: 'DOM\\bob' },
      { key: 'b', type: T.Approval, assignedUser: 'DOM\\carol' },
      { key: 'c', type: T.Review, assignedUser: 'DOM\\dave' },
      { key: 'end', type: T.End },
    ],
    [
      ['start', 'a'],
      ['a', 'end'],
      ['b', 'end'],
      ['c', 'end'],
    ],
  );
  await w.instances.create({ workflowDefinitionId: defId }, alice);
  const now = Date.now();
  const mk = (key: string, assignedTo: string, assignedAgoH: number, deadlineInH: number) => {
    const id = w.db.stepInstances.length + 1;
    w.db.stepInstances.push({
      wfStepInstanceId: 100 + id,
      wfInstanceId: 1,
      wfStepId: step[key],
      status: 1,
      assignedTo,
      assignedDate: new Date(now - assignedAgoH * H),
      startedDate: null,
      completedDate: null,
      completedBy: null,
      outputData: null,
      remarks: null,
      slaDeadline: new Date(now + deadlineInH * H),
      slaStatus: SlaStatus.OnTime,
    });
    return 100 + id;
  };
  w.db.stepInstances.length = 0; // เริ่มจากว่างแล้วใส่เองเพื่อคุมเวลา
  const a = mk('a', 'DOM\\bob', 1, 23);
  const b = mk('b', 'DOM\\carol', 20, 4);
  const c = mk('c', 'DOM\\dave', 30, -6);
  w.trace.length = 0;
  w.notifier.sent.length = 0;
  return { w, ids: { a, b, c } };
}

const flush = async (w: Wfe) => await w.events();

describe('WorkflowSlaService.refresh — อัปเดตสถานะ SLA', () => {
  it('อัปเดตเฉพาะ step ที่สถานะเปลี่ยน (OnTime→AtRisk / OnTime→Overdue) และสรุปจำนวน', async () => {
    const { w, ids } = await withOpenSteps();
    const r = await w.sla.refresh({ escalate: false });
    expect(r).toEqual({
      checked: 3,
      updated: 2,
      becameAtRisk: 1,
      becameOverdue: 1,
      escalated: false,
    });
    expect(w.slaStore.updatedStatuses).toEqual([
      { ids: [ids.b], status: SlaStatus.AtRisk },
      { ids: [ids.c], status: SlaStatus.Overdue },
    ]);
    const byId = (id: number) =>
      w.db.stepInstances.find((s) => s.wfStepInstanceId === id)?.slaStatus;
    expect([byId(ids.a), byId(ids.b), byId(ids.c)]).toEqual([
      SlaStatus.OnTime,
      SlaStatus.AtRisk,
      SlaStatus.Overdue,
    ]);
  });

  it('escalate=false: ไม่แจ้งเตือน ไม่บันทึก SLAEscalated', async () => {
    const { w } = await withOpenSteps();
    await w.sla.refresh({ escalate: false });
    expect(w.notifier.sent).toHaveLength(0);
    const evs = await flush(w);
    expect(evs.filter((e) => e.operation === WFE_OP.slaEscalated)).toHaveLength(0);
  });

  it('สั่งอัปเดตทันที (Admin): บันทึก CRUD-log SLAStatusRefreshed พร้อมสรุป; escalation ตามค่า WorkflowEscalationEnabled', async () => {
    const { w } = await withOpenSteps();
    const r = await w.sla.refreshNow();
    expect(r).toMatchObject({ updated: 2, escalated: false });
    const [ev] = (await flush(w)).filter((e) => e.operation === WFE_OP.slaRefreshed);
    expect(ev).toMatchObject({
      action: 'EXECUTE',
      entity: 'WorkflowStepInstance',
      success: true,
      meta: { trigger: 'manual', checked: 3, updated: 2, becameAtRisk: 1, becameOverdue: 1 },
    });
    expect(w.notifier.sent).toHaveLength(0);

    const { w: w2 } = await withOpenSteps();
    w2.db.config[WFE_CONFIG_KEY.escalationEnabled] = true;
    expect((await w2.sla.refreshNow()).escalated).toBe(true);
    expect(w2.notifier.all.length).toBeGreaterThan(0);
  });

  it('escalate=true: เลยกำหนดบันทึก SLAEscalated (ผู้ทำ=system) + แจ้งเตือนผู้รับผิดชอบและผู้เริ่ม; ใกล้ครบกำหนดแจ้งเตือนผู้รับผิดชอบ', async () => {
    const { w, ids } = await withOpenSteps();
    await w.sla.refresh({ escalate: true });

    const esc = (await flush(w)).filter((e) => e.operation === WFE_OP.slaEscalated);
    expect(esc).toHaveLength(1);
    expect(esc[0]).toMatchObject({
      module: 'WFE',
      entity: 'WorkflowStepInstance',
      action: 'EXECUTE',
      recordId: ids.c,
      success: true,
      actor: { userName: 'system' },
    });
    expect(esc[0].meta).toMatchObject({ assignedTo: 'DOM\\dave', reason: 'SLA deadline exceeded' });
    expect(esc[0].meta?.hoursOverdue).toBeCloseTo(6, 0);

    expect(w.notifier.all.map((n) => [n.kind, n.recipient])).toEqual([
      ['SLA_WARNING', 'DOM\\carol'],
      ['SLA_ESCALATED', 'DOM\\dave'],
      ['SLA_ESCALATED', alice.adUserName],
    ]);
  });

  it('รอบที่สองไม่เปลี่ยนอะไรและไม่แจ้ง/escalate ซ้ำ (แจ้งเฉพาะตอนสถานะเปลี่ยน)', async () => {
    const { w } = await withOpenSteps();
    await w.sla.refresh({ escalate: true });
    w.notifier.sent.length = 0;
    w.slaStore.updatedStatuses.length = 0;
    const r = await w.sla.refresh({ escalate: true });
    expect(r).toMatchObject({ checked: 3, updated: 0, becameAtRisk: 0, becameOverdue: 0 });
    expect(w.slaStore.updatedStatuses).toHaveLength(0);
    expect(w.notifier.all).toHaveLength(0);
    expect((await flush(w)).filter((e) => e.operation === WFE_OP.slaEscalated)).toHaveLength(1);
  });

  it('ใช้ WorkflowSLAWarningThresholdPercent จากค่าตั้ง (เกณฑ์ 95% → B ยังไม่เสี่ยง)', async () => {
    const { w } = await withOpenSteps();
    w.db.config[WFE_CONFIG_KEY.slaWarningThresholdPercent] = 95;
    const r = await w.sla.refresh({ escalate: false });
    expect(r).toMatchObject({ becameAtRisk: 0, becameOverdue: 1 });
  });

  it('step ของ workflow ที่ถูกระงับและ step ที่ปิดแล้วไม่ถูกตรวจ', async () => {
    const { w, ids } = await withOpenSteps();
    w.db.instances[0].status = 5; // Suspended
    expect((await w.sla.refresh({ escalate: false })).checked).toBe(0);
    w.db.instances[0].status = 2;
    w.db.stepInstances.find((s) => s.wfStepInstanceId === ids.c)!.status = 3; // Completed
    expect((await w.sla.refresh({ escalate: false })).checked).toBe(2);
  });
});

describe('WorkflowSlaService.scheduledRefresh — งานเบื้องหลัง (ปิดเป็นค่าเริ่มต้น)', () => {
  it('ค่าเริ่มต้น (ไม่มี WorkflowEscalationEnabled) → ไม่ทำอะไรเลย แม้ไม่แตะ DB/ล็อก', async () => {
    const { w } = await withOpenSteps();
    await w.sla.scheduledRefresh();
    expect(w.slaStore.openCalls).toBe(0);
    expect(w.slaStore.lockAttempts).toBe(0);
    expect(w.slaStore.updatedStatuses).toHaveLength(0);
  });

  it('WorkflowEscalationEnabled=false ชัดเจน → ไม่ทำ', async () => {
    const { w } = await withOpenSteps();
    w.db.config[WFE_CONFIG_KEY.escalationEnabled] = false;
    await w.sla.scheduledRefresh();
    expect(w.slaStore.openCalls).toBe(0);
  });

  it('เปิดใช้: ล็อก → อัปเดต+escalate → ปล่อยล็อก', async () => {
    const { w, ids } = await withOpenSteps();
    w.db.config[WFE_CONFIG_KEY.escalationEnabled] = true;
    await w.sla.scheduledRefresh();
    expect(w.trace.filter((t) => t.startsWith('sla:'))).toEqual(['sla:lock', 'sla:unlock']);
    expect(w.db.stepInstances.find((s) => s.wfStepInstanceId === ids.c)?.slaStatus).toBe(
      SlaStatus.Overdue,
    );
    expect((await flush(w)).filter((e) => e.operation === WFE_OP.slaEscalated)).toHaveLength(1);
    const summary = (await flush(w)).find((e) => e.operation === WFE_OP.slaRefreshed);
    expect(summary).toMatchObject({
      action: 'UPDATE',
      actor: { userName: 'system' },
      meta: { trigger: 'cron', updated: 2 },
    });
  });

  it('เคารพ WorkflowSLAJobIntervalMinutes: เรียกถี่กว่าช่วงที่ตั้งจะข้าม', async () => {
    const { w } = await withOpenSteps();
    w.db.config[WFE_CONFIG_KEY.escalationEnabled] = true;
    w.db.config[WFE_CONFIG_KEY.slaJobIntervalMinutes] = 10;
    await w.sla.scheduledRefresh();
    const first = w.slaStore.lockAttempts;
    await w.sla.scheduledRefresh();
    expect(w.slaStore.lockAttempts).toBe(first); // ยังไม่ครบ 10 นาที
  });

  it('instance อื่นถือล็อกอยู่ → ข้ามรอบนี้', async () => {
    const { w } = await withOpenSteps();
    w.db.config[WFE_CONFIG_KEY.escalationEnabled] = true;
    w.slaStore.lockAvailable = false;
    await w.sla.scheduledRefresh();
    expect(w.slaStore.lockAttempts).toBe(1);
    expect(w.slaStore.openCalls).toBe(0);
  });

  it('เกิด error ระหว่างทำงาน → ไม่โยนออกไป และปล่อยล็อกเสมอ', async () => {
    const { w } = await withOpenSteps();
    w.db.config[WFE_CONFIG_KEY.escalationEnabled] = true;
    w.slaStore.openSlaRows = async () => {
      throw new Error('db down');
    };
    await expect(w.sla.scheduledRefresh()).resolves.toBeUndefined();
    expect(w.trace.filter((t) => t.startsWith('sla:'))).toEqual(['sla:lock', 'sla:unlock']);
  });

  it('ไม่ทำงานซ้อนกันในโปรเซสเดียว', async () => {
    const { w } = await withOpenSteps();
    w.db.config[WFE_CONFIG_KEY.escalationEnabled] = true;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = w.slaStore.openSlaRows.bind(w.slaStore);
    w.slaStore.openSlaRows = async (...args: Parameters<typeof original>) => {
      await gate;
      return original(...args);
    };
    const first = w.sla.scheduledRefresh();
    await new Promise((r) => setImmediate(r)); // ให้รอบแรกไปถึงจุดที่กำลังทำงานอยู่
    await w.sla.scheduledRefresh(); // รอบที่สองเห็นว่ากำลังรัน → กลับทันที ไม่ขอล็อกซ้ำ
    expect(w.slaStore.lockAttempts).toBe(1);
    release();
    await first;
    expect(w.slaStore.lockAttempts).toBe(1);
  });
});

describe('WorkflowSlaService — รายงาน', () => {
  it('compliance: สรุปจาก sp_WF_GetSLAComplianceMetrics + ตาม template + แนวโน้ม + การกระจายระยะเวลา + top 5 ผู้ที่เกินกำหนด', async () => {
    const w = makeWfe();
    w.sp.reportRows[Sp.dbo.wfGetSlaComplianceMetrics.name] = [
      {
        TotalSteps: 10,
        OnTimeCount: 6,
        AtRiskCount: 2,
        OverdueCount: 2,
        OnTimePercent: 60.04,
        AvgCompletionHours: 5.25,
      },
    ];
    w.sp.reportRows[Sp.dbo.wfGetTaskDistribution.name] = [
      { AssignedTo: 'u1', TotalAssigned: 9, Completed: 5, Pending: 3, Rejected: 1, Overdue: 4 },
      { AssignedTo: 'u2', TotalAssigned: 3, Completed: 3, Pending: 0, Rejected: 0, Overdue: 0 },
      ...[2, 7, 3, 1, 5, 6].map((o, i) => ({
        AssignedTo: `x${i}`,
        TotalAssigned: 5,
        Completed: 1,
        Pending: 4,
        Rejected: 0,
        Overdue: o,
      })),
    ];
    const r = await w.sla.compliance({ workflowDefinitionId: 1, weeks: 12 } as never);

    expect(r.summary).toEqual({
      totalTasks: 10,
      onTimeCount: 6,
      atRiskCount: 2,
      overdueCount: 2,
      onTimePercent: 60,
      averageCompletionHours: 5.3,
    });
    // SP ได้รับตัวกรองแบบ PascalCase ตามนิยามจริง
    expect(w.sp.calls[0].input).toMatchObject({
      WorkflowDefinitionId: 1,
      FromDate: null,
      ToDate: null,
    });
    expect(r.byTemplate).toEqual([
      {
        workflowDefinitionId: 1,
        templateName: 'T1',
        totalTasks: 4,
        onTimeCount: 2,
        atRiskCount: 1,
        overdueCount: 1,
        compliancePercent: 75,
      },
    ]);
    expect(r.topOverdueUsers.map((u) => [u.userName, u.overdue])).toEqual([
      ['x1', 7],
      ['x5', 6],
      ['x4', 5],
      ['u1', 4],
      ['x2', 3],
    ]);
    expect(r.weeklyTrend).toEqual([
      { year: 2026, week: 9, weekLabel: 'W1', compliancePercent: 75, totalTasks: 4 },
      { year: 2026, week: 10, weekLabel: 'W2', compliancePercent: 50, totalTasks: 2 },
    ]);
    expect(r.cycleTimeDistribution.map((c) => [c.label, c.category])).toEqual([
      ['0–1', 'pass'],
      ['3–4', 'near'],
      ['10+', 'over'],
    ]);
  });

  it('ไม่มีข้อมูลเลย (SP คืนไม่มีแถว) → ศูนย์ทั้งหมด ไม่ error', async () => {
    const w = makeWfe();
    const r = await w.sla.compliance({} as never);
    expect(r.summary).toEqual({
      totalTasks: 0,
      onTimeCount: 0,
      atRiskCount: 0,
      overdueCount: 0,
      onTimePercent: 0,
      averageCompletionHours: 0,
    });
    expect(r.topOverdueUsers).toEqual([]);
  });

  it('task-distribution: แบ่งหน้าในหน่วยความจำ (SP คืนทั้งหมด) · overdue: ชั่วโมงที่เลยกำหนดคำนวณสด', async () => {
    const w = makeWfe();
    w.sp.reportRows[Sp.dbo.wfGetTaskDistribution.name] = Array.from({ length: 5 }, (_, i) => ({
      AssignedTo: `u${i}`,
      TotalAssigned: 1,
      Completed: 0,
      Pending: 1,
      Rejected: 0,
      Overdue: 0,
    }));
    const page = await w.sla.taskDistribution({ page: 2, pageSize: 2, sortDir: 'asc' } as never);
    expect(page.total).toBe(5);
    expect(page.items.map((u) => u.userName)).toEqual(['u2', 'u3']);

    const over = await w.sla.overdue({ page: 1, pageSize: 10, sortDir: 'asc' } as never);
    expect(over.total).toBe(1);
    expect(over.items[0]).toMatchObject({
      templateName: 'T1',
      stepName: 'อนุมัติ',
      assignedTo: 'DOM\\bob',
    });
    expect(over.items[0].hoursOverdue).toBeCloseTo(26, 0);
  });
});
