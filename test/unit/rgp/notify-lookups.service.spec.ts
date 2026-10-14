import { AppRole } from '../../../src/common/constants/enums';
import { Employee } from '../../../src/modules/shared/entities/employee.entity';
import { HrDepartment } from '../../../src/modules/shared/entities/hr-department.entity';
import { HrDivision } from '../../../src/modules/shared/entities/hr-division.entity';
import { SubCommittee } from '../../../src/modules/shared/entities/sub-committee.entity';
import { UserAccount } from '../../../src/modules/shared/entities/user-account.entity';
import { MasterDocumentType } from '../../../src/modules/rgp/entities/master-document-type.entity';
import { MasterDocument } from '../../../src/modules/rgp/entities/master-document.entity';
import { ProjectNotifyLog } from '../../../src/modules/rgp/entities/project-notify-log.entity';
import { ProjectStateMember } from '../../../src/modules/rgp/entities/project-state-member.entity';
import { ProjectTask } from '../../../src/modules/rgp/entities/project-task.entity';
import { RgpLookupsService } from '../../../src/modules/rgp/lookups/rgp-lookups.service';
import { fakeUser, makeCrudLog } from '../../helpers/stubs';
import { MemoryDb } from './helpers/memory-db';
import { makeHarness, seedProject, seedRunningNumber } from './helpers/harness';

const officer = fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });

function setup() {
  const send = jest.fn(async (_input: unknown) => undefined);
  const h = makeHarness({ user: officer, notifications: { send } });
  seedRunningNumber(h.project, { type: 'TK', current: 0 });
  const { project, states } = seedProject(h, { states: [{ name: 'ขั้นตอนอนุมัติ' }] });
  const [member, deptMember] = h.main.seed(ProjectStateMember, [
    {
      projStateId: states[0].projStateId,
      projectId: project.projectId,
      memberName: 'somchai',
      role: 'ผู้ประสานงาน',
      memberType: 'พนักงาน',
      createUser: 'u',
    },
    {
      projStateId: states[0].projStateId,
      projectId: project.projectId,
      memberName: 'แผนก ก',
      role: 'ผู้ประสานงาน',
      memberType: 'แผนก',
      createUser: 'u',
    },
  ]);
  h.main.seed(UserAccount, [{ userId: 77, adUserName: 'somchai', isActive: true }]);
  return { h, send, project, state: states[0], member, deptMember };
}

