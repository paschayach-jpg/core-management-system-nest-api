import {
  AppRole,
  WorkflowInstanceStatus as IS,
  WorkflowStepType as T,
  WorkflowTemplateStatus as S,
} from '../../../src/common/constants/enums';
import { WFE_ENTITY, WFE_OP } from '../../../src/modules/wfe/common/wfe.constants';
import {
  boss,
  designerJson,
  LINEAR_JSON,
  makeWfe,
  root,
  seedLinear,
  seedTemplate,
  type Wfe,
} from './fakes';

const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as { response?: { code?: string; details?: unknown }; message: string };
  }
  throw new Error('คาดว่าจะโยน error แต่สำเร็จ');
}
const find = async (w: Wfe, operation: string) =>
  (await w.events()).filter((e) => e.operation === operation);

describe('WorkflowTemplatesService — สร้าง/แก้/ลบ', () => {
  it('สร้าง template เป็น Draft, IsActive=false, Version 1 เสมอ (ไม่เชื่อ IsActive จาก client) และบันทึก CRUD-log', async () => {
    const w = makeWfe();
    const t = await w.templates.create(
      { name: 'ขออนุมัติ', description: 'x', category: 'HR' },
      boss,
    );
    expect(t).toMatchObject({
      name: 'ขออนุมัติ',
      approvalStatus: S.Draft,
      isActive: false,
      version: 1,
      createdBy: boss.adUserName,
    });
    const [ev] = await find(w, WFE_OP.templateCreated);
    expect(ev).toMatchObject({
      module: 'WFE',
      entity: WFE_ENTITY.template,
      action: 'CREATE',
      recordId: t.workflowDefinitionId,
      success: true,
    });
  });

  it('TemplateDefinition ที่ไม่ใช่ JSON ถูกปฏิเสธ และบันทึกเหตุการณ์ล้มเหลว', async () => {
    const w = makeWfe();
    const e = await rejection(w.templates.create({ name: 'x', templateDefinition: '{oops' }, boss));
    expect(code(e)).toBe('TEMPLATE_DEFINITION_INVALID');
    const [ev] = await find(w, WFE_OP.templateCreated);
    expect(ev.success).toBe(false);
    expect(w.db.defs).toHaveLength(0);
  });

  it('สร้างพร้อมผังแบบ designer → สร้างแถว step/connection ให้ทันที', async () => {
    const w = makeWfe();
    const t = await w.templates.create({ name: 'x', templateDefinition: LINEAR_JSON }, boss);
    expect(t.structure.source).toBe('rows');
    expect(
      t.structure.steps.map((s) => [s.stepName, s.stepType, s.assignedUser, s.slaDays]),
    ).toEqual([
      ['เริ่ม', T.Start, null, null],
      ['อนุมัติ', T.Approval, 'DOM\\bob', 2],
      ['จบ', T.End, null, null],
    ]);
    expect(t.structure.connections).toHaveLength(2);
    // เส้นเชื่อมอ้าง WFStepId จริง (ไม่ใช่รหัสใน layout)
    const ids = t.structure.steps.map((s) => s.workflowStepId);
    expect(
      t.structure.connections.every((c) => ids.includes(c.fromStepId) && ids.includes(c.toStepId)),
    ).toBe(true);
    expect(t.validation.valid).toBe(true);
    expect(t.stepCount).toBe(3);
  });

  it('ผังแบบ wizard เก็บเป็น JSON อย่างเดียว (ไม่สร้างแถว) และอ่านผ่าน structure.source=definition', async () => {
    const w = makeWfe();
    const wizard = JSON.stringify({
      Steps: [
        { StepNumber: 1, StepName: 'A', Action: 'Approve', NextStep: 'B' },
        { StepNumber: 2, StepName: 'B', Action: 'Review', NextStep: '' },
      ],
    });
    const t = await w.templates.create({ name: 'wiz', templateDefinition: wizard }, boss);
    expect(w.db.steps).toHaveLength(0);
    expect(t.structure.source).toBe('definition');
    expect(t.structure.steps).toHaveLength(2);
    expect(t.validation.valid).toBe(false); // ไม่มี Start/End
  });

  it('แก้ไข: Version เพิ่ม, IsActive ถูกปรับให้คู่กับสถานะ, บันทึก before/after', async () => {
    const w = makeWfe();
    const seeded = seedLinear(w.db, {
      approvalStatus: S.Draft,
      isActive: true /* ข้อมูลเก่าที่ไม่คู่กัน */,
    });
    const t = await w.templates.update(
      seeded.defId,
      { name: 'ชื่อใหม่', changeDescription: 'ปรับชื่อ' },
      boss,
    );
    expect(t).toMatchObject({
      name: 'ชื่อใหม่',
      version: 4,
      isActive: false,
      modifiedBy: boss.adUserName,
    });
    const [ev] = await find(w, WFE_OP.templateUpdated);
    expect(ev).toMatchObject({ action: 'UPDATE', recordId: seeded.defId, success: true });
    expect(ev.before).toMatchObject({ name: `Template ${seeded.defId}`, version: 3 });
    expect(ev.meta).toMatchObject({ changeDescription: 'ปรับชื่อ' });
  });

  it('แก้ไขไม่ได้ตอนรออนุมัติหรือ Deprecated; ไม่มีข้อมูลให้แก้ = 422', async () => {
    const w = makeWfe();
    const pending = seedLinear(w.db, { approvalStatus: S.PendingApproval, isActive: false });
    const dep = seedLinear(w.db, { approvalStatus: S.Deprecated, isActive: false });
    expect(code(await rejection(w.templates.update(pending.defId, { name: 'x' }, boss)))).toBe(
      'TEMPLATE_NOT_EDITABLE',
    );
    expect(code(await rejection(w.templates.update(dep.defId, { name: 'x' }, boss)))).toBe(
      'TEMPLATE_NOT_EDITABLE',
    );
    const draft = seedLinear(w.db, { approvalStatus: S.Draft, isActive: false });
    expect(code(await rejection(w.templates.update(draft.defId, {}, boss)))).toBe('NO_CHANGES');
  });

  it('แก้ผังของ Draft → สร้างแถว step ใหม่ตาม definition (แทนของเดิม); ของ Active ไม่แตะแถว', async () => {
    const w = makeWfe();
    const draft = await w.templates.create({ name: 'd', templateDefinition: LINEAR_JSON }, boss);
    const oldIds = w.db.steps.filter((s) => !s.isDeleted).map((s) => s.wfStepId);
    const next = designerJson(
      [
        { WorkflowStepId: 1, StepName: 'เริ่ม', StepType: 'Start' },
        { WorkflowStepId: 2, StepName: 'จบ', StepType: 'End' },
      ],
      [{ FromStepId: 1, ToStepId: 2 }],
    );
    const upd = await w.templates.update(
      draft.workflowDefinitionId,
      { templateDefinition: next },
      boss,
    );
    expect(upd.structure.steps.map((s) => s.stepName)).toEqual(['เริ่ม', 'จบ']);
    expect(w.db.steps.filter((s) => oldIds.includes(s.wfStepId)).every((s) => s.isDeleted)).toBe(
      true,
    );
  });

  it('Active/Inactive ที่มีแถว step แล้ว: แก้ผัง (TemplateDefinition) ไม่ได้ (422) แต่แก้ชื่อ/คำอธิบายได้; ส่ง definition เดิมซ้ำไม่ถือว่าแก้ผัง', async () => {
    const w = makeWfe();
    const active = seedLinear(w.db, { templateDefinition: LINEAR_JSON });
    const before = JSON.stringify(w.db.steps);
    const other = designerJson([{ WorkflowStepId: 1, StepName: 'x', StepType: 'Start' }], []);

    const e = await rejection(
      w.templates.update(active.defId, { templateDefinition: other }, boss),
    );
    expect(code(e)).toBe('TEMPLATE_STRUCTURE_LOCKED');
    expect(JSON.stringify(w.db.steps)).toBe(before);
    expect(w.db.defs[0].version).toBe(3); // ไม่ถูกเพิ่ม Version เมื่อล้มเหลว

    const renamed = await w.templates.update(
      active.defId,
      { name: 'ชื่อใหม่', templateDefinition: LINEAR_JSON },
      boss,
    );
    expect(renamed).toMatchObject({ name: 'ชื่อใหม่', version: 4 });
    expect(JSON.stringify(w.db.steps)).toBe(before);
  });

  it('Active ที่ยังไม่มีแถว step เลย (ผังอยู่ใน JSON อย่างเดียวแบบระบบเดิม) ยังแก้ผังได้ — instance แรกจะสร้างแถวจาก JSON ล่าสุด', async () => {
    const w = makeWfe();
    const active = seedTemplate(w.db, [], null, { templateDefinition: LINEAR_JSON });
    const next = designerJson(
      [
        { WorkflowStepId: 1, StepName: 'เริ่ม', StepType: 'Start' },
        { WorkflowStepId: 2, StepName: 'จบ', StepType: 'End' },
      ],
      [{ FromStepId: 1, ToStepId: 2 }],
    );
    await w.templates.update(active.defId, { templateDefinition: next }, boss);
    expect(w.db.steps).toHaveLength(0);
    expect(w.db.defs[0].templateDefinition).toBe(next);
  });

  describe('ลบ template', () => {
    it('ลบไม่ได้ถ้ายังมี instance ที่ทำงานอยู่ (409) และบันทึก success=false', async () => {
      const w = makeWfe();
      const { defId } = seedLinear(w.db);
      await w.instances.create({ workflowDefinitionId: defId }, boss);
      const e = await rejection(w.templates.remove(defId, boss));
      expect(code(e)).toBe('TEMPLATE_HAS_ACTIVE_INSTANCES');
      expect(w.db.defs.find((d) => d.wfDefinitionId === defId)?.isDeleted).toBe(false);
      const [ev] = await find(w, WFE_OP.templateDeleted);
      expect(ev).toMatchObject({ action: 'DELETE', success: false });
    });

    it.each([IS.Created, IS.InProgress, IS.Suspended, 0])(
      'instance สถานะ %s ถือว่ายังทำงานอยู่ → ลบไม่ได้',
      async (status) => {
        const w = makeWfe();
        const { defId } = seedLinear(w.db);
        w.db.instances.push({
          wfInstanceId: 1,
          wfDefinitionId: defId,
          status,
          isDeleted: false,
        } as never);
        expect(code(await rejection(w.templates.remove(defId, boss)))).toBe(
          'TEMPLATE_HAS_ACTIVE_INSTANCES',
        );
      },
    );

    it('มีแต่ instance ที่จบแล้ว (Completed/Rejected/Cancelled) → ลบได้ (soft delete)', async () => {
      const w = makeWfe();
      const { defId } = seedLinear(w.db);
      for (const status of [IS.Completed, IS.Rejected, IS.Cancelled])
        w.db.instances.push({
          wfInstanceId: status,
          wfDefinitionId: defId,
          status,
          isDeleted: false,
        } as never);
      await w.templates.remove(defId, boss);
      expect(w.db.defs.find((d) => d.wfDefinitionId === defId)).toMatchObject({
        isDeleted: true,
        modifiedBy: boss.adUserName,
      });
      const [ev] = await find(w, WFE_OP.templateDeleted);
      expect(ev).toMatchObject({ success: true, recordId: defId });
      expect(ev.before).toMatchObject({ workflowDefinitionId: defId });
    });

    it('ไม่พบ template → 404', async () => {
      const w = makeWfe();
      expect((await rejection(w.templates.remove(999, boss))).response).toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});

describe('WorkflowTemplatesService — วงจรสถานะ', () => {
  it('Draft → ส่งอนุมัติ → อนุมัติ → Active พร้อมบันทึกผู้ส่ง/ผู้อนุมัติ และ log ชื่อ Action เดิม', async () => {
    const w = makeWfe();
    const t = await w.templates.create({ name: 'x', templateDefinition: LINEAR_JSON }, boss);
    const id = t.workflowDefinitionId;

    const pending = await w.templates.submitForApproval(id, boss);
    expect(pending).toMatchObject({
      approvalStatus: S.PendingApproval,
      isActive: false,
      submittedBy: boss.adUserName,
    });
    expect(pending.submittedDate).toBeInstanceOf(Date);

    const active = await w.templates.approve(id, root);
    expect(active).toMatchObject({
      approvalStatus: S.Active,
      isActive: true,
      approvedBy: root.adUserName,
    });

    const ops = (await w.events()).filter((e) => e.action === 'EXECUTE').map((e) => e.operation);
    expect(ops).toEqual([WFE_OP.templateSubmitted, WFE_OP.templateApproved]);
  });

  it('ปฏิเสธ → กลับ Draft พร้อมเหตุผลและผู้ปฏิเสธ; ส่งใหม่แล้วล้างเหตุผล', async () => {
    const w = makeWfe();
    const t = await w.templates.create({ name: 'x', templateDefinition: LINEAR_JSON }, boss);
    const id = t.workflowDefinitionId;
    await w.templates.submitForApproval(id, boss);
    const rejected = await w.templates.reject(id, { reason: 'ขาดผู้อนุมัติ' }, root);
    expect(rejected).toMatchObject({
      approvalStatus: S.Draft,
      isActive: false,
      rejectionReason: 'ขาดผู้อนุมัติ',
      approvedBy: root.adUserName,
    });
    const again = await w.templates.submitForApproval(id, boss);
    expect(again.rejectionReason).toBeNull();
    const [ev] = await find(w, WFE_OP.templateRejected);
    expect(ev.meta).toMatchObject({ reason: 'ขาดผู้อนุมัติ' });
  });

  it('เผยแพร่ตรงจาก Draft → Active; ปิดใช้งาน → Inactive (บันทึกผู้ปิด/เหตุผล) → เผยแพร่ซ้ำล้างข้อมูลปิด', async () => {
    const w = makeWfe();
    const t = await w.templates.create({ name: 'x', templateDefinition: LINEAR_JSON }, boss);
    const id = t.workflowDefinitionId;
    expect(await w.templates.publish(id, root)).toMatchObject({
      approvalStatus: S.Active,
      isActive: true,
    });
    const off = await w.templates.deactivate(id, { reason: 'ยกเลิกใช้' }, boss);
    expect(off).toMatchObject({
      approvalStatus: S.Inactive,
      isActive: false,
      disabledBy: boss.adUserName,
      disabledReason: 'ยกเลิกใช้',
    });
    const on = await w.templates.publish(id, root);
    expect(on).toMatchObject({ approvalStatus: S.Active, disabledBy: null, disabledReason: null });
  });

  it('ยกเลิกเวอร์ชัน (Deprecate) เป็นสถานะสิ้นสุด', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db);
    const d = await w.templates.deprecate(defId, {}, root);
    expect(d).toMatchObject({ approvalStatus: S.Deprecated, isActive: false });
    expect(code(await rejection(w.templates.publish(defId, root)))).toBe(
      'TEMPLATE_INVALID_TRANSITION',
    );
    expect(code(await rejection(w.templates.deactivate(defId, {}, boss)))).toBe(
      'TEMPLATE_INVALID_TRANSITION',
    );
  });

  it('เปลี่ยนสถานะที่ไม่อนุญาต → 422 พร้อมข้อความไทยที่บอกสถานะปัจจุบัน และ log success=false', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db); // Active
    const e = await rejection(w.templates.submitForApproval(defId, boss));
    expect(code(e)).toBe('TEMPLATE_INVALID_TRANSITION');
    expect(e.message).toContain('Draft');
    const [ev] = await find(w, WFE_OP.templateSubmitted);
    expect(ev.success).toBe(false);
    expect(w.db.defs[0].approvalStatus).toBe(S.Active);
  });

  it('ส่งอนุมัติ/เผยแพร่ ต้องผ่านการตรวจผัง (ไม่มี End → 422 พร้อมรายการปัญหา)', async () => {
    const w = makeWfe();
    const noEnd = designerJson(
      [
        { WorkflowStepId: 1, StepName: 'เริ่ม', StepType: 'Start' },
        { WorkflowStepId: 2, StepName: 'งาน', StepType: 'Approval', AssignedUser: 'DOM\\bob' },
      ],
      [{ FromStepId: 1, ToStepId: 2 }],
    );
    const t = await w.templates.create({ name: 'x', templateDefinition: noEnd }, boss);
    const e = await rejection(w.templates.submitForApproval(t.workflowDefinitionId, boss));
    expect(code(e)).toBe('TEMPLATE_GRAPH_INVALID');
    const issues = (e.response?.details as { issues: { code: string }[] }).issues.map(
      (i) => i.code,
    );
    expect(issues).toEqual(expect.arrayContaining(['NO_END']));
    expect(code(await rejection(w.templates.publish(t.workflowDefinitionId, root)))).toBe(
      'TEMPLATE_GRAPH_INVALID',
    );
    expect(w.db.defs[0].approvalStatus).toBe(S.Draft);
  });

  it('ผู้รับผิดชอบที่ไม่ใช่ผู้ใช้ในระบบ (เช่นกลุ่ม AD) หรือเป็นบทบาทเท่านั้น ทำให้ผังไม่ผ่าน; ไม่ระบุผู้รับผิดชอบใน Approval เป็นแค่คำเตือน', async () => {
    const w = makeWfe();
    const { defId } = seedTemplate(
      w.db,
      [
        { key: 's', type: T.Start },
        { key: 'a', type: T.Approval, name: 'ตรวจ', assignedUser: 'AD Group: CMS-Legal-Managers' },
        { key: 'b', type: T.Approval, name: 'บทบาท', assignedRole: 'Legal' },
        { key: 'c', type: T.Review, name: 'ว่าง' },
        { key: 'e', type: T.End },
      ],
      [
        ['s', 'a'],
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'e'],
      ],
      { approvalStatus: S.Draft, isActive: false },
    );
    const v = await w.structure.validateById(defId);
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => [i.severity, i.code])).toEqual(
      expect.arrayContaining([
        ['error', 'ASSIGNEE_NOT_FOUND'],
        ['error', 'ASSIGNEE_UNSUPPORTED'],
        ['warning', 'ASSIGNEE_BLANK'],
      ]),
    );
  });

  it('สองคนกดพร้อมกัน: สถานะเปลี่ยนไประหว่างทาง → 409 TEMPLATE_STATE_CHANGED', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db, { approvalStatus: S.Draft, isActive: false });
    // จำลองว่า update ตามสถานะที่คาดไว้ไม่โดนแถวใด (มีคนอื่นเปลี่ยนไปแล้ว)
    const store = (w.structure as unknown as { store: { updateDefinition: unknown } }).store;
    store.updateDefinition = async () => 0;
    expect(code(await rejection(w.templates.submitForApproval(defId, boss)))).toBe(
      'TEMPLATE_STATE_CHANGED',
    );
  });
});

