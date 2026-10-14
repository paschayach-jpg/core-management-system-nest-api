import { WorkflowStepType as T } from '../../../src/common/constants/enums';
import {
  checkTemplateDefinitionJson,
  graphFromDefinition,
  mapStepTypeLabel,
  parseTemplateDefinition,
  sequentialEdges,
  validateGraph,
  type GraphEdge,
  type GraphNode,
} from '../../../src/modules/wfe/template/template-definition';

const n = (key: number, type: T, name = `S${key}`, sequence = key): GraphNode => ({
  key,
  name,
  type,
  sequence,
});
const e = (from: number, to: number): GraphEdge => ({ from, to });
const codes = (r: ReturnType<typeof validateGraph>, severity?: 'error' | 'warning') =>
  r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);

describe('ตรวจความถูกต้องของกราฟ template', () => {
  it('กราฟตรง Start → Approval → End ผ่าน', () => {
    const r = validateGraph([n(1, T.Start), n(2, T.Approval), n(3, T.End)], [e(1, 2), e(2, 3)]);
    expect(r).toEqual({ valid: true, issues: [] });
  });

  it('Decision แตกสองทางแล้วไป End ทั้งคู่ ผ่าน', () => {
    const r = validateGraph(
      [n(1, T.Start), n(2, T.Decision), n(3, T.Approval), n(4, T.Review), n(5, T.End)],
      [e(1, 2), e(2, 3), e(2, 4), e(3, 5), e(4, 5)],
    );
    expect(r.valid).toBe(true);
  });

  it('ไม่มี step เลย → NO_STEPS', () => {
    expect(codes(validateGraph([], []))).toEqual(['NO_STEPS']);
  });

  it('ไม่มี Start / ไม่มี End', () => {
    const r = validateGraph([n(1, T.Approval), n(2, T.Approval)], [e(1, 2)]);
    expect(r.valid).toBe(false);
    expect(codes(r, 'error')).toEqual(expect.arrayContaining(['NO_START', 'NO_END']));
  });

  it('มี Start มากกว่าหนึ่งตัว → MULTIPLE_START', () => {
    const r = validateGraph([n(1, T.Start), n(2, T.Start), n(3, T.End)], [e(1, 3), e(2, 3)]);
    expect(codes(r, 'error')).toContain('MULTIPLE_START');
  });

  it('step ลอย (ไม่มีเส้นเข้า/ออกเลย) → FLOATING_STEP', () => {
    const r = validateGraph(
      [n(1, T.Start), n(2, T.Approval), n(3, T.End), n(9, T.Review, 'ลอย')],
      [e(1, 2), e(2, 3)],
    );
    expect(r.valid).toBe(false);
    const floating = r.issues.find((i) => i.code === 'FLOATING_STEP');
    expect(floating).toMatchObject({ severity: 'error', stepKey: 9 });
    expect(floating?.message).toContain('ลอย');
    // ไม่รายงานซ้ำเป็น unreachable/dead-end
    expect(codes(r)).not.toContain('UNREACHABLE_FROM_START');
    expect(codes(r)).not.toContain('DEAD_END');
  });

  it('เดินจาก Start ไปไม่ถึง step → UNREACHABLE_FROM_START', () => {
    // 4 → 3 (End) มีเส้นออก แต่ไม่มีทางเข้าจาก Start
    const r = validateGraph(
      [n(1, T.Start), n(2, T.Approval), n(3, T.End), n(4, T.Review)],
      [e(1, 2), e(2, 3), e(4, 3)],
    );
    expect(codes(r, 'error')).toEqual(['UNREACHABLE_FROM_START']);
  });

  it('step ที่ไม่ใช่ End แต่ไม่มีทางไปต่อ → DEAD_END', () => {
    const r = validateGraph(
      [n(1, T.Start), n(2, T.Approval), n(3, T.Review), n(4, T.End)],
      [e(1, 2), e(1, 3), e(2, 4)],
    );
    expect(codes(r, 'error')).toEqual(['DEAD_END']);
  });

  it('วนกันเองไม่มีทางออกไป End → NO_PATH_TO_END', () => {
    const r = validateGraph(
      [n(1, T.Start), n(2, T.Approval), n(3, T.Review), n(4, T.End)],
      [e(1, 2), e(2, 3), e(3, 2)],
    );
    expect(codes(r, 'error')).toEqual(expect.arrayContaining(['NO_PATH_TO_END']));
    expect(r.valid).toBe(false);
  });

  it('เส้นเชื่อมผิด: อ้าง step ที่ไม่มี / วนหาตัวเอง / ซ้ำ', () => {
    const r = validateGraph([n(1, T.Start), n(2, T.End)], [e(1, 2), e(1, 2), e(2, 2), e(1, 99)]);
    expect(codes(r, 'error')).toEqual(
      expect.arrayContaining(['CONNECTION_UNKNOWN_STEP', 'CONNECTION_SELF_LOOP']),
    );
    expect(codes(r, 'warning')).toContain('CONNECTION_DUPLICATE');
  });

  it('รหัส step ซ้ำ → DUPLICATE_STEP_KEY', () => {
    const r = validateGraph([n(1, T.Start), n(1, T.End)], [e(1, 1)]);
    expect(codes(r, 'error')).toContain('DUPLICATE_STEP_KEY');
  });

  it('Start มีเส้นเข้า / End มีเส้นออก เป็นแค่คำเตือน', () => {
    const r = validateGraph(
      [n(1, T.Start), n(2, T.Approval), n(3, T.End)],
      [e(1, 2), e(2, 3), e(2, 1), e(3, 2)],
    );
    expect(codes(r, 'warning')).toEqual(
      expect.arrayContaining(['START_HAS_INCOMING', 'END_HAS_OUTGOING']),
    );
    expect(r.valid).toBe(true);
  });

  describe('ไม่มี connection เลย (sequential fallback ของ engine)', () => {
    it('ถือว่าเรียงต่อกันตาม SequenceNumber และเตือน', () => {
      const nodes = [
        n(10, T.End, 'จบ', 3),
        n(11, T.Start, 'เริ่ม', 1),
        n(12, T.Approval, 'อนุมัติ', 2),
      ];
      expect(sequentialEdges(nodes)).toEqual([e(11, 12), e(12, 10)]);
      const r = validateGraph(nodes, []);
      expect(r.valid).toBe(true);
      expect(codes(r, 'warning')).toEqual(['SEQUENTIAL_FALLBACK']);
    });

    it('ลำดับเรียงผิด (End มาก่อน Start) → ไม่ผ่าน', () => {
      const r = validateGraph([n(1, T.End, 'จบ', 1), n(2, T.Start, 'เริ่ม', 2)], []);
      expect(r.valid).toBe(false);
    });
  });
});

