import { WorkflowStepType } from '../../../common/constants/enums';
import { sameUser } from '../common/wfe-access';

/**
 * Pure functions ของ "ตัวเลือก step ถัดไป" (พอร์ตจาก StepResolverService + ส่วนตัดสินใจใน WorkflowService.CompleteWorkflowStep)
 *
 * พฤติกรรมของระบบเดิมที่ต้องรักษา (อ่านจากโค้ดจริง ไม่ใช่จากเอกสารออกแบบ):
 *  - เส้นเชื่อมออกจาก step ปัจจุบันทุกเส้นที่ "เงื่อนไขเป็นจริง" ถูกเดินพร้อมกันหมด (Parallel/Decision/Merge ไม่มีตรรกะพิเศษ)
 *  - `ConditionEvaluatorService.EvaluateCondition` เป็น stub คืน true เสมอ → เงื่อนไขทุกเส้นถือว่าเป็นจริง
 *  - Merge ไม่รอสาขาอื่น · End ที่ไปถึงจะปิด instance ต่อเมื่อไม่มี step อื่นค้างอยู่
 *  - ถ้า step ไม่มีเส้นออกเลย → เดินตาม SequenceNumber ถัดไป (sequential fallback)
 */

export interface StepLite {
  stepId: number;
  stepName: string;
  stepType: WorkflowStepType;
  sequenceNumber: number;
  assignedUser: string | null;
  assignedRole: string | null;
  assignedOrgUnit: string | null;
  slaHours: number | null;
  slaDays: number | null;
  allowDelegation: boolean;
}

export interface ConnectionLite {
  connectionId: number;
  fromStepId: number;
  toStepId: number;
  conditionExpression: string | null;
}

/** ระบบเดิมยังไม่ได้เขียนตัวประเมินเงื่อนไข (TODO) — ค่านี้บอกให้ผู้ตรวจ/เอกสารเห็นชัดว่าไม่ได้ประเมินจริง */
export const CONDITION_EVALUATION_IMPLEMENTED = false;

/**
 * ประเมินเงื่อนไขของเส้นเชื่อม — พอร์ตตรงตัวจาก ConditionEvaluatorService.EvaluateCondition (คืน true เสมอ)
 * ห้ามเดาไวยากรณ์เงื่อนไขเอง: ข้อความเงื่อนไขใน DB เป็นข้อความอิสระที่ผู้ใช้พิมพ์ใน designer
 */
export function evaluateCondition(
  _expression: string | null | undefined,
  _outputData: string | null | undefined,
): boolean {
  return true;
}

export type ConditionEvaluator = typeof evaluateCondition;

export interface ResolvedNextSteps {
  steps: StepLite[];
  /** เส้นเชื่อมที่ชี้ไปยัง step ที่ไม่มี/ถูกลบ (ระบบเดิม log error แล้วข้าม) */
  missingTargets: number[];
}

/** พอร์ตจาก StepResolverService.ResolveNextSteps — `outgoing` ต้องเรียงตาม SequenceNumber แล้ว */
export function resolveNextSteps(
  outgoing: readonly ConnectionLite[],
  stepsById: ReadonlyMap<number, StepLite>,
  outputData: string | null | undefined,
  evaluate: ConditionEvaluator = evaluateCondition,
): ResolvedNextSteps {
  const steps: StepLite[] = [];
  const missingTargets: number[] = [];
  for (const conn of outgoing) {
    if (conn.conditionExpression && !evaluate(conn.conditionExpression, outputData)) continue;
    const target = stepsById.get(conn.toStepId);
    if (target) steps.push(target);
    else missingTargets.push(conn.toStepId);
  }
  return { steps, missingTargets };
}

export interface OpenStep {
  stepInstanceId: number;
  stepId: number;
}

export type CompletionReason = 'CURRENT_IS_END' | 'NEXT_IS_END' | 'SEQUENTIAL_END';

export type CompletionPlan =
  /** ไม่มี step อื่นค้าง → instance เสร็จ (Status=Completed, CompletedDate=now, CurrentStepId=currentStepId) */
  | { kind: 'COMPLETE_INSTANCE'; currentStepId: number; reason: CompletionReason }
  /** ถึง End แล้วแต่ยังมี step อื่นค้าง → instance ยัง InProgress ชี้ CurrentStepId ไป step ที่ค้าง */
  | { kind: 'KEEP_OPEN'; currentStepId: number; reason: CompletionReason }
  /** สร้าง step instance ของ `next` ทั้งหมด แล้วตั้ง CurrentStepId = currentStepId */
  | {
      kind: 'ADVANCE';
      next: StepLite[];
      currentStepId: number;
      reason: 'CONNECTIONS' | 'SEQUENTIAL_FALLBACK';
    };

