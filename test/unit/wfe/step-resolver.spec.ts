import { WorkflowStepType as T } from '../../../src/common/constants/enums';
import {
  decideAssignee,
  evaluateCondition,
  planCompletion,
  resolveNextSteps,
  type ConnectionLite,
  type StepLite,
} from '../../../src/modules/wfe/instance/step-resolver';

const step = (id: number, type: T, over: Partial<StepLite> = {}): StepLite => ({
  stepId: id,
  stepName: `S${id}`,
  stepType: type,
  sequenceNumber: id,
  assignedUser: null,
  assignedRole: null,
  assignedOrgUnit: null,
  slaHours: null,
  slaDays: null,
  allowDelegation: false,
  ...over,
});
const conn = (
  id: number,
  from: number,
  to: number,
  cond: string | null = null,
): ConnectionLite => ({
  connectionId: id,
  fromStepId: from,
  toStepId: to,
  conditionExpression: cond,
});

describe('StepResolver.resolveNextSteps (พอร์ตจากระบบเดิม)', () => {
  const steps = [
    step(1, T.Start),
    step(2, T.Parallel),
    step(3, T.Approval),
    step(4, T.Review),
    step(5, T.End),
  ];
  const byId = new Map(steps.map((s) => [s.stepId, s]));

  it('Parallel: เดินทุกเส้นที่ออกจาก step พร้อมกัน เรียงตามลำดับเส้น', () => {
    const r = resolveNextSteps([conn(1, 2, 3), conn(2, 2, 4)], byId, null);
    expect(r.steps.map((s) => s.stepId)).toEqual([3, 4]);
  });

  it('เงื่อนไขของเส้นเชื่อมไม่ถูกประเมินจริง (evaluator ของระบบเดิมเป็น stub คืน true)', () => {
    expect(evaluateCondition('Amount > 1000', '{"Amount":1}')).toBe(true);
    const r = resolveNextSteps([conn(1, 2, 3, 'Approved'), conn(2, 2, 4, 'Rejected')], byId, '{}');
    expect(r.steps.map((s) => s.stepId)).toEqual([3, 4]); // ทั้งสองสาขาถูกเดิน — พฤติกรรมเดิม
  });

  it('ใส่ evaluator เองได้ (ช่องสำหรับอนาคต) — เส้นที่เงื่อนไขเท็จถูกข้าม', () => {
    const r = resolveNextSteps(
      [conn(1, 2, 3, 'yes'), conn(2, 2, 4, 'no')],
      byId,
      null,
      (expr) => expr === 'yes',
    );
    expect(r.steps.map((s) => s.stepId)).toEqual([3]);
  });

  it('เส้นที่ชี้ไป step ที่ไม่มี ถูกข้ามและรายงานแยก', () => {
    const r = resolveNextSteps([conn(1, 2, 3), conn(2, 2, 99)], byId, null);
    expect(r.steps.map((s) => s.stepId)).toEqual([3]);
    expect(r.missingTargets).toEqual([99]);
  });

  it('ไม่มีเส้นออกเลย → ว่าง', () => {
    expect(resolveNextSteps([], byId, null).steps).toEqual([]);
  });
});

