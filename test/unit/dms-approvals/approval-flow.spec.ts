import { AppRole } from '../../../src/common/constants/enums';
import {
  canActOnStep,
  decideAfterApprove,
  defaultApproverIds,
  escalationTargetRole,
  isStepActionable,
  nextStepOrder,
  pickActingStep,
  StepLite,
} from '../../../src/modules/dms/approvals/common/approval-flow';

const step = (
  stepId: number,
  stepOrder: number,
  approverId: number,
  stepStatus = 1,
  extra: Partial<StepLite> = {},
): StepLite => ({
  stepId,
  stepOrder,
  approverId,
  stepStatus,
  ...extra,
});
const manager = { userId: 10, appRole: AppRole.Manager };
const admin = { userId: 20, appRole: AppRole.Admin };
const officer = { userId: 30, appRole: AppRole.Officer };

describe('decideAfterApprove — ลำดับ step', () => {
  it('มี step ถัดไปที่ Pending → ยังไม่จบ และคืน step ถัดไป', () => {
    const steps = [step(1, 1, 10), step(2, 2, 11), step(3, 3, 12)];
    const d = decideAfterApprove({ requestType: 'CHANGE_PERMISSION', steps, approvedStepId: 1 });
    expect(d.finalize).toBe(false);
    expect(d.nextStep?.stepId).toBe(2);
    expect(d.autoCloseStepIds).toEqual([]);
  });

  it('step สุดท้ายอนุมัติ → จบ (ไม่มี step ถัดไป)', () => {
    const steps = [step(1, 1, 10, 2), step(2, 2, 11)];
    const d = decideAfterApprove({ requestType: 'DELETE_FOLDER', steps, approvedStepId: 2 });
    expect(d).toMatchObject({ finalize: true, nextStep: null });
  });

  it('step ถัดไปที่เป็น Delegated(4) ไม่ขวาง (เหมือนระบบเดิม: นับเฉพาะ Pending)', () => {
    const steps = [step(1, 1, 10), step(2, 2, 11, 4)];
    expect(
      decideAfterApprove({ requestType: 'EXTERNAL_SHARE', steps, approvedStepId: 1 }).finalize,
    ).toBe(true);
  });

  it('step ลำดับก่อนหน้าที่ยังค้างไม่ทำให้ step หลังอนุมัติแล้วไม่จบ (พฤติกรรมเดิม)', () => {
    const steps = [step(1, 1, 10), step(2, 2, 11)];
    expect(
      decideAfterApprove({ requestType: 'EXTERNAL_SHARE', steps, approvedStepId: 2 }).finalize,
    ).toBe(true);
  });

  it('CREATE_HC: อนุมัติคนแรกจบ และปิด step Pending ที่เหลือ (เฉพาะที่ Pending)', () => {
    const steps = [step(1, 1, 20), step(2, 2, 21), step(3, 3, 22, 4), step(4, 4, 23)];
    const d = decideAfterApprove({ requestType: 'create_hc', steps, approvedStepId: 1 });
    expect(d.finalize).toBe(true);
    expect(d.autoCloseStepIds.sort()).toEqual([2, 4]);
  });

  it('step ที่เกิดจากการยกระดับ: ผู้อนุมัติคนแรกของกลุ่มจบทันทีและปิดที่เหลือ', () => {
    const escalatedAt = new Date();
    const steps = [
      step(1, 1, 10, 4, { escalatedDate: escalatedAt }), // ต้นทางที่ถูกยกระดับ
      step(2, 2, 20),
      step(3, 3, 21),
    ];
    const d = decideAfterApprove({ requestType: 'EXTERNAL_SHARE', steps, approvedStepId: 2 });
    expect(d.finalize).toBe(true);
    expect(d.autoCloseStepIds).toEqual([3]);
  });

  it('step ต้นทางก่อนการยกระดับยังเป็นลำดับต่อกันตามปกติ', () => {
    const steps = [step(1, 1, 10), step(2, 2, 11)];
    expect(
      decideAfterApprove({ requestType: 'EXTERNAL_SHARE', steps, approvedStepId: 1 }).finalize,
    ).toBe(false);
  });

  it('ไม่พบ step ที่อนุมัติ → โยน error ภายใน', () => {
    expect(() => decideAfterApprove({ requestType: 'X', steps: [], approvedStepId: 9 })).toThrow();
  });
});