export interface CompletionInput {
  currentStep: StepLite;
  /** ผลจาก resolveNextSteps */
  nextSteps: readonly StepLite[];
  /** ทุก step ของ template เรียงตาม SequenceNumber (ใช้ตอน sequential fallback) */
  orderedSteps: readonly StepLite[];
  /** step instance อื่นที่ยังเปิดอยู่ (ไม่รวมตัวที่กำลังเสร็จ) เรียงเหมือน GetStepInstancesByWorkflow */
  otherOpen: readonly OpenStep[];
}

/**
 * ตัดสินว่าหลังกด "เสร็จ" แล้ว instance ควรไปทางไหน — พอร์ตลำดับ if/else ของ CompleteWorkflowStep เดิมทีละกิ่ง:
 *  1) step ปัจจุบันเป็น End
 *  2) step ถัดไปมี End (ข้อควรระวัง: ระบบเดิมทิ้ง step ถัดไปอื่นๆ ที่ไม่ใช่ End — คงไว้เหมือนเดิม ดู OPEN_QUESTIONS ใน docs)
 *  3) ไม่มีเส้นเชื่อมออก → เดินตาม SequenceNumber
 *  4) เส้นทางปกติ: สร้างทุก step ถัดไป
 */
export function planCompletion(input: CompletionInput): CompletionPlan {
  const { currentStep, nextSteps, orderedSteps, otherOpen } = input;
  const active = otherOpen[0];

  if (currentStep.stepType === WorkflowStepType.End) {
    return active
      ? { kind: 'KEEP_OPEN', currentStepId: active.stepId, reason: 'CURRENT_IS_END' }
      : { kind: 'COMPLETE_INSTANCE', currentStepId: currentStep.stepId, reason: 'CURRENT_IS_END' };
  }

  const endStep = nextSteps.find((s) => s.stepType === WorkflowStepType.End);
  if (endStep) {
    return active
      ? { kind: 'KEEP_OPEN', currentStepId: active.stepId, reason: 'NEXT_IS_END' }
      : { kind: 'COMPLETE_INSTANCE', currentStepId: endStep.stepId, reason: 'NEXT_IS_END' };
  }

  if (nextSteps.length === 0) {
    const idx = orderedSteps.findIndex((s) => s.stepId === currentStep.stepId);
    const nextBySeq = idx >= 0 ? orderedSteps[idx + 1] : undefined;
    if (!nextBySeq || nextBySeq.stepType === WorkflowStepType.End) {
      return active
        ? { kind: 'KEEP_OPEN', currentStepId: active.stepId, reason: 'SEQUENTIAL_END' }
        : {
            kind: 'COMPLETE_INSTANCE',
            currentStepId: nextBySeq?.stepId ?? currentStep.stepId,
            reason: 'SEQUENTIAL_END',
          };
    }
    return {
      kind: 'ADVANCE',
      next: [nextBySeq],
      currentStepId: nextBySeq.stepId,
      reason: 'SEQUENTIAL_FALLBACK',
    };
  }

  return {
    kind: 'ADVANCE',
    next: [...nextSteps],
    currentStepId: nextSteps[0].stepId,
    reason: 'CONNECTIONS',
  };
}

export type AssigneeDecision =
  /** มอบหมายให้ผู้ใช้ที่ระบุ (AssignedUser ของ step) — ผู้เรียกต้องตรวจว่ามีอยู่จริงและใช้งานอยู่ */
  | { kind: 'EXPLICIT'; userName: string }
  /** step ไม่ระบุผู้รับผิดชอบ → ผู้ที่ทำรายการอยู่ (พฤติกรรมเดิม: `AssignedUser ?? userContext.ADUserName`) */
  | { kind: 'ACTING_USER'; userName: string }
  /** step ระบุเฉพาะ AssignedRole/AssignedOrgUnit — ระบบเดิมไม่ได้ใช้ค่านี้ (มอบให้ผู้ทำรายการเงียบๆ) API ปฏิเสธแทน */
  | { kind: 'UNSUPPORTED'; reason: 'ROLE' | 'ORG_UNIT' };

/** ตัดสินผู้รับผิดชอบ step instance ใหม่ */
export function decideAssignee(
  step: Pick<StepLite, 'assignedUser' | 'assignedRole' | 'assignedOrgUnit'>,
  actingUserName: string,
): AssigneeDecision {
  const user = step.assignedUser?.trim();
  if (user) return { kind: 'EXPLICIT', userName: user };
  if (step.assignedRole?.trim()) return { kind: 'UNSUPPORTED', reason: 'ROLE' };
  if (step.assignedOrgUnit?.trim()) return { kind: 'UNSUPPORTED', reason: 'ORG_UNIT' };
  return { kind: 'ACTING_USER', userName: actingUserName };
}

/** ผู้ทำรายการเป็นผู้รับผิดชอบ step นี้หรือไม่ */
export function isAssignee(assignedTo: string | null | undefined, userName: string): boolean {
  return sameUser(assignedTo, userName);
}
