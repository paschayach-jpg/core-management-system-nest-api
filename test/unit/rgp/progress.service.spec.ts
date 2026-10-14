import { AppRole } from '../../../src/common/constants/enums';
import { ProjectProgress } from '../../../src/modules/rgp/entities/project-progress.entity';
import { ProjectState } from '../../../src/modules/rgp/entities/project-state.entity';
import { Project } from '../../../src/modules/rgp/entities/project.entity';
import { fakeUser } from '../../helpers/stubs';
import { makeHarness, seedProject } from './helpers/harness';

const officer = fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });
const project = (h: ReturnType<typeof makeHarness>) => h.main.rows<Project>(Project)[0];
const state = (h: ReturnType<typeof makeHarness>, i: number) =>
  h.main.rows<ProjectState>(ProjectState)[i];

describe('ProjectProgressService.update — % → สถานะ state → สถานะโครงการ', () => {
  it('0% → Pending · 1–99% → InProgress · 100% → Completed', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }, { name: 'B' }] });
    const id = states[0].projStateId;

    expect((await h.progress.update(id, { pctComplete: 0 }, officer)).stateStatus).toBe('Pending');
    expect(state(h, 0).status).toBe('Pending');

    expect((await h.progress.update(id, { pctComplete: 45 }, officer)).stateStatus).toBe(
      'InProgress',
    );
    expect(state(h, 0).status).toBe('InProgress');

    expect((await h.progress.update(id, { pctComplete: 100 }, officer)).stateStatus).toBe(
      'Completed',
    );
    expect(state(h, 0).status).toBe('Completed');
  });

  it('ทุกครั้งเพิ่มแถวประวัติ (ไม่ทับของเดิม) พร้อมผู้บันทึกและหมายเหตุ', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }] });
    await h.progress.update(
      states[0].projStateId,
      { pctComplete: 20, remark: '  เริ่มงาน ' },
      officer,
    );
    await h.progress.update(states[0].projStateId, { pctComplete: 60, remark: '' }, officer);

    const rows = h.main.rows<ProjectProgress>(ProjectProgress);
    expect(rows.map((r) => [r.pctComplete, r.status, r.remark, r.actionUser, r.projectId])).toEqual(
      [
        [20, 'InProgress', 'เริ่มงาน', 'somchai', states[0].projectId],
        [60, 'InProgress', null, 'somchai', states[0].projectId],
      ],
    );

    const history = await h.progress.history(states[0].projStateId);
    expect(history.map((r) => r.pctComplete)).toEqual([60, 20]); // ใหม่สุดก่อน
    expect(history[0].stateName).toBe('A');
  });

  it('โครงการ: มี progress → InProgress; ทุก required Completed → Completed (+วันที่ปิด); ลดลง → กลับเป็น InProgress', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }, { name: 'B' }] });
    const [a, b] = states.map((s) => s.projStateId);

    let r = await h.progress.update(a, { pctComplete: 30 }, officer);
    expect(r.projectStatus).toBe('InProgress');
    expect(project(h).status).toBe('InProgress');

    r = await h.progress.update(a, { pctComplete: 100 }, officer);
    expect(r.projectStatus).toBe('InProgress'); // B ยังไม่เสร็จ

    r = await h.progress.update(b, { pctComplete: 100 }, officer);
    expect(r.projectStatus).toBe('Completed');
    expect(project(h).status).toBe('Completed');
    const closed = project(h).closeDate;
    expect(closed).toBeInstanceOf(Date);

    r = await h.progress.update(b, { pctComplete: 60 }, officer);
    expect(r.projectStatus).toBe('InProgress');
    expect(project(h).status).toBe('InProgress');
  });

  it('state ที่ไม่ required เสร็จก่อน ไม่ทำให้โครงการ Completed ถ้า required ยังค้าง', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, {
      states: [{ name: 'หลัก' }, { name: 'เสริม', required: false }],
    });
    const r = await h.progress.update(states[1].projStateId, { pctComplete: 100 }, officer);
    expect(r.projectStatus).toBe('InProgress');
  });

  it('ย้อนกลับเป็น 0% ทุก state → โครงการกลับเป็น Open', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }] });
    await h.progress.update(states[0].projStateId, { pctComplete: 50 }, officer);
    const r = await h.progress.update(states[0].projStateId, { pctComplete: 0 }, officer);
    expect(r.projectStatus).toBe('Open');
  });

  it('คืน % รวมของโครงการหลังบันทึก', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }, { name: 'B' }] });
    const r = await h.progress.update(states[0].projStateId, { pctComplete: 80 }, officer);
    expect(r.projectPctOverall).toBe(40);
  });

  it('ทั้งสามขั้นอยู่ใน transaction เดียว: คำนวณสถานะโครงการล้ม → ไม่เหลือ progress/สถานะ state ที่เปลี่ยน', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }] });
    // ทำให้การอัปเดตโครงการ (ขั้นสุดท้าย) ล้ม
    const original = h.tx.main.manager().update.bind(h.tx.main.manager());
    jest
      .spyOn(Object.getPrototypeOf(h.tx.main.manager()), 'update')
      .mockImplementation(async (...args: unknown[]) => {
        if ((args[0] as { name: string }).name === 'Project') throw new Error('อัปเดตโครงการล้ม');
        return (original as (...a: unknown[]) => Promise<unknown>)(...args);
      });
    try {
      await expect(
        h.progress.update(states[0].projStateId, { pctComplete: 50 }, officer),
      ).rejects.toThrow('อัปเดตโครงการล้ม');
    } finally {
      jest.restoreAllMocks();
    }
    expect(h.main.rows(ProjectProgress)).toHaveLength(0);
    expect(state(h, 0).status).toBe('Pending');
    expect(project(h).status).toBe('Open');
  });

  it('state ไม่พบ / โครงการถูกลบแล้ว → 404 และไม่เขียนอะไร', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }] });
    await expect(h.progress.update(999, { pctComplete: 10 }, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    project(h).active = 'N';
    await expect(
      h.progress.update(states[0].projStateId, { pctComplete: 10 }, officer),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    expect(h.main.rows(ProjectProgress)).toHaveLength(0);
  });

  it('บันทึก CRUD-log (CREATE UPDATE_STATE_PROGRESS) เมื่อสำเร็จและเมื่อล้ม', async () => {
    const h = makeHarness({ user: officer });
    const { states } = seedProject(h, { states: [{ name: 'A' }] });
    const ok = await h.progress.update(states[0].projStateId, { pctComplete: 50 }, officer);
    await h.progress.update(999, { pctComplete: 10 }, officer).catch(() => undefined);
    await h.crud.drain();
    expect(h.sink.events.map((e) => [e.entity, e.action, e.operation, e.success])).toEqual([
      ['ProjectProgress', 'CREATE', 'UPDATE_STATE_PROGRESS', true],
      ['ProjectProgress', 'CREATE', 'UPDATE_STATE_PROGRESS', false],
    ]);
    expect(h.sink.events[0].recordId).toBe(ok.progressId);
  });
});

describe('ProjectProgressService.overview', () => {
  it('ความคืบหน้าล่าสุดต่อขั้นตอน + % รวม (state ที่อ้างโครงการอื่นใช้ % รวมของโครงการนั้น)', async () => {
    const h = makeHarness({ user: officer });
    const ref = seedProject(h, { projectNo: 'REF', states: [{ name: 'r1' }, { name: 'r2' }] });
    const main = seedProject(h, { projectNo: 'MAIN', states: [{ name: 'A' }, { name: 'B' }] });
    await h.progress.update(ref.states[0].projStateId, { pctComplete: 100 }, officer); // REF รวม 50
    await h.progress.update(main.states[0].projStateId, { pctComplete: 20 }, officer);
    h.main
      .rows<ProjectState>(ProjectState)
      .find((s) => s.projStateId === main.states[1].projStateId)!.refProjectId =
      ref.project.projectId;

    const view = await h.progress.overview(main.project.projectId);

    expect(
      view.states.map((s) => [s.stateName, s.pctComplete, s.refPctOverall, s.refProjectNo]),
    ).toEqual([
      ['A', 20, 0, null],
      ['B', 0, 50, 'REF'],
    ]);
    expect(view.pctOverall).toBe(35); // (20 + 50) / 2
  });
});
