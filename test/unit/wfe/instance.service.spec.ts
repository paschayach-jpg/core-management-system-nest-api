import {
  SlaStatus,
  WorkflowInstanceStatus as IS,
  WorkflowStepInstanceStatus as SS,
  WorkflowStepType as T,
  WorkflowTemplateStatus as TS,
} from '../../../src/common/constants/enums';
import { Sp } from '../../../src/database/sp/sp-catalog.generated';
import { SpExecutionError } from '../../../src/database/sp/sp-execution.error';
import { WFE_ENTITY, WFE_OP } from '../../../src/modules/wfe/common/wfe.constants';
import {
  alice,
  asUser,
  boss,
  bob,
  carol,
  LINEAR_JSON,
  makeWfe,
  seedLinear,
  seedTemplate,
  type Wfe,
} from './fakes';

const H = 3_600_000;
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { response?: { code?: string; details?: unknown }; message: string };
  }
  throw new Error('คาดว่าจะโยน error แต่สำเร็จ');
}
const events = async (w: Wfe, operation: string) =>
  (await w.events()).filter((e) => e.operation === operation);
const spNames = (w: Wfe) => w.sp.calls.map((c) => c.sp);
const SP_INSTANCE = Sp.wfe.createWfInstance.name;
const SP_STEP = Sp.wfe.createWfStepInstance.name;

/** instance ที่เริ่มแล้วจากแม่แบบ Start → อนุมัติ(bob) → End โดย alice */
async function startedLinear() {
  const w = makeWfe();
  const seeded = seedLinear(w.db);
  const created = await w.instances.create({ workflowDefinitionId: seeded.defId }, alice);
  const stepOf = (key: string) => w.db.stepInstances.find((s) => s.wfStepId === seeded.step[key]);
  w.sp.calls.length = 0;
  w.trace.length = 0;
  w.notifier.sent.length = 0;
  return { w, ...seeded, id: created.workflowInstanceId, created, stepOf };
}