describe('planCompletion — ตัดสินว่าหลังกด "เสร็จ" ไปทางไหน', () => {
  const ordered = [step(1, T.Start), step(2, T.Approval), step(3, T.Review), step(4, T.End)];

  it('เส้นทางปกติ: สร้าง step ถัดไปทุกตัว, CurrentStepId = ตัวแรก', () => {
    const plan = planCompletion({
      currentStep: ordered[0],
      nextSteps: [ordered[1], ordered[2]],
      orderedSteps: ordered,
      otherOpen: [],
    });
    expect(plan).toEqual({
      kind: 'ADVANCE',
      next: [ordered[1], ordered[2]],
      currentStepId: 2,
      reason: 'CONNECTIONS',
    });
  });

  it('step ถัดไปคือ End และไม่มีงานอื่นค้าง → instance เสร็จ CurrentStepId = End', () => {
    const plan = planCompletion({
      currentStep: ordered[2],
      nextSteps: [ordered[3]],
      orderedSteps: ordered,
      otherOpen: [],
    });
    expect(plan).toEqual({ kind: 'COMPLETE_INSTANCE', currentStepId: 4, reason: 'NEXT_IS_END' });
  });

  it('ถึง End แต่ยังมีสาขาอื่นค้าง (Parallel ยังไม่ครบ) → instance ยังเปิด ชี้ไป step ที่ค้าง', () => {
    const plan = planCompletion({
      currentStep: ordered[2],
      nextSteps: [ordered[3]],
      orderedSteps: ordered,
      otherOpen: [{ stepInstanceId: 77, stepId: 2 }],
    });
    expect(plan).toEqual({ kind: 'KEEP_OPEN', currentStepId: 2, reason: 'NEXT_IS_END' });
  });

  it('กด "เสร็จ" ที่ตัว End เอง', () => {
    expect(
      planCompletion({
        currentStep: ordered[3],
        nextSteps: [],
        orderedSteps: ordered,
        otherOpen: [],
      }),
    ).toEqual({ kind: 'COMPLETE_INSTANCE', currentStepId: 4, reason: 'CURRENT_IS_END' });
    expect(
      planCompletion({
        currentStep: ordered[3],
        nextSteps: [],
        orderedSteps: ordered,
        otherOpen: [{ stepInstanceId: 8, stepId: 3 }],
      }),
    ).toEqual({ kind: 'KEEP_OPEN', currentStepId: 3, reason: 'CURRENT_IS_END' });
  });

  it('ไม่มีเส้นออก → เดินตาม SequenceNumber (sequential fallback)', () => {
    const plan = planCompletion({
      currentStep: ordered[0],
      nextSteps: [],
      orderedSteps: ordered,
      otherOpen: [],
    });
    expect(plan).toEqual({
      kind: 'ADVANCE',
      next: [ordered[1]],
      currentStepId: 2,
      reason: 'SEQUENTIAL_FALLBACK',
    });
  });

  it('sequential fallback ถึง End → เสร็จ · ถึงท้ายสุดโดยไม่มี End → เสร็จที่ step ปัจจุบัน', () => {
    expect(
      planCompletion({
        currentStep: ordered[2],
        nextSteps: [],
        orderedSteps: ordered,
        otherOpen: [],
      }),
    ).toEqual({ kind: 'COMPLETE_INSTANCE', currentStepId: 4, reason: 'SEQUENTIAL_END' });
    const noEnd = [step(1, T.Start), step(2, T.Approval)];
    expect(
      planCompletion({ currentStep: noEnd[1], nextSteps: [], orderedSteps: noEnd, otherOpen: [] }),
    ).toEqual({ kind: 'COMPLETE_INSTANCE', currentStepId: 2, reason: 'SEQUENTIAL_END' });
  });

  it('พฤติกรรมเดิมที่คงไว้: ถ้า nextSteps มีทั้ง End และ step อื่น จะเลือกปิดงาน (step อื่นไม่ถูกสร้าง)', () => {
    const plan = planCompletion({
      currentStep: ordered[1],
      nextSteps: [ordered[2], ordered[3]],
      orderedSteps: ordered,
      otherOpen: [],
    });
    expect(plan.kind).toBe('COMPLETE_INSTANCE');
  });
});

describe('decideAssignee', () => {
  it('AssignedUser มาก่อน (ตัดช่องว่าง)', () => {
    expect(decideAssignee(step(1, T.Approval, { assignedUser: ' DOM\\boss ' }), 'DOM\\me')).toEqual(
      {
        kind: 'EXPLICIT',
        userName: 'DOM\\boss',
      },
    );
  });

  it('ไม่ระบุอะไรเลย → ผู้ที่ทำรายการ (พฤติกรรมเดิม)', () => {
    expect(decideAssignee(step(1, T.Approval), 'DOM\\me')).toEqual({
      kind: 'ACTING_USER',
      userName: 'DOM\\me',
    });
  });

  it('ระบุเฉพาะบทบาท/หน่วยงาน → ปฏิเสธ (ระบบเดิมมอบให้ผู้ทำรายการเงียบๆ ซึ่งเสี่ยงอนุมัติเอง)', () => {
    expect(decideAssignee(step(1, T.Approval, { assignedRole: 'Legal' }), 'x')).toEqual({
      kind: 'UNSUPPORTED',
      reason: 'ROLE',
    });
    expect(decideAssignee(step(1, T.Approval, { assignedOrgUnit: 'DIV-1' }), 'x')).toEqual({
      kind: 'UNSUPPORTED',
      reason: 'ORG_UNIT',
    });
    // มี AssignedUser ด้วย → ใช้ผู้ใช้
    expect(
      decideAssignee(step(1, T.Approval, { assignedUser: 'u', assignedRole: 'Legal' }), 'x').kind,
    ).toBe('EXPLICIT');
  });
});
