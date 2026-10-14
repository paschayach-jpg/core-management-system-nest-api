import { Confidentiality } from '../../../common/constants/enums';
import type { UserContext } from '../../../common/interfaces/user-context';

/**
 * สิทธิ์ตามชั้นความลับ (FolderAuthorityConfig → UserContext.authority) — พอร์ตจากเมธอดใน UserContext.cs
 *  - ดูโฟลเดอร์: ถ้าไม่มีแถวของชั้นนั้น ผ่านเฉพาะ PC (4) · มีแถวใช้ค่า canView
 *  - เพิ่ม/แก้/อนุมัติ/ดาวน์โหลด: ไม่มีแถว = ไม่อนุญาต
 */
export function canViewLevel(user: UserContext, level: number): boolean {
  const row = user.authority?.[level];
  if (!row) return level === Confidentiality.PC;
  return row.canView;
}
export const canAddToLevel = (u: UserContext, level: number): boolean =>
  u.authority?.[level]?.canAdd ?? false;
export const canEditLevel = (u: UserContext, level: number): boolean =>
  u.authority?.[level]?.canEdit ?? false;
export const canApproveLevel = (u: UserContext, level: number): boolean =>
  u.authority?.[level]?.canApprove ?? false;
export const canDownloadLevel = (u: UserContext, level: number): boolean =>
  u.authority?.[level]?.canDownload ?? false;