describe('WorkflowInstancesService.create — สร้างผ่าน SP ตามลำดับ', () => {
  it('เรียก sp_CreateWFInstance → sp_CreateWFStepInstance ใน transaction เดียว แล้วปรับ Status 0 → InProgress', async () => {
    const w = makeWfe();
    const { defId, step } = seedLinear(w.db);
    const before = Date.now();

    const r = await w.instances.create(
      { workflowDefinitionId: defId, inputParameters: '{"a":1}' },
      alice,
    );

    expect(spNames(w)).toEqual([SP_INSTANCE, SP_STEP]);
    // ลำดับรวมทุกอย่างใน transaction เดียว: SP, SP, แล้วค่อยอัปเดต instance ก่อน commit; แจ้งเตือนหลัง commit เท่านั้น
    expect(w.trace).toEqual([
      'tx:begin',
      `sp:${SP_INSTANCE}`,
      `sp:${SP_STEP}`,
      'store.updateInstance',
      'tx:commit',
      'notify',
    ]);
    // ทั้งสอง SP รับ scope.sp ของ transaction (ไม่ใช่ connection แยก)
    expect(w.sp.calls.every((c) => (c.options as { fakeTx?: boolean }).fakeTx)).toBe(true);

    expect(w.sp.calls[0].input).toEqual({
      WFDefinitionId: defId,
      TemplateVersion: 3,
      InitiatedBy: alice.adUserName,
      InputParameters: '{"a":1}',
    });
    const si = w.sp.calls[1].input as Record<string, unknown>;
    expect(si).toMatchObject({
      WFInstanceId: r.workflowInstanceId,
      WFStepId: step.start,
      AssignedTo: alice.adUserName,
    });
    // SLADeadline ส่งเป็น Date (SP แปลงเป็นสตริง ISO เอง) · ไม่ส่ง SLAStatus เป็นสตริง
    expect(si.SLADeadline).toBeInstanceOf(Date);
    expect((si.SLADeadline as Date).getTime() - before).toBeGreaterThanOrEqual(24 * H - 5000);
    expect((si.SLADeadline as Date).getTime() - before).toBeLessThan(24 * H + 5000);
    expect('SLAStatus' in si).toBe(false);

    expect(r).toMatchObject({
      status: IS.InProgress,
      currentStepId: step.start,
      currentStepName: 'เริ่ม',
      initiatedBy: alice.adUserName,
      templateVersion: 3,
      totalStepCount: 3,
      completedStepCount: 0,
    });
    expect(r.stepHistory).toHaveLength(1);
    expect(r.stepHistory[0]).toMatchObject({
      status: SS.Pending,
      assignedTo: alice.adUserName,
      stepName: 'เริ่ม',
    });
    expect(r.allowedActions).toEqual(['SUSPEND', 'CANCEL']);
  });

  it('บันทึก CRUD-log ด้วยชื่อเดิม WorkflowInstanceCreated ผูกกับ entity WorkflowInstance + id ของ instance', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db);
    const r = await w.instances.create({ workflowDefinitionId: defId }, alice);
    const [ev] = await events(w, WFE_OP.instanceCreated);
    expect(ev).toMatchObject({
      module: 'WFE',
      entity: WFE_ENTITY.instance,
      action: 'CREATE',
      recordId: r.workflowInstanceId,
      success: true,
    });
    expect(ev.entity).toBe('WorkflowInstance'); // ชื่อที่ AuditLogsService.byWorkflowInstance ค้น
  });

  it('SP ตัวที่สองล้ม → rollback ทั้งหมด (ไม่เหลือ instance สถานะ 0 ค้าง), ไม่แจ้งเตือน, log success=false', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db);
    w.sp.failOn(SP_STEP, new SpExecutionError(SP_STEP, 'WFInstanceId and WFStepId are required.'));

    const e = await rejection(w.instances.create({ workflowDefinitionId: defId }, alice));

    expect(e.message).toContain('required');
    expect(w.db.instances).toHaveLength(0);
    expect(w.db.stepInstances).toHaveLength(0);
    expect(w.trace).toEqual(['tx:begin', `sp:${SP_INSTANCE}`, `sp:${SP_STEP}`, 'tx:rollback']);
    expect(w.notifier.sent).toHaveLength(0);
    const [ev] = await events(w, WFE_OP.instanceCreated);
    expect(ev).toMatchObject({ success: false, action: 'CREATE' });
    expect(ev.errorCode).toBeDefined();
  });

  it('template ต้อง Active: Draft (แม้ IsActive=1 จากข้อมูลเก่า) / Inactive / ไม่มี → ไม่เรียก SP เลย', async () => {
    const w = makeWfe();
    const draftActiveFlag = seedLinear(w.db, { approvalStatus: TS.Draft, isActive: true });
    const inactive = seedLinear(w.db, { approvalStatus: TS.Inactive, isActive: false });
    const flagOff = seedLinear(w.db, { approvalStatus: TS.Active, isActive: false });
    for (const t of [draftActiveFlag, inactive, flagOff])
      expect(
        code(await rejection(w.instances.create({ workflowDefinitionId: t.defId }, alice))),
      ).toBe('TEMPLATE_NOT_ACTIVE');
    expect(code(await rejection(w.instances.create({ workflowDefinitionId: 404 }, alice)))).toBe(
      'NOT_FOUND',
    );
    expect(w.sp.calls).toHaveLength(0);
    expect(w.db.instances).toHaveLength(0);
  });

  it('template ไม่มีขั้นตอน Start → 422 และไม่สร้าง instance ค้าง (ตรวจก่อนเรียก SP)', async () => {
    const w = makeWfe();
    const { defId } = seedTemplate(
      w.db,
      [
        { key: 'a', type: T.Approval },
        { key: 'e', type: T.End },
      ],
      [['a', 'e']],
    );
    expect(code(await rejection(w.instances.create({ workflowDefinitionId: defId }, alice)))).toBe(
      'TEMPLATE_NO_START_STEP',
    );
    expect(w.sp.calls).toHaveLength(0);
  });

  describe('fallback SyncStepsFromTemplateDefinition', () => {
    it('ไม่มีแถว step แต่มี TemplateDefinition → สร้างแถวจาก JSON ใน transaction เดียวกันแล้วเริ่มได้', async () => {
      const w = makeWfe();
      const { defId } = seedTemplate(w.db, [], null, { templateDefinition: LINEAR_JSON });
      const r = await w.instances.create({ workflowDefinitionId: defId }, alice);
      expect(w.db.steps.filter((s) => !s.isDeleted)).toHaveLength(3);
      expect(w.db.conns.filter((c) => !c.isDeleted)).toHaveLength(2);
      const start = w.db.steps.find((s) => s.stepType === T.Start);
      expect(r.currentStepId).toBe(start?.wfStepId);
      // การสร้างแถว step เกิดก่อน SP (ต้องมี WFStepId ให้อ้าง)
      expect(w.trace.indexOf('store.insertStep')).toBeLessThan(
        w.trace.indexOf(`sp:${SP_INSTANCE}`),
      );
    });

    it('ถ้าขั้นต่อมาล้ม แถวที่เพิ่งสร้างจาก JSON ก็ถูก rollback ด้วย', async () => {
      const w = makeWfe();
      const { defId } = seedTemplate(w.db, [], null, { templateDefinition: LINEAR_JSON });
      w.sp.failOn(SP_INSTANCE, new SpExecutionError(SP_INSTANCE, 'boom'));
      await rejection(w.instances.create({ workflowDefinitionId: defId }, alice));
      expect(w.db.steps).toHaveLength(0);
      expect(w.db.conns).toHaveLength(0);
    });

    it('JSON ไม่มี Start → 422', async () => {
      const w = makeWfe();
      const { defId } = seedTemplate(w.db, [], null, {
        templateDefinition: JSON.stringify({
          Steps: [{ WorkflowStepId: 1, StepName: 'a', StepType: 'Approval' }],
        }),
      });
      expect(
        code(await rejection(w.instances.create({ workflowDefinitionId: defId }, alice))),
      ).toBe('TEMPLATE_NO_START_STEP');
    });
  });

  describe('ผู้รับผิดชอบ step แรก', () => {
    it('ใช้ AssignedUser ของ step (ชื่อตามที่ระบบเก็บ ไม่สนตัวพิมพ์ที่พิมพ์ใน template)', async () => {
      const w = makeWfe();
      const { defId } = seedTemplate(
        w.db,
        [
          { key: 's', type: T.Start, assignedUser: 'dom\\CAROL' },
          { key: 'e', type: T.End },
        ],
        [['s', 'e']],
      );
      await w.instances.create({ workflowDefinitionId: defId }, alice);
      expect(w.sp.calls[1].input.AssignedTo).toBe('DOM\\carol');
    });

    it.each([
      [
        'ผู้ใช้ที่ไม่มีในระบบ/กลุ่ม AD',
        { assignedUser: 'AD Group: HR-Process-Owners' },
        'STEP_ASSIGNEE_NOT_FOUND',
      ],
      ['ผู้ใช้ที่ถูกปิดใช้งาน', { assignedUser: 'DOM\\gone' }, 'STEP_ASSIGNEE_NOT_FOUND'],
      ['ระบุเฉพาะบทบาท', { assignedRole: 'Legal' }, 'STEP_ASSIGNEE_UNSUPPORTED'],
    ])('%s → ปฏิเสธก่อนเรียก SP', async (_n, over, expected) => {
      const w = makeWfe();
      const { defId } = seedTemplate(
        w.db,
        [
          { key: 's', type: T.Start, ...over },
          { key: 'e', type: T.End },
        ],
        [['s', 'e']],
      );
      expect(
        code(await rejection(w.instances.create({ workflowDefinitionId: defId }, alice))),
      ).toBe(expected);
      expect(w.sp.calls).toHaveLength(0);
    });
  });

  describe('SLA deadline ของ step แรก', () => {
    const deadlineOf = async (
      steps: Parameters<typeof seedTemplate>[1],
      cfg: Record<string, number> = {},
    ) => {
      const w = makeWfe();
      Object.assign(w.db.config, cfg);
      const { defId } = seedTemplate(w.db, steps, [[steps[0].key, steps[1].key]]);
      const t0 = Date.now();
      await w.instances.create({ workflowDefinitionId: defId }, alice);
      return ((w.sp.calls[1].input.SLADeadline as Date).getTime() - t0) / H;
    };
    it('SLAHours มาก่อน; รองลงมา SLADays×24; ไม่มีใช้ WorkflowSLADefaultHours', async () => {
      const end = { key: 'e', type: T.End };
      expect(
        await deadlineOf([{ key: 's', type: T.Start, slaHours: 6, slaDays: 9 }, end]),
      ).toBeCloseTo(6, 1);
      expect(await deadlineOf([{ key: 's', type: T.Start, slaDays: 2 }, end])).toBeCloseTo(48, 1);
      expect(await deadlineOf([{ key: 's', type: T.Start }, end])).toBeCloseTo(24, 1);
      expect(
        await deadlineOf([{ key: 's', type: T.Start }, end], { WorkflowSLADefaultHours: 12 }),
      ).toBeCloseTo(12, 1);
    });
  });
});

