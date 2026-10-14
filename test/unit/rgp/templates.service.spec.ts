import { AppRole } from '../../../src/common/constants/enums';
import { MasterDocument } from '../../../src/modules/rgp/entities/master-document.entity';
import { ProjectTemplate } from '../../../src/modules/rgp/entities/project-template.entity';
import { Project } from '../../../src/modules/rgp/entities/project.entity';
import { ProjectState } from '../../../src/modules/rgp/entities/project-state.entity';
import { TemplateDoc } from '../../../src/modules/rgp/entities/template-doc.entity';
import { TemplateState } from '../../../src/modules/rgp/entities/template-state.entity';
import { fakeUser } from '../../helpers/stubs';
import { makeHarness, type Harness } from './helpers/harness';

const admin = fakeUser({ adUserName: 'boss', appRole: AppRole.Manager });

function setup() {
  const h = makeHarness({ user: admin });
  h.project.seed(MasterDocument, [
    { docCode: 'D-001', docName: 'หนังสือขออนุมัติ', docTypeId: 1, active: 1 },
    { docCode: 'D-002', docName: 'รายงานผล', docTypeId: 2, active: 1 },
  ]);
  return h;
}

const states = (h: Harness) => h.main.rows<TemplateState>(TemplateState);
const docs = (h: Harness) => h.main.rows<TemplateDoc>(TemplateDoc);
const templates = (h: Harness) => h.main.rows<ProjectTemplate>(ProjectTemplate);

/** สร้าง template พร้อม 2 ขั้นตอนและเอกสารขั้นละ 1 รายการผ่าน service */
async function makeFullTemplate(h: Harness, code = 'GEN') {
  const t = await h.templates.create({ code, name: `ประเภท ${code}`, description: 'd' }, admin);
  const s1 = await h.templates.createState(t.templateId, { name: 'ยื่นคำขอ' }, admin);
  const s2 = await h.templates.createState(
    t.templateId,
    { name: 'พิจารณา', required: false },
    admin,
  );
  const d1 = await h.templates.createDoc(s1.stateId, { masterDocId: 1 }, admin);
  const d2 = await h.templates.createDoc(s2.stateId, { masterDocId: 2, remark: 'ต้องมี' }, admin);
  return { t, s1, s2, d1, d2 };
}