describe('canActOnStep / pickActingStep — ใครลงมติได้', () => {
  it('Officer ลงมติไม่ได้เลย แม้เป็นเจ้าของ step', () => {
    expect(canActOnStep(officer, { requestType: 'DOWNLOAD_FILE' }, step(1, 1, 30), 'approve')).toBe(
      false,
    );
  });

  it('เจ้าของ step และผู้รับมอบ (DelegatedTo) ลงมติได้', () => {
    expect(
      canActOnStep(manager, { requestType: 'CHANGE_PERMISSION' }, step(1, 1, 10), 'approve'),
    ).toBe(true);
    expect(
      canActOnStep(
        manager,
        { requestType: 'CHANGE_PERMISSION' },
        step(1, 1, 99, 4, { delegatedTo: 10 }),
        'reject',
      ),
    ).toBe(true);
  });

  it('Manager ที่ไม่ใช่เจ้าของ step ลงมติ CHANGE_PERMISSION ไม่ได้', () => {
    expect(
      canActOnStep(manager, { requestType: 'CHANGE_PERMISSION' }, step(1, 1, 99), 'approve'),
    ).toBe(false);
  });

  it('Admin อนุมัติ CREATE_HC ได้ทุก step ที่ค้าง แต่ Manager ทำไม่ได้', () => {
    const s = step(1, 1, 99);
    expect(canActOnStep(admin, { requestType: 'CREATE_HC' }, s, 'approve')).toBe(true);
    expect(canActOnStep(manager, { requestType: 'CREATE_HC' }, s, 'approve')).toBe(false);
  });

  it('DELETE_FOLDER: Manager+ อนุมัติแทนได้ แต่ปฏิเสธแทนไม่ได้ (fallback เดิมของ Approval Inbox)', () => {
    const s = step(1, 1, 99);
    expect(canActOnStep(manager, { requestType: 'DELETE_FOLDER' }, s, 'approve')).toBe(true);
    expect(canActOnStep(manager, { requestType: 'DELETE_FOLDER' }, s, 'reject')).toBe(false);
  });

  it('step ที่ Approved/Rejected แล้วลงมติซ้ำไม่ได้', () => {
    expect(isStepActionable(step(1, 1, 10, 2))).toBe(false);
    expect(
      canActOnStep(manager, { requestType: 'CHANGE_PERMISSION' }, step(1, 1, 10, 3), 'approve'),
    ).toBe(false);
  });

  it('pickActingStep: เลือก step ของตัวเองที่ Pending ก่อน Delegated', () => {
    const steps = [step(1, 1, 10, 4), step(2, 2, 10, 1), step(3, 3, 11)];
    expect(
      pickActingStep(manager, { requestType: 'CHANGE_PERMISSION' }, steps, 'approve')?.stepId,
    ).toBe(2);
  });

  it('pickActingStep: Admin ไม่มี step ของตัวเองใน CREATE_HC → ใช้ step แรกที่ค้าง', () => {
    const steps = [step(1, 1, 21, 2), step(2, 2, 22), step(3, 3, 23)];
    expect(pickActingStep(admin, { requestType: 'CREATE_HC' }, steps, 'approve')?.stepId).toBe(2);
  });

  it('pickActingStep: ไม่มี step ที่ทำได้ → null', () => {
    expect(
      pickActingStep(manager, { requestType: 'CHANGE_PERMISSION' }, [step(1, 1, 99)], 'approve'),
    ).toBeNull();
  });
});

describe('ยกระดับ (escalation)', () => {
  it('เทียบ AppRole ของผู้อนุมัติเดิม ไม่ใช่เลข UserID: Manager+ → Admin, ต่ำกว่า/ไม่รู้ → Manager', () => {
    expect(escalationTargetRole(AppRole.Manager)).toBe(AppRole.Admin);
    expect(escalationTargetRole(AppRole.Admin)).toBe(AppRole.Admin);
    expect(escalationTargetRole(AppRole.Officer)).toBe(AppRole.Manager);
    expect(escalationTargetRole(null)).toBe(AppRole.Manager);
  });

  it('nextStepOrder = ค่าสูงสุด + 1 (มี unique RequestID+StepOrder)', () => {
    expect(nextStepOrder([])).toBe(1);
    expect(nextStepOrder([{ stepOrder: 1 }, { stepOrder: 7 }, { stepOrder: 3 }])).toBe(8);
  });
});

describe('defaultApproverIds — ผู้อนุมัติตั้งต้น', () => {
  it('แชร์/สิทธิ์: Manager ทุกคนยกเว้นผู้ขอ', () => {
    expect(
      defaultApproverIds({
        requestType: 'EXTERNAL_SHARE',
        requesterId: 1,
        managers: [1, 2, 3],
        admins: [9],
      }),
    ).toEqual([2, 3]);
  });

  it('ไม่มี Manager อื่น → Admin (ไม่ตัดผู้ขอ เหมือน ShareService เดิม)', () => {
    expect(
      defaultApproverIds({
        requestType: 'INTERNAL_SHARE',
        requesterId: 9,
        managers: [9],
        admins: [9, 8],
      }),
    ).toEqual([9, 8]);
  });

  it('DELETE_FOLDER/CREATE_HC: Admin ทุกคนยกเว้นผู้ขอ; Admin คนเดียวเป็นผู้ขอเองก็อนุมัติเองได้', () => {
    expect(
      defaultApproverIds({
        requestType: 'DELETE_FOLDER',
        requesterId: 8,
        managers: [2],
        admins: [8, 9],
      }),
    ).toEqual([9]);
    expect(
      defaultApproverIds({ requestType: 'CREATE_HC', requesterId: 8, managers: [], admins: [8] }),
    ).toEqual([8]);
  });

  it('ไม่มีใครเลย → ว่าง', () => {
    expect(
      defaultApproverIds({
        requestType: 'CHANGE_PERMISSION',
        requesterId: 1,
        managers: [],
        admins: [],
      }),
    ).toEqual([]);
  });
});
