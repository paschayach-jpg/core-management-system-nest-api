import { AppRole } from '../../../../common/constants/enums';
import { STEP_DELEGATED_OR_AUTOCLOSED, STEP_PENDING } from './approval.constants';

/**
 * กฎ "เปลี่ยนสถานะ / ลำดับ step" ของงานอนุมัติ — ฟังก์ชันล้วน (ไม่แตะ DB) พอร์ตจาก ApprovalService.ApproveStep,
 * ApprovalInboxForm.ProcessBatch และ ApprovalService.EscalateRequest
 *
 * สถานะ step: 1=Pending, 2=Approved, 3=Rejected, 4=Delegated (ซ้อนความหมาย "ยกระดับ/ปิดอัตโนมัติ" — ห้ามเปลี่ยน)
 */

export interface StepLite {
  stepId: number;
  stepOrder: number;
  approverId: number;
  stepStatus: number;
  delegatedTo?: number | null;
  /** เวลาที่ step นี้ถูกยกระดับ (escalate) — step ที่ถูกสร้างขึ้นเพื่อรับช่วงต่อจะมี StepOrder มากกว่า step ที่มีค่านี้ */
  escalatedDate?: Date | null;
}

export interface ActorLite {
  userId: number;
  appRole: number;
}

/** step ที่ยังลงมติได้: Pending(1) หรือ Delegated(4) (ApproveStep เดิมยอมรับทั้งสอง) */
export const isStepActionable = (s: Pick<StepLite, 'stepStatus'>): boolean =>
  s.stepStatus === STEP_PENDING || s.stepStatus === STEP_DELEGATED_OR_AUTOCLOSED;

const byOrder = (a: StepLite, b: StepLite): number => a.stepOrder - b.stepOrder;

export interface ApprovalDecision {
  /** step ถัดไปที่รอลงมติ (null = ไม่มี → คำขอจบ) */
  nextStep: StepLite | null;
  /** step อื่นที่ต้องปิดอัตโนมัติ (CREATE_HC: อนุมัติคนแรกจบ → ปิดที่เหลือเป็น 4) */
  autoCloseStepIds: number[];
  /** true = ไม่มี step ถัดไป → ตั้งคำขอเป็น Approved แล้วทำผลข้างเคียงตามชนิด */
  finalize: boolean;
}

/**
 * ตัดสินว่าหลังอนุมัติ step หนึ่งแล้วคำขอไปต่ออย่างไร
 *  - ปกติ: step ถัดไป = step ที่ StepOrder มากกว่า และยัง Pending(1) (step ที่เป็น 4 ไม่ขวาง) — ไม่มี → คำขอจบ
 *  - CREATE_HC: อนุมัติคนแรกจบ: ปิด step Pending ที่เหลือเป็น 4 แล้วจบทันที
 *  - step ที่เกิดจากการยกระดับ (StepOrder มากกว่า step ที่มี escalatedDate): ผู้อนุมัติคนแรกของกลุ่มนี้จบทันที เช่นกัน
 *    (เจตนาเดิมของ ProcessEscalations คือ "แจ้งทุกคนใน role ปลายทาง ใครอนุมัติก็ได้" แต่โค้ดเดิมใส่เลข role แทน UserID จนใช้ไม่ได้)
 * `steps` คือ step ทั้งหมดของคำขอ (ตัวที่เพิ่งอนุมัติจะถูกข้ามด้วย approvedStepId)
 */
export function decideAfterApprove(args: {
  requestType: string;
  steps: StepLite[];
  approvedStepId: number;
}): ApprovalDecision {
  const approved = args.steps.find((s) => s.stepId === args.approvedStepId);
  if (!approved) throw new Error(`ไม่พบ step ${args.approvedStepId} ในคำขอ`);
  const others = args.steps.filter((s) => s.stepId !== approved.stepId);

  if (
    args.requestType.trim().toUpperCase() === 'CREATE_HC' ||
    isEscalatedStep(args.steps, approved)
  ) {
    return {
      nextStep: null,
      autoCloseStepIds: others.filter((s) => s.stepStatus === STEP_PENDING).map((s) => s.stepId),
      finalize: true,
    };
  }

  const next =
    [...others]
      .sort(byOrder)
      .find((s) => s.stepOrder > approved.stepOrder && s.stepStatus === STEP_PENDING) ?? null;
  return { nextStep: next, autoCloseStepIds: [], finalize: next === null };
}

/** step นี้เกิดจากการยกระดับหรือไม่ = มี step ที่ถูกยกระดับแล้วซึ่งมี StepOrder น้อยกว่า */
export function isEscalatedStep(steps: StepLite[], step: StepLite): boolean {
  return steps.some((s) => s.escalatedDate != null && s.stepOrder < step.stepOrder);
}

/** DELETE_FOLDER เท่านั้นที่ระบบเดิมยอมให้ Manager/Admin ที่ไม่ได้ถูก assign อนุมัติแทน (IsManagerAdminFallbackRequestType) */
const MANAGER_FALLBACK_TYPES = new Set(['DELETE_FOLDER']);

