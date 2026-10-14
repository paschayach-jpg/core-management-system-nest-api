import { AppRole } from '../../../src/common/constants/enums';
import {
  ConflictBusinessException,
  PermissionDeniedException,
} from '../../../src/common/exceptions/business.exception';
import { ProjectAuditLog } from '../../../src/modules/rgp/entities/project-audit-log.entity';
import { ProjectDocWorkflow } from '../../../src/modules/rgp/entities/project-doc-workflow.entity';
import { ProjectMemberRole } from '../../../src/modules/rgp/entities/project-member-role.entity';
import { ProjectMember } from '../../../src/modules/rgp/entities/project-member.entity';
import { ProjectProgress } from '../../../src/modules/rgp/entities/project-progress.entity';
import { ProjectState } from '../../../src/modules/rgp/entities/project-state.entity';
import { ProjectTemplate } from '../../../src/modules/rgp/entities/project-template.entity';
import { Project } from '../../../src/modules/rgp/entities/project.entity';
import { RunningNumber } from '../../../src/modules/rgp/entities/running-number.entity';
import type { CreateProjectDto } from '../../../src/modules/rgp/projects/dto/project.dto';
import { Employee } from '../../../src/modules/shared/entities/employee.entity';
import { HrDepartment } from '../../../src/modules/shared/entities/hr-department.entity';
import { fakeUser } from '../../helpers/stubs';
import { makeHarness, seedProject, seedRunningNumber, type Harness } from './helpers/harness';
import { MemoryManager, type EntityClass } from './helpers/memory-db';

const YY = String(new Date().getFullYear()).slice(-2);
const officer = fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });
const manager = fakeUser({ adUserName: 'boss', appRole: AppRole.Manager });

/** ข้อมูลหลักที่การสร้างโครงการต้องใช้ */
function setup(): Harness {
  const h = makeHarness({ user: officer });
  seedRunningNumber(h.project, { type: 'PRJ', current: 0 });
  h.main.seed(ProjectTemplate, [
    {
      templateCode: 'GEN',
      templateName: 'ทั่วไป',
      active: 'Y',
      isLegalDict: 'N',
      createUser: 'admin',
    },
    {
      templateCode: 'OLD',
      templateName: 'เลิกใช้',
      active: 'N',
      isLegalDict: 'N',
      createUser: 'admin',
    },
  ]);
  h.main.seed(ProjectMemberRole, [
    { roleName: 'ผู้ประสานงาน', active: 'Y' },
    { roleName: 'ที่ปรึกษา', active: 'N' },
  ]);
  h.main.seed(Employee, [
    { adUserName: 'somchai', fullNameTh: 'สมชาย ใจดี', isActive: true, isAnonymized: false },
    { adUserName: 'resigned', fullNameTh: 'ลาออก', isActive: false, isAnonymized: false },
  ]);
  h.main.seed(HrDepartment, [
    { departmentName: 'แผนกนโยบาย', departmentCode: 'D01', divisionId: 1, isActive: true },
  ]);
  return h;
}

const fullDto = (over: Partial<CreateProjectDto> = {}): CreateProjectDto => ({
  name: '  โครงการ A  ',
  templateId: 1,
  description: 'รายละเอียด',
  startDate: '2026-03-01',
  dueDate: '2026-04-30',
  states: [
    { name: 'ยื่นคำขอ', estimatedDays: 10, templateStateId: 11 },
    { name: 'พิจารณา', estimatedDays: 20, required: false },
  ],
  documents: [
    { stateIndex: 0, name: 'หนังสือขออนุมัติ', masterDocId: 5, docType: 'DOC-1' },
    { stateIndex: 1, name: 'รายงานผล' },
    { stateIndex: 0, name: 'สำเนาบัตร', required: false },
  ],
  members: [
    { memberType: 'Employee', adUserName: 'somchai', role: 'ผู้ประสานงาน' },
    { memberType: 'Department', orgId: 1, role: 'ผู้ประสานงาน' },
  ],
  ...over,
});

const stateRows = (h: Harness) => h.main.rows<ProjectState>(ProjectState);
const auditRows = (h: Harness) => h.main.rows<ProjectAuditLog>(ProjectAuditLog);
const runningCurrent = (h: Harness) =>
  h.project.rows<Record<string, unknown>>(RunningNumber)[0].currentNumber;