describe('WorkflowInstancesService.completeStep — เส้นทางและ StepResolver', () => {
  it('เส้นตรง: จบ Start → สร้าง step ของ bob → จบ → workflow เสร็จ (CurrentStepId = End)', async () => {
    const { w, id, step, stepOf } = await startedLinear();
    const startSi = stepOf('start')!;

    const r1 = await w.instances.completeStep(
      startSi.wfStepInstanceId,
      { remarks: 'ส่งเรื่อง' },
      alice,
    );

    expect(r1.instanceStatus).toBe(IS.InProgress);
    expect(r1.currentStepId).toBe(step.approve);
    expect(r1.stepInstance).toMatchObject({
      status: SS.Completed,
      completedBy: alice.adUserName,
      remarks: 'ส่งเรื่อง',
      outputData: 'ส่งเรื่อง',
    });
    expect(r1.createdStepInstances).toHaveLength(1);
    expect(r1.createdStepInstances[0]).toMatchObject({
      assignedTo: 'DOM\\bob',
      status: SS.Pending,
      stepName: 'อนุมัติ',
    });
    expect(spNames(w)).toEqual([SP_STEP]);
    expect(w.sp.calls[0].input).toMatchObject({
      WFInstanceId: id,
      WFStepId: step.approve,
      AssignedTo: 'DOM\\bob',
    });
    expect(w.db.instances[0].currentStepId).toBe(step.approve);
    expect(w.notifier.all.map((n) => [n.kind, n.recipient])).toEqual([
      ['TASK_ASSIGNED', 'DOM\\bob'],
    ]);

    const approveSi = w.db.stepInstances.find((s) => s.wfStepId === step.approve)!;
    const r2 = await w.instances.completeStep(
      approveSi.wfStepInstanceId,
      { outputData: '{"decision":"ok"}' },
      bob,
    );
    expect(r2.instanceStatus).toBe(IS.Completed);
    expect(r2.currentStepId).toBe(step.end);
    expect(r2.createdStepInstances).toHaveLength(0);
    expect(w.db.instances[0]).toMatchObject({ status: IS.Completed, currentStepId: step.end });
    expect(w.db.instances[0].completedDate).toBeInstanceOf(Date);
    expect(w.notifier.all.at(-1)).toMatchObject({
      kind: 'WORKFLOW_COMPLETED',
      recipient: alice.adUserName,
    });
  });

  it('บันทึก CRUD-log WorkflowStepCompleted ผูก entity WorkflowStepInstance + รหัส step instance (ให้ประวัติค้นเจอ)', async () => {
    const { w, stepOf } = await startedLinear();
    const startSi = stepOf('start')!;
    await w.instances.completeStep(startSi.wfStepInstanceId, {}, alice);
    const [ev] = await events(w, WFE_OP.stepCompleted);
    expect(ev).toMatchObject({
      module: 'WFE',
      entity: 'WorkflowStepInstance',
      action: 'EXECUTE',
      recordId: startSi.wfStepInstanceId,
      success: true,
    });
    expect(ev.before).toMatchObject({ status: SS.Pending, assignedTo: alice.adUserName });
    expect(ev.meta).toMatchObject({ instanceStatus: IS.InProgress });
  });

  it('SLAStatus ประเมินตอนเสร็จ: ทันกำหนด = OnTime, เลยกำหนด = Overdue', async () => {
    const { w, stepOf } = await startedLinear();
    const startSi = stepOf('start')!;
    const ok = await w.instances.completeStep(startSi.wfStepInstanceId, {}, alice);
    expect(ok.stepInstance.slaStatus).toBe(SlaStatus.OnTime);

    const late = w.db.stepInstances.find((s) => s.assignedTo === 'DOM\\bob')!;
    late.assignedDate = new Date(Date.now() - 80 * H);
    late.slaDeadline = new Date(Date.now() - 56 * H);
    const r = await w.instances.completeStep(late.wfStepInstanceId, {}, bob);
    expect(r.stepInstance.slaStatus).toBe(SlaStatus.Overdue);
    expect(
      w.db.stepInstances.find((s) => s.wfStepInstanceId === late.wfStepInstanceId)?.slaStatus,
    ).toBe(SlaStatus.Overdue);
  });

  it('ไม่ใช่ผู้รับผิดชอบ → 403 · ทำซ้ำ → 409 · ไม่พบ → 404 · log success=false', async () => {
    const { w, stepOf } = await startedLinear();
    const startSi = stepOf('start')!;
    expect(
      code(await rejection(w.instances.completeStep(startSi.wfStepInstanceId, {}, carol))),
    ).toBe('NOT_ASSIGNEE');
    await w.instances.completeStep(startSi.wfStepInstanceId, {}, alice);
    expect(
      code(await rejection(w.instances.completeStep(startSi.wfStepInstanceId, {}, alice))),
    ).toBe('STEP_ALREADY_CLOSED');
    expect(code(await rejection(w.instances.completeStep(9999, {}, alice)))).toBe('NOT_FOUND');
    const evs = await events(w, WFE_OP.stepCompleted);
    expect(evs.map((e) => e.success)).toEqual([false, true, false, false]);
  });

  it('instance ที่ถูกระงับ/ยกเลิก ทำ step ต่อไม่ได้ (Suspend มีผลจริง)', async () => {
    const { w, id, stepOf } = await startedLinear();
    const startSi = stepOf('start')!;
    await w.instances.suspend(id, alice);
    expect(
      code(await rejection(w.instances.completeStep(startSi.wfStepInstanceId, {}, alice))),
    ).toBe('INSTANCE_NOT_ACTIVE');
    await w.instances.resume(id, alice);
    await expect(
      w.instances.completeStep(startSi.wfStepInstanceId, {}, alice),
    ).resolves.toBeDefined();
  });

  it('ผู้รับผิดชอบ step ถัดไปที่ระบุไว้ไม่ใช่ผู้ใช้ที่ใช้งาน → rollback ทั้ง step ที่เพิ่งจบ', async () => {
    const w = makeWfe();
    const { defId, step } = seedTemplate(
      w.db,
      [
        { key: 's', type: T.Start },
        { key: 'a', type: T.Approval, assignedUser: 'DOM\\gone' },
        { key: 'e', type: T.End },
      ],
      [
        ['s', 'a'],
        ['a', 'e'],
      ],
    );
    const created = await w.instances.create({ workflowDefinitionId: defId }, alice);
    const startSi = w.db.stepInstances[0];
    const e = await rejection(w.instances.completeStep(startSi.wfStepInstanceId, {}, alice));
    expect(code(e)).toBe('STEP_ASSIGNEE_NOT_FOUND');
    expect(w.db.stepInstances).toHaveLength(1);
    expect(w.db.stepInstances[0].status).toBe(SS.Pending); // ยังไม่ถูกปิด
    expect(w.db.instances[0]).toMatchObject({
      wfInstanceId: created.workflowInstanceId,
      currentStepId: step.s,
    });
  });

  describe('Parallel / Decision / Merge ตามที่ service เดิมทำจริง', () => {
    async function parallelFlow() {
      const w = makeWfe();
      const seeded = seedTemplate(
        w.db,
        [
          { key: 'start', type: T.Start },
          { key: 'par', type: T.Parallel },
          { key: 'a', type: T.Approval, assignedUser: 'DOM\\carol' },
          { key: 'b', type: T.Review, assignedUser: 'DOM\\dave' },
          { key: 'end', type: T.End },
        ],
        [
          ['start', 'par'],
          ['par', 'a'],
          ['par', 'b'],
          ['a', 'end'],
          ['b', 'end'],
        ],
      );
      const created = await w.instances.create({ workflowDefinitionId: seeded.defId }, alice);
      const si = (key: string) => w.db.stepInstances.find((s) => s.wfStepId === seeded.step[key])!;
      await w.instances.completeStep(si('start').wfStepInstanceId, {}, alice);
      return { w, ...seeded, id: created.workflowInstanceId, si };
    }

    it('Parallel: เดินทุกเส้นออกพร้อมกัน สร้าง step instance ครบทุกสาขา', async () => {
      const { w, step, si } = await parallelFlow();
      w.sp.calls.length = 0;
      const r = await w.instances.completeStep(si('par').wfStepInstanceId, {}, alice);
      expect(r.createdStepInstances.map((c) => [c.stepName, c.assignedTo])).toEqual([
        ['a', 'DOM\\carol'],
        ['b', 'DOM\\dave'],
      ]);
      expect(spNames(w)).toEqual([SP_STEP, SP_STEP]);
      expect(r.currentStepId).toBe(step.a); // CurrentStepId = step แรกของสาขา
    });

    it('ถึง End แต่อีกสาขายังค้าง → instance ยัง InProgress (ชี้ไป step ที่ค้าง); สาขาสุดท้ายจบ → Completed', async () => {
      const { w, id, step, si } = await parallelFlow();
      await w.instances.completeStep(si('par').wfStepInstanceId, {}, alice);

      const first = await w.instances.completeStep(si('a').wfStepInstanceId, {}, asUser('carol'));
      expect(first.instanceStatus).toBe(IS.InProgress);
      expect(first.currentStepId).toBe(step.b);
      expect(w.db.instances.find((i) => i.wfInstanceId === id)?.completedDate).toBeNull();

      const last = await w.instances.completeStep(si('b').wfStepInstanceId, {}, asUser('dave'));
      expect(last.instanceStatus).toBe(IS.Completed);
      expect(last.currentStepId).toBe(step.end);
    });

    it('Decision: เงื่อนไขของเส้นเชื่อมไม่ถูกประเมิน (evaluator เดิมเป็น stub) → ทุกสาขาถูกสร้าง', async () => {
      const w = makeWfe();
      const seeded = seedTemplate(
        w.db,
        [
          { key: 'start', type: T.Start },
          { key: 'dec', type: T.Decision },
          { key: 'yes', type: T.Approval, assignedUser: 'DOM\\carol' },
          { key: 'no', type: T.Approval, assignedUser: 'DOM\\dave' },
          { key: 'end', type: T.End },
        ],
        [
          ['start', 'dec'],
          ['dec', 'yes'],
          ['dec', 'no'],
          ['yes', 'end'],
          ['no', 'end'],
        ],
      );
      w.db.conns.find(
        (c) => c.fromStepId === seeded.step.dec && c.toStepId === seeded.step.yes,
      )!.conditionExpression = 'Approved';
      w.db.conns.find(
        (c) => c.fromStepId === seeded.step.dec && c.toStepId === seeded.step.no,
      )!.conditionExpression = 'Rejected';
      await w.instances.create({ workflowDefinitionId: seeded.defId }, alice);
      await w.instances.completeStep(w.db.stepInstances[0].wfStepInstanceId, {}, alice);
      const dec = w.db.stepInstances.find((s) => s.wfStepId === seeded.step.dec)!;
      const r = await w.instances.completeStep(
        dec.wfStepInstanceId,
        { outputData: '{"result":"Approved"}' },
        alice,
      );
      expect(r.createdStepInstances).toHaveLength(2);
    });

    it('SP สร้าง step ตัวที่สองของ Parallel ล้ม → rollback ทั้งการจบ step และ step ตัวแรกที่เพิ่งสร้าง', async () => {
      const { w, si } = await parallelFlow();
      const par = si('par');
      const countBefore = w.db.stepInstances.length;
      const noticesBefore = w.notifier.sent.length;
      w.sp.failOn(SP_STEP, new SpExecutionError(SP_STEP, 'deadlock'), 2);
      w.sp.calls.length = 0;
      await rejection(w.instances.completeStep(par.wfStepInstanceId, {}, alice));
      expect(w.db.stepInstances).toHaveLength(countBefore);
      expect(
        w.db.stepInstances.find((s) => s.wfStepInstanceId === par.wfStepInstanceId)?.status,
      ).toBe(SS.Pending);
      expect(w.notifier.sent).toHaveLength(noticesBefore); // ไม่แจ้งเตือนงานที่ rollback
    });
  });

  it('ไม่มีเส้นเชื่อมเลย → เดินตาม SequenceNumber (sequential fallback)', async () => {
    const w = makeWfe();
    const { defId, step } = seedTemplate(
      w.db,
      [
        { key: 's', type: T.Start },
        { key: 'a', type: T.Approval, assignedUser: 'DOM\\bob' },
        { key: 'e', type: T.End },
      ],
      null,
    );
    await w.instances.create({ workflowDefinitionId: defId }, alice);
    const r = await w.instances.completeStep(w.db.stepInstances[0].wfStepInstanceId, {}, alice);
    expect(r.createdStepInstances.map((c) => c.stepName)).toEqual(['a']);
    expect(r.currentStepId).toBe(step.a);
    const r2 = await w.instances.completeStep(
      r.createdStepInstances[0].workflowStepInstanceId,
      {},
      bob,
    );
    expect(r2.instanceStatus).toBe(IS.Completed);
  });

  it('step ถัดไปมี SLA ของตัวเอง → deadline ตาม step', async () => {
    const w = makeWfe();
    const { defId } = seedTemplate(
      w.db,
      [
        { key: 's', type: T.Start },
        { key: 'a', type: T.Approval, assignedUser: 'DOM\\bob', slaHours: 4 },
        { key: 'e', type: T.End },
      ],
      [
        ['s', 'a'],
        ['a', 'e'],
      ],
    );
    await w.instances.create({ workflowDefinitionId: defId }, alice);
    const t0 = Date.now();
    await w.instances.completeStep(w.db.stepInstances[0].wfStepInstanceId, {}, alice);
    const dl = w.sp.calls.at(-1)!.input.SLADeadline as Date;
    expect((dl.getTime() - t0) / H).toBeCloseTo(4, 1);
  });
});

