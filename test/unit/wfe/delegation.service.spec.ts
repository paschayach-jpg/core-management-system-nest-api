import {
  WorkflowInstanceStatus as IS,
  WorkflowStepInstanceStatus as SS,
  WorkflowStepType as T,
} from '../../../src/common/constants/enums';
import { Sp } from '../../../src/database/sp/sp-catalog.generated';
import { SpExecutionError } from '../../../src/database/sp/sp-execution.error';
import { MAX_DELEGATION_DEPTH, WFE_OP } from '../../../src/modules/wfe/common/wfe.constants';
import {
  alice,
  asUser,
  boss,
  bob,
  carol,
  makeWfe,
  seedLinear,
  seedTemplate,
  type Wfe,
} from './fakes';

const SP_DELEGATE = Sp.dbo.wfCreateDelegation.name;
const dave = asUser('dave');
const erin = asUser('erin');
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { response?: { code?: string }; message: string };
  }
  throw new Error('คาดว่าจะโยน error แต่สำเร็จ');
}
const events = async (w: Wfe, operation: string) =>
  (await w.events()).filter((e) => e.operation === operation);

/** instance ที่ alice เริ่มและจบ step แรกแล้ว → งานอนุมัติของ bob พร้อมมอบหมาย */
async function atApproval(allowDelegation = true) {
  const w = makeWfe();
  const seeded = allowDelegation
    ? seedLinear(w.db)
    : seedTemplate(
        w.db,
        [
          { key: 'start', type: T.Start },
          { key: 'approve', type: T.Approval, assignedUser: 'DOM\\bob', allowDelegation: false },
          { key: 'end', type: T.End },
        ],
        [
          ['start', 'approve'],
          ['approve', 'end'],
        ],
      );
  const created = await w.instances.create({ workflowDefinitionId: seeded.defId }, alice);
  await w.instances.completeStep(w.db.stepInstances[0].wfStepInstanceId, {}, alice);
  const si = w.db.stepInstances.find((s) => s.wfStepId === seeded.step.approve)!;
  w.sp.calls.length = 0;
  w.trace.length = 0;
  w.notifier.sent.length = 0;
  const row = () => w.db.stepInstances.find((s) => s.wfStepInstanceId === si.wfStepInstanceId)!;
  const delegate = (from: typeof bob, to: string, extra: object = {}) =>
    w.delegations.delegate(
      { workflowStepInstanceId: si.wfStepInstanceId, delegateToUserName: to, ...extra },
      from,
    );
  return {
    w,
    ...seeded,
    instanceId: created.workflowInstanceId,
    sid: si.wfStepInstanceId,
    row,
    delegate,
  };
}