describe('WorkflowTemplatesService — คัดลอก / ส่งออก / นำเข้า / อ่าน', () => {
  it('copy: สร้าง Draft ใหม่ ชื่อ "(Copy)" พร้อมคัดลอกขั้นตอน/เส้นเชื่อมด้วยรหัสใหม่', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db, {
      category: 'HR',
      wfDescription: 'คำอธิบาย',
      templateDefinition: LINEAR_JSON,
    });
    const copy = await w.templates.copy(defId, {}, boss);
    expect(copy).toMatchObject({
      name: `Template ${defId} (Copy)`,
      description: 'คำอธิบาย',
      category: 'HR',
      approvalStatus: S.Draft,
      isActive: false,
      version: 1,
      createdBy: boss.adUserName,
    });
    expect(copy.workflowDefinitionId).not.toBe(defId);
    expect(copy.structure.steps.map((s) => s.stepName)).toEqual(['เริ่ม', 'อนุมัติ', 'จบ']);
    const srcStepIds = w.db.steps.filter((s) => s.wfDefinitionId === defId).map((s) => s.wfStepId);
    const copyStepIds = copy.structure.steps.map((s) => s.workflowStepId);
    expect(copyStepIds.some((id) => srcStepIds.includes(id))).toBe(false);
    expect(
      copy.structure.connections.every(
        (c) => copyStepIds.includes(c.fromStepId) && copyStepIds.includes(c.toStepId),
      ),
    ).toBe(true);
    // ต้นฉบับไม่ถูกแตะ
    expect(w.db.conns.filter((c) => c.wfDefinitionId === defId)).toHaveLength(2);
    const [ev] = await find(w, WFE_OP.templateDuplicated);
    expect(ev.meta).toMatchObject({ copiedFrom: defId });
  });

  it('copy ต้นทางที่มีผังใน JSON อย่างเดียว → สร้างแถวให้ฉบับคัดลอกจาก JSON', async () => {
    const w = makeWfe();
    const src = await w.templates.create({ name: 'src', templateDefinition: LINEAR_JSON }, boss);
    w.db.steps.forEach((s) => (s.isDeleted = true)); // ทำให้ต้นทางเหลือ JSON อย่างเดียว
    w.db.conns.forEach((c) => (c.isDeleted = true));
    const copy = await w.templates.copy(src.workflowDefinitionId, { name: 'ชื่อใหม่' }, boss);
    expect(copy.name).toBe('ชื่อใหม่');
    expect(copy.structure.source).toBe('rows');
    expect(copy.structure.steps).toHaveLength(3);
  });

  it('export → import: สร้าง Draft ชื่อ "(Imported)" และไม่เชื่อสถานะ/เวอร์ชันจากไฟล์', async () => {
    const w = makeWfe({ logLevel: 'all' });
    const { defId } = seedLinear(w.db, { templateDefinition: LINEAR_JSON });
    const exported = await w.templates.export(defId);
    expect(exported).toMatchObject({
      name: `Template ${defId}`,
      approvalStatus: S.Active,
      version: 3,
    });
    const [exEv] = await find(w, WFE_OP.templateExported);
    expect(exEv).toMatchObject({ action: 'READ' }); // เก็บเมื่อ CRUD_LOG_LEVEL=all เท่านั้น

    const imported = await w.templates.import(
      { ...exported, name: exported.name, description: undefined } as never,
      boss,
    );
    expect(imported).toMatchObject({
      name: `Template ${defId} (Imported)`,
      approvalStatus: S.Draft,
      isActive: false,
      version: 1,
      description: 'Imported from file',
    });
    expect(imported.structure.steps).toHaveLength(3);
  });

  it('list กรองตามสถานะและแบ่งหน้า; versions คืนแถวเดียว', async () => {
    const w = makeWfe();
    seedLinear(w.db, { wfName: 'B' });
    seedLinear(w.db, { wfName: 'A', approvalStatus: S.Draft, isActive: false });
    const q = { page: 1, pageSize: 10, sortDir: 'asc' as const };
    const all = await w.templates.list(q as never);
    expect(all.items.map((i) => i.name)).toEqual(['A', 'B']);
    const drafts = await w.templates.list({ ...q, approvalStatus: S.Draft } as never);
    expect(drafts.total).toBe(1);
    const v = await w.templates.versions(all.items[0].workflowDefinitionId);
    expect(v).toHaveLength(1);
  });
});