describe('ProjectsService.create — สร้างโครงการพร้อมลูกในคำขอเดียว', () => {
  it('ออกเลขอัตโนมัติ สถานะ Open และสร้างขั้นตอน/เอกสาร/บุคคลครบ พร้อมผูกเอกสารกับขั้นตอนตาม stateIndex', async () => {
    const h = setup();

    const detail = await h.projects.create(fullDto(), officer);

    expect(detail.projectNo).toBe(`PRJ-${YY}-000001`);
    expect(detail.status).toBe('Open');
    expect(detail.name).toBe('โครงการ A');
    expect(detail.templateName).toBe('ทั่วไป');
    expect(detail.createUser).toBe('somchai');
    expect(detail.startDate).toBe('2026-03-01');
    expect(detail.dueDate).toBe('2026-04-30');

    // ขั้นตอน: ลำดับ 1..n สถานะ Pending อ้างขั้นตอน template
    expect(detail.states.map((s) => [s.name, s.seqNo, s.status, s.required])).toEqual([
      ['ยื่นคำขอ', 1, 'Pending', true],
      ['พิจารณา', 2, 'Pending', false],
    ]);
    expect(detail.states[0].templateStateId).toBe(11);
    expect(detail.states[0].estimatedDays).toBe(10);

    // เอกสาร: ผูกกับขั้นตอนที่ถูกต้อง ลำดับต่อท้ายของแต่ละขั้นตอน สถานะเริ่ม Pending
    const [s1, s2] = detail.states;
    const docs = detail.documents.map((d) => [
      d.name,
      d.projStateId,
      d.seqNo,
      d.status,
      d.masterDocId,
    ]);
    expect(docs).toEqual([
      ['หนังสือขออนุมัติ', s1.projStateId, 1, 'Pending', 5],
      ['สำเนาบัตร', s1.projStateId, 2, 'Pending', null],
      ['รายงานผล', s2.projStateId, 1, 'Pending', null],
    ]);

    // บุคคล: ชื่อ/ประเภทอ่านจากฐานข้อมูล เก็บข้อความประเภทเดิมของระบบเก่า
    expect(
      detail.members.map((m) => [m.name, m.memberTypeName, m.memberType, m.departmentCode, m.role]),
    ).toEqual([
      ['somchai', 'พนักงาน', 'Employee', null, 'ผู้ประสานงาน'],
      ['แผนกนโยบาย', 'แผนก', 'Department', 'D01', 'ผู้ประสานงาน'],
    ]);
    expect(runningCurrent(h)).toBe('1');
  });

  it('ซ้อน transaction: ฐาน BUI_RG เปิดก่อนและ commit หลังสุด (เลขถูกล็อกจนโครงการ commit)', async () => {
    const h = setup();
    await h.projects.create(fullDto({ states: [], documents: [], members: [] }), officer);
    expect(h.tx.trace.filter((t) => !t.endsWith('main') || true)).toEqual([
      'begin:project',
      'begin:main',
      'commit:main',
      'commit:project',
    ]);
  });

  it('เลขอัตโนมัติรีเซ็ตเมื่อขึ้นปีใหม่ (ปีใน RunningNumber ≠ ปีปัจจุบัน)', async () => {
    const h = makeHarness({ user: officer });
    seedRunningNumber(h.project, { type: 'PRJ', current: 500, year: 1999 });
    const detail = await h.projects.create({ name: 'ปีใหม่' }, officer);
    expect(detail.projectNo).toBe(`PRJ-${YY}-000001`);
  });

  it('ระบุเลขที่เองได้ (ไม่แตะ RunningNumber) แต่ห้ามซ้ำกับโครงการที่ใช้งานอยู่ → 409 และไม่สร้างอะไร', async () => {
    const h = setup();
    seedProject(h, { projectNo: 'MY-001' });

    const ok = await h.projects.create({ name: 'ใหม่', projectNo: 'MY-002' }, officer);
    expect(ok.projectNo).toBe('MY-002');
    expect(runningCurrent(h)).toBe('0');

    await expect(
      h.projects.create({ name: 'ซ้ำ', projectNo: 'MY-001' }, officer),
    ).rejects.toBeInstanceOf(ConflictBusinessException);
    expect(h.main.rows(Project)).toHaveLength(2);
  });

  it('เลขอัตโนมัติชนกับเลขที่มีอยู่แล้ว (เช่น ออกซ้ำหลัง commit ล้ม) → ข้ามไปเลขถัดไป', async () => {
    const h = setup();
    seedProject(h, { projectNo: `PRJ-${YY}-000001` });
    const detail = await h.projects.create({ name: 'ข้ามเลข' }, officer);
    expect(detail.projectNo).toBe(`PRJ-${YY}-000002`);
    expect(runningCurrent(h)).toBe('2');
  });
});

