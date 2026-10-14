import {
  allRequiredStatesCompleted,
  averageTaskPct,
  checkEstimatedDays,
  computeProjectStatus,
  fromYesNo,
  hasActiveProgress,
  nextSeqNo,
  overallProjectPct,
  parseDateOnly,
  projectTotalDays,
  resolveTaskStatusChange,
  stateStatusFromPct,
  toDateOnly,
  toYesNo,
} from '../../../src/modules/rgp/common/rgp-rules';

describe('stateStatusFromPct — 0=Pending, 100=Completed, อื่นๆ=InProgress', () => {
  it.each([
    [0, 'Pending'],
    [1, 'InProgress'],
    [50, 'InProgress'],
    [99, 'InProgress'],
    [100, 'Completed'],
  ])('%i%% → %s', (pct, status) => {
    expect(stateStatusFromPct(pct)).toBe(status);
  });
});

describe('computeProjectStatus — คำนวณสถานะโครงการจากสถานะ state', () => {
  const s = (status: string, required = true) => ({ status, required });

  it('ไม่มี state เลย → Open', () => {
    expect(computeProjectStatus([])).toBe('Open');
  });

  it('ทุก state ยัง Pending → Open', () => {
    expect(computeProjectStatus([s('Pending'), s('Pending')])).toBe('Open');
  });

  it('มี state ที่ InProgress แต่ required ยังไม่ครบ → InProgress', () => {
    expect(computeProjectStatus([s('Completed'), s('InProgress'), s('Pending')])).toBe(
      'InProgress',
    );
  });

  it('ทุก required Completed และมี progress → Completed', () => {
    expect(computeProjectStatus([s('Completed'), s('Completed')])).toBe('Completed');
  });

  it('required ครบ แต่ state ที่ไม่ required ยัง Pending → ยัง Completed', () => {
    expect(computeProjectStatus([s('Completed'), s('Pending', false)])).toBe('Completed');
  });

  it('state ที่ไม่ required ไม่ถูกนับในเงื่อนไขครบ — InProgress ถ้า required ยังค้าง', () => {
    expect(computeProjectStatus([s('Pending'), s('InProgress', false)])).toBe('InProgress');
  });

  it('พฤติกรรมเดิม: ไม่มี required state เลยแต่มี state InProgress → Completed (เป็นจริงโดยปริยาย)', () => {
    expect(computeProjectStatus([s('InProgress', false)])).toBe('Completed');
  });
});

describe('allRequiredStatesCompleted / hasActiveProgress', () => {
  it('มี required ที่ยังไม่ Completed → false', () => {
    expect(
      allRequiredStatesCompleted([
        { required: true, status: 'Completed' },
        { required: true, status: 'InProgress' },
      ]),
    ).toBe(false);
  });

  it('ไม่มี required เลย → true (พฤติกรรมเดิม)', () => {
    expect(allRequiredStatesCompleted([{ required: false, status: 'Pending' }])).toBe(true);
  });

  it('hasActiveProgress: มี state ที่ไม่ใช่ Pending → true', () => {
    expect(hasActiveProgress([{ status: 'Pending' }, { status: 'InProgress' }])).toBe(true);
    expect(hasActiveProgress([{ status: 'Pending' }])).toBe(false);
    expect(hasActiveProgress([])).toBe(false);
  });
});

describe('overallProjectPct — ค่าเฉลี่ยตัดทศนิยม และ state ที่มีโครงการอ้างอิงใช้ % ของโครงการนั้น', () => {
  it('ไม่มี state = 0', () => {
    expect(overallProjectPct([])).toBe(0);
  });

  it('เฉลี่ยแล้วตัดทศนิยมทิ้ง (66.67 → 66)', () => {
    expect(overallProjectPct([{ pct: 100 }, { pct: 100 }, { pct: 0 }])).toBe(66);
  });

  it('state ที่อ้างโครงการอื่นใช้ refPctOverall แทน pct ของตัวเอง', () => {
    expect(overallProjectPct([{ pct: 0, refProjectId: 9, refPctOverall: 80 }, { pct: 20 }])).toBe(
      50,
    );
  });

  it('refProjectId ที่ไม่มี % รวม ถือเป็น 0', () => {
    expect(overallProjectPct([{ pct: 90, refProjectId: 9, refPctOverall: null }])).toBe(0);
  });
});

describe('averageTaskPct — % ของ state จากค่าเฉลี่ย task หลัก', () => {
  it('ไม่มี task = 0', () => {
    expect(averageTaskPct([])).toBe(0);
  });

  it('เฉลี่ยตัดทศนิยม', () => {
    expect(averageTaskPct([{ pctComplete: 100 }, { pctComplete: 50 }, { pctComplete: 0 }])).toBe(
      50,
    );
    expect(averageTaskPct([{ pctComplete: 100 }, { pctComplete: 0 }, { pctComplete: 0 }])).toBe(33);
  });

  it('task ที่ Cancelled ไม่ถูกนับ', () => {
    expect(
      averageTaskPct([
        { pctComplete: 100, status: 'Done' },
        { pctComplete: 0, status: 'Cancelled' },
      ]),
    ).toBe(100);
  });

  it('ทุก task ถูกยกเลิก = 0', () => {
    expect(averageTaskPct([{ pctComplete: 40, status: 'Cancelled' }])).toBe(0);
  });

  it('task ที่ OnHold ยังถูกนับด้วย % ที่ตรึงไว้', () => {
    expect(
      averageTaskPct([
        { pctComplete: 60, status: 'OnHold' },
        { pctComplete: 100, status: 'Done' },
      ]),
    ).toBe(80);
  });
});