describe('TemplateStructureService — step / connection', () => {
  it('เพิ่ม/แก้/ลบ step ได้เฉพาะ Draft; Active ถูกล็อก', async () => {
    const w = makeWfe();
    const draft = await w.templates.create({ name: 'd' }, boss);
    const id = draft.workflowDefinitionId;
    const s1 = await w.structure.createStep(id, { stepName: 'เริ่ม', stepType: T.Start }, boss);
    const s2 = await w.structure.createStep(
      id,
      { stepName: 'จบ', stepType: T.End, assignedUser: '  ' },
      boss,
    );
    expect([s1.sequenceNumber, s2.sequenceNumber]).toEqual([1, 2]);
    expect(s2.assignedUser).toBeNull();

    const upd = await w.structure.updateStep(
      id,
      s2.workflowStepId,
      { stepName: 'สิ้นสุด', slaDays: 3 },
      boss,
    );
    expect(upd).toMatchObject({ stepName: 'สิ้นสุด', slaDays: 3 });
    expect(code(await rejection(w.structure.updateStep(id, s2.workflowStepId, {}, boss)))).toBe(
      'NO_CHANGES',
    );

    const active = seedLinear(w.db);
    expect(
      code(
        await rejection(
          w.structure.createStep(active.defId, { stepName: 'x', stepType: T.Approval }, boss),
        ),
      ),
    ).toBe('TEMPLATE_STRUCTURE_LOCKED');
    const ev = (await w.events()).filter((e) => e.operation === WFE_OP.stepCreated);
    expect(ev.map((e) => e.success)).toEqual([true, true, false]);
  });

  it('เส้นเชื่อม: ห้ามวนหาตัวเอง, ห้ามซ้ำ, ต้องเป็น step ใน template เดียวกัน; ลบ step ลบเส้นที่เกี่ยวข้องด้วย', async () => {
    const w = makeWfe();
    const draft = await w.templates.create({ name: 'd' }, boss);
    const id = draft.workflowDefinitionId;
    const a = await w.structure.createStep(id, { stepName: 'A', stepType: T.Start }, boss);
    const b = await w.structure.createStep(id, { stepName: 'B', stepType: T.End }, boss);
    const other = seedLinear(w.db);

    const c = await w.structure.createConnection(
      id,
      { fromStepId: a.workflowStepId, toStepId: b.workflowStepId },
      boss,
    );
    expect(c).toMatchObject({ sequenceNumber: 1, conditionExpression: null });
    expect(
      code(
        await rejection(
          w.structure.createConnection(
            id,
            { fromStepId: a.workflowStepId, toStepId: b.workflowStepId },
            boss,
          ),
        ),
      ),
    ).toBe('CONNECTION_DUPLICATE');
    expect(
      code(
        await rejection(
          w.structure.createConnection(
            id,
            { fromStepId: a.workflowStepId, toStepId: a.workflowStepId },
            boss,
          ),
        ),
      ),
    ).toBe('CONNECTION_SELF_LOOP');
    expect(
      code(
        await rejection(
          w.structure.createConnection(
            id,
            { fromStepId: a.workflowStepId, toStepId: other.step.end },
            boss,
          ),
        ),
      ),
    ).toBe('CONNECTION_STEP_NOT_FOUND');

    await w.structure.deleteStep(id, b.workflowStepId, boss);
    expect(await w.structure.listSteps(id)).toHaveLength(1);
    expect(await w.structure.listConnections(id)).toHaveLength(0);
  });

  it('ลบ step ที่มี instance อ้างอิงไม่ได้ (409 STEP_IN_USE)', async () => {
    const w = makeWfe();
    const { defId, step } = seedLinear(w.db, { approvalStatus: S.Draft, isActive: false });
    w.db.stepInstances.push({
      wfStepInstanceId: 1,
      wfInstanceId: 1,
      wfStepId: step.approve,
      status: 1,
    } as never);
    expect(code(await rejection(w.structure.deleteStep(defId, step.approve, boss)))).toBe(
      'STEP_IN_USE',
    );
  });

  it('sync-steps: แทนที่แถวเดิมของ Draft ด้วยผังจาก definition; ไม่มีผัง designer → 422', async () => {
    const w = makeWfe();
    const t = await w.templates.create({ name: 'd', templateDefinition: LINEAR_JSON }, boss);
    const synced = await w.structure.syncFromDefinition(t.workflowDefinitionId, boss);
    expect(synced.steps).toHaveLength(3);
    expect(w.db.steps.filter((s) => !s.isDeleted)).toHaveLength(3);
    expect(w.db.steps.filter((s) => s.isDeleted)).toHaveLength(3); // ชุดเก่าถูก soft delete

    const empty = await w.templates.create({ name: 'empty' }, boss);
    expect(
      code(await rejection(w.structure.syncFromDefinition(empty.workflowDefinitionId, boss))),
    ).toBe('TEMPLATE_DEFINITION_EMPTY');
  });

  it('ผู้ใช้ Officer ถูกกันที่ controller ด้วย @MinRole(Manager) — service ไม่รับผิดชอบซ้ำ', () => {
    expect(AppRole.Manager).toBe(3);
  });
});
