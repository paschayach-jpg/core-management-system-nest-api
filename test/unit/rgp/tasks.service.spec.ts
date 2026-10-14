import { AppRole } from '../../../src/common/constants/enums';
import { ProjectAuditLog } from '../../../src/modules/rgp/entities/project-audit-log.entity';
import { ProjectProgress } from '../../../src/modules/rgp/entities/project-progress.entity';
import { ProjectState } from '../../../src/modules/rgp/entities/project-state.entity';
import { ProjectTaskComment } from '../../../src/modules/rgp/entities/project-task-comment.entity';
import { ProjectTaskStatusLog } from '../../../src/modules/rgp/entities/project-task-status-log.entity';
import { ProjectTask } from '../../../src/modules/rgp/entities/project-task.entity';
import { Project } from '../../../src/modules/rgp/entities/project.entity';
import { RunningNumber } from '../../../src/modules/rgp/entities/running-number.entity';
import { todayDateOnly } from '../../../src/modules/rgp/common/rgp-rules';
import { fakeUser } from '../../helpers/stubs';
import { makeHarness, seedProject, seedRunningNumber, type Harness } from './helpers/harness';
import { MemoryManager } from './helpers/memory-db';

const officer = fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });
const YY = String(new Date().getFullYear()).slice(-2);

const tasks = (h: Harness) => h.main.rows<ProjectTask>(ProjectTask);
const audit = (h: Harness) => h.main.rows<ProjectAuditLog>(ProjectAuditLog);
const tkCurrent = (h: Harness) =>
  h.project.rows<Record<string, unknown>>(RunningNumber)[0].currentNumber;

function setup(stateCount = 1) {
  const h = makeHarness({ user: officer });
  seedRunningNumber(h.project, { type: 'TK', current: 0 });
  const seeded = seedProject(h, {
    states: Array.from({ length: stateCount }, (_, i) => ({ name: `ขั้นที่ ${i + 1}` })),
  });
  return { h, ...seeded };
}

const seedTask = (
  h: Harness,
  state: ProjectState,
  over: Partial<ProjectTask> = {},
): ProjectTask => {
  const [t] = h.main.seed(ProjectTask, [
    {
      taskCode: `T-${tasks(h).length + 1}`,
      projStateId: state.projStateId,
      projectId: state.projectId,
      parentTaskId: null,
      subtaskDepth: 0,
      title: 'งาน',
      priority: 2,
      status: 'Todo',
      pctComplete: 0,
      active: 'Y',
      createUser: 'somchai',
      createDate: new Date(),
      ...over,
    },
  ]);
  return t as ProjectTask;
};

