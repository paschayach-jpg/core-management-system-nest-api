import { AppRole } from '../../../common/constants/enums';
import type { UserContext } from '../../../common/interfaces/user-context';

/** ชื่อผู้ใช้ AD เทียบแบบไม่สนตัวพิมพ์ (AD ไม่แยก; ระบบเดิมเทียบ ordinal แต่ SQL Server ไม่แยกตัวพิมพ์) */
export function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isManagerOrAbove(user: Pick<UserContext, 'appRole'>): boolean {
  return user.appRole >= AppRole.Manager;
}

export function isAdmin(user: Pick<UserContext, 'appRole'>): boolean {
  return user.appRole >= AppRole.Admin;
}

export interface InstanceParticipation {
  initiatedBy: string;
  /** ชื่อผู้ใช้ที่เคยถูกมอบหมาย step ใดๆ ใน instance (AssignedTo) */
  assignees: readonly string[];
}

/**
 * ผู้ที่ "เห็น" instance ได้: ผู้เริ่ม, ผู้ที่มี step ใน instance, หรือ Manager ขึ้นไป
 * (ระบบเดิม CanViewWorkflowInstance คืน true เสมอ — มี TODO; API เลือกทางที่เข้มกว่าเพื่อไม่เปิดข้อมูลให้ทุกคน)
 */
export function canViewInstance(
  user: Pick<UserContext, 'appRole' | 'adUserName'>,
  p: InstanceParticipation,
): boolean {
  return (
    isManagerOrAbove(user) ||
    sameUser(user.adUserName, p.initiatedBy) ||
    p.assignees.some((a) => sameUser(a, user.adUserName))
  );
}

/** ผู้ที่ระงับ/ทำต่อ/ยกเลิก instance ได้: ผู้เริ่ม หรือ Manager ขึ้นไป (ระบบเดิมไม่ตรวจสิทธิ์) */
export function canControlInstance(
  user: Pick<UserContext, 'appRole' | 'adUserName'>,
  initiatedBy: string,
): boolean {
  return isManagerOrAbove(user) || sameUser(user.adUserName, initiatedBy);
}