describe('WorkflowInstancesService — ปฏิเสธ / เริ่มงาน', () => {
  it('ปฏิเสธ: step เป็น Rejected, instance จบเป็น Rejected, ปิดสาขาอื่นที่ค้าง, แจ้งผู้เริ่ม, log WorkflowStepRejected', async () => {
    const w = makeWfe();
    const seeded = seedTemplate(
      w.db,
      [
        { key: 'start', type: T.Start },
        { key: 'par', type: T.Parallel },
        { key: 'a', type: T.Approval, assignedUser: 'DOM\\carol' },
        { key: 'b', type: T.Review, assignedUser: 'DOM\\dave' },
        { key: 'end', type: T.End },
      ],
      [
        ['start', 'par'],
        ['par', 'a'],
        ['par', 'b'],
        ['a', 'end'],
        ['b', 'end'],
      ],
    );
    await w.instances.create({ workflowDefinitionId: seeded.defId }, alice);
    await w.instances.completeStep(w.db.stepInstances[0].wfStepInstanceId, {}, alice);
    const par = w.db.stepInstances.find((s) => s.wfStepId === seeded.step.par)!;
    await w.instances.completeStep(par.wfStepInstanceId, {}, alice);
    const a = w.db.stepInstances.find((s) => s.wfStepId === seeded.step.a)!;
    const b = w.db.stepInstances.find((s) => s.wfStepId === seeded.step.b)!;

    const r = await w.instances.rejectStep(
      a.wfStepInstanceId,
      { reason: 'เอกสารไม่ครบ', remarks: 'แนบเพิ่ม' },
      carol,
    );

    expect(r).toMatchObject({
      status: SS.Rejected,
      outputData: 'เอกสารไม่ครบ',
      remarks: 'แนบเพิ่ม',
      completedBy: carol.adUserName,
    });
    expect(w.db.instances[0].status).toBe(IS.Rejected);
    expect(w.db.instances[0].completedDate).toBeInstanceOf(Date);
    const bAfter = w.db.stepInstances.find((s) => s.wfStepInstanceId === b.wfStepInstanceId)!;
    expect(bAfter).toMatchObject({ status: SS.Rejected, outputData: 'ยกเลิก: workflow ถูกปฏิเสธ' });
    expect(w.notifier.all.at(-1)).toMatchObject({
      kind: 'TASK_REJECTED',
      recipient: alice.adUserName,
    });
    expect(w.notifier.all.at(-1)?.messageText).toContain('เอกสารไม่ครบ');

    const [ev] = await events(w, WFE_OP.stepRejected);
    expect(ev).toMatchObject({
      entity: 'WorkflowStepInstance',
      recordId: a.wfStepInstanceId,
      success: true,
    });
    expect(ev.meta).toMatchObject({ reason: 'เอกสารไม่ครบ' });
  });

  it('ปฏิเสธโดยผู้ที่ไม่ใช่ผู้รับผิดชอบ → 403 · ปฏิเสธ step ที่ปิดแล้ว → 409', async () => {
    const { w, stepOf } = await startedLinear();
    const s = stepOf('start')!;
    expect(
      code(await rejection(w.instances.rejectStep(s.wfStepInstanceId, { reason: 'x' }, carol))),
    ).toBe('NOT_ASSIGNEE');
    await w.instances.rejectStep(s.wfStepInstanceId, { reason: 'x' }, alice);
    expect(
      code(await rejection(w.instances.rejectStep(s.wfStepInstanceId, { reason: 'x' }, alice))),
    ).toBe('STEP_ALREADY_CLOSED');
  });

  it('เริ่มงาน (Pending → InProgress) เฉพาะผู้รับผิดชอบ; เริ่มซ้ำ → 409; log WorkflowStepStarted', async () => {
    const { w, stepOf } = await startedLinear();
    const s = stepOf('start')!;
    expect(code(await rejection(w.instances.startStep(s.wfStepInstanceId, carol)))).toBe(
      'NOT_ASSIGNEE',
    );
    const r = await w.instances.startStep(s.wfStepInstanceId, alice);
    expect(r.status).toBe(SS.InProgress);
    expect(code(await rejection(w.instances.startStep(s.wfStepInstanceId, alice)))).toBe(
      'STEP_CANNOT_START',
    );
    // step ที่กำลังทำ ก็จบ/ปฏิเสธได้ตามปกติ
    await expect(w.instances.completeStep(s.wfStepInstanceId, {}, alice)).resolves.toBeDefined();
    const evs = await events(w, WFE_OP.stepStarted);
    expect(evs.map((e) => e.success)).toEqual([false, true, false]);
  });
});

