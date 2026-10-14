import {
  assertDateRange,
  assertDocStateIndexes,
  assertStagedDays,
  planStateOrder,
} from '../../../src/modules/rgp/projects/project-rules';

describe('assertDateRange', () => {
  it('ครบกำหนดก่อนวันเริ่ม → 422', () => {
    expect(() => assertDateRange('2026-03-10', '2026-03-01')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
      }),
    );
  });

  it('วันเท่ากัน/ไม่ครบสองวัน ผ่าน', () => {
    expect(() => assertDateRange('2026-03-01', '2026-03-01')).not.toThrow();
    expect(() => assertDateRange('2026-03-01', null)).not.toThrow();
    expect(() => assertDateRange(undefined, '2026-03-01')).not.toThrow();
  });
});

describe('planStateOrder', () => {
  it('เรียงตาม seqNo ที่ระบุ ไม่ระบุใช้ตำแหน่งใน array และเท่ากันคงลำดับเดิม', () => {
    expect(planStateOrder([{ seqNo: 3 }, { seqNo: 1 }, {}, { seqNo: 1 }])).toEqual([1, 3, 0, 2]);
  });

  it('ไม่มี seqNo เลย = ตามลำดับ array', () => {
    expect(planStateOrder([{}, {}, {}])).toEqual([0, 1, 2]);
  });
});

describe('assertDocStateIndexes', () => {
  it('stateIndex นอกช่วง → 422 ระบุลำดับเอกสาร', () => {
    expect(() => assertDocStateIndexes(2, [{ stateIndex: 0 }, { stateIndex: 2 }])).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'DOC_STATE_INDEX_INVALID' }),
      }),
    );
  });

  it('อยู่ในช่วงผ่าน · ไม่มีขั้นตอนแต่มีเอกสาร → ไม่ผ่าน', () => {
    expect(() => assertDocStateIndexes(2, [{ stateIndex: 1 }])).not.toThrow();
    expect(() => assertDocStateIndexes(0, [{ stateIndex: 0 }])).toThrow();
  });
});

describe('assertStagedDays — ผลรวมวันของขั้นตอนต้องไม่เกินช่วงโครงการ', () => {
  const states = [{ estimatedDays: 20 }, { estimatedDays: 15 }];

  it('รวม 35 วัน เกินช่วง 30 วัน → 422 ระบุวันที่เหลือ', () => {
    expect(() => assertStagedDays('2026-03-01', '2026-03-31', states, [0, 1])).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'STATE_DAYS_EXCEEDED',
          details: expect.objectContaining({ remainingDays: 10 }),
        }),
      }),
    );
  });

  it('รวมไม่เกินผ่าน · ไม่มีวันที่โครงการไม่ตรวจ', () => {
    expect(() => assertStagedDays('2026-03-01', '2026-04-30', states, [0, 1])).not.toThrow();
    expect(() => assertStagedDays(null, null, states, [0, 1])).not.toThrow();
  });
});