describe('WorkflowDelegationsService.delegate', () => {
  it('มอบหมาย: เรียก sp_WF_CreateDelegation (max=3) + เปลี่ยนผู้รับผิดชอบ/สถานะ Delegated ใน transaction เดียว + log TaskDelegated', async () => {
    const { w, sid, row, delegate } = await atApproval();

    const d = await delegate(bob, 'dom\\CAROL', { delegationReason: 'ลาพักร้อน', remarks: 'ด่วน' });

    expect(d).toMatchObject({
      workflowStepInstanceId: sid,
      delegatedFrom: bob.adUserName,
      delegatedTo: 'DOM\\carol', // ชื่อตามที่ระบบเก็บ
      delegationDepth: 1,
      isActive: true,
      delegationReason: 'ลาพักร้อน',
    });
    const call = w.sp.calls.find((c) => c.sp === SP_DELEGATE)!;
    expect(call.input).toMatchObject({
      WorkflowStepInstanceId: sid,
      DelegatedFrom: bob.adUserName,
      DelegatedTo: 'DOM\\carol',
      MaxDelegationDepth: MAX_DELEGATION_DEPTH,
    });
    expect((call.options as { fakeTx?: boolean }).fakeTx).toBe(true);
    expect(row()).toMatchObject({ assignedTo: 'DOM\\carol', status: SS.Delegated });
    expect(w.trace).toEqual([
      'tx:begin',
      `sp:${Sp.dbo.wfGetDelegationHistory.name}`,
      `sp:${SP_DELEGATE}`,
      'store.updateStepInstance',
      'tx:commit',
      'notify',
    ]);

    const [ev] = await events(w, WFE_OP.taskDelegated);
    expect(ev).toMatchObject({
      module: 'WFE',
      entity: 'WorkflowStepInstance', // ให้หน้าประวัติของ workflow ค้นเจอ
      action: 'CREATE',
      recordId: sid,
      success: true,
    });
    expect(ev.before).toMatchObject({ assignedTo: bob.adUserName, status: SS.Pending });
    expect(w.notifier.all[0]).toMatchObject({ kind: 'TASK_DELEGATED', recipient: 'DOM\\carol' });
  });

  it('ผู้รับมอบทำงานต่อได้ (จบ step) และงานเดินต่อ', async () => {
    const { w, instanceId, delegate, sid } = await atApproval();
    await delegate(bob, 'DOM\\carol');
    expect(code(await rejection(w.instances.completeStep(sid, {}, bob)))).toBe('NOT_ASSIGNEE'); // ผู้มอบหมดสิทธิ์
    const r = await w.instances.completeStep(sid, {}, carol);
    expect(r.instanceStatus).toBe(IS.Completed);
    expect(w.db.instances.find((i) => i.wfInstanceId === instanceId)?.status).toBe(IS.Completed);
  });

  describe('กฎ', () => {
    it('ผู้ที่ไม่ใช่ผู้รับผิดชอบมอบไม่ได้ (403) และไม่เรียก SP', async () => {
      const { w, delegate } = await atApproval();
      expect(code(await rejection(delegate(alice, 'DOM\\carol')))).toBe('NOT_ASSIGNEE');
      expect(w.sp.calls.some((c) => c.sp === SP_DELEGATE)).toBe(false);
    });

    it('ห้ามมอบให้ตัวเอง', async () => {
      const { delegate } = await atApproval();
      expect(code(await rejection(delegate(bob, 'dom\\BOB')))).toBe('SELF_DELEGATION');
    });

    it('step ต้องอนุญาตให้มอบหมาย (AllowDelegation)', async () => {
      const { delegate } = await atApproval(false);
      expect(code(await rejection(delegate(bob, 'DOM\\carol')))).toBe('DELEGATION_NOT_ALLOWED');
    });

    it('ผู้รับต้องเป็นผู้ใช้ที่ใช้งานอยู่ (ไม่มีในระบบ/ถูกปิด) และไม่เรียก SP สร้าง', async () => {
      const { w, delegate } = await atApproval();
      expect(code(await rejection(delegate(bob, 'DOM\\nobody')))).toBe('DELEGATE_USER_NOT_FOUND');
      expect(code(await rejection(delegate(bob, 'DOM\\gone')))).toBe('DELEGATE_USER_NOT_FOUND');
      expect(w.sp.calls.some((c) => c.sp === SP_DELEGATE)).toBe(false);
    });

    it('instance ที่ถูกระงับ มอบหมายไม่ได้', async () => {
      const { w, instanceId, delegate } = await atApproval();
      await w.instances.suspend(instanceId, alice);
      expect(code(await rejection(delegate(bob, 'DOM\\carol')))).toBe('INSTANCE_NOT_ACTIVE');
    });

    it('งานที่เสร็จแล้วมอบหมายไม่ได้', async () => {
      const { w, sid, delegate } = await atApproval();
      await w.instances.completeStep(sid, {}, bob);
      expect(code(await rejection(delegate(bob, 'DOM\\carol')))).toBe('INSTANCE_NOT_ACTIVE'); // instance จบแล้ว
    });

    it('วันสิ้นสุดต้องมากกว่าวันเริ่ม', async () => {
      const { delegate } = await atApproval();
      const start = new Date('2026-06-01');
      expect(
        code(await rejection(delegate(bob, 'DOM\\carol', { startDate: start, endDate: start }))),
      ).toBe('DATE_RANGE_INVALID');
    });

    it('ล้มเหลวทุกกรณีถูกบันทึกเป็น success=false', async () => {
      const { delegate, w } = await atApproval();
      await rejection(delegate(alice, 'DOM\\carol'));
      await rejection(delegate(bob, 'DOM\\bob'));
      const evs = await events(w, WFE_OP.taskDelegated);
      expect(evs.map((e) => e.success)).toEqual([false, false]);
    });
  });

  describe(`ความลึกสูงสุด ${MAX_DELEGATION_DEPTH} ระดับ และการวน`, () => {
    it('bob→carol→dave→erin ผ่านครบ 3 ระดับ แล้วระดับที่ 4 ถูกปฏิเสธ', async () => {
      const { w, sid, row, delegate } = await atApproval();
      await delegate(bob, 'DOM\\carol');
      await delegate(carol, 'DOM\\dave');
      const third = await delegate(dave, 'DOM\\erin');
      expect(third.delegationDepth).toBe(3);
      expect(w.db.delegations.map((d) => [d.delegationDepth, d.isActive])).toEqual([
        [1, false],
        [2, false],
        [3, true],
      ]); // SP ปิดอันเดิมก่อนสร้างใหม่ — active เหลือรายการล่าสุด
      expect(row().assignedTo).toBe('DOM\\erin');

      const e = await rejection(delegate(erin, 'DOM\\alice'));
      expect(code(e)).toBe('MAX_DEPTH_EXCEEDED');
      expect(w.db.delegations).toHaveLength(3);
      expect(sid).toBeGreaterThan(0);
    });

    it('ห้ามวนกลับหาคนที่เคยอยู่ในสาย (ผู้มอบเดิม/ผู้รับก่อนหน้า)', async () => {
      const { delegate } = await atApproval();
      await delegate(bob, 'DOM\\carol');
      expect(code(await rejection(delegate(carol, 'DOM\\bob')))).toBe('DELEGATION_CYCLE');
      await delegate(carol, 'DOM\\dave');
      expect(code(await rejection(delegate(dave, 'DOM\\carol')))).toBe('DELEGATION_CYCLE');
      expect(code(await rejection(delegate(dave, 'dom\\BOB')))).toBe('DELEGATION_CYCLE');
    });

    it('อัปเดต step ล้มหลังเรียก SP → rollback ทั้ง transaction (delegation เดิมกลับมา active, ไม่มีรายการใหม่, ไม่แจ้งเตือน)', async () => {
      const { w, row, delegate } = await atApproval();
      await delegate(bob, 'DOM\\carol');
      // ให้การอัปเดต step หลังเรียก SP ล้ม → ทั้ง transaction (รวมที่ SP ปิด delegation เดิม + เพิ่มใหม่) ต้องถอยกลับ
      const store = (w.delegations as unknown as { instances: { updateStepInstance: unknown } })
        .instances;
      const original = store.updateStepInstance;
      store.updateStepInstance = async () => {
        throw new Error('update failed');
      };
      await rejection(delegate(carol, 'DOM\\dave'));
      store.updateStepInstance = original;
      expect(w.db.delegations).toHaveLength(1);
      expect(w.db.delegations[0].isActive).toBe(true);
      expect(row()).toMatchObject({ assignedTo: 'DOM\\carol', status: SS.Delegated });
      expect(w.trace.at(-1)).not.toBe('notify');
    });

    it('SP โยน RAISERROR "Maximum delegation depth exceeded" (race ที่ผ่านการตรวจใน service) → ไม่มีอะไรเปลี่ยน', async () => {
      const { w, row, delegate } = await atApproval();
      w.sp.failOn(
        SP_DELEGATE,
        new SpExecutionError(SP_DELEGATE, 'Maximum delegation depth exceeded'),
      );
      const e = await rejection(delegate(bob, 'DOM\\carol'));
      expect(e.message).toContain('Maximum delegation depth exceeded');
      expect(w.db.delegations).toHaveLength(0);
      expect(row()).toMatchObject({ assignedTo: bob.adUserName, status: SS.Pending });
      expect(w.trace).toContain('tx:rollback');
    });
  });
});