describe('ProjectsService.create — ล้มกลางทาง = rollback ทั้งหมด', () => {
  it('บุคคลที่เกี่ยวข้องรายการสุดท้ายผิด → ไม่เหลือโครงการ/ขั้นตอน/เอกสาร/บุคคล และเลขที่รันไม่ถูกใช้', async () => {
    const h = setup();
    const bad = fullDto({
      members: [
        { memberType: 'Employee', adUserName: 'somchai', role: 'ผู้ประสานงาน' },
        { memberType: 'Employee', adUserName: 'ghost', role: 'ผู้ประสานงาน' }, // ไม่มีในระบบ
      ],
    });

    await expect(h.projects.create(bad, officer)).rejects.toMatchObject({
      response: { code: 'MEMBER_REF_NOT_FOUND' },
    });

    expect(h.main.rows(Project)).toHaveLength(0);
    expect(stateRows(h)).toHaveLength(0);
    expect(h.main.rows(ProjectDocWorkflow)).toHaveLength(0);
    expect(h.main.rows(ProjectMember)).toHaveLength(0);
    expect(runningCurrent(h)).toBe('0'); // ฝั่ง BUI_RG rollback ด้วย
    expect(h.tx.trace).toEqual([
      'begin:project',
      'begin:main',
      'rollback:main',
      'rollback:project',
    ]);
  });

  it.each([
    [
      'บทบาทที่ปิดใช้งาน',
      { memberType: 'Employee', adUserName: 'somchai', role: 'ที่ปรึกษา' },
      'MEMBER_ROLE_NOT_FOUND',
    ],
    [
      'พนักงานที่ลาออก (ไม่ active)',
      { memberType: 'Employee', adUserName: 'resigned', role: 'ผู้ประสานงาน' },
      'MEMBER_REF_NOT_FOUND',
    ],
    [
      'แผนกที่ไม่มี',
      { memberType: 'Department', orgId: 999, role: 'ผู้ประสานงาน' },
      'MEMBER_REF_NOT_FOUND',
    ],
  ] as const)('%s → 422 และ rollback', async (_name, member, code) => {
    const h = setup();
    await expect(
      h.projects.create(fullDto({ members: [{ ...member }] }), officer),
    ).rejects.toMatchObject({ response: { code } });
    expect(h.main.rows(Project)).toHaveLength(0);
    expect(runningCurrent(h)).toBe('0');
  });

  it('วันคาดการณ์รวมเกินช่วงวันของโครงการ → 422 ก่อนบันทึกอะไร', async () => {
    const h = setup();
    const dto = fullDto({
      startDate: '2026-03-01',
      dueDate: '2026-03-31',
      states: [
        { name: 'A', estimatedDays: 20 },
        { name: 'B', estimatedDays: 15 },
      ],
      documents: [],
      members: [],
    });
    await expect(h.projects.create(dto, officer)).rejects.toMatchObject({
      response: { code: 'STATE_DAYS_EXCEEDED' },
    });
    expect(h.main.rows(Project)).toHaveLength(0);
    expect(stateRows(h)).toHaveLength(0);
  });

  it('template ที่ปิดใช้งาน/ไม่มี → 422', async () => {
    const h = setup();
    await expect(h.projects.create({ name: 'x', templateId: 2 }, officer)).rejects.toMatchObject({
      response: { code: 'TEMPLATE_NOT_FOUND' },
    });
    await expect(h.projects.create({ name: 'x', templateId: 99 }, officer)).rejects.toMatchObject({
      response: { code: 'TEMPLATE_NOT_FOUND' },
    });
    expect(h.main.rows(Project)).toHaveLength(0);
  });

  it('stateIndex ของเอกสารไม่ตรงกับขั้นตอน และวันครบกำหนดก่อนวันเริ่ม → 422', async () => {
    const h = setup();
    await expect(
      h.projects.create(
        fullDto({
          states: [{ name: 'A' }],
          documents: [{ stateIndex: 3, name: 'd' }],
          members: [],
        }),
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'DOC_STATE_INDEX_INVALID' } });
    await expect(
      h.projects.create({ name: 'x', startDate: '2026-05-01', dueDate: '2026-04-01' }, officer),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DATE_RANGE' } });
  });
});