describe('ProjectTasksService.create — รหัส Task จาก RunningNumber (TK)', () => {
  it('สร้าง Task: รหัส TK-YY-000001, สถานะ Todo, ผู้สร้างเป็นผู้ใช้ปัจจุบัน, audit CREATE_PROJECT_TASK', async () => {
    const { h, states } = setup();

    const task = await h.tasks.create(
      states[0].projStateId,
      {
        title: '  ร่างเอกสาร ',
        description: 'รายละเอียด',
        priority: 3,
        assignee: ' somchai ',
        dueDate: todayDateOnly(),
        estimatedHours: 8,
      },
      officer,
    );
    await h.crud.drain();

    expect(task).toMatchObject({
      taskCode: `TK-${YY}-000001`,
      title: 'ร่างเอกสาร',
      status: 'Todo',
      pctComplete: 0,
      priority: 3,
      assignee: 'somchai',
      subtaskDepth: 0,
      parentTaskId: null,
      active: true,
      createUser: 'somchai',
      estimatedHours: 8,
    });
    expect(tkCurrent(h)).toBe('1');
    expect(audit(h)).toEqual([
      expect.objectContaining({
        action: 'CREATE_PROJECT_TASK',
        tableName: 't_project_task',
        recordId: task.taskId,
        result: 1,
      }),
    ]);
    expect(h.sink.events.find((e) => e.operation === 'CREATE_PROJECT_TASK')).toMatchObject({
      entity: 'ProjectTask',
      action: 'CREATE',
      success: true,
    });
    expect(h.tx.trace).toEqual(['begin:project', 'begin:main', 'commit:main', 'commit:project']);
  });

  it('ไม่มีแถว RunningNumber ของ TK → ล้มด้วยข้อความชัดเจน ไม่สร้าง Task', async () => {
    const h = makeHarness({ user: officer });
    seedRunningNumber(h.project, { type: 'PRJ', current: 0 }); // มีแต่ PRJ
    const { states } = seedProject(h, { states: [{ name: 'A' }] });

    await expect(
      h.tasks.create(states[0].projStateId, { title: 'x' }, officer),
    ).rejects.toMatchObject({
      response: {
        code: 'RUNNING_NUMBER_NOT_CONFIGURED',
        message: expect.stringContaining("running_type = 'TK'"),
      },
    });
    expect(tasks(h)).toHaveLength(0);
  });

  it('เลขรันต่อเนื่องไม่ซ้ำ · สร้างล้ม (วันกำหนดผ่านมาแล้ว) → ไม่เสียเลข', async () => {
    const { h, states } = setup();
    const a = await h.tasks.create(states[0].projStateId, { title: 'a' }, officer);
    await expect(
      h.tasks.create(states[0].projStateId, { title: 'b', dueDate: '2020-01-01' }, officer),
    ).rejects.toMatchObject({ response: { code: 'TASK_DUE_DATE_PAST' } });
    const c = await h.tasks.create(states[0].projStateId, { title: 'c' }, officer);

    expect([a.taskCode, c.taskCode]).toEqual([`TK-${YY}-000001`, `TK-${YY}-000002`]);
    expect(tkCurrent(h)).toBe('2'); // ครั้งที่ล้มถูก rollback ฝั่ง BUI_RG
    expect(audit(h).map((x) => x.action)).toEqual([
      'CREATE_PROJECT_TASK',
      'CREATE_PROJECT_TASK_FAILED',
      'CREATE_PROJECT_TASK',
    ]);
  });

  it('วันกำหนดเสร็จเป็นวันนี้ได้ (ไม่ถือว่าผ่านมาแล้ว)', async () => {
    const { h, states } = setup();
    await expect(
      h.tasks.create(states[0].projStateId, { title: 'x', dueDate: todayDateOnly() }, officer),
    ).resolves.toBeDefined();
  });

  describe('sub task', () => {
    it('depth = depth ของแม่ + 1 และต้องอยู่ขั้นตอนเดียวกัน', async () => {
      const { h, states } = setup(2);
      const root = seedTask(h, states[0]);

      const sub = await h.tasks.create(
        states[0].projStateId,
        { title: 'ย่อย', parentTaskId: root.taskId },
        officer,
      );
      expect(sub).toMatchObject({ parentTaskId: root.taskId, subtaskDepth: 1 });

      const subSub = await h.tasks.create(
        states[0].projStateId,
        { title: 'ย่อยของย่อย', parentTaskId: sub.taskId },
        officer,
      );
      expect(subSub.subtaskDepth).toBe(2);

      await expect(
        h.tasks.create(
          states[1].projStateId,
          { title: 'ผิดขั้น', parentTaskId: root.taskId },
          officer,
        ),
      ).rejects.toMatchObject({ response: { code: 'PARENT_TASK_OTHER_STATE' } });
    });

    it('แม่ที่ถูกลบ/ไม่มี → 422 · ซ้อนลึกเกินกำหนด → 422', async () => {
      const { h, states } = setup();
      const deleted = seedTask(h, states[0], { active: 'N' });
      await expect(
        h.tasks.create(
          states[0].projStateId,
          { title: 'x', parentTaskId: deleted.taskId },
          officer,
        ),
      ).rejects.toMatchObject({ response: { code: 'PARENT_TASK_NOT_FOUND' } });

      const deep = seedTask(h, states[0], { subtaskDepth: 20 });
      await expect(
        h.tasks.create(states[0].projStateId, { title: 'x', parentTaskId: deep.taskId }, officer),
      ).rejects.toMatchObject({ response: { code: 'SUBTASK_TOO_DEEP' } });
    });
  });

  it('ขั้นตอนไม่พบ / โครงการถูกลบ → 404 ไม่เสียเลข', async () => {
    const { h, project, states } = setup();
    await expect(h.tasks.create(999, { title: 'x' }, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    h.main.rows<Project>(Project).find((p) => p.projectId === project.projectId)!.active = 'N';
    await expect(
      h.tasks.create(states[0].projStateId, { title: 'x' }, officer),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    expect(tkCurrent(h)).toBe('0');
  });
});

describe('ProjectTasksService.updateStatus — เปลี่ยนสถานะ + sync % ของ state', () => {
  it('OnHold ตรึง % เดิม แม้ client ส่ง % ใหม่มา และบันทึก status log ด้วย % ที่ตรึงไว้', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0], { status: 'InProgress', pctComplete: 40 });

    const r = await h.tasks.updateStatus(t.taskId, { status: 'OnHold', pctComplete: 90 }, officer);

    expect(r.task).toMatchObject({ status: 'OnHold', pctComplete: 40 });
    expect(tasks(h)[0].pctComplete).toBe(40);
    expect(h.main.rows<ProjectTaskStatusLog>(ProjectTaskStatusLog)).toEqual([
      expect.objectContaining({
        taskId: t.taskId,
        oldStatus: 'InProgress',
        newStatus: 'OnHold',
        pctAtChange: 40,
        changeUser: 'somchai',
      }),
    ]);
  });

  it('Done → 100% · Todo → 0% (บังคับที่ API)', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0], { status: 'InProgress', pctComplete: 40 });
    expect(
      (await h.tasks.updateStatus(t.taskId, { status: 'Done', pctComplete: 10 }, officer)).task
        .pctComplete,
    ).toBe(100);
    expect(
      (await h.tasks.updateStatus(t.taskId, { status: 'Todo', pctComplete: 70 }, officer)).task
        .pctComplete,
    ).toBe(0);
  });

  it('sync % ของ state = ค่าเฉลี่ย task หลัก แล้วบันทึก progress "Auto-sync จาก Tasks", ตั้งสถานะ state และโครงการ', async () => {
    const { h, project, states } = setup();
    const t1 = seedTask(h, states[0], { status: 'InProgress', pctComplete: 50 });
    seedTask(h, states[0], { status: 'Todo', pctComplete: 0 });

    const r = await h.tasks.updateStatus(t1.taskId, { status: 'Done' }, officer);

    expect(r).toMatchObject({
      statePct: 50,
      stateStatus: 'InProgress',
      projectStatus: 'InProgress',
    });
    expect(h.main.rows<ProjectProgress>(ProjectProgress)).toEqual([
      expect.objectContaining({
        projStateId: states[0].projStateId,
        projectId: project.projectId,
        pctComplete: 50,
        status: 'InProgress',
        remark: 'Auto-sync จาก Tasks',
        actionUser: 'somchai',
      }),
    ]);
    expect(h.main.rows<ProjectState>(ProjectState)[0].status).toBe('InProgress');
    expect(h.main.rows<Project>(Project)[0].status).toBe('InProgress');
  });

  it('task ทุกตัวเสร็จ → state 100% Completed → โครงการ Completed', async () => {
    const { h, states } = setup();
    const t1 = seedTask(h, states[0]);
    const t2 = seedTask(h, states[0]);
    await h.tasks.updateStatus(t1.taskId, { status: 'Done' }, officer);
    const r = await h.tasks.updateStatus(t2.taskId, { status: 'Done' }, officer);
    expect(r).toMatchObject({
      statePct: 100,
      stateStatus: 'Completed',
      projectStatus: 'Completed',
    });
  });

  it('sub task และ task ที่ถูกลบ/ยกเลิกไม่ถูกนับในค่าเฉลี่ยของ state', async () => {
    const { h, states } = setup();
    const root = seedTask(h, states[0], { pctComplete: 0 });
    seedTask(h, states[0], {
      parentTaskId: root.taskId,
      status: 'Done',
      pctComplete: 100,
      subtaskDepth: 1,
    });
    seedTask(h, states[0], { active: 'N', pctComplete: 100 });
    seedTask(h, states[0], { status: 'Cancelled', pctComplete: 0 });

    const r = await h.tasks.updateStatus(
      root.taskId,
      { status: 'InProgress', pctComplete: 60 },
      officer,
    );
    expect(r.statePct).toBe(60); // นับเฉพาะ root ที่ใช้งานและไม่ยกเลิก
  });

  it('audit UPDATE_PROJECT_TASK_STATUS (Project) และ CRUD-log ถูกเขียน', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0]);
    await h.tasks.updateStatus(t.taskId, { status: 'InReview', pctComplete: 80 }, officer);
    await h.crud.drain();

    expect(audit(h)).toEqual([
      expect.objectContaining({
        module: 'Project',
        action: 'UPDATE_PROJECT_TASK_STATUS',
        tableName: 't_project_task',
        recordId: t.taskId,
        result: 1,
        userId: 'somchai',
      }),
    ]);
    expect(h.sink.events[0]).toMatchObject({
      entity: 'ProjectTask',
      action: 'UPDATE',
      operation: 'UPDATE_PROJECT_TASK_STATUS',
      recordId: t.taskId,
      success: true,
    });
    expect(h.sink.events[0].before).toMatchObject({ status: 'Todo' });
  });

  it('ใช้ state/โครงการของตัว Task เอง — ไม่มี input ให้ client ระบุ จึงสลับโครงการไม่ได้', async () => {
    const { h, states } = setup(2);
    const t = seedTask(h, states[1], { pctComplete: 0 });
    await h.tasks.updateStatus(t.taskId, { status: 'Done' }, officer);
    const progress = h.main.rows<ProjectProgress>(ProjectProgress);
    expect(progress.map((p) => p.projStateId)).toEqual([states[1].projStateId]);
  });

  it('ทั้งก้อนเป็น transaction เดียว: บันทึก status log ล้ม → task, progress, สถานะ state/โครงการ ถูก rollback', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0], { status: 'Todo', pctComplete: 0 });
    const insert = jest
      .spyOn(MemoryManager.prototype, 'insert')
      .mockImplementation(async (entity: Function) => {
        if (entity === ProjectTaskStatusLog) throw new Error('log ล้ม');
        return { identifiers: [] };
      });
    try {
      await expect(h.tasks.updateStatus(t.taskId, { status: 'Done' }, officer)).rejects.toThrow(
        'log ล้ม',
      );
    } finally {
      insert.mockRestore();
    }
    expect(tasks(h)[0]).toMatchObject({ status: 'Todo', pctComplete: 0 });
    expect(h.main.rows(ProjectProgress)).toHaveLength(0);
    expect(h.main.rows<ProjectState>(ProjectState)[0].status).toBe('Pending');
    expect(h.main.rows<Project>(Project)[0].status).toBe('Open');
    expect(audit(h).map((a) => [a.action, a.result])).toEqual([
      ['UPDATE_PROJECT_TASK_STATUS_FAILED', 2],
    ]);
  });

  it('Task ที่ถูกลบ/ไม่มี → 404', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0], { active: 'N' });
    await expect(h.tasks.updateStatus(t.taskId, { status: 'Done' }, officer)).rejects.toMatchObject(
      {
        response: { code: 'NOT_FOUND' },
      },
    );
    await expect(h.tasks.updateStatus(999, { status: 'Done' }, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('ประวัติสถานะ: ใหม่สุดก่อน', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0]);
    await h.tasks.updateStatus(t.taskId, { status: 'InProgress', pctComplete: 30 }, officer);
    await h.tasks.updateStatus(t.taskId, { status: 'OnHold' }, officer);
    const log = await h.tasks.statusLog(t.taskId);
    expect(log.map((l) => [l.oldStatus, l.newStatus, l.pctAtChange])).toEqual([
      ['InProgress', 'OnHold', 30],
      ['Todo', 'InProgress', 30],
    ]);
  });
});

