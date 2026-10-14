import { AppRole } from '../../../src/common/constants/enums';
import { ProjectDocWorkflow } from '../../../src/modules/rgp/entities/project-doc-workflow.entity';
import { ProjectMemberRole } from '../../../src/modules/rgp/entities/project-member-role.entity';
import { ProjectMember } from '../../../src/modules/rgp/entities/project-member.entity';
import { Project } from '../../../src/modules/rgp/entities/project.entity';
import { Employee } from '../../../src/modules/shared/entities/employee.entity';
import { HrDepartment } from '../../../src/modules/shared/entities/hr-department.entity';
import { HrDivision } from '../../../src/modules/shared/entities/hr-division.entity';
import { SubCommittee } from '../../../src/modules/shared/entities/sub-committee.entity';
import { fakeUser } from '../../helpers/stubs';
import { makeHarness, seedProject, type Harness } from './helpers/harness';

const officer = fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });

describe('ProjectDocumentsService', () => {
  const setup = () => {
    const h = makeHarness({ user: officer });
    const seeded = seedProject(h, { states: [{ name: 'A' }, { name: 'B' }] });
    return { h, ...seeded };
  };
  const docs = (h: Harness) => h.main.rows<ProjectDocWorkflow>(ProjectDocWorkflow);

  it('เพิ่มเอกสารต่อท้ายของขั้นตอน: ลำดับ MAX+1 ต่อขั้นตอน สถานะ Pending', async () => {
    const { h, states } = setup();
    const a1 = await h.documents.create(
      states[0].projStateId,
      { name: ' ใบสมัคร ', docType: 'F-01' },
      officer,
    );
    const a2 = await h.documents.create(
      states[0].projStateId,
      { name: 'สำเนา', required: false },
      officer,
    );
    const b1 = await h.documents.create(
      states[1].projStateId,
      { name: 'รายงาน', masterDocId: 7 },
      officer,
    );

    expect([a1.seqNo, a2.seqNo, b1.seqNo]).toEqual([1, 2, 1]);
    expect(a1).toMatchObject({
      name: 'ใบสมัคร',
      docType: 'F-01',
      status: 'Pending',
      required: true,
      stateName: 'A',
    });
    expect(a2.required).toBe(false);
    expect(b1.masterDocId).toBe(7);
    expect(docs(h)[0].createUser).toBe('somchai');
  });

  it('เพิ่มในขั้นตอนของโครงการที่ถูกลบ → 404', async () => {
    const { h, states } = setup();
    h.main.rows<Project>(Project)[0].active = 'N';
    await expect(
      h.documents.create(states[0].projStateId, { name: 'x' }, officer),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('แก้ไข/เปลี่ยนสถานะ/ลบ และ CRUD-log ถูกเขียน', async () => {
    const { h, states } = setup();
    const d = await h.documents.create(states[0].projStateId, { name: 'เอกสาร' }, officer);

    const updated = await h.documents.update(
      d.docWfId,
      { name: 'ชื่อใหม่', status: 'Received', remark: ' หมายเหตุ ' },
      officer,
    );
    expect(updated).toMatchObject({
      name: 'ชื่อใหม่',
      status: 'Received',
      remark: 'หมายเหตุ',
      updateUser: 'somchai',
    });

    const verified = await h.documents.updateStatus(d.docWfId, { status: 'Verified' }, officer);
    expect(verified.status).toBe('Verified');

    await h.documents.remove(d.docWfId);
    expect(docs(h)).toHaveLength(0);
    await expect(h.documents.get(d.docWfId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    await h.crud.drain();
    expect(h.sink.events.map((e) => [e.entity, e.action, e.operation, e.success])).toEqual([
      ['ProjectDocWorkflow', 'CREATE', 'ADD_PROJECT_DOC', true],
      ['ProjectDocWorkflow', 'UPDATE', 'UPDATE_PROJECT_DOC', true],
      ['ProjectDocWorkflow', 'UPDATE', 'UPDATE_PROJECT_DOC_STATUS', true],
      ['ProjectDocWorkflow', 'DELETE', 'DELETE_PROJECT_DOC', true],
    ]);
  });

  it('ย้ายเอกสารไปขั้นตอนอื่นของโครงการเดียวกัน → ต่อท้ายขั้นตอนใหม่ · ข้ามโครงการไม่ได้', async () => {
    const { h, states } = setup();
    const d = await h.documents.create(states[0].projStateId, { name: 'ย้าย' }, officer);
    await h.documents.create(states[1].projStateId, { name: 'อยู่ก่อน' }, officer);

    const moved = await h.documents.update(
      d.docWfId,
      { projStateId: states[1].projStateId },
      officer,
    );
    expect(moved).toMatchObject({ projStateId: states[1].projStateId, seqNo: 2, stateName: 'B' });

    const other = seedProject(h, { projectNo: 'OTHER', states: [{ name: 'X' }] });
    await expect(
      h.documents.update(d.docWfId, { projStateId: other.states[0].projStateId }, officer),
    ).rejects.toMatchObject({ response: { code: 'DOC_STATE_OTHER_PROJECT' } });
  });

  it('listByProject เรียงตามลำดับขั้นตอน แล้วลำดับเอกสาร', async () => {
    const { h, project, states } = setup();
    await h.documents.create(states[1].projStateId, { name: 'B1' }, officer);
    await h.documents.create(states[0].projStateId, { name: 'A1' }, officer);
    await h.documents.create(states[0].projStateId, { name: 'A2' }, officer);
    const list = await h.documents.listByProject(project.projectId);
    expect(list.map((d) => d.name)).toEqual(['A1', 'A2', 'B1']);
  });
});

describe('ProjectMembersService — บุคคลที่เกี่ยวข้องของโครงการ', () => {
  const setup = () => {
    const h = makeHarness({ user: officer });
    const seeded = seedProject(h);
    h.main.seed(ProjectMemberRole, [
      { roleName: 'ผู้ประสานงาน', active: 'Y' },
      { roleName: 'เลิกใช้', active: 'N' },
    ]);
    h.main.seed(Employee, [
      { adUserName: 'somchai', isActive: true, isAnonymized: false },
      { adUserName: 'anon', isActive: true, isAnonymized: true },
    ]);
    h.main.seed(SubCommittee, [
      {
        subCommitteeNameTh: 'คณะกรรมการ A',
        subCommitteeCode: 'SC1',
        isActive: true,
        isDeleted: false,
      },
      {
        subCommitteeNameTh: 'คณะที่ถูกลบ',
        subCommitteeCode: 'SC2',
        isActive: true,
        isDeleted: true,
      },
    ]);
    h.main.seed(HrDivision, [{ divisionName: 'ฝ่าย ก', divisionCode: 'DV1', isActive: true }]);
    h.main.seed(HrDepartment, [
      { departmentName: 'แผนก ข', departmentCode: 'DP1', divisionId: 1, isActive: true },
    ]);
    return { h, ...seeded };
  };

  it.each([
    [
      'SubCommittee',
      { memberType: 'SubCommittee', orgId: 1 },
      ['คณะกรรมการ A', 'คณะกรรมการ', null],
    ],
    ['Division', { memberType: 'Division', orgId: 1 }, ['ฝ่าย ก', 'ฝ่าย', 'DV1']],
    ['Department', { memberType: 'Department', orgId: 1 }, ['แผนก ข', 'แผนก', 'DP1']],
    ['Employee', { memberType: 'Employee', adUserName: 'somchai' }, ['somchai', 'พนักงาน', null]],
  ] as const)(
    'ประเภท %s: ชื่อ/รหัสอ่านจากฐานข้อมูล เก็บข้อความประเภทเดิม',
    async (_n, ref, [name, label, code]) => {
      const { h, project } = setup();
      const m = await h.members.add(project.projectId, { ...ref, role: 'ผู้ประสานงาน' }, officer);
      expect([m.name, m.memberTypeName, m.departmentCode]).toEqual([name, label, code]);
      expect(h.main.rows<ProjectMember>(ProjectMember)[0]).toMatchObject({
        memberName: name,
        memberType: label,
        role: 'ผู้ประสานงาน',
        createUser: 'somchai',
      });
    },
  );

  it.each([
    ['คณะที่ถูกลบ', { memberType: 'SubCommittee', orgId: 2 }],
    ['พนักงานที่ถูก anonymize', { memberType: 'Employee', adUserName: 'anon' }],
    ['ไม่ส่ง orgId', { memberType: 'Division' }],
    ['ไม่ส่งชื่อผู้ใช้', { memberType: 'Employee' }],
  ] as const)('%s → 422 MEMBER_REF_NOT_FOUND', async (_n, ref) => {
    const { h, project } = setup();
    await expect(
      h.members.add(project.projectId, { ...ref, role: 'ผู้ประสานงาน' }, officer),
    ).rejects.toMatchObject({ response: { code: 'MEMBER_REF_NOT_FOUND' } });
  });

  it('บทบาทต้องเป็นบทบาทที่เปิดใช้งาน', async () => {
    const { h, project } = setup();
    await expect(
      h.members.add(
        project.projectId,
        { memberType: 'Division', orgId: 1, role: 'เลิกใช้' },
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'MEMBER_ROLE_NOT_FOUND' } });
    await expect(
      h.members.add(
        project.projectId,
        { memberType: 'Division', orgId: 1, role: 'ไม่มีบทบาทนี้' },
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'MEMBER_ROLE_NOT_FOUND' } });
  });

  it('ลบสมาชิก · ไม่พบ → 404 · โครงการที่ถูกลบเพิ่มสมาชิกไม่ได้', async () => {
    const { h, project } = setup();
    const m = await h.members.add(
      project.projectId,
      { memberType: 'Division', orgId: 1, role: 'ผู้ประสานงาน' },
      officer,
    );
    await h.members.remove(m.memberId);
    expect(await h.members.listByProject(project.projectId)).toEqual([]);
    await expect(h.members.remove(m.memberId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });

    h.main.rows<Project>(Project)[0].active = 'N';
    await expect(
      h.members.add(
        project.projectId,
        { memberType: 'Division', orgId: 1, role: 'ผู้ประสานงาน' },
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });
});

describe('MemberRolesService — บทบาท (ข้อมูลหลัก)', () => {
  it('เพิ่ม/แก้/ปิดใช้งาน/ลบ · activeOnly กรองเฉพาะที่เปิด · ชื่อซ้ำ → 409', async () => {
    const h = makeHarness({ user: officer });
    const a = await h.roles.create({ name: '  ผู้ประสานงาน ' }, officer);
    const b = await h.roles.create({ name: 'ที่ปรึกษา' }, officer);
    expect(a).toMatchObject({ name: 'ผู้ประสานงาน', active: true, createUser: 'somchai' });

    await expect(h.roles.create({ name: 'ที่ปรึกษา' }, officer)).rejects.toMatchObject({
      response: { code: 'ROLE_NAME_DUPLICATE' },
    });

    const renamed = await h.roles.update(
      b.roleId,
      { name: 'ที่ปรึกษาอาวุโส', active: false },
      officer,
    );
    expect(renamed).toMatchObject({
      name: 'ที่ปรึกษาอาวุโส',
      active: false,
      updateUser: 'somchai',
    });
    await expect(h.roles.update(b.roleId, { name: 'ผู้ประสานงาน' }, officer)).rejects.toMatchObject(
      {
        response: { code: 'ROLE_NAME_DUPLICATE' },
      },
    );
    // เปลี่ยนเป็นชื่อตัวเองไม่ถือว่าซ้ำ
    await expect(
      h.roles.update(a.roleId, { name: 'ผู้ประสานงาน' }, officer),
    ).resolves.toBeDefined();

    expect((await h.roles.list(true)).map((r) => r.name)).toEqual(['ผู้ประสานงาน']);
    expect((await h.roles.list()).map((r) => r.name)).toEqual(['ผู้ประสานงาน', 'ที่ปรึกษาอาวุโส']);

    await h.roles.remove(a.roleId);
    expect((await h.roles.list()).map((r) => r.name)).toEqual(['ที่ปรึกษาอาวุโส']);
    await expect(h.roles.remove(a.roleId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});