describe('WorkflowDelegationsService — คืนงาน / ยกเลิก', () => {
  it('ผู้รับคืนงาน: งานกลับไปหาผู้มอบ (Pending), delegation ถูกปิด, แจ้งผู้มอบ, log DelegationReturned', async () => {
    const { w, sid, row, delegate } = await atApproval();
    const d = await delegate(bob, 'DOM\\carol');
    w.notifier.sent.length = 0;

    const r = await w.delegations.returnTask(d.wfDelegationId, carol);

    expect(r.isActive).toBe(false);
    expect(row()).toMatchObject({ assignedTo: bob.adUserName, status: SS.Pending });
    expect(w.notifier.all[0]).toMatchObject({
      kind: 'DELEGATION_ENDED',
      recipient: bob.adUserName,
    });
    const [ev] = await events(w, WFE_OP.delegationReturned);
    expect(ev).toMatchObject({
      entity: 'WorkflowStepInstance',
      recordId: sid,
      success: true,
      action: 'EXECUTE',
    });
  });

  it('คืนงานแล้วความลึกไม่รีเซ็ต: มอบต่อได้ครั้งที่ 2', async () => {
    const { w, delegate } = await atApproval();
    const d1 = await delegate(bob, 'DOM\\carol');
    await w.delegations.returnTask(d1.wfDelegationId, carol);
    const d2 = await delegate(bob, 'DOM\\dave');
    expect(d2.delegationDepth).toBe(2);
    // ผู้ที่เคยรับแล้วคืน (carol) ถือว่าอยู่ในสาย → มอบกลับให้ไม่ได้
    await w.delegations.returnTask(d2.wfDelegationId, dave);
    expect(code(await rejection(delegate(bob, 'DOM\\carol')))).toBe('DELEGATION_CYCLE');
  });

  it('ผู้มอบยกเลิกการมอบหมาย: งานกลับมาอยู่กับผู้มอบ, log DelegationDeactivated', async () => {
    const { w, row, delegate } = await atApproval();
    const d = await delegate(bob, 'DOM\\carol');
    const r = await w.delegations.deactivate(d.wfDelegationId, bob);
    expect(r.isActive).toBe(false);
    expect(row()).toMatchObject({ assignedTo: bob.adUserName, status: SS.Pending });
    expect((await events(w, WFE_OP.delegationDeactivated))[0]).toMatchObject({ success: true });
  });

  it('Manager ยกเลิกแทนได้; คนนอกไม่ได้ (403); ผู้มอบใช้ endpoint "คืนงาน" ไม่ได้ และผู้รับใช้ "ยกเลิก" ไม่ได้', async () => {
    const { w, delegate } = await atApproval();
    const d = await delegate(bob, 'DOM\\carol');
    expect(code(await rejection(w.delegations.deactivate(d.wfDelegationId, erin)))).toBe(
      'DELEGATION_FORBIDDEN',
    );
    expect(code(await rejection(w.delegations.returnTask(d.wfDelegationId, bob)))).toBe(
      'DELEGATION_FORBIDDEN',
    );
    expect(code(await rejection(w.delegations.deactivate(d.wfDelegationId, carol)))).toBe(
      'DELEGATION_FORBIDDEN',
    );
    await expect(w.delegations.deactivate(d.wfDelegationId, boss)).resolves.toMatchObject({
      isActive: false,
    });
  });

  it('ปิดซ้ำ → 409 · ไม่พบ → 404', async () => {
    const { w, delegate } = await atApproval();
    const d = await delegate(bob, 'DOM\\carol');
    await w.delegations.returnTask(d.wfDelegationId, carol);
    expect(code(await rejection(w.delegations.returnTask(d.wfDelegationId, carol)))).toBe(
      'DELEGATION_NOT_ACTIVE',
    );
    expect(code(await rejection(w.delegations.deactivate(999, boss)))).toBe('NOT_FOUND');
  });

  it('งานที่ผู้รับจบไปแล้ว: การปิด delegation ไม่แตะ step (ไม่ดึงงานที่เสร็จกลับ)', async () => {
    const { w, sid, delegate } = await atApproval();
    const d = await delegate(bob, 'DOM\\carol');
    await w.instances.completeStep(sid, {}, carol);
    await w.delegations.deactivate(d.wfDelegationId, bob);
    expect(w.db.stepInstances.find((s) => s.wfStepInstanceId === sid)).toMatchObject({
      status: SS.Completed,
      assignedTo: 'DOM\\carol',
    });
  });
});