describe('ProjectsService — audit สองทาง (RGP.t_project_audit_log + CRUD-log)', () => {
  it('สร้างสำเร็จ: เขียน CREATE_PROJECT Result=1 ลง t_project_audit_log และ CRUD-log CREATE', async () => {
    const h = setup();
    const detail = await h.projects.create({ name: 'audit' }, officer);
    await h.crud.drain();

    expect(auditRows(h)).toEqual([
      expect.objectContaining({
        userId: 'somchai',
        module: 'Project',
        action: 'CREATE_PROJECT',
        tableName: 't_project',
        recordId: detail.projectId,
        result: 1,
      }),
    ]);
    const event = h.sink.events.find((e) => e.operation === 'CREATE_PROJECT')!;
    expect(event).toMatchObject({
      module: 'RGP',
      entity: 'Project',
      action: 'CREATE',
      recordId: detail.projectId,
      success: true,
    });
    expect(event.after).toMatchObject({ projectNo: detail.projectNo, states: 0 });
  });

  it('สร้างล้มเหลว: rollback แต่ยังเหลือแถว CREATE_PROJECT_FAILED Result=2 พร้อมข้อความ และ CRUD-log success=false', async () => {
    const h = setup();
    await h.projects.create({ name: 'x', templateId: 2 }, officer).catch(() => undefined);
    await h.crud.drain();

    expect(h.main.rows(Project)).toHaveLength(0);
    expect(auditRows(h)).toEqual([
      expect.objectContaining({
        action: 'CREATE_PROJECT_FAILED',
        tableName: 't_project',
        recordId: null,
        result: 2,
        message: expect.stringContaining('Template'),
      }),
    ]);
    expect(h.sink.events.find((e) => e.operation === 'CREATE_PROJECT')).toMatchObject({
      success: false,
      errorCode: 'HTTP_422',
    });
  });

  it('แถว audit สำเร็จอยู่ใน transaction เดียวกับงาน: เขียน audit ไม่ได้ → งานทั้งก้อน rollback', async () => {
    const h = setup();
    const insert = jest
      .spyOn(MemoryManager.prototype, 'insert')
      .mockImplementation(async (entity: EntityClass) => {
        if (entity === ProjectAuditLog) throw new Error('เขียน audit ไม่ได้');
        return { identifiers: [] };
      });
    try {
      await expect(h.projects.create({ name: 'x' }, officer)).rejects.toThrow('เขียน audit ไม่ได้');
    } finally {
      insert.mockRestore();
    }
    expect(h.main.rows(Project)).toHaveLength(0);
    expect(runningCurrent(h)).toBe('0');
    // แถวล้มเหลวเขียนแยก connection (repo.insert) จึงยังอยู่
    expect(auditRows(h).map((a) => a.action)).toEqual(['CREATE_PROJECT_FAILED']);
  });
});

