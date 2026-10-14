import {
  WorkflowInstanceStatus as IS,
  WorkflowStepInstanceStatus as SS,
} from '../../../src/common/constants/enums';
import {
  canDeleteInstance,
  canStartStep,
  instanceTransitionError,
  isInstanceActionable,
  isStepActionable,
  nextInstanceStatus,
} from '../../../src/modules/wfe/instance/instance-rules';
import {
  canControlInstance,
  canViewInstance,
  sameUser,
} from '../../../src/modules/wfe/common/wfe-access';
import { AppRole } from '../../../src/common/constants/enums';

describe('สถานะ instance', () => {
  it('ระงับได้เฉพาะ InProgress · ทำต่อได้เฉพาะ Suspended', () => {
    expect(nextInstanceStatus(IS.InProgress, 'SUSPEND')).toBe(IS.Suspended);
    expect(nextInstanceStatus(IS.Suspended, 'SUSPEND')).toBeNull();
    expect(nextInstanceStatus(IS.Suspended, 'RESUME')).toBe(IS.InProgress);
    expect(nextInstanceStatus(IS.InProgress, 'RESUME')).toBeNull();
  });

  it('ยกเลิกได้ตอน 0/Created/InProgress/Suspended; ไม่ได้ตอนจบแล้ว', () => {
    for (const s of [0, IS.Created, IS.InProgress, IS.Suspended])
      expect(nextInstanceStatus(s, 'CANCEL')).toBe(IS.Cancelled);
    for (const s of [IS.Completed, IS.Rejected, IS.Cancelled])
      expect(nextInstanceStatus(s, 'CANCEL')).toBeNull();
  });

  it('ข้อความ error บอกสถานะปัจจุบัน', () => {
    expect(instanceTransitionError(IS.Completed, 'CANCEL')).toContain('Completed');
  });

  it('ลบ (soft) ได้เฉพาะที่จบแล้ว', () => {
    expect([IS.Completed, IS.Rejected, IS.Cancelled].every(canDeleteInstance)).toBe(true);
    expect([0, IS.Created, IS.InProgress, IS.Suspended].some(canDeleteInstance)).toBe(false);
  });

  it('ทำงานกับ step ได้เฉพาะเมื่อ instance กำลังดำเนินการ (Suspend มีผลจริง)', () => {
    expect(isInstanceActionable(IS.InProgress)).toBe(true);
    expect(
      [0, IS.Created, IS.Suspended, IS.Completed, IS.Rejected, IS.Cancelled].some(
        isInstanceActionable,
      ),
    ).toBe(false);
  });
});

describe('สถานะ step instance', () => {
  it('กระทำได้เมื่อ Pending/InProgress/Delegated; ไม่ได้เมื่อ Completed/Rejected', () => {
    expect([SS.Pending, SS.InProgress, SS.Delegated].every(isStepActionable)).toBe(true);
    expect([SS.Completed, SS.Rejected].some(isStepActionable)).toBe(false);
  });
  it('เริ่มงานได้จาก Pending/Delegated เท่านั้น', () => {
    expect(canStartStep(SS.Pending)).toBe(true);
    expect(canStartStep(SS.Delegated)).toBe(true);
    expect(canStartStep(SS.InProgress)).toBe(false);
    expect(canStartStep(SS.Completed)).toBe(false);
  });
});

describe('สิทธิ์ระดับ instance', () => {
  const officer = { appRole: AppRole.Officer, adUserName: 'DOM\\alice' };
  const manager = { appRole: AppRole.Manager, adUserName: 'DOM\\boss' };

  it('sameUser ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย และ null ไม่เท่ากับอะไร', () => {
    expect(sameUser(' DOM\\Alice ', 'dom\\alice')).toBe(true);
    expect(sameUser(null, null)).toBe(false);
    expect(sameUser('a', undefined)).toBe(false);
  });

  it('ดู instance ได้: ผู้เริ่ม / ผู้มี step / Manager ขึ้นไป', () => {
    const p = { initiatedBy: 'DOM\\alice', assignees: ['DOM\\bob'] };
    expect(canViewInstance(officer, p)).toBe(true);
    expect(canViewInstance({ appRole: AppRole.Officer, adUserName: 'dom\\BOB' }, p)).toBe(true);
    expect(canViewInstance({ appRole: AppRole.Officer, adUserName: 'DOM\\eve' }, p)).toBe(false);
    expect(canViewInstance(manager, p)).toBe(true);
  });

  it('ระงับ/ยกเลิก instance ได้: ผู้เริ่มหรือ Manager ขึ้นไป', () => {
    expect(canControlInstance(officer, 'DOM\\alice')).toBe(true);
    expect(canControlInstance(officer, 'DOM\\other')).toBe(false);
    expect(canControlInstance(manager, 'DOM\\other')).toBe(true);
  });
});
