import type { UserContext } from '../../../common/interfaces/user-context';

/**
 * ผู้ใช้ในตาราง RGP เก็บเป็นชื่อผู้ใช้ AD แบบสตริง (ไม่ใช่ UserID) — `UserContext.adUserName`
 * คอลัมน์ส่วนใหญ่เป็น varchar(20) (i_create_user / i_update_user / i_action_user) บางตารางเป็น nvarchar(100)
 * จึงตัดให้พอดีความยาวคอลัมน์ กันข้อผิดพลาด "String or binary data would be truncated"
 */
export type ActorSource = Pick<UserContext, 'adUserName'>;

export const ACTOR_SHORT = 20;
export const ACTOR_LONG = 100;

export function rgpActor(user: ActorSource, max: number = ACTOR_SHORT): string {
  return (user.adUserName ?? '').trim().slice(0, max);
}

/** ตัดข้อความให้ไม่เกินความยาวคอลัมน์ (ใช้กับ n_message ฯลฯ) */
export function clip(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null;
  return text.length > max ? text.slice(0, max) : text;
}