describe('อ่าน TemplateDefinition', () => {
  const designer = JSON.stringify({
    Steps: [
      { WorkflowStepId: 1, StepName: 'เริ่ม', StepType: 'Start', CanvasX: 10 },
      {
        WorkflowStepId: 2,
        StepName: 'หัวหน้าอนุมัติ',
        StepType: 'Approval',
        AssignedUser: ' DOM\\boss ',
        SLADays: 3,
        AllowForward: true,
      },
      { WorkflowStepId: 3, StepName: 'แจ้งผล', StepType: 'System Task' },
      { WorkflowStepId: 4, StepName: 'จบ', StepType: 'end', SLADays: 0 },
    ],
    Connections: [
      { FromStepId: 1, ToStepId: 2, Condition: '' },
      { FromStepId: 2, ToStepId: 3, Condition: 'Approved' },
      { FromStepId: 3, ToStepId: 4 },
      { FromStepId: 3, ToStepId: 99 },
    ],
  });

  it('รูปแบบ designer: step, ชนิด, ผู้รับผิดชอบ, SLA, เส้นเชื่อม', () => {
    const p = parseTemplateDefinition(designer)!;
    expect(p.format).toBe('designer');
    expect(p.steps.map((s) => [s.key, s.stepType, s.sequenceNumber])).toEqual([
      [1, T.Start, 1],
      [2, T.Approval, 2],
      [3, T.Approval, 3], // System Task → Approval (เหมือน MapStringToStepType)
      [4, T.End, 4],
    ]);
    expect(p.steps[1]).toMatchObject({
      assignedUser: 'DOM\\boss',
      slaDays: 3,
      allowDelegation: true,
    });
    expect(p.steps[3].slaDays).toBeNull(); // 0 → ไม่มี SLA
    expect(p.connections.map((c) => [c.fromKey, c.toKey, c.condition, c.sequenceNumber])).toEqual([
      [1, 2, null, 1],
      [2, 3, 'Approved', 2],
      [3, 4, null, 3],
      [3, 99, null, 4],
    ]);
  });

  it('กราฟจาก designer: เส้นไป step ที่ไม่มีถูกรายงาน', () => {
    const { nodes, edges } = graphFromDefinition(parseTemplateDefinition(designer)!);
    const r = validateGraph(nodes, edges);
    expect(codes(r, 'error')).toContain('CONNECTION_UNKNOWN_STEP');
  });

  it('รับ key แบบ camelCase ด้วย', () => {
    const p = parseTemplateDefinition(
      JSON.stringify({
        steps: [{ workflowStepId: 5, stepName: 'A', stepType: 'review' }],
        connections: [],
      }),
    )!;
    expect(p.steps[0]).toMatchObject({ key: 5, stepName: 'A', stepType: T.Review });
  });

  it('รูปแบบ wizard: แปลง Action เป็นชนิด และ NextStep เป็นเส้นเชื่อม', () => {
    const wizard = JSON.stringify({
      TemplateCode: 'X',
      Steps: [
        { StepNumber: 2, StepName: 'ตรวจสอบ', Action: 'Review', NextStep: 'จบงาน' },
        { StepNumber: 1, StepName: 'ยื่นคำขอ', Action: 'Approve', NextStep: 'ตรวจสอบ' },
        { StepNumber: 3, StepName: 'จบงาน', Action: 'End', NextStep: '' },
      ],
      Approvers: [],
    });
    const p = parseTemplateDefinition(wizard)!;
    expect(p.format).toBe('wizard');
    expect(p.steps.map((s) => [s.stepName, s.stepType])).toEqual([
      ['ยื่นคำขอ', T.Approval],
      ['ตรวจสอบ', T.Review],
      ['จบงาน', T.End],
    ]);
    expect(p.connections.map((c) => [c.fromKey, c.toKey])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    // wizard ไม่มี Start → ตรวจกราฟแล้วไม่ผ่าน (ต้องเปิดใน designer เติม Start)
    const { nodes, edges } = graphFromDefinition(p);
    expect(codes(validateGraph(nodes, edges), 'error')).toContain('NO_START');
  });

  it('ว่าง / "{}" / ไม่ใช่ JSON / ไม่มี Steps → null', () => {
    for (const raw of [null, undefined, '', '  ', '{}', 'ไม่ใช่ json', '[]', '{"Steps":[]}'])
      expect(parseTemplateDefinition(raw)).toBeNull();
  });

  describe('mapStepTypeLabel', () => {
    it('ชื่อชนิด (ไม่สนตัวพิมพ์) + ตัวเลข; ที่ไม่รู้จัก = Approval', () => {
      expect(mapStepTypeLabel('Start')).toBe(T.Start);
      expect(mapStepTypeLabel('PARALLEL')).toBe(T.Parallel);
      expect(mapStepTypeLabel('merge')).toBe(T.Merge);
      expect(mapStepTypeLabel(6)).toBe(T.Decision);
      expect(mapStepTypeLabel('7')).toBe(T.Merge);
      for (const s of ['Sub-Workflow', 'System Task', 'Wait Timer', '', undefined, 'xyz', 99])
        expect(mapStepTypeLabel(s)).toBe(T.Approval);
    });
  });

  describe('checkTemplateDefinitionJson (ตรวจ input จาก client)', () => {
    it('ว่างใช้ได้ · JSON object ใช้ได้', () => {
      expect(checkTemplateDefinitionJson(undefined)).toBeNull();
      expect(checkTemplateDefinitionJson('')).toBeNull();
      expect(checkTemplateDefinitionJson('{}')).toBeNull();
      expect(checkTemplateDefinitionJson(designer)).toBeNull();
    });
    it('ไม่ใช่ JSON / ไม่ใช่ object ถูกปฏิเสธ', () => {
      expect(checkTemplateDefinitionJson('{oops')).toContain('JSON');
      expect(checkTemplateDefinitionJson('[1,2]')).toContain('object');
      expect(checkTemplateDefinitionJson('"str"')).toContain('object');
    });
  });
});
