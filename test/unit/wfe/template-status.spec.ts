import { WorkflowTemplateStatus as S } from '../../../src/common/constants/enums';
import {
  canInstantiate,
  isStructureEditable,
  isTemplateEditable,
  nextTemplateState,
  TEMPLATE_TRANSITIONS,
  transitionErrorMessage,
  type TemplateAction,
} from '../../../src/modules/wfe/template/template-status';

const ACTIONS = Object.keys(TEMPLATE_TRANSITIONS) as TemplateAction[];
const ALL = [S.Draft, S.PendingApproval, S.Active, S.Inactive, S.Deprecated];

describe('วงจรสถานะ template (ตารางการเปลี่ยนสถานะ)', () => {
  it('Draft → ส่งอนุมัติ → รออนุมัติ (IsActive=false)', () => {
    expect(nextTemplateState(S.Draft, 'SUBMIT')).toEqual({
      approvalStatus: S.PendingApproval,
      isActive: false,
    });
  });

  it('รออนุมัติ → อนุมัติ → Active (IsActive=true)', () => {
    expect(nextTemplateState(S.PendingApproval, 'APPROVE')).toEqual({
      approvalStatus: S.Active,
      isActive: true,
    });
  });

  it('รออนุมัติ → ปฏิเสธ → กลับเป็น Draft (IsActive=false)', () => {
    expect(nextTemplateState(S.PendingApproval, 'REJECT')).toEqual({
      approvalStatus: S.Draft,
      isActive: false,
    });
  });

  it('เผยแพร่ตรงได้จาก Draft และ Inactive เท่านั้น', () => {
    expect(nextTemplateState(S.Draft, 'PUBLISH')?.approvalStatus).toBe(S.Active);
    expect(nextTemplateState(S.Inactive, 'PUBLISH')?.approvalStatus).toBe(S.Active);
    for (const s of [S.PendingApproval, S.Active, S.Deprecated])
      expect(nextTemplateState(s, 'PUBLISH')).toBeNull();
  });

  it('ปิดใช้งานได้เฉพาะ Active → Inactive; ยกเลิกเวอร์ชันได้จาก Active/Inactive', () => {
    expect(nextTemplateState(S.Active, 'DEACTIVATE')).toEqual({
      approvalStatus: S.Inactive,
      isActive: false,
    });
    expect(nextTemplateState(S.Draft, 'DEACTIVATE')).toBeNull();
    expect(nextTemplateState(S.Active, 'DEPRECATE')?.approvalStatus).toBe(S.Deprecated);
    expect(nextTemplateState(S.Inactive, 'DEPRECATE')?.approvalStatus).toBe(S.Deprecated);
    expect(nextTemplateState(S.Draft, 'DEPRECATE')).toBeNull();
  });

  it('Deprecated เป็นสถานะสิ้นสุด: ไม่มี action ไหนออกจากมันได้', () => {
    for (const a of ACTIONS) expect(nextTemplateState(S.Deprecated, a)).toBeNull();
  });

  it('IsActive คู่กับสถานะเสมอ: true เฉพาะเมื่อผลลัพธ์เป็น Active', () => {
    for (const from of ALL)
      for (const a of ACTIONS) {
        const r = nextTemplateState(from, a);
        if (r) expect(r.isActive).toBe(r.approvalStatus === S.Active);
      }
  });

  it('ข้อความ error ภาษาไทยบอกสถานะปัจจุบัน', () => {
    expect(transitionErrorMessage(S.Active, 'SUBMIT')).toContain('Draft');
    expect(transitionErrorMessage(S.Active, 'SUBMIT')).toContain('สถานะปัจจุบัน: Active');
  });

  it('แก้ข้อมูลได้ตอน Draft/Active/Inactive; ห้ามตอนรออนุมัติ/Deprecated', () => {
    expect([S.Draft, S.Active, S.Inactive].every(isTemplateEditable)).toBe(true);
    expect(isTemplateEditable(S.PendingApproval)).toBe(false);
    expect(isTemplateEditable(S.Deprecated)).toBe(false);
  });

  it('แก้ผัง (step/connection) ได้เฉพาะ Draft', () => {
    expect(ALL.filter(isStructureEditable)).toEqual([S.Draft]);
  });

  it('สร้าง instance ได้เฉพาะ Active ที่ IsActive=true', () => {
    expect(canInstantiate(S.Active, true)).toBe(true);
    expect(canInstantiate(S.Active, false)).toBe(false);
    expect(canInstantiate(S.Draft, true)).toBe(false); // ข้อมูลเก่าที่ Draft แต่ IsActive=1
  });
});
