import {
  buildTaskTree,
  computeTaskFlags,
  dateDiffDays,
  sortStateTasks,
} from '../../../src/modules/rgp/tasks/task-rules';

const NOW = new Date(2026, 2, 20, 10, 0); // 2026-03-20

describe('computeTaskFlags — เลยกำหนด / SLA 80%', () => {
  it('ไม่มีวันกำหนด → ไม่ติดธง', () => {
    expect(
      computeTaskFlags({ dueDate: null, createDate: '2026-03-01', status: 'Todo' }, NOW),
    ).toEqual({
      overdue: false,
      slaWarning: false,
    });
  });

  it('กำหนดเมื่อวาน ยังไม่เสร็จ → overdue', () => {
    const f = computeTaskFlags(
      { dueDate: '2026-03-19', createDate: '2026-03-01', status: 'InProgress' },
      NOW,
    );
    expect(f.overdue).toBe(true);
  });

  it('กำหนดวันนี้ ยังไม่ถือว่าเลยกำหนด', () => {
    const f = computeTaskFlags(
      { dueDate: '2026-03-20', createDate: '2026-03-01', status: 'Todo' },
      NOW,
    );
    expect(f.overdue).toBe(false);
  });

  it('Done / OnHold / Cancelled ไม่ติดธงเลย แม้เลยกำหนด', () => {
    for (const status of ['Done', 'OnHold', 'Cancelled']) {
      expect(
        computeTaskFlags({ dueDate: '2026-03-01', createDate: '2026-02-01', status }, NOW),
      ).toEqual({ overdue: false, slaWarning: false });
    }
  });

  it('SLA: ผ่านไป 8 ใน 10 วัน (80%) → เตือน, 7 ใน 10 วัน → ไม่เตือน', () => {
    // สร้าง 2026-03-12, กำหนด 2026-03-22 (10 วัน), วันนี้ 03-20 = ผ่านไป 8 วัน
    expect(
      computeTaskFlags({ dueDate: '2026-03-22', createDate: '2026-03-12', status: 'Todo' }, NOW)
        .slaWarning,
    ).toBe(true);
    // สร้าง 03-13, กำหนด 03-23 (10 วัน), ผ่านไป 7 วัน
    expect(
      computeTaskFlags({ dueDate: '2026-03-23', createDate: '2026-03-13', status: 'Todo' }, NOW)
        .slaWarning,
    ).toBe(false);
  });

  it('กำหนดเสร็จวันเดียวกับวันสร้าง (ช่วง 0 วัน) ไม่ติดธง SLA (หารศูนย์ = NULL เหมือน SQL)', () => {
    expect(
      computeTaskFlags({ dueDate: '2026-03-20', createDate: '2026-03-20', status: 'Todo' }, NOW)
        .slaWarning,
    ).toBe(false);
  });

  it('รับ Date object ของคอลัมน์ datetime ได้', () => {
    const f = computeTaskFlags(
      { dueDate: '2026-03-19', createDate: new Date(2026, 2, 1, 8, 30), status: 'Todo' },
      NOW,
    );
    expect(f.overdue).toBe(true);
  });
});

describe('dateDiffDays', () => {
  it('นับตามขอบเขตวัน (ไม่สนเวลา)', () => {
    expect(dateDiffDays('2026-03-01', '2026-03-11')).toBe(10);
    expect(dateDiffDays('2026-03-11', '2026-03-01')).toBe(-10);
    expect(dateDiffDays('2026-12-30', '2027-01-02')).toBe(3);
  });
});

describe('buildTaskTree — depth-first เรียงพี่น้องตาม taskId', () => {
  const t = (taskId: number, parentTaskId: number | null = null) => ({ taskId, parentTaskId });

  it('จัดลำดับ: ราก → ลูก → หลาน แล้วค่อยรากถัดไป พร้อมระดับ', () => {
    const tree = buildTaskTree([t(5), t(3), t(4, 3), t(6, 4), t(2, 5)]);
    expect(tree.map((n) => [n.task.taskId, n.depth])).toEqual([
      [3, 0],
      [4, 1],
      [6, 2],
      [5, 0],
      [2, 1],
    ]);
  });

  it('sub task ที่ parent ไม่อยู่ในชุด (parent ถูกลบ) ไม่ปรากฏ', () => {
    const tree = buildTaskTree([t(1), t(2, 99)]);
    expect(tree.map((n) => n.task.taskId)).toEqual([1]);
  });

  it('จำกัดความลึกไม่ให้วนไม่รู้จบ', () => {
    // ข้อมูลเสียที่ parent ชี้วนกันเอง ไม่ควรทำให้ค้าง
    const tree = buildTaskTree([t(1), t(2, 1), t(3, 2)], 1);
    expect(tree.map((n) => n.task.taskId)).toEqual([1, 2]);
  });
});

describe('sortStateTasks — priority มากก่อน → กำหนดเสร็จเร็วก่อน (ไม่มีวัน = ก่อน) → สร้างก่อน', () => {
  it('เรียงตามกฎ', () => {
    const sorted = sortStateTasks([
      { taskId: 1, priority: 2, dueDate: '2026-04-01', createDate: '2026-03-01' },
      { taskId: 2, priority: 4, dueDate: '2026-05-01', createDate: '2026-03-02' },
      { taskId: 3, priority: 2, dueDate: null, createDate: '2026-03-03' },
      { taskId: 4, priority: 2, dueDate: '2026-03-15', createDate: '2026-03-04' },
    ]);
    expect(sorted.map((x) => x.taskId)).toEqual([2, 3, 4, 1]);
  });
});
