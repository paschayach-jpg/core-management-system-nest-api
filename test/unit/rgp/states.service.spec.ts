import { AppRole } from '../../../src/common/constants/enums';
import { ConflictBusinessException } from '../../../src/common/exceptions/business.exception';
import { ProjectAuditLog } from '../../../src/modules/rgp/entities/project-audit-log.entity';
import { ProjectDocWorkflow } from '../../../src/modules/rgp/entities/project-doc-workflow.entity';
import { ProjectMember } from '../../../src/modules/rgp/entities/project-member.entity';
import { ProjectNotifyLog } from '../../../src/modules/rgp/entities/project-notify-log.entity';
import { ProjectProgress } from '../../../src/modules/rgp/entities/project-progress.entity';
import { ProjectStateMember } from '../../../src/modules/rgp/entities/project-state-member.entity';
import { ProjectState } from '../../../src/modules/rgp/entities/project-state.entity';
import { ProjectTask } from '../../../src/modules/rgp/entities/project-task.entity';
import { fakeUser } from '../../helpers/stubs';
import { makeHarness, seedProject, type Harness } from './helpers/harness';

const officer = fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });
const audit = (h: Harness) => h.main.rows<ProjectAuditLog>(ProjectAuditLog);
const states = (h: Harness) => h.main.rows<ProjectState>(ProjectState);

