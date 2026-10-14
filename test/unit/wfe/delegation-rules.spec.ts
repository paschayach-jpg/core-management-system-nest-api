import {
  WorkflowInstanceStatus as IS,
  WorkflowStepInstanceStatus as SS,
} from '../../../src/common/constants/enums';
import { MAX_DELEGATION_DEPTH } from '../../../src/modules/wfe/common/wfe.constants';
import {
  checkDelegation,
  deactivationKind,
  nextDelegationDepth,
  type DelegationCheckInput,
  type DelegationHistoryItem,
} from '../../../src/modules/wfe/delegation/delegation-rules';

const hist = (
  from: string,
  to: string,
  depth: number,
  isActive = false,
): DelegationHistoryItem => ({
  delegationId: depth,
  delegatedFrom: from,
  delegatedTo: to,
  delegationDepth: depth,
  isActive,
});

const base = (over: Partial<DelegationCheckInput> = {}): DelegationCheckInput => ({
  caller: 'DOM\\alice',
  delegateTo: 'DOM\\bob',
  assignedTo: 'DOM\\alice',
  stepStatus: SS.Pending,
  instanceStatus: IS.InProgress,
  stepAllowsDelegation: true,
  history: [],
  ...over,
});

describe('กฎการมอบหมายงาน (delegation)', () => {
  it('มอบหมายครั้งแรกผ่าน', () => {
    expect(checkDelegation(base())).toBeNull();
  });

  it('ต้องระบุผู้รับ', () => {
    expect(checkDelegation(base({ delegateTo: '  ' }))?.code).toBe('DELEGATE_REQUIRED');
  });

  it('ผู้มอบต้องเป็นผู้รับผิดชอบปัจจุบัน (ไม่สนตัวพิมพ์)', () => {
    expect(checkDelegation(base({ assignedTo: 'DOM\\carol' }))?.code).toBe('NOT_ASSIGNEE');
    expect(checkDelegation(base({ assignedTo: 'dom\\ALICE' }))).toBeNull();
  });

  it('ห้ามมอบให้ตัวเอง', () => {
    expect(checkDelegation(base({ delegateTo: 'dom\\Alice' }))?.code).toBe('SELF_DELEGATION');
  });

  it('ห้ามวน: มอบกลับหาคนที่เคยอยู่ในสาย (ผู้มอบเดิมหรือผู้รับเดิม)', () => {
    // alice → bob แล้ว bob (ผู้ถืองานตอนนี้) จะมอบ → ห้ามมอบกลับ alice
    const history = [hist('DOM\\alice', 'DOM\\bob', 1, true)];
    const asBob = base({ caller: 'DOM\\bob', assignedTo: 'DOM\\bob', history });
    expect(checkDelegation({ ...asBob, delegateTo: 'DOM\\alice' })?.code).toBe('DELEGATION_CYCLE');
    expect(checkDelegation({ ...asBob, delegateTo: 'DOM\\ALICE' })?.code).toBe('DELEGATION_CYCLE');
    expect(checkDelegation({ ...asBob, delegateTo: 'DOM\\carol' })).toBeNull();
  });

  it('วนผ่านลำดับยาว: alice→bob→carol แล้ว carol มอบกลับ bob ไม่ได้', () => {
    const history = [hist('DOM\\alice', 'DOM\\bob', 1), hist('DOM\\bob', 'DOM\\carol', 2, true)];
    const asCarol = base({ caller: 'DOM\\carol', assignedTo: 'DOM\\carol', history });
    expect(checkDelegation({ ...asCarol, delegateTo: 'DOM\\bob' })?.code).toBe('DELEGATION_CYCLE');
  });

  describe(`ความลึกสูงสุด ${MAX_DELEGATION_DEPTH} ระดับ`, () => {
    it('ความลึกถัดไป = MAX(depth)+1 (เหมือน sp_WF_CreateDelegation)', () => {
      expect(nextDelegationDepth([])).toBe(1);
      expect(nextDelegationDepth([hist('a', 'b', 1), hist('b', 'c', 2)])).toBe(3);
    });

    it('ระดับที่ 3 ยังมอบได้ (มีประวัติ 2 ครั้ง)', () => {
      const history = [hist('DOM\\a', 'DOM\\b', 1), hist('DOM\\b', 'DOM\\alice', 2, true)];
      expect(checkDelegation(base({ history, delegateTo: 'DOM\\d' }))).toBeNull();
    });

    it('ครั้งที่ 4 ถูกปฏิเสธ (มีประวัติครบ 3 ครั้งแล้ว)', () => {
      const history = [
        hist('DOM\\a', 'DOM\\b', 1),
        hist('DOM\\b', 'DOM\\c', 2),
        hist('DOM\\c', 'DOM\\alice', 3, true),
      ];
      expect(checkDelegation(base({ history, delegateTo: 'DOM\\e' }))?.code).toBe(
        'MAX_DEPTH_EXCEEDED',
      );
    });

    it('นับจากประวัติทั้งหมดรวมที่ถูกปิดแล้ว (คืนงานแล้วไม่รีเซ็ตความลึก)', () => {
      const history = [
        hist('DOM\\alice', 'DOM\\b', 1),
        hist('DOM\\alice', 'DOM\\c', 2),
        hist('DOM\\alice', 'DOM\\d', 3),
      ];
      expect(checkDelegation(base({ history, delegateTo: 'DOM\\e' }))?.code).toBe(
        'MAX_DEPTH_EXCEEDED',
      );
    });
  });

  it('step ต้องอนุญาตให้มอบหมาย (AllowDelegation)', () => {
    expect(checkDelegation(base({ stepAllowsDelegation: false }))?.code).toBe(
      'DELEGATION_NOT_ALLOWED',
    );
  });

  it('งานที่เสร็จ/ถูกปฏิเสธแล้วมอบหมายไม่ได้ แต่ Delegated/InProgress มอบต่อได้', () => {
    for (const s of [SS.Completed, SS.Rejected])
      expect(checkDelegation(base({ stepStatus: s }))?.code).toBe('STEP_NOT_ACTIVE');
    for (const s of [SS.InProgress, SS.Delegated])
      expect(checkDelegation(base({ stepStatus: s }))).toBeNull();
  });

  it('instance ที่ระงับ/ยกเลิก/จบแล้วมอบหมายไม่ได้', () => {
    for (const s of [IS.Suspended, IS.Cancelled, IS.Completed, IS.Rejected])
      expect(checkDelegation(base({ instanceStatus: s }))?.code).toBe('INSTANCE_NOT_ACTIVE');
  });

  it('ช่วงวันที่ต้องเรียงถูก', () => {
    const start = new Date('2026-05-01');
    expect(checkDelegation(base({ startDate: start, endDate: start }))?.code).toBe(
      'DATE_RANGE_INVALID',
    );
    expect(checkDelegation(base({ startDate: start, endDate: new Date('2026-05-02') }))).toBeNull();
  });

  describe('ใครยกเลิก/คืนงานได้', () => {
    const d = { delegatedFrom: 'DOM\\alice', delegatedTo: 'DOM\\bob' };
    it('ผู้มอบ = ยกเลิก · ผู้รับ = คืนงาน · Manager = ยกเลิก · คนอื่น = ไม่ได้', () => {
      expect(deactivationKind('dom\\alice', false, d)).toBe('CANCEL');
      expect(deactivationKind('DOM\\bob', false, d)).toBe('RETURN');
      expect(deactivationKind('DOM\\boss', true, d)).toBe('CANCEL');
      expect(deactivationKind('DOM\\eve', false, d)).toBeNull();
    });
  });
});