describe('ProjectTemplatesService — Template', () => {
  it('สร้าง/แก้ไข: รหัสต้องไม่ซ้ำ (409) · active เริ่มเป็น Y · CRUD-log ถูกเขียน', async () => {
    const h = setup();
    const a = await h.templates.create(
      { code: ' LEGAL ', name: '  กฎหมาย ', isLegalDict: true },
      admin,
    );
    expect(a).toMatchObject({ code: 'LEGAL', name: 'กฎหมาย', active: true, isLegalDict: true });
    expect(templates(h)[0].createUser).toBe('boss');

    await expect(h.templates.create({ code: 'LEGAL', name: 'ซ้ำ' }, admin)).rejects.toMatchObject({
      response: { code: 'TEMPLATE_CODE_DUPLICATE' },
    });

    const b = await h.templates.create({ code: 'GEN', name: 'ทั่วไป' }, admin);
    const updated = await h.templates.update(
      b.templateId,
      { name: 'ทั่วไป 2', active: false },
      admin,
    );
    expect(updated).toMatchObject({
      code: 'GEN',
      name: 'ทั่วไป 2',
      active: false,
      isLegalDict: false,
    });
    await expect(h.templates.update(b.templateId, { code: 'LEGAL' }, admin)).rejects.toMatchObject({
      response: { code: 'TEMPLATE_CODE_DUPLICATE' },
    });
    await expect(h.templates.update(b.templateId, { code: 'GEN' }, admin)).resolves.toBeDefined();

    await h.crud.drain();
    expect(h.sink.events.map((e) => [e.entity, e.action, e.operation, e.success])).toEqual([
      ['ProjectTemplate', 'CREATE', 'CREATE_PROJECT_TEMPLATE', true],
      ['ProjectTemplate', 'CREATE', 'CREATE_PROJECT_TEMPLATE', false],
      ['ProjectTemplate', 'CREATE', 'CREATE_PROJECT_TEMPLATE', true],
      ['ProjectTemplate', 'UPDATE', 'UPDATE_PROJECT_TEMPLATE', true],
      ['ProjectTemplate', 'UPDATE', 'UPDATE_PROJECT_TEMPLATE', false],
      ['ProjectTemplate', 'UPDATE', 'UPDATE_PROJECT_TEMPLATE', true],
    ]);
  });

  it('ลบ template: ลบเอกสาร → ขั้นตอน → template ทั้งหมดในครั้งเดียว', async () => {
    const h = setup();
    const { t } = await makeFullTemplate(h);
    await h.templates.remove(t.templateId);
    expect(templates(h)).toHaveLength(0);
    expect(states(h)).toHaveLength(0);
    expect(docs(h)).toHaveLength(0);
  });

  it('ลบไม่ได้ถ้ามีโครงการใช้ (แม้ถูกลบแบบ soft) — บอกจำนวน และไม่ลบอะไรเลย', async () => {
    const h = setup();
    const { t } = await makeFullTemplate(h);
    h.main.seed(Project, [
      {
        projectNo: 'P1',
        projectName: 'a',
        templateId: t.templateId,
        status: 'Open',
        active: 'Y',
        createUser: 'u',
      },
      {
        projectNo: 'P2',
        projectName: 'b',
        templateId: t.templateId,
        status: 'Cancelled',
        active: 'N',
        createUser: 'u',
      },
    ]);
    await expect(h.templates.remove(t.templateId)).rejects.toMatchObject({
      response: {
        code: 'TEMPLATE_IN_USE',
        message: 'ไม่สามารถลบได้ มีโครงการที่ใช้งาน Template นี้อยู่ 2 รายการ',
      },
    });
    expect(templates(h)).toHaveLength(1);
    expect(states(h)).toHaveLength(2);
    expect(docs(h)).toHaveLength(2);
  });

  it('ลบไม่ได้ถ้าขั้นตอนของ template ถูกโครงการอ้างอิง (t_project_state.i_state_id) และ rollback ลูกที่ลบไปแล้ว', async () => {
    const h = setup();
    const { t, s2 } = await makeFullTemplate(h);
    const [p] = h.main.seed(Project, [
      {
        projectNo: 'P1',
        projectName: 'a',
        templateId: null,
        status: 'Open',
        active: 'Y',
        createUser: 'u',
      },
    ]);
    h.main.seed(ProjectState, [
      {
        projectId: p.projectId,
        stateId: s2.stateId,
        stateName: 'พิจารณา',
        seqNo: 1,
        status: 'Pending',
        createUser: 'u',
      },
    ]);
    await expect(h.templates.remove(t.templateId)).rejects.toMatchObject({
      response: { code: 'TEMPLATE_STATE_IN_USE' },
    });
    expect(states(h)).toHaveLength(2);
    expect(docs(h)).toHaveLength(2);
  });

  it('template ไม่พบ → 404', async () => {
    const h = setup();
    await expect(h.templates.remove(99)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    await expect(h.templates.get(99)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });

  it('list: ส่ง activeOnly เป็นพารามิเตอร์ และแปลง flag Y/N เป็น boolean', async () => {
    const h = setup();
    h.main.onQuery = (_sql, params) => [
      {
        templateId: 1,
        code: 'A',
        name: 'ก',
        description: null,
        active: 'Y',
        isLegalDict: 'N',
        createDate: new Date(),
        stateCount: '3',
        projectCount: '2',
        seen: params[0],
      },
    ];
    const rows = await h.templates.list(true);
    expect(rows[0]).toMatchObject({
      active: true,
      isLegalDict: false,
      stateCount: 3,
      projectCount: 2,
    });
    expect(h.main.queries[0].params).toEqual([1]);
    await h.templates.list();
    expect(h.main.queries[1].params).toEqual([0]);
  });
});

describe('ProjectTemplatesService — ขั้นตอนของ template', () => {
  it('เพิ่มต่อท้ายตามลำดับ (หรือระบุ seqNo) · แก้ไข · docCount ถูกนับ', async () => {
    const h = setup();
    const { t, s1, s2 } = await makeFullTemplate(h);
    expect([s1.seqNo, s2.seqNo]).toEqual([1, 2]);
    expect(s2.required).toBe(false);

    const s3 = await h.templates.createState(
      t.templateId,
      { name: 'ปิดงาน', seqNo: 10, description: ' ท้าย ' },
      admin,
    );
    expect(s3).toMatchObject({ seqNo: 10, description: 'ท้าย' });

    const updated = await h.templates.updateState(s1.stateId, {
      name: 'ยื่นคำขอ (แก้)',
      required: false,
      seqNo: 3,
    });
    expect(updated).toMatchObject({
      name: 'ยื่นคำขอ (แก้)',
      required: false,
      seqNo: 3,
      docCount: 1,
    });
  });

  it('ลบขั้นตอนที่มีเอกสารผูกอยู่ไม่ได้ (ข้อความเดิม) · ลบเอกสารก่อนแล้วลบได้', async () => {
    const h = setup();
    const { s1, d1 } = await makeFullTemplate(h);
    await expect(h.templates.removeState(s1.stateId)).rejects.toMatchObject({
      response: {
        code: 'TEMPLATE_STATE_HAS_DOCS',
        message: 'ไม่สามารถลบได้ ขั้นตอนนี้มีเอกสาร 1 รายการผูกอยู่ กรุณาลบเอกสารออกก่อน',
      },
    });
    await h.templates.removeDoc(d1.templateDocId);
    await h.templates.removeState(s1.stateId);
    expect(states(h).map((s) => s.stateName)).toEqual(['พิจารณา']);
  });

  it('ลบขั้นตอนที่โครงการสร้างมาจากมัน → 409', async () => {
    const h = setup();
    const { s2, d2 } = await makeFullTemplate(h);
    await h.templates.removeDoc(d2.templateDocId);
    const [p] = h.main.seed(Project, [
      { projectNo: 'P1', projectName: 'a', status: 'Open', active: 'Y', createUser: 'u' },
    ]);
    h.main.seed(ProjectState, [
      {
        projectId: p.projectId,
        stateId: s2.stateId,
        stateName: 'x',
        seqNo: 1,
        status: 'Pending',
        createUser: 'u',
      },
    ]);
    await expect(h.templates.removeState(s2.stateId)).rejects.toMatchObject({
      response: { code: 'TEMPLATE_STATE_IN_USE' },
    });
  });
});

describe('ProjectTemplatesService — copy-states', () => {
  it('แทนที่ขั้นตอนปลายทางด้วยสำเนาจากต้นทาง และลบเอกสารของปลายทาง (ไม่คัดลอกเอกสาร)', async () => {
    const h = setup();
    const src = await makeFullTemplate(h, 'SRC');
    const dst = await makeFullTemplate(h, 'DST');

    const count = await h.templates.copyStatesFrom(dst.t.templateId, src.t.templateId, admin);

    expect(count).toBe(2);
    const dstStates = states(h).filter((s) => s.templateId === dst.t.templateId);
    expect(dstStates.map((s) => [s.stateName, s.seqNo, s.required])).toEqual([
      ['ยื่นคำขอ', 1, 'Y'],
      ['พิจารณา', 2, 'N'],
    ]);
    expect(dstStates.some((s) => s.stateId === dst.s1.stateId)).toBe(false); // เป็นแถวใหม่
    expect(docs(h).filter((d) => d.templateId === dst.t.templateId)).toHaveLength(0);
    // ต้นทางไม่ถูกแตะ
    expect(states(h).filter((s) => s.templateId === src.t.templateId)).toHaveLength(2);
    expect(docs(h).filter((d) => d.templateId === src.t.templateId)).toHaveLength(2);
  });

  it('ต้นทาง = ปลายทาง / ไม่พบ → 422/404 และไม่ลบอะไร', async () => {
    const h = setup();
    const { t } = await makeFullTemplate(h);
    await expect(
      h.templates.copyStatesFrom(t.templateId, t.templateId, admin),
    ).rejects.toMatchObject({
      response: { code: 'COPY_SAME_TEMPLATE' },
    });
    await expect(h.templates.copyStatesFrom(t.templateId, 99, admin)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    expect(states(h)).toHaveLength(2);
  });

  it('ขั้นตอนปลายทางถูกโครงการอ้างอิง → 409 และขั้นตอน/เอกสารเดิมยังอยู่ครบ', async () => {
    const h = setup();
    const src = await makeFullTemplate(h, 'SRC');
    const dst = await makeFullTemplate(h, 'DST');
    const [p] = h.main.seed(Project, [
      { projectNo: 'P', projectName: 'p', status: 'Open', active: 'Y', createUser: 'u' },
    ]);
    h.main.seed(ProjectState, [
      {
        projectId: p.projectId,
        stateId: dst.s1.stateId,
        stateName: 'x',
        seqNo: 1,
        status: 'Pending',
        createUser: 'u',
      },
    ]);
    await expect(
      h.templates.copyStatesFrom(dst.t.templateId, src.t.templateId, admin),
    ).rejects.toMatchObject({
      response: { code: 'TEMPLATE_STATE_IN_USE' },
    });
    expect(docs(h).filter((d) => d.templateId === dst.t.templateId)).toHaveLength(2);
    expect(states(h).filter((s) => s.templateId === dst.t.templateId)).toHaveLength(2);
  });
});

describe('ProjectTemplatesService — เอกสารของ template', () => {
  it('คัดลอกชื่อ/รหัสเอกสารจากมาสเตอร์ (ฐาน BUI_RG) ตอนบันทึก', async () => {
    const h = setup();
    const { d1, s1 } = await makeFullTemplate(h);
    expect(d1).toMatchObject({
      stateId: s1.stateId,
      masterDocId: 1,
      name: 'หนังสือขออนุมัติ',
      docType: 'D-001',
      required: true,
      seqNo: 1,
    });
  });

  it('เอกสารซ้ำในขั้นตอนเดียวกัน → 409 · มาสเตอร์ไม่พบ → 422', async () => {
    const h = setup();
    const { s1 } = await makeFullTemplate(h);
    await expect(
      h.templates.createDoc(s1.stateId, { masterDocId: 1 }, admin),
    ).rejects.toMatchObject({
      response: {
        code: 'TEMPLATE_DOC_DUPLICATE',
        message: 'เอกสารนี้ถูก mapping กับขั้นตอนนี้ไว้แล้ว',
      },
    });
    await expect(
      h.templates.createDoc(s1.stateId, { masterDocId: 99 }, admin),
    ).rejects.toMatchObject({
      response: { code: 'MASTER_DOC_NOT_FOUND' },
    });
    await expect(h.templates.createDoc(999, { masterDocId: 2 }, admin)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('แก้ไข: เปลี่ยนมาสเตอร์ → ชื่อ/รหัส/i_doc_id ถูกอัปเดตพร้อมกัน (ระบบเดิมไม่แก้ i_doc_id) และตรวจซ้ำ', async () => {
    const h = setup();
    const { s1, d1 } = await makeFullTemplate(h);
    const d3 = await h.templates.createDoc(s1.stateId, { masterDocId: 2 }, admin);

    await expect(
      h.templates.updateDoc(d1.templateDocId, { masterDocId: 2 }, admin),
    ).rejects.toMatchObject({
      response: { code: 'TEMPLATE_DOC_DUPLICATE' },
    });

    await h.templates.removeDoc(d3.templateDocId);
    const updated = await h.templates.updateDoc(
      d1.templateDocId,
      { masterDocId: 2, required: false, seqNo: 4, remark: '  หมายเหตุ ' },
      admin,
    );
    expect(updated).toMatchObject({
      masterDocId: 2,
      name: 'รายงานผล',
      docType: 'D-002',
      required: false,
      seqNo: 4,
      remark: 'หมายเหตุ',
    });
  });
});

describe('ProjectTemplatesService.blueprint — แม่แบบสำหรับสร้างโครงการ', () => {
  it('คืน states/documents ในรูปแบบเดียวกับ body สร้างโครงการ (stateIndex ตามลำดับขั้นตอน)', async () => {
    const h = setup();
    const { t, s1, s2 } = await makeFullTemplate(h);
    await h.templates.updateState(s1.stateId, { seqNo: 2 });
    await h.templates.updateState(s2.stateId, { seqNo: 1 }); // สลับลำดับ

    const bp = await h.templates.blueprint(t.templateId);

    expect(bp.states.map((s) => [s.name, s.templateStateId, s.required])).toEqual([
      ['พิจารณา', s2.stateId, false],
      ['ยื่นคำขอ', s1.stateId, true],
    ]);
    expect(bp.documents.map((d) => [d.stateIndex, d.masterDocId, d.name, d.remark])).toEqual([
      [0, 2, 'รายงานผล', 'ต้องมี'],
      [1, 1, 'หนังสือขออนุมัติ', null],
    ]);
  });

  it('blueprint ที่ได้นำไปสร้างโครงการได้โดยตรง (ขั้นตอนอ้างกลับ template)', async () => {
    const h = setup();
    const { t, s1 } = await makeFullTemplate(h);
    const bp = await h.templates.blueprint(t.templateId);
    // สร้างโครงการด้วย service จริงต้องมีข้อมูลหลักอื่น — ตรวจแค่รูปร่างข้อมูลที่ส่งต่อได้
    expect(bp.states[0]).toEqual(
      expect.objectContaining({
        templateStateId: s1.stateId,
        name: 'ยื่นคำขอ',
        seqNo: 1,
        required: true,
      }),
    );
    expect(Object.keys(bp.documents[0]).sort()).toEqual(
      ['docType', 'masterDocId', 'name', 'remark', 'required', 'stateIndex'].sort(),
    );
  });
});