describe('StateNotifyService — ส่งแจ้งเตือนผู้เกี่ยวข้องของขั้นตอน', () => {
  it('ครั้งแรก: สร้าง Task ติดตาม "ติดตาม - <ชื่อขั้นตอน>" มอบหมายให้ผู้รับ + ส่งแจ้งเตือน + บันทึกประวัติ', async () => {
    const { h, send, project, state, member } = setup();

    const r = await h.notify.notify(member.stateMemberId, officer);

    expect(r).toMatchObject({ sent: true, taskCreated: true, message: null });
    const task = h.main.rows<ProjectTask>(ProjectTask)[0];
    expect(task).toMatchObject({
      title: 'ติดตาม - ขั้นตอนอนุมัติ',
      assignee: 'somchai',
      projStateId: state.projStateId,
      status: 'Todo',
    });
    expect(r.taskId).toBe(task.taskId);
    expect(send).toHaveBeenCalledWith({
      recipientUserId: 77,
      eventType: 'ProjectStateAssigned',
      relatedEntityId: state.projStateId,
      messageText:
        "คุณได้รับงานสำหรับขั้นตอน 'ขั้นตอนอนุมัติ' ในโครงการ 'โครงการทดสอบ' กรุณาดำเนินการ",
    });
    expect(h.main.rows<ProjectNotifyLog>(ProjectNotifyLog)).toEqual([
      expect.objectContaining({
        projectId: project.projectId,
        projStateId: state.projStateId,
        stateMemberId: member.stateMemberId,
        recipientName: 'somchai',
        taskId: task.taskId,
        taskCreated: 'Y',
        apiResult: 'Success',
        sendUser: 'somchai',
      }),
    ]);
  });

  it('ครั้งถัดไป: ใช้ Task เดิม ไม่สร้างซ้ำ และบันทึกประวัติเพิ่ม (นับจำนวนครั้ง)', async () => {
    const { h, state, member } = setup();
    const first = await h.notify.notify(member.stateMemberId, officer);
    const second = await h.notify.notify(member.stateMemberId, officer);

    expect(second).toMatchObject({ sent: true, taskCreated: false, taskId: first.taskId });
    expect(h.main.rows(ProjectTask)).toHaveLength(1);
    const list = await h.stateMembers.listByState(state.projStateId);
    expect(list.find((m) => m.name === 'somchai')!.notifyCount).toBe(2);
    expect(h.main.rows<ProjectNotifyLog>(ProjectNotifyLog).map((l) => l.taskCreated)).toEqual([
      'Y',
      'N',
    ]);
  });

  it('เฉพาะสมาชิกประเภทพนักงาน — ประเภทอื่น 422 และไม่สร้าง Task/ไม่ส่ง', async () => {
    const { h, send, deptMember } = setup();
    await expect(h.notify.notify(deptMember.stateMemberId, officer)).rejects.toMatchObject({
      response: { code: 'NOTIFY_EMPLOYEE_ONLY' },
    });
    expect(h.main.rows(ProjectTask)).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('ผู้รับไม่มีบัญชีผู้ใช้ในระบบ → ไม่ส่ง บันทึกประวัติ Failed พร้อมเหตุผล (Task ติดตามยังถูกสร้างเหมือนระบบเดิม)', async () => {
    const { h, send, member } = setup();
    h.main.rows<UserAccount>(UserAccount)[0].isActive = false;

    const r = await h.notify.notify(member.stateMemberId, officer);

    expect(r.sent).toBe(false);
    expect(r.message).toContain('ไม่พบบัญชีผู้ใช้');
    expect(send).not.toHaveBeenCalled();
    expect(h.main.rows<ProjectNotifyLog>(ProjectNotifyLog)[0]).toMatchObject({
      apiResult: 'Failed',
      taskCreated: 'Y',
    });
  });

  it('สมาชิกไม่พบ → 404', async () => {
    const { h } = setup();
    await expect(h.notify.notify(999, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});

describe('RgpLookupsService', () => {
  function make() {
    const main = new MemoryDb();
    const project = new MemoryDb();
    const { service: crud } = makeCrudLog();
    const svc = new RgpLookupsService(
      crud,
      main.repo(Employee) as never,
      main.repo(SubCommittee) as never,
      main.repo(HrDivision) as never,
      main.repo(HrDepartment) as never,
      project.repo(MasterDocument) as never,
      project.repo(MasterDocumentType) as never,
    );
    return { main, project, svc };
  }

  it('พนักงาน: เฉพาะที่ทำงานอยู่ ไม่ anonymize มีชื่อผู้ใช้ AD · ค้นด้วย q ไม่สนตัวพิมพ์', async () => {
    const { main, svc } = make();
    main.seed(Employee, [
      { adUserName: 'somchai', fullNameTh: 'สมชาย ใจดี', isActive: true, isAnonymized: false },
      { adUserName: 'Malee', fullNameTh: 'มาลี สุขใจ', isActive: true, isAnonymized: false },
      { adUserName: 'gone', fullNameTh: 'ลาออก', isActive: false, isAnonymized: false },
      { adUserName: 'anon', fullNameTh: 'x', isActive: true, isAnonymized: true },
      { adUserName: null, fullNameTh: 'ไม่มี AD', isActive: true, isAnonymized: false },
      { adUserName: '  ', fullNameTh: 'ว่าง', isActive: true, isAnonymized: false },
    ]);
    expect((await svc.employeeList()).map((e) => e.adUserName)).toEqual(['Malee', 'somchai']);
    expect((await svc.employeeList('MALEE')).map((e) => e.adUserName)).toEqual(['Malee']);
    expect((await svc.employeeList('ใจดี')).map((e) => e.adUserName)).toEqual(['somchai']);
    expect(await svc.employeeList('zzz')).toEqual([]);
  });

  it('คณะกรรมการ/ฝ่าย/แผนก: เฉพาะที่ใช้งาน (คณะที่ถูกลบไม่แสดง) เรียงตามชื่อ', async () => {
    const { main, svc } = make();
    main.seed(SubCommittee, [
      { subCommitteeNameTh: 'ข', isActive: true, isDeleted: false },
      { subCommitteeNameTh: 'ก', isActive: true, isDeleted: false },
      { subCommitteeNameTh: 'ลบ', isActive: true, isDeleted: true },
      { subCommitteeNameTh: 'ปิด', isActive: false, isDeleted: false },
    ]);
    main.seed(HrDivision, [
      { divisionName: 'ฝ่าย 2', divisionCode: 'D2', isActive: true },
      { divisionName: 'ฝ่าย 1', divisionCode: 'D1', isActive: true },
      { divisionName: 'ปิด', divisionCode: 'DX', isActive: false },
    ]);
    main.seed(HrDepartment, [
      { departmentName: 'แผนก 1', departmentCode: 'P1', divisionId: 1, isActive: true },
    ]);
    expect((await svc.subCommitteeList()).map((x) => x.name)).toEqual(['ก', 'ข']);
    expect((await svc.divisionList()).map((x) => [x.name, x.code])).toEqual([
      ['ฝ่าย 1', 'D1'],
      ['ฝ่าย 2', 'D2'],
    ]);
    expect(await svc.departmentList()).toEqual([{ id: 1, name: 'แผนก 1', code: 'P1' }]);
  });

  it('เอกสารมาสเตอร์: ชื่อแสดง "รหัส - ชื่อ" กรองตามประเภทได้ · ประเภทเอกสาร', async () => {
    const { project, svc } = make();
    project.seed(MasterDocument, [
      { docCode: 'B-1', docName: 'ข', docTypeId: 2 },
      { docCode: 'A-1', docName: 'ก', docTypeId: 1 },
    ]);
    project.seed(MasterDocumentType, [{ docTypeName: 'ภายใน' }, { docTypeName: 'ภายนอก' }]);
    expect((await svc.masterDocuments()).map((d) => d.displayName)).toEqual(['A-1 - ก', 'B-1 - ข']);
    expect((await svc.masterDocuments(2)).map((d) => d.docCode)).toEqual(['B-1']);
    expect((await svc.masterDocumentTypes()).map((t) => t.docTypeName)).toEqual([
      'ภายนอก',
      'ภายใน',
    ]);
  });
});
