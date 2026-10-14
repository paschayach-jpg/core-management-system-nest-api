import { BusinessException } from '../../../common/exceptions/business.exception';
import { checkEstimatedDays } from '../common/rgp-rules';

/**
 * กฎการสร้างโครงการพร้อมลูก (ขั้นตอน/เอกสาร/บุคคล) ที่เป็นฟังก์ชันล้วน — เทสต์ได้โดยไม่ต้องมี DB
 */

/** วันครบกำหนดต้องไม่ก่อนวันเริ่ม (ตรวจเฉพาะเมื่อมีทั้งสองวัน) */
export function assertDateRange(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): void {
  if (startDate && dueDate && dueDate < startDate) {
    throw new BusinessException('วันครบกำหนดต้องไม่ก่อนวันเริ่มโครงการ', 'INVALID_DATE_RANGE');
  }
}

export interface PlannedStateInput {
  seqNo?: number;
  estimatedDays?: number | null;
}

/**
 * ลำดับการเพิ่มขั้นตอน: เรียงตาม seqNo ที่ระบุ (ไม่ระบุ = ตำแหน่งใน array) ถ้าเท่ากันใช้ลำดับใน array
 * คืน index ของ array เดิมตามลำดับที่ควรบันทึก — ระบบเพิ่มทีละขั้นต่อท้ายจึงได้ seq 1..n ต่อเนื่องเหมือน AddState เดิม
 */
export function planStateOrder(states: PlannedStateInput[]): number[] {
  return states
    .map((s, index) => ({ index, key: s.seqNo ?? index + 1 }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((x) => x.index);
}

/** เอกสารต้องอ้างขั้นตอนที่มีอยู่ใน array states ของคำขอเดียวกัน */
export function assertDocStateIndexes(stateCount: number, docs: { stateIndex: number }[]): void {
  docs.forEach((d, i) => {
    if (!Number.isInteger(d.stateIndex) || d.stateIndex < 0 || d.stateIndex >= stateCount) {
      throw new BusinessException(
        `เอกสารลำดับที่ ${i + 1}: stateIndex ${d.stateIndex} ไม่ตรงกับขั้นตอนใน states (มี ${stateCount} ขั้นตอน)`,
        'DOC_STATE_INDEX_INVALID',
      );
    }
  });
}

/**
 * ผลรวมวันคาดการณ์ของขั้นตอนที่ส่งมาต้องไม่เกินช่วงวันของโครงการ — ตรวจทีละขั้นตามลำดับที่บันทึก
 * (กฎเดิมของหน้าจอ Frm_Project_State_Edit ที่ใช้ตอน stage ขั้นตอน)
 */
export function assertStagedDays(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
  states: PlannedStateInput[],
  order: number[],
): void {
  let used = 0;
  for (const index of order) {
    const days = states[index].estimatedDays ?? 0;
    const check = checkEstimatedDays(startDate, dueDate, used, days);
    if (!check.ok) {
      throw new BusinessException(
        `ขั้นตอนลำดับที่ ${index + 1}: จำนวนวันที่กำหนด (${days} วัน) เกินวันที่เหลือ (${check.remainingDays} วัน) — ` +
          `รวมทั้งหมด ${check.totalDays} วัน ใช้ไปแล้ว ${check.usedDays} วัน`,
        'STATE_DAYS_EXCEEDED',
        check,
      );
    }
    used += days;
  }
}