describe('WorkflowDelegationsService — อ่าน', () => {
  it('ประวัติของงาน: เฉพาะผู้เกี่ยวข้อง/ผู้รับผิดชอบ/Manager; คนนอก 403; เรียงตามระดับ', async () => {
    const { w, sid, delegate } = await atApproval();
    await delegate(bob, 'DOM\\carol');
    await delegate(carol, 'DOM\\dave');
    const h = await w.delegations.history(sid, dave);
    expect(h.map((x) => x.delegationDepth)).toEqual([1, 2]);
    await expect(w.delegations.history(sid, bob)).resolves.toHaveLength(2);
    await expect(w.delegations.history(sid, boss)).resolves.toHaveLength(2);
    expect(code(await rejection(w.delegations.history(sid, erin)))).toBe('DELEGATION_FORBIDDEN');
    expect(code(await rejection(w.delegations.history(999, boss)))).toBe('NOT_FOUND');
  });

  it('get: ผู้มอบ/ผู้รับ/Manager ดูได้, คนอื่นไม่ได้ · mine แยกทิศทาง', async () => {
    const { w, delegate } = await atApproval();
    const d = await delegate(bob, 'DOM\\carol');
    await expect(w.delegations.get(d.wfDelegationId, carol)).resolves.toBeDefined();
    expect(code(await rejection(w.delegations.get(d.wfDelegationId, erin)))).toBe(
      'DELEGATION_FORBIDDEN',
    );
    const q = { page: 1, pageSize: 10, sortDir: 'asc' as const };
    expect((await w.delegations.mine({ ...q, direction: 'from' } as never, bob)).total).toBe(1);
    expect((await w.delegations.mine({ ...q, direction: 'to' } as never, bob)).total).toBe(0);
    expect((await w.delegations.mine({ ...q, direction: 'to' } as never, carol)).total).toBe(1);
    expect((await w.delegations.mine(q as never, erin)).total).toBe(0);
  });
});