describe('WorkflowInstancesService — ระงับ / ทำต่อ / ยกเลิก / ลบ', () => {
  it('ผู้เริ่มระงับ → ทำต่อ ได้ · สถานะที่ไม่ถูกต้อง → 422 · log ชื่อ Action เดิม', async () => {
    const { w, id } = await startedLinear();
    expect((await w.instances.suspend(id, alice)).status).toBe(IS.Suspended);
    expect(code(await rejection(w.instances.suspend(id, alice)))).toBe(
      'INSTANCE_INVALID_TRANSITION',
    );
    expect((await w.instances.resume(id, alice)).status).toBe(IS.InProgress);
    expect(code(await rejection(w.instances.resume(id, alice)))).toBe(
      'INSTANCE_INVALID_TRANSITION',
    );

    const [sus] = await events(w, WFE_OP.instanceSuspended);
    expect(sus).toMatchObject({
      entity: 'WorkflowInstance',
      recordId: id,
      action: 'EXECUTE',
      success: true,
    });
    expect(sus.before).toMatchObject({ status: IS.InProgress });
    expect((await events(w, WFE_OP.instanceResumed))[0]).toMatchObject({
      recordId: id,
      success: true,
    });
  });

  it('คนอื่นที่ไม่ใช่ผู้เริ่ม (Officer) ระงับไม่ได้ (403); Manager ทำได้', async () => {
    const { w, id } = await startedLinear();
    expect(code(await rejection(w.instances.suspend(id, bob)))).toBe('INSTANCE_FORBIDDEN'); // bob มี step แต่ไม่ใช่ผู้เริ่ม
    expect((await w.instances.suspend(id, boss)).status).toBe(IS.Suspended);
  });

  it('ยกเลิก: ปิด step ที่ค้างอยู่ด้วยข้อความเหตุผล, ตั้ง CompletedDate; ยกเลิกซ้ำ/ที่เสร็จแล้ว → 422', async () => {
    const { w, id, stepOf } = await startedLinear();
    const r = await w.instances.cancel(id, { reason: 'ผิดแบบฟอร์ม' }, alice);
    expect(r.status).toBe(IS.Cancelled);
    expect(w.db.instances[0].completedDate).toBeInstanceOf(Date);
    expect(stepOf('start')).toMatchObject({
      status: SS.Rejected,
      outputData: 'ยกเลิก: ผิดแบบฟอร์ม',
      completedBy: alice.adUserName,
    });
    expect(code(await rejection(w.instances.cancel(id, {}, alice)))).toBe(
      'INSTANCE_INVALID_TRANSITION',
    );

    const w2 = (await startedLinear()).w;
    const startSi = w2.db.stepInstances[0];
    await w2.instances.cancel(1, {}, alice);
    expect(
      w2.db.stepInstances.find((s) => s.wfStepInstanceId === startSi.wfStepInstanceId)?.outputData,
    ).toBe('ยกเลิกโดยผู้ใช้');
  });

  it('ยกเลิก workflow ที่เสร็จแล้ว/ถูกปฏิเสธแล้วไม่ได้', async () => {
    const { w, id, stepOf } = await startedLinear();
    await w.instances.rejectStep(stepOf('start')!.wfStepInstanceId, { reason: 'x' }, alice);
    expect(code(await rejection(w.instances.cancel(id, {}, boss)))).toBe(
      'INSTANCE_INVALID_TRANSITION',
    );
  });

  describe('ลบ (soft delete)', () => {
    it('ลบได้เฉพาะ workflow ที่จบแล้ว ต้องเป็น Manager ขึ้นไป', async () => {
      const { w, id } = await startedLinear();
      expect(code(await rejection(w.instances.remove(id, 'ทดสอบ', boss)))).toBe(
        'INSTANCE_NOT_TERMINAL',
      );
      await w.instances.cancel(id, {}, alice);
      expect(code(await rejection(w.instances.remove(id, 'ทดสอบ', alice)))).toBe(
        'INSTANCE_FORBIDDEN',
      );
      await w.instances.remove(id, 'ล้างข้อมูลทดสอบ', boss);
      expect(w.db.instances[0].isDeleted).toBe(true);
      const evs = await events(w, WFE_OP.instanceDeleted);
      expect(evs.map((e) => e.success)).toEqual([false, false, true]);
      expect(evs[2]).toMatchObject({
        action: 'DELETE',
        entity: 'WorkflowInstance',
        meta: { reason: 'ล้างข้อมูลทดสอบ' },
      });
      expect(code(await rejection(w.instances.get(id, boss)))).toBe('NOT_FOUND');
    });
  });
});