/**
 * ผู้ใช้ลงมติ step นี้ได้หรือไม่ (บังคับที่ API — ระบบเดิมเช็กแค่ AppRole>=3 ใน service แต่ให้ UI เลือก step ให้)
 *  1) เจ้าของ step (ApproverID) หรือผู้รับมอบ (DelegatedTo)
 *  2) Admin กับคำขอ CREATE_HC (Admin อนุมัติได้ทุก step ที่ค้าง)
 *  3) Manager/Admin กับ DELETE_FOLDER เฉพาะการ "อนุมัติ" (fallback เดิมของ ApprovalInboxForm)
 */
export function canActOnStep(
  actor: ActorLite,
  request: { requestType: string },
  step: StepLite,
  action: 'approve' | 'reject',
): boolean {
  if (actor.appRole < AppRole.Manager) return false; // ApproveStep/RejectStep เดิม: AppRole < 3 ห้าม
  if (!isStepActionable(step)) return false;
  if (step.approverId === actor.userId || step.delegatedTo === actor.userId) return true;
  const type = request.requestType.trim().toUpperCase();
  if (actor.appRole === AppRole.Admin && type === 'CREATE_HC') return true;
  return action === 'approve' && MANAGER_FALLBACK_TYPES.has(type);
}

/**
 * เลือก step ที่ผู้ใช้จะลงมติในคำขอหนึ่ง (กรณี client ส่งเลขคำขอมา) — ลำดับเดียวกับ ApprovalInboxForm.ProcessBatch:
 * step ของตัวเองที่ Pending → step ของตัวเองที่เป็น Delegated → (Admin+CREATE_HC | อนุมัติ DELETE_FOLDER) step แรกที่ค้าง
 */
export function pickActingStep(
  actor: ActorLite,
  request: { requestType: string },
  steps: StepLite[],
  action: 'approve' | 'reject',
): StepLite | null {
  const ordered = [...steps].sort(byOrder);
  const own = ordered.filter(
    (s) => s.approverId === actor.userId || s.delegatedTo === actor.userId,
  );
  const pick =
    own.find((s) => s.stepStatus === STEP_PENDING) ??
    own.find((s) => s.stepStatus === STEP_DELEGATED_OR_AUTOCLOSED);
  if (pick && canActOnStep(actor, request, pick, action)) return pick;
  return ordered.find((s) => canActOnStep(actor, request, s, action)) ?? null;
}

/** StepOrder ถัดไปของคำขอ (ตาราง ApprovalStep มี unique (RequestID, StepOrder)) */
export const nextStepOrder = (steps: Pick<StepLite, 'stepOrder'>[]): number =>
  steps.reduce((max, s) => Math.max(max, s.stepOrder), 0) + 1;

/**
 * Role ปลายทางของการยกระดับ (EscalateRequest เดิมเทียบ "ApproverID == 3" ซึ่งเอา UserID ไปเทียบกับเลข role —
 * OPEN_QUESTIONS C1) → ที่นี่เทียบ AppRole จริงของผู้อนุมัติเดิม:
 * ผู้อนุมัติเดิมเป็น Manager ขึ้นไป → ยกระดับไป Admin(4), ต่ำกว่านั้น (ข้อมูลเก่า) → Manager(3)
 */
export function escalationTargetRole(currentApproverRole: number | null | undefined): AppRole {
  return (currentApproverRole ?? 0) >= AppRole.Manager ? AppRole.Admin : AppRole.Manager;
}

/**
 * ผู้อนุมัติตั้งต้นเมื่อผู้เรียกไม่ระบุเอง (พอร์ตจาก ShareService / ApprovalService.RequestFolderDelete)
 *  - CREATE_HC / DELETE_FOLDER: Admin ทุกคน (ตัดผู้ขอออก; ถ้าเหลือไม่มีให้ใช้ Admin ทั้งหมดรวมผู้ขอ — Admin คนเดียวอนุมัติเองได้)
 *  - ชนิดอื่น: Manager ทุกคนที่ไม่ใช่ผู้ขอ; ถ้าไม่มี → Admin (ShareService เดิม — Admin fallback ไม่ตัดผู้ขอ)
 * คืน userId ตามลำดับ (ใช้เป็น StepOrder 1..n)
 */
export function defaultApproverIds(args: {
  requestType: string;
  requesterId: number;
  managers: number[];
  admins: number[];
}): number[] {
  const type = args.requestType.trim().toUpperCase();
  const uniq = (xs: number[]) => [...new Set(xs)];
  if (type === 'CREATE_HC' || type === 'DELETE_FOLDER') {
    const others = uniq(args.admins).filter((id) => id !== args.requesterId);
    return others.length > 0 ? others : uniq(args.admins);
  }
  const managers = uniq(args.managers).filter((id) => id !== args.requesterId);
  return managers.length > 0 ? managers : uniq(args.admins);
}