describe('resolveTaskStatusChange — OnHold ตรึง %', () => {
  const current = { status: 'InProgress', pctComplete: 40 };

  it('OnHold: คง % เดิม แม้ client ส่ง % มาใหม่', () => {
    expect(resolveTaskStatusChange(current, { status: 'OnHold', pctComplete: 90 })).toEqual({
      status: 'OnHold',
      pctComplete: 40,
    });
  });

  it('Done → 100 เสมอ · Todo → 0 เสมอ', () => {
    expect(resolveTaskStatusChange(current, { status: 'Done', pctComplete: 10 }).pctComplete).toBe(
      100,
    );
    expect(resolveTaskStatusChange(current, { status: 'Todo', pctComplete: 70 }).pctComplete).toBe(
      0,
    );
  });

  it('InProgress/InReview: ใช้ % ที่ส่งมา ถ้าไม่ส่งคง % เดิม', () => {
    expect(resolveTaskStatusChange(current, { status: 'InProgress', pctComplete: 75 })).toEqual({
      status: 'InProgress',
      pctComplete: 75,
    });
    expect(resolveTaskStatusChange(current, { status: 'InReview' })).toEqual({
      status: 'InReview',
      pctComplete: 40,
    });
  });

  it('ออกจาก OnHold แล้วรับ % ใหม่ได้', () => {
    expect(
      resolveTaskStatusChange(
        { status: 'OnHold', pctComplete: 40 },
        { status: 'InProgress', pctComplete: 55 },
      ).pctComplete,
    ).toBe(55);
  });
});

describe('วันคาดการณ์ของขั้นตอน', () => {
  it('projectTotalDays: ครบกำหนด − เริ่ม (ต้องมากกว่า 0)', () => {
    expect(projectTotalDays('2026-03-01', '2026-03-31')).toBe(30);
    expect(projectTotalDays('2026-03-01', '2026-03-01')).toBeNull();
    expect(projectTotalDays('2026-03-10', '2026-03-01')).toBeNull();
    expect(projectTotalDays(null, '2026-03-01')).toBeNull();
  });

  it('ไม่ข้ามเดือน/ปีผิด (นับตามปฏิทิน)', () => {
    expect(projectTotalDays('2026-12-31', '2027-01-02')).toBe(2);
    expect(projectTotalDays('2028-02-28', '2028-03-01')).toBe(2); // ปีอธิกสุรทิน
  });

  it('checkEstimatedDays: ไม่เกินวันที่เหลือ → ผ่าน', () => {
    expect(checkEstimatedDays('2026-03-01', '2026-03-31', 20, 10).ok).toBe(true);
  });

  it('checkEstimatedDays: เกินวันที่เหลือ → ไม่ผ่านพร้อมตัวเลข', () => {
    expect(checkEstimatedDays('2026-03-01', '2026-03-31', 25, 10)).toEqual({
      ok: false,
      totalDays: 30,
      usedDays: 25,
      remainingDays: 5,
    });
  });

  it('ไม่มีช่วงวันที่ที่ถูกต้อง หรือไม่ระบุวัน → ไม่ตรวจ', () => {
    expect(checkEstimatedDays(null, null, 100, 999).ok).toBe(true);
    expect(checkEstimatedDays('2026-03-01', '2026-03-31', 0, null).ok).toBe(true);
    expect(checkEstimatedDays('2026-03-01', '2026-03-31', 0, 0).ok).toBe(true);
  });
});

describe('ตัวช่วยทั่วไป', () => {
  it('nextSeqNo = MAX + 1 เริ่มที่ 1', () => {
    expect(nextSeqNo([])).toBe(1);
    expect(nextSeqNo([1, 2, 5])).toBe(6);
    expect(nextSeqNo([null, undefined, 3])).toBe(4);
  });

  it('toYesNo / fromYesNo', () => {
    expect(toYesNo(true)).toBe('Y');
    expect(toYesNo(false)).toBe('N');
    expect(toYesNo(undefined)).toBe('Y');
    expect(toYesNo(undefined, 'N')).toBe('N');
    expect(fromYesNo('Y')).toBe(true);
    expect(fromYesNo('N')).toBe(false);
    expect(fromYesNo(null)).toBe(false);
  });

  it('คอลัมน์ date: toDateOnly รับทั้ง Date และสตริง, parseDateOnly วนกลับได้', () => {
    expect(toDateOnly('2026-03-05')).toBe('2026-03-05');
    expect(toDateOnly(new Date(2026, 2, 5, 23, 59))).toBe('2026-03-05');
    expect(toDateOnly(null)).toBeNull();
    const parsed = parseDateOnly('2026-03-05') as Date;
    expect(toDateOnly(parsed)).toBe('2026-03-05');
    expect(parseDateOnly(null)).toBeNull();
  });
});