describe('WorkflowInstancesService — การมองเห็นและรายการ', () => {
  it('ดู instance ได้เฉพาะผู้เริ่ม ผู้ที่มี step และ Manager ขึ้นไป', async () => {
    const { w, id } = await startedLinear();
    const stranger = asUser('erin');
    expect(code(await rejection(w.instances.get(id, stranger)))).toBe('INSTANCE_FORBIDDEN');
    await expect(w.instances.get(id, alice)).resolves.toBeDefined();
    await expect(w.instances.get(id, boss)).resolves.toBeDefined();
    // bob ยังไม่มี step → ยังดูไม่ได้ จนกว่าจะถึงคิว
    expect(code(await rejection(w.instances.get(id, bob)))).toBe('INSTANCE_FORBIDDEN');
    await w.instances.completeStep(w.db.stepInstances[0].wfStepInstanceId, {}, alice);
    await expect(w.instances.get(id, bob)).resolves.toBeDefined();
  });

  it('รายการ: Officer เห็นเฉพาะของที่เกี่ยวข้องกับตน, Manager เห็นทั้งหมด', async () => {
    const { w, defId } = await startedLinear();
    await w.instances.create({ workflowDefinitionId: defId }, carol);
    const q = { page: 1, pageSize: 20, sortDir: 'desc' as const };
    expect((await w.instances.list(q as never, alice)).items.map((i) => i.initiatedBy)).toEqual([
      alice.adUserName,
    ]);
    expect((await w.instances.list(q as never, bob)).total).toBe(0);
    expect((await w.instances.list(q as never, boss)).total).toBe(2);
  });

  it('allowedActions ตามสถานะ+สิทธิ์ (Manager เห็น DELETE เมื่อจบแล้ว)', async () => {
    const { w, id } = await startedLinear();
    expect((await w.instances.get(id, alice)).allowedActions).toEqual(['SUSPEND', 'CANCEL']);
    await w.instances.suspend(id, alice);
    expect((await w.instances.get(id, alice)).allowedActions).toEqual(['RESUME', 'CANCEL']);
    await w.instances.cancel(id, {}, alice);
    expect((await w.instances.get(id, alice)).allowedActions).toEqual([]);
    expect((await w.instances.get(id, boss)).allowedActions).toEqual(['DELETE']);
  });

  it('งานของฉัน: ส่ง canDelegate + SLA สด (เลยกำหนดแม้ค่าที่เก็บยังเป็น OnTime) และ onlyOpen ซ่อนงานที่เสร็จ', async () => {
    const { w, id, stepOf } = await startedLinear();
    await w.instances.completeStep(stepOf('start')!.wfStepInstanceId, {}, alice);
    const bobSi = w.db.stepInstances.find((s) => s.assignedTo === 'DOM\\bob')!;
    bobSi.slaDeadline = new Date(Date.now() - 2 * H);
    bobSi.assignedDate = new Date(Date.now() - 30 * H);
    expect(bobSi.slaStatus).toBe(SlaStatus.OnTime); // ค่าที่เก็บล้าสมัย

    const q = { page: 1, pageSize: 20, sortDir: 'asc' as const };
    const mine = await w.instances.myTasks(q as never, bob);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      workflowInstanceId: id,
      workflowName: `Template 1`,
      stepName: 'อนุมัติ',
      canDelegate: true,
      slaStatus: SlaStatus.Overdue,
      instanceStatus: IS.InProgress,
      totalSteps: 3,
    });
    expect(mine.items[0].timeRemainingMinutes).toBeLessThan(0);

    const aliceAll = await w.instances.myTasks(q as never, alice);
    expect(aliceAll.items.map((t) => t.status)).toEqual([SS.Completed]);
    const aliceOpen = await w.instances.myTasks({ ...q, onlyOpen: true } as never, alice);
    expect(aliceOpen.total).toBe(0);
  });

  it('ประวัติ: คืน step ทั้งหมด + audit ของ instance (เฉพาะผู้ที่ดู instance ได้)', async () => {
    const { w, id } = await startedLinear();
    const h = await w.instances.history(id, alice);
    expect(h.steps).toHaveLength(1);
    expect(h.audit).toEqual([{ auditId: '1', recordId: id }]);
    expect(code(await rejection(w.instances.history(id, asUser('erin'))))).toBe(
      'INSTANCE_FORBIDDEN',
    );
  });
});