describe('ProjectsService.update', () => {
  it('แก้เฉพาะฟิลด์ที่ส่ง (PATCH) · null ล้มค่า · เขียน UPDATE_PROJECT', async () => {
    const h = setup();
    const { project } = seedProject(h, { startDate: '2026-03-01', dueDate: '2026-04-30' });
    h.main.rows<Project>(Project)[0].description = 'เดิม';

    const detail = await h.projects.update(
      project.projectId,
      { name: '  ชื่อใหม่ ', dueDate: null, templateId: 1 },
      officer,
    );

    expect(detail.name).toBe('ชื่อใหม่');
    expect(detail.dueDate).toBeNull();
    expect(detail.startDate).toBe('2026-03-01'); // ไม่ส่ง = ไม่เปลี่ยน
    expect(detail.description).toBe('เดิม');
    expect(detail.templateId).toBe(1);
    expect(detail.updateUser).toBe('somchai');
    expect(auditRows(h).map((a) => [a.action, a.result])).toEqual([['UPDATE_PROJECT', 1]]);
  });

  it('วันครบกำหนดก่อนวันเริ่ม (รวมค่าเดิมในฐานข้อมูล) → 422', async () => {
    const h = setup();
    const { project } = seedProject(h, { startDate: '2026-03-10', dueDate: '2026-04-30' });
    await expect(
      h.projects.update(project.projectId, { dueDate: '2026-03-01' }, officer),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DATE_RANGE' } });
  });

  it('โครงการที่ถูกลบแล้ว → 404 และบันทึก UPDATE_PROJECT_FAILED', async () => {
    const h = setup();
    const { project } = seedProject(h);
    h.main.rows<Project>(Project)[0].active = 'N';
    await expect(
      h.projects.update(project.projectId, { name: 'x' }, officer),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    expect(auditRows(h).map((a) => [a.action, a.result])).toEqual([['UPDATE_PROJECT_FAILED', 2]]);
  });
});

describe('ProjectsService.remove — ลบแบบ soft และถูกบล็อกเมื่อมีความคืบหน้า', () => {
  it('มี state ที่เลย Pending ไปแล้ว → 422 PROJECT_HAS_PROGRESS โครงการยังอยู่', async () => {
    const h = setup();
    const { project } = seedProject(h, {
      states: [{ name: 'A', status: 'InProgress' }, { name: 'B' }],
    });

    await expect(h.projects.remove(project.projectId, officer)).rejects.toMatchObject({
      response: {
        code: 'PROJECT_HAS_PROGRESS',
        message: 'ไม่สามารถลบโครงการได้ เนื่องจากมีการอัปเดตความคืบหน้าแล้ว',
      },
    });
    const row = h.main.rows<Project>(Project)[0];
    expect(row.active).toBe('Y');
    expect(row.status).toBe('Open');
    expect(auditRows(h).map((a) => a.action)).toEqual(['DELETE_PROJECT_FAILED']);
  });

  it('ทุก state ยัง Pending → soft delete: f_active=N, สถานะ Cancelled, audit DELETE_PROJECT และ CRUD-log DELETE', async () => {
    const h = setup();
    const { project } = seedProject(h, { states: [{ name: 'A' }] });

    await h.projects.remove(project.projectId, officer);
    await h.crud.drain();

    const row = h.main.rows<Project>(Project)[0];
    expect(row.active).toBe('N');
    expect(row.status).toBe('Cancelled');
    expect(row.updateUser).toBe('somchai');
    expect(auditRows(h)[0]).toMatchObject({
      action: 'DELETE_PROJECT',
      result: 1,
      recordId: project.projectId,
    });
    expect(h.sink.events.find((e) => e.operation === 'DELETE_PROJECT')).toMatchObject({
      action: 'DELETE',
      success: true,
      recordId: project.projectId,
    });
    // ลูก ๆ ไม่ถูกลบ (soft delete เฉพาะหัวโครงการ)
    expect(stateRows(h)).toHaveLength(1);
    // โครงการที่ถูกลบมองไม่เห็นอีก
    await expect(h.projects.getDetail(project.projectId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('เจ้าของโครงการคนอื่นลบไม่ได้ (403) · Manager ขึ้นไปลบได้', async () => {
    const h = setup();
    const { project } = seedProject(h, { createUser: 'other.user' });

    await expect(h.projects.remove(project.projectId, officer)).rejects.toBeInstanceOf(
      PermissionDeniedException,
    );
    expect(h.main.rows<Project>(Project)[0].active).toBe('Y');

    await h.projects.remove(project.projectId, manager);
    expect(h.main.rows<Project>(Project)[0].active).toBe('N');
  });

  it('ไม่พบโครงการ → 404', async () => {
    const h = setup();
    await expect(h.projects.remove(999, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});

describe('ProjectsService.close — ปิดโครงการ', () => {
  it('ยังมี required state ที่ไม่ Completed → 422 และรายชื่อขั้นตอนที่ค้าง', async () => {
    const h = setup();
    const { project } = seedProject(h, {
      states: [
        { name: 'A', status: 'Completed' },
        { name: 'B', status: 'InProgress' },
        { name: 'C', status: 'Pending', required: false },
      ],
    });
    await expect(h.projects.close(project.projectId, manager)).rejects.toMatchObject({
      response: {
        code: 'REQUIRED_STATES_INCOMPLETE',
        message: 'ยังมีขั้นตอนที่จำเป็น (Required) ยังไม่เสร็จสมบูรณ์',
        details: { pendingStates: ['B'] },
      },
    });
    expect(h.main.rows<Project>(Project)[0].status).toBe('Open');
  });

  it('required ครบ → Completed + วันที่ปิด + audit CLOSE_PROJECT · ปิดซ้ำ → 409', async () => {
    const h = setup();
    const { project } = seedProject(h, {
      states: [
        { name: 'A', status: 'Completed' },
        { name: 'B', status: 'Pending', required: false },
      ],
    });

    const result = await h.projects.close(project.projectId, manager);

    expect(result).toEqual({ projectId: project.projectId, status: 'Completed' });
    const row = h.main.rows<Project>(Project)[0];
    expect(row.status).toBe('Completed');
    expect(row.closeDate).toBeInstanceOf(Date);
    expect(auditRows(h).map((a) => [a.action, a.result, a.userId])).toEqual([
      ['CLOSE_PROJECT', 1, 'boss'],
    ]);
    await expect(h.projects.close(project.projectId, manager)).rejects.toBeInstanceOf(
      ConflictBusinessException,
    );
  });
});

describe('ProjectsService.recalculateStatus', () => {
  it('คำนวณสถานะใหม่จากสถานะ state ที่เก็บไว้', async () => {
    const h = setup();
    const { project } = seedProject(h, {
      states: [
        { name: 'A', status: 'Completed' },
        { name: 'B', status: 'InProgress' },
      ],
    });
    expect(await h.projects.recalculateStatus(project.projectId, officer)).toEqual({
      projectId: project.projectId,
      status: 'InProgress',
    });
    expect(h.main.rows<Project>(Project)[0].status).toBe('InProgress');
  });
});

describe('ProjectsService.getDetail / list / อื่นๆ', () => {
  it('detail รวม % รวมของโครงการจากความคืบหน้าล่าสุดของแต่ละขั้นตอน', async () => {
    const h = setup();
    const { project, states } = seedProject(h, { states: [{ name: 'A' }, { name: 'B' }] });
    h.main.seed(ProjectProgress, [
      {
        projStateId: states[0].projStateId,
        projectId: project.projectId,
        status: 'InProgress',
        pctComplete: 30,
        actionUser: 'u',
        actionDate: new Date(),
      },
      {
        projStateId: states[0].projStateId,
        projectId: project.projectId,
        status: 'InProgress',
        pctComplete: 80,
        actionUser: 'u',
        actionDate: new Date(),
      },
    ]);
    const detail = await h.projects.getDetail(project.projectId);
    expect(detail.states[0].pctComplete).toBe(80); // progress ล่าสุด (id มากสุด)
    expect(detail.pctOverall).toBe(40); // (80 + 0) / 2
  });

  it('checkProjectNo ตรวจเฉพาะโครงการที่ใช้งานอยู่', async () => {
    const h = setup();
    seedProject(h, { projectNo: 'A-1' });
    seedProject(h, { projectNo: 'A-2' });
    h.main.rows<Project>(Project)[1].active = 'N';
    expect(await h.projects.checkProjectNo(' A-1 ')).toEqual({ projectNo: 'A-1', exists: true });
    expect(await h.projects.checkProjectNo('A-2')).toEqual({ projectNo: 'A-2', exists: false });
  });

  it('list: SQL ใช้พารามิเตอร์ (LIKE ... ESCAPE) แบ่งหน้า OFFSET/FETCH และ sort ตาม whitelist เท่านั้น', async () => {
    const h = setup();
    const queries: { sql: string; params: unknown[] }[] = [];
    h.main.onQuery = (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT COUNT(*) AS total')) return [{ total: 45 }];
      return [
        {
          projectId: 1,
          projectNo: 'P',
          name: 'n',
          templateId: null,
          templateName: '-',
          status: 'Open',
          startDate: new Date(2026, 2, 1),
          dueDate: null,
          createUser: 'u',
          createDate: new Date(),
          totalStates: '3',
          completedStates: '1',
          pctOverall: '33',
        },
      ];
    };
    const q = Object.assign(
      new (await import('../../../src/modules/rgp/projects/dto/project.dto')).ProjectListQueryDto(),
      {
        page: 3,
        pageSize: 20,
        projectNo: "50%_'; DROP TABLE x;--",
        status: 'Open',
        templateId: 2,
        createdFrom: '2026-01-01',
        sortBy: 'pctOverall; DROP TABLE t_project',
        sortDir: 'desc' as const,
      },
    );

    const page = await h.projects.list(q);

    expect(page).toMatchObject({ total: 45, page: 3, pageSize: 20 });
    expect(page.items[0]).toMatchObject({
      startDate: '2026-03-01',
      totalStates: 3,
      pctOverall: 33,
    });
    const select = queries[1];
    expect(select.sql).not.toContain('DROP TABLE'); // ค่าของผู้ใช้ไม่ถูก concat
    expect(select.sql).toContain("ESCAPE '\\'");
    expect(select.sql).toMatch(/OFFSET @\d+ ROWS FETCH NEXT @\d+ ROWS ONLY/);
    expect(select.sql).toContain('ORDER BY p.d_create_date DESC'); // sortBy นอก whitelist → ค่าเริ่มต้น
    expect(select.params).toContain("%50\\%\\_'; DROP TABLE x;--%");
    expect(select.params.slice(-2)).toEqual([40, 20]); // OFFSET (3-1)*20, FETCH 20
  });

  it('list: sortBy ที่อยู่ใน whitelist ใช้ได้', async () => {
    const h = setup();
    const seen: string[] = [];
    h.main.onQuery = (sql) => {
      seen.push(sql);
      return sql.startsWith('SELECT COUNT(*) AS total') ? [{ total: 0 }] : [];
    };
    const { ProjectListQueryDto } =
      await import('../../../src/modules/rgp/projects/dto/project.dto');
    await h.projects.list(
      Object.assign(new ProjectListQueryDto(), { sortBy: 'projectNo', sortDir: 'asc' as const }),
    );
    expect(seen[1]).toContain('ORDER BY p.c_project_no ASC');
  });
});

describe('ProjectsService.updateLegalDict', () => {
  it('เฉพาะโครงการที่ template เป็นพจนานุกรมกฎหมาย และต้องเป็น JSON ที่ถูกต้อง', async () => {
    const h = setup();
    h.main.seed(ProjectTemplate, [
      {
        templateCode: 'LD',
        templateName: 'พจนานุกรม',
        active: 'Y',
        isLegalDict: 'Y',
        createUser: 'a',
      },
    ]);
    const normal = seedProject(h, { projectNo: 'N-1', templateId: 1 });
    const legal = seedProject(h, { projectNo: 'L-1', templateId: 3 });

    await expect(
      h.projects.updateLegalDict(normal.project.projectId, { json: '{}' }, officer),
    ).rejects.toMatchObject({ response: { code: 'NOT_LEGAL_DICT_PROJECT' } });
    await expect(
      h.projects.updateLegalDict(legal.project.projectId, { json: '{ไม่ใช่ json' }, officer),
    ).rejects.toMatchObject({ response: { code: 'INVALID_JSON' } });

    await h.projects.updateLegalDict(
      legal.project.projectId,
      { json: '{"title":"พ.ร.บ."}' },
      officer,
    );
    expect(h.main.rows<Project>(Project)[1].legalDictJson).toBe('{"title":"พ.ร.บ."}');
    await h.projects.updateLegalDict(legal.project.projectId, { json: null }, officer);
    expect(h.main.rows<Project>(Project)[1].legalDictJson).toBeNull();
  });

  it('CRUD-log ไม่เก็บเนื้อหา JSON (เก็บเฉพาะความยาว)', async () => {
    const h = setup();
    h.main.seed(ProjectTemplate, [
      {
        templateCode: 'LD',
        templateName: 'พจนานุกรม',
        active: 'Y',
        isLegalDict: 'Y',
        createUser: 'a',
      },
    ]);
    const legal = seedProject(h, { templateId: 3 });
    await h.projects.updateLegalDict(legal.project.projectId, { json: '{"secret":"x"}' }, officer);
    await h.crud.drain();
    const ev = h.sink.events.find((e) => e.operation === 'UPDATE_LEGAL_DICT_JSON')!;
    expect(JSON.stringify(ev)).not.toContain('secret');
    expect(ev.meta).toMatchObject({ length: 14 });
  });
});