describe('ProjectStatesService.create', () => {
  it('เพิ่มต่อท้าย (seq = MAX+1) สถานะ Pending พร้อม audit CREATE_PROJECT_STATE ที่มีชื่อผู้ใช้', async () => {
    const h = makeHarness({ user: officer });
    const { project } = seedProject(h, { states: [{ name: 'A' }, { name: 'B' }] });

    const created = await h.states.create(
      project.projectId,
      { name: '  C ', description: '  คำอธิบาย ', required: false, estimatedDays: 5 },
      officer,
    );
    await h.crud.drain();

    expect(created).toMatchObject({
      name: 'C',
      seqNo: 3,
      status: 'Pending',
      required: false,
      description: 'คำอธิบาย',
      estimatedDays: 5,
      pctComplete: 0,
      createUser: 'somchai',
    });
    expect(audit(h)).toEqual([
      expect.objectContaining({
        action: 'CREATE_PROJECT_STATE',
        tableName: 't_project_state',
        recordId: created.projStateId,
        userId: 'somchai',
        result: 1,
      }),
    ]);
    expect(h.sink.events[0]).toMatchObject({
      entity: 'ProjectState',
      action: 'CREATE',
      operation: 'CREATE_PROJECT_STATE',
      success: true,
    });
  });

  it('วันคาดการณ์เกินวันที่เหลือของโครงการ → 422 และไม่เพิ่ม', async () => {
    const h = makeHarness({ user: officer });
    const { project } = seedProject(h, {
      startDate: '2026-03-01',
      dueDate: '2026-03-31',
      states: [{ name: 'A', estimatedDays: 25 }],
    });
    await expect(
      h.states.create(project.projectId, { name: 'B', estimatedDays: 10 }, officer),
    ).rejects.toMatchObject({
      response: { code: 'STATE_DAYS_EXCEEDED', details: { remainingDays: 5 } },
    });
    expect(states(h)).toHaveLength(1);
    expect(audit(h)[0]).toMatchObject({ action: 'CREATE_PROJECT_STATE_FAILED', result: 2 });
  });

  it('โครงการอ้างอิงต้องเป็นโครงการอื่นที่ยังใช้งานอยู่', async () => {
    const h = makeHarness({ user: officer });
    const a = seedProject(h, { projectNo: 'A' });
    const b = seedProject(h, { projectNo: 'B' });

    await expect(
      h.states.create(
        a.project.projectId,
        { name: 'x', refProjectId: a.project.projectId },
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'REF_PROJECT_SELF' } });
    await expect(
      h.states.create(a.project.projectId, { name: 'x', refProjectId: 999 }, officer),
    ).rejects.toMatchObject({ response: { code: 'REF_PROJECT_NOT_FOUND' } });

    const ok = await h.states.create(
      a.project.projectId,
      { name: 'อ้างอิง', refProjectId: b.project.projectId },
      officer,
    );
    expect(ok.refProjectId).toBe(b.project.projectId);
  });

  it('โครงการไม่พบ/ถูกลบ → 404', async () => {
    const h = makeHarness({ user: officer });
    await expect(h.states.create(99, { name: 'x' }, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});

describe('ProjectStatesService.update', () => {
  it('แก้เฉพาะฟิลด์ที่ส่ง ไม่แตะสถานะ/ความคืบหน้า', async () => {
    const h = makeHarness({ user: officer });
    const { states: s } = seedProject(h, { states: [{ name: 'A', status: 'InProgress' }] });

    const updated = await h.states.update(
      s[0].projStateId,
      { name: 'A2', seqNo: 5, required: false, description: null },
      officer,
    );

    expect(updated).toMatchObject({ name: 'A2', seqNo: 5, required: false, status: 'InProgress' });
    expect(states(h)[0].updateUser).toBe('somchai');
  });

  it('วันคาดการณ์ไม่นับตัวเอง: แก้ 25→28 วันในโครงการ 30 วันผ่าน, 25→31 ไม่ผ่าน', async () => {
    const h = makeHarness({ user: officer });
    const { states: s } = seedProject(h, {
      startDate: '2026-03-01',
      dueDate: '2026-03-31',
      states: [
        { name: 'A', estimatedDays: 25 },
        { name: 'B', estimatedDays: 2 },
      ],
    });
    await expect(
      h.states.update(s[0].projStateId, { estimatedDays: 29 }, officer),
    ).rejects.toMatchObject({
      response: { code: 'STATE_DAYS_EXCEEDED' },
    });
    const ok = await h.states.update(s[0].projStateId, { estimatedDays: 28 }, officer);
    expect(ok.estimatedDays).toBe(28);
  });
});

describe('ProjectStatesService.remove — ลบจริงได้เฉพาะเมื่อไม่มี progress', () => {
  it('มีประวัติความคืบหน้า → 422 STATE_HAS_PROGRESS ไม่ลบ', async () => {
    const h = makeHarness({ user: officer });
    const { states: s } = seedProject(h, { states: [{ name: 'A' }] });
    await h.progress.update(s[0].projStateId, { pctComplete: 10 }, officer);

    await expect(h.states.remove(s[0].projStateId, officer)).rejects.toMatchObject({
      response: {
        code: 'STATE_HAS_PROGRESS',
        message: 'ไม่สามารถลบขั้นตอนได้ เนื่องจากมีประวัติการอัปเดตความคืบหน้าแล้ว',
      },
    });
    expect(states(h)).toHaveLength(1);
    expect(audit(h).map((a) => a.action)).toEqual(['DELETE_PROJECT_STATE_FAILED']);
  });

  it('แม้ progress กลับมา 0% ก็ยังบล็อก (ดูจากประวัติ ไม่ใช่สถานะ)', async () => {
    const h = makeHarness({ user: officer });
    const { states: s } = seedProject(h, { states: [{ name: 'A' }] });
    await h.progress.update(s[0].projStateId, { pctComplete: 10 }, officer);
    await h.progress.update(s[0].projStateId, { pctComplete: 0 }, officer);
    await expect(h.states.remove(s[0].projStateId, officer)).rejects.toMatchObject({
      response: { code: 'STATE_HAS_PROGRESS' },
    });
  });

  it('ไม่มี progress → ลบจริง · audit DELETE_PROJECT_STATE มีชื่อผู้ใช้ · CRUD-log DELETE', async () => {
    const h = makeHarness({ user: officer });
    const { states: s } = seedProject(h, { states: [{ name: 'A' }, { name: 'B' }] });

    await h.states.remove(s[0].projStateId, officer);
    await h.crud.drain();

    expect(states(h).map((x) => x.stateName)).toEqual(['B']);
    expect(audit(h)[0]).toMatchObject({
      action: 'DELETE_PROJECT_STATE',
      recordId: s[0].projStateId,
      userId: 'somchai',
      result: 1,
    });
    expect(h.sink.events.find((e) => e.operation === 'DELETE_PROJECT_STATE')).toMatchObject({
      action: 'DELETE',
      success: true,
    });
  });

  it('มี Task อ้างอิง (แม้ถูกลบแบบ soft) → 409 STATE_IN_USE แม้ส่ง cascade', async () => {
    const h = makeHarness({ user: officer });
    const { project, states: s } = seedProject(h, { states: [{ name: 'A' }] });
    h.main.seed(ProjectTask, [
      {
        taskCode: 'T1',
        projStateId: s[0].projStateId,
        projectId: project.projectId,
        title: 't',
        active: 'N',
        createUser: 'u',
      },
    ]);
    await expect(h.states.remove(s[0].projStateId, officer, true)).rejects.toBeInstanceOf(
      ConflictBusinessException,
    );
    expect(states(h)).toHaveLength(1);
  });

  it('มีเอกสาร/ผู้เกี่ยวข้อง: ไม่ cascade → 409 พร้อมจำนวน · cascade=true → ลบลูกแล้วลบขั้นตอน', async () => {
    const h = makeHarness({ user: officer });
    const { project, states: s } = seedProject(h, { states: [{ name: 'A' }] });
    const sid = s[0].projStateId;
    h.main.seed(ProjectDocWorkflow, [
      { projStateId: sid, projectId: project.projectId, docName: 'd1', seqNo: 1, createUser: 'u' },
      { projStateId: sid, projectId: project.projectId, docName: 'd2', seqNo: 2, createUser: 'u' },
    ]);
    h.main.seed(ProjectStateMember, [
      {
        projStateId: sid,
        projectId: project.projectId,
        memberName: 'x',
        role: 'r',
        createUser: 'u',
      },
    ]);

    await expect(h.states.remove(sid, officer)).rejects.toMatchObject({
      response: { code: 'STATE_IN_USE', details: { docs: 2, members: 1 } },
    });
    expect(h.main.rows(ProjectDocWorkflow)).toHaveLength(2);

    await h.states.remove(sid, officer, true);
    expect(states(h)).toHaveLength(0);
    expect(h.main.rows(ProjectDocWorkflow)).toHaveLength(0);
    expect(h.main.rows(ProjectStateMember)).toHaveLength(0);
  });

  it('มีประวัติแจ้งเตือนอ้างอิง → 409', async () => {
    const h = makeHarness({ user: officer });
    const { project, states: s } = seedProject(h, { states: [{ name: 'A' }] });
    h.main.seed(ProjectNotifyLog, [
      {
        projectId: project.projectId,
        projStateId: s[0].projStateId,
        stateMemberId: 1,
        recipientName: 'x',
      },
    ]);
    await expect(h.states.remove(s[0].projStateId, officer, true)).rejects.toMatchObject({
      response: { code: 'STATE_IN_USE' },
    });
  });
});

describe('ProjectStatesService.reorder', () => {
  it('จัดลำดับใหม่ทั้งชุดใน transaction เดียว และคืนรายการตามลำดับใหม่', async () => {
    const h = makeHarness({ user: officer });
    const { project, states: s } = seedProject(h, {
      states: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });

    const result = await h.states.reorder(
      project.projectId,
      {
        items: [
          { stateId: s[0].projStateId, seqNo: 3 },
          { stateId: s[1].projStateId, seqNo: 1 },
          { stateId: s[2].projStateId, seqNo: 2 },
        ],
      },
      officer,
    );

    expect(result.map((x) => x.name)).toEqual(['B', 'C', 'A']);
  });

  it('มี state ที่ไม่ใช่ของโครงการ → 422 และไม่เปลี่ยนอะไรเลย (rollback)', async () => {
    const h = makeHarness({ user: officer });
    const a = seedProject(h, { projectNo: 'A', states: [{ name: 'A1' }, { name: 'A2' }] });
    const b = seedProject(h, { projectNo: 'B', states: [{ name: 'B1' }] });

    await expect(
      h.states.reorder(
        a.project.projectId,
        {
          items: [
            { stateId: a.states[0].projStateId, seqNo: 9 },
            { stateId: b.states[0].projStateId, seqNo: 1 },
          ],
        },
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'STATE_NOT_IN_PROJECT' } });
    expect(states(h).map((x) => x.seqNo)).toEqual([1, 2, 1]);
  });

  it('state ซ้ำในรายการ → 422', async () => {
    const h = makeHarness({ user: officer });
    const { project, states: s } = seedProject(h, { states: [{ name: 'A' }] });
    await expect(
      h.states.reorder(
        project.projectId,
        {
          items: [
            { stateId: s[0].projStateId, seqNo: 1 },
            { stateId: s[0].projStateId, seqNo: 2 },
          ],
        },
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'STATE_DUPLICATE' } });
  });
});

describe('ProjectStatesService.estimatedDays', () => {
  it('รวม/ใช้ไป/เหลือ — ไม่นับ state ที่ระบุ', async () => {
    const h = makeHarness({ user: officer });
    const { project, states: s } = seedProject(h, {
      startDate: '2026-03-01',
      dueDate: '2026-03-31',
      states: [
        { name: 'A', estimatedDays: 10 },
        { name: 'B', estimatedDays: 5 },
      ],
    });
    expect(await h.states.estimatedDays(project.projectId)).toEqual({
      totalDays: 30,
      usedDays: 15,
      remainingDays: 15,
    });
    expect(await h.states.estimatedDays(project.projectId, s[0].projStateId)).toEqual({
      totalDays: 30,
      usedDays: 5,
      remainingDays: 25,
    });
  });

  it('โครงการไม่มีช่วงวันที่ → totalDays/remainingDays เป็น null', async () => {
    const h = makeHarness({ user: officer });
    const { project } = seedProject(h, { states: [{ name: 'A', estimatedDays: 4 }] });
    expect(await h.states.estimatedDays(project.projectId)).toEqual({
      totalDays: null,
      usedDays: 4,
      remainingDays: null,
    });
  });
});

describe('StateMembersService — ผู้เกี่ยวข้องของขั้นตอน', () => {
  const setup = () => {
    const h = makeHarness({ user: officer });
    const { project, states: s } = seedProject(h, { states: [{ name: 'A' }] });
    const [m1, m2] = h.main.seed(ProjectMember, [
      {
        projectId: project.projectId,
        memberName: 'somchai',
        role: 'ผู้ประสานงาน',
        memberType: 'พนักงาน',
        createUser: 'u',
      },
      {
        projectId: project.projectId,
        memberName: 'แผนกนโยบาย',
        role: 'ผู้ประสานงาน',
        memberType: 'แผนก',
        createUser: 'u',
      },
    ]);
    return { h, project, state: s[0], m1, m2 };
  };

  it('เลือกจากบุคคลในโครงการ: คัดลอกชื่อ/บทบาท/ประเภท · ซ้ำชื่อ (ไม่สนตัวพิมพ์) → 409', async () => {
    const { h, state, m1 } = setup();
    const added = await h.stateMembers.add(state.projStateId, m1.memberId, officer);
    expect(added).toMatchObject({
      name: 'somchai',
      role: 'ผู้ประสานงาน',
      memberType: 'Employee',
      notifyCount: 0,
    });

    h.main.rows<ProjectMember>(ProjectMember)[0].memberName = 'SOMCHAI'; // คนเดียวกันแต่พิมพ์ต่าง
    await expect(h.stateMembers.add(state.projStateId, m1.memberId, officer)).rejects.toMatchObject(
      {
        response: { code: 'STATE_MEMBER_DUPLICATE' },
      },
    );
  });

  it('บุคคลของโครงการอื่นเลือกไม่ได้ (404)', async () => {
    const { h, state } = setup();
    const other = seedProject(h, { projectNo: 'OTHER' });
    const [foreign] = h.main.seed(ProjectMember, [
      { projectId: other.project.projectId, memberName: 'x', role: 'r', createUser: 'u' },
    ]);
    await expect(
      h.stateMembers.add(state.projStateId, foreign.memberId, officer),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('ลบได้ถ้ายังไม่เคยส่งแจ้งเตือน · เคยส่งแล้วลบไม่ได้ (409)', async () => {
    const { h, project, state, m1, m2 } = setup();
    const a = await h.stateMembers.add(state.projStateId, m1.memberId, officer);
    const b = await h.stateMembers.add(state.projStateId, m2.memberId, officer);
    h.main.seed(ProjectNotifyLog, [
      {
        projectId: project.projectId,
        projStateId: state.projStateId,
        stateMemberId: a.stateMemberId,
        recipientName: 'somchai',
      },
    ]);

    await expect(h.stateMembers.remove(a.stateMemberId)).rejects.toMatchObject({
      response: { code: 'STATE_MEMBER_HAS_NOTIFY_LOG' },
    });
    await h.stateMembers.remove(b.stateMemberId);
    const list = await h.stateMembers.listByState(state.projStateId);
    expect(list.map((m) => [m.name, m.notifyCount])).toEqual([['somchai', 1]]);
  });
});
