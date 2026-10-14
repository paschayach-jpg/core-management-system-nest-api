import { SlaStatus, WorkflowStepInstanceStatus as SS } from '../../../src/common/constants/enums';
import {
  clampThreshold,
  computeSlaDeadline,
  diffSlaStatus,
  evaluateSlaStatus,
  hoursOverdue,
  minutesRemaining,
  percentOf,
  slaHoursFor,
} from '../../../src/modules/wfe/sla/sla-calculator';

const H = 3_600_000;
const t0 = new Date('2026-03-02T09:00:00');
const at = (hours: number) => new Date(t0.getTime() + hours * H);

describe('SLACalculator (pure)', () => {
  describe('evaluateSlaStatus — step ที่ยังเปิดอยู่', () => {
    const input = { status: SS.Pending, assignedDate: t0, slaDeadline: at(24) };

    it('ยังไม่ถึงเกณฑ์ → OnTime', () => {
      expect(evaluateSlaStatus(input, at(10), 75)).toBe(SlaStatus.OnTime);
    });

    it('ใช้เวลา ≥ threshold% (18 จาก 24 ชม. = 75%) → AtRisk', () => {
      expect(evaluateSlaStatus(input, at(18), 75)).toBe(SlaStatus.AtRisk);
      expect(evaluateSlaStatus(input, at(17.9), 75)).toBe(SlaStatus.OnTime);
    });

    it('เกินกำหนด → Overdue (ตรงกำหนดพอดียังไม่ Overdue)', () => {
      expect(evaluateSlaStatus(input, at(24), 75)).toBe(SlaStatus.AtRisk);
      expect(evaluateSlaStatus(input, new Date(at(24).getTime() + 1), 75)).toBe(SlaStatus.Overdue);
    });

    it('threshold ถูกปรับได้ (50% → 12 ชม. เป็นต้นไปเสี่ยง)', () => {
      expect(evaluateSlaStatus(input, at(12), 50)).toBe(SlaStatus.AtRisk);
      expect(evaluateSlaStatus(input, at(11), 50)).toBe(SlaStatus.OnTime);
    });

    it('InProgress และ Delegated ประเมินเหมือน Pending', () => {
      for (const status of [SS.InProgress, SS.Delegated])
        expect(evaluateSlaStatus({ ...input, status }, at(30), 75)).toBe(SlaStatus.Overdue);
    });

    it('ไม่มี deadline → OnTime', () => {
      expect(evaluateSlaStatus({ ...input, slaDeadline: null }, at(999), 75)).toBe(
        SlaStatus.OnTime,
      );
    });

    it('ช่วงเวลาเป็นศูนย์แต่ยังไม่เลยกำหนด → AtRisk (กันหารศูนย์)', () => {
      const z = { status: SS.Pending, assignedDate: t0, slaDeadline: t0 };
      expect(evaluateSlaStatus(z, t0, 75)).toBe(SlaStatus.AtRisk);
      expect(evaluateSlaStatus(z, at(1), 75)).toBe(SlaStatus.Overdue);
    });
  });

  describe('evaluateSlaStatus — step ที่เสร็จแล้ว', () => {
    const done = (completed: Date) => ({
      status: SS.Completed,
      assignedDate: t0,
      slaDeadline: at(24),
      completedDate: completed,
    });

    it('เสร็จก่อน/ตรงกำหนด → OnTime (ไม่มี AtRisk สำหรับงานที่เสร็จแล้ว)', () => {
      expect(evaluateSlaStatus(done(at(23.9)), at(100), 75)).toBe(SlaStatus.OnTime);
      expect(evaluateSlaStatus(done(at(24)), at(100), 75)).toBe(SlaStatus.OnTime);
    });

    it('เสร็จหลังกำหนด → Overdue แม้ตอนนี้เวลาผ่านไปนานแล้ว', () => {
      expect(evaluateSlaStatus(done(at(25)), at(26), 75)).toBe(SlaStatus.Overdue);
    });
  });

  describe('deadline ของ step', () => {
    it('SLAHours มาก่อน SLADays; ไม่มีทั้งคู่ใช้ค่าเริ่มต้น', () => {
      expect(slaHoursFor({ slaHours: 8, slaDays: 3 }, 24)).toBe(8);
      expect(slaHoursFor({ slaHours: null, slaDays: 3 }, 24)).toBe(72);
      expect(slaHoursFor({ slaHours: null, slaDays: null }, 24)).toBe(24);
      expect(slaHoursFor({ slaHours: 0, slaDays: 0 }, 36)).toBe(36);
    });

    it('computeSlaDeadline = เวลามอบหมาย + ชั่วโมง', () => {
      expect(computeSlaDeadline(t0, { slaHours: null, slaDays: 2 }, 24)).toEqual(at(48));
    });
  });

  it('clampThreshold ตัดให้อยู่ใน 0..100 และรับมือค่าที่ไม่ใช่ตัวเลข', () => {
    expect(clampThreshold(150)).toBe(100);
    expect(clampThreshold(-5)).toBe(0);
    expect(clampThreshold(Number.NaN)).toBe(75);
  });

  it('minutesRemaining / hoursOverdue / percentOf', () => {
    expect(minutesRemaining(at(1), t0)).toBe(60);
    expect(minutesRemaining(t0, at(1))).toBe(-60);
    expect(minutesRemaining(null, t0)).toBeNull();
    expect(hoursOverdue(at(1), at(3.5))).toBe(2.5);
    expect(hoursOverdue(at(5), at(3))).toBe(0);
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(1, 0)).toBe(0);
  });

  describe('diffSlaStatus (ใช้ใน cron)', () => {
    const row = (id: number, stored: number | null, deadlineH: number) => ({
      stepInstanceId: id,
      status: SS.Pending,
      assignedDate: t0,
      slaDeadline: at(deadlineH),
      slaStatus: stored,
    });

    it('คืนเฉพาะที่สถานะเปลี่ยน', () => {
      const out = diffSlaStatus(
        [row(1, 1, 24), row(2, 1, 5), row(3, 2, 5), row(4, 3, 5)],
        at(10), // 1: 10/24=42% OnTime(คงเดิม) · 2: เลยกำหนด→Overdue · 3: Overdue · 4: Overdue(คงเดิม)
        75,
      );
      expect(out).toEqual([
        { stepInstanceId: 2, from: SlaStatus.OnTime, to: SlaStatus.Overdue },
        { stepInstanceId: 3, from: SlaStatus.AtRisk, to: SlaStatus.Overdue },
      ]);
    });

    it('ค่าที่ยังไม่เคยตั้ง (null/0) ไม่ถือว่าเปลี่ยนเมื่อผลเป็น OnTime', () => {
      expect(diffSlaStatus([row(1, null, 24), row(2, 0, 24)], at(1), 75)).toEqual([]);
      expect(diffSlaStatus([row(1, null, 5)], at(10), 75)).toEqual([
        { stepInstanceId: 1, from: null, to: SlaStatus.Overdue },
      ]);
    });
  });
});