describe('ProjectTasksService — แก้ไข / ลบ / รายการ', () => {
  it('update แก้เฉพาะฟิลด์ที่ส่ง ไม่แตะสถานะ/% และ null ล้มค่า', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0], {
      status: 'InProgress',
      pctComplete: 55,
      assignee: 'x',
      description: 'เดิม',
    });

    const updated = await h.tasks.update(
      t.taskId,
      {
        title: ' ใหม่ ',
        priority: 4,
        assignee: null,
        dueDate: '2026-12-31',
        actualHours: 3,
        extendReason: 'ขยาย',
      },
      officer,
    );

    expect(updated).toMatchObject({
      title: 'ใหม่',
      priority: 4,
      assignee: null,
      dueDate: '2026-12-31',
      actualHours: 3,
      extendReason: 'ขยาย',
      status: 'InProgress',
      pctComplete: 55,
      description: 'เดิม',
      updateUser: 'somchai',
    });
  });

  it('remove: soft delete (active=N, วันที่ลบ, หมดอายุถังขยะ) ไม่ sync % ของ state · ลบซ้ำไม่ error', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0]);
    await h.tasks.remove(t.taskId, officer);
    await h.tasks.remove(t.taskId, officer);

    const row = tasks(h)[0];
    expect(row.active).toBe('N');
    expect(row.deletedDate).toBeInstanceOf(Date);
    expect(row.recycleExpiry).toBeInstanceOf(Date);
    expect(h.main.rows(ProjectProgress)).toHaveLength(0);
    await h.crud.drain();
    expect(h.sink.events.filter((e) => e.operation === 'DELETE_PROJECT_TASK')).toHaveLength(2);
  });

  it('listByState: เฉพาะ task หลักที่ใช้งาน เรียงตามความสำคัญ + สรุปจำนวน sub task · includeDeleted รวมที่ลบ', async () => {
    const { h, states } = setup();
    const low = seedTask(h, states[0], { title: 'ต่ำ', priority: 1 });
    const high = seedTask(h, states[0], { title: 'สูง', priority: 4 });
    seedTask(h, states[0], {
      title: 'ลูก',
      parentTaskId: high.taskId,
      status: 'Done',
      subtaskDepth: 1,
    });
    seedTask(h, states[0], {
      title: 'ลูกที่ถูกลบ',
      parentTaskId: high.taskId,
      active: 'N',
      subtaskDepth: 1,
    });
    seedTask(h, states[0], { title: 'ลบแล้ว', active: 'N' });

    const list = await h.tasks.listByState(states[0].projStateId);
    expect(list.map((x) => [x.title, x.subtaskCount, x.subtaskDone])).toEqual([
      ['สูง', 1, 1],
      ['ต่ำ', 0, 0],
    ]);
    expect(low.taskId).toBeDefined();

    const all = await h.tasks.listByState(states[0].projStateId, true);
    expect(all.map((x) => [x.title, x.active])).toEqual([
      ['สูง', true],
      ['ลบแล้ว', false], // priority 2
      ['ต่ำ', true], // priority 1
    ]);
  });

  it('listByProject: ต้นไม้ depth-first พร้อม treeDepth และธง overdue', async () => {
    const { h, states } = setup();
    const a = seedTask(h, states[0], {
      title: 'A',
      dueDate: '2020-01-01' as never,
      status: 'InProgress',
    });
    seedTask(h, states[0], { title: 'A.1', parentTaskId: a.taskId, subtaskDepth: 1 });
    seedTask(h, states[0], { title: 'B' });

    const tree = await h.tasks.listByProject(states[0].projectId);

    expect(tree.map((t) => [t.title, t.treeDepth])).toEqual([
      ['A', 0],
      ['A.1', 1],
      ['B', 0],
    ]);
    expect(tree[0]).toMatchObject({ overdue: true, subtaskCount: 1, stateName: 'ขั้นที่ 1' });
  });
});

describe('ProjectTasksService — comment', () => {
  const comment = (h: Harness, taskId: number, over: Partial<ProjectTaskComment> = {}) =>
    h.main.seed(ProjectTaskComment, [
      {
        taskId,
        threadDepth: 0,
        content: 'c',
        isEdited: 'N',
        isDeleted: 'N',
        createUser: 'somchai',
        createDate: new Date(),
        ...over,
      },
    ])[0] as ProjectTaskComment;

  it('เพิ่ม comment ระดับบนสุดและตอบกลับ: ความลึกคำนวณที่ server', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0]);

    const root = await h.tasks.addComment(t.taskId, { content: '  สวัสดี ' }, officer);
    const reply = await h.tasks.addComment(
      t.taskId,
      { content: 'ตอบ', parentCommentId: root.commentId },
      officer,
    );
    const reply2 = await h.tasks.addComment(
      t.taskId,
      { content: 'ตอบอีก', parentCommentId: reply.commentId },
      officer,
    );

    expect([root, reply, reply2].map((c) => c.threadDepth)).toEqual([0, 1, 2]);
    expect(root).toMatchObject({ content: 'สวัสดี', createUser: 'somchai', isDeleted: false });

    await expect(
      h.tasks.addComment(
        t.taskId,
        { content: 'ลึกเกิน', parentCommentId: reply2.commentId },
        officer,
      ),
    ).rejects.toMatchObject({ response: { code: 'COMMENT_TOO_DEEP' } });
  });

  it('ตอบกลับ comment ที่ถูกลบ / ของ task อื่น ไม่ได้', async () => {
    const { h, states } = setup();
    const t1 = seedTask(h, states[0]);
    const t2 = seedTask(h, states[0]);
    const deleted = comment(h, t1.taskId, { isDeleted: 'Y' });
    const other = comment(h, t2.taskId);

    await expect(
      h.tasks.addComment(t1.taskId, { content: 'x', parentCommentId: deleted.commentId }, officer),
    ).rejects.toMatchObject({ response: { code: 'PARENT_COMMENT_NOT_FOUND' } });
    await expect(
      h.tasks.addComment(t1.taskId, { content: 'x', parentCommentId: other.commentId }, officer),
    ).rejects.toMatchObject({ response: { code: 'PARENT_COMMENT_NOT_FOUND' } });
  });

  it('ลบได้เฉพาะ comment ของตัวเอง (soft) และเนื้อหาที่ถูกลบไม่ถูกส่งออก', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0]);
    const mine = comment(h, t.taskId, { content: 'ของฉัน' });
    const theirs = comment(h, t.taskId, { content: 'ของคนอื่น', createUser: 'other' });

    await expect(h.tasks.deleteComment(theirs.commentId, officer)).rejects.toMatchObject({
      response: { code: 'COMMENT_NOT_OWNER' },
    });
    await h.tasks.deleteComment(mine.commentId, officer);

    const list = await h.tasks.listComments(t.taskId);
    expect(list.map((c) => [c.commentId, c.isDeleted, c.content])).toEqual([
      [mine.commentId, true, null],
      [theirs.commentId, false, 'ของคนอื่น'],
    ]);
  });

  it('comment ใน Task ที่ถูกลบแล้วเพิ่มไม่ได้', async () => {
    const { h, states } = setup();
    const t = seedTask(h, states[0], { active: 'N' });
    await expect(h.tasks.addComment(t.taskId, { content: 'x' }, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});
