import { PrincipalType } from '../../../common/constants/enums';
import type { AclEntry, AclSubject, FolderLink, PermissionType } from './permission.types';

/** ธงของแถว ACL ตรงกับสิทธิ์ที่ขอหรือไม่ — FullControl ผ่านทุกสิทธิ์ (พอร์ตจาก PermissionService.MatchesFlag) */
export function matchesFlag(e: AclEntry, perm: PermissionType): boolean {
  if (e.canFullControl) return true;
  switch (perm) {
    case 'Read':
      return e.canRead;
    case 'Write':
      return e.canWrite || e.canModify;
    case 'Delete':
      return e.canDelete || e.canModify;
    case 'Modify':
      return e.canModify;
    case 'FullControl':
      return e.canFullControl;
    default:
      return false;
  }
}

/** แถว ACL นี้ใช้กับผู้ใช้คนนี้หรือไม่ (User=UserID, Role=AppRole, Department=DepartmentId, Division=DivisionId) */
export function isApplicable(e: AclEntry, u: AclSubject): boolean {
  switch (e.principalType) {
    case PrincipalType.User:
      return e.principalId === u.userId;
    case PrincipalType.Role:
      return e.principalId === u.appRole;
    case PrincipalType.Department:
      return u.departmentId != null && e.principalId === u.departmentId;
    case PrincipalType.Division:
      return u.divisionId != null && e.principalId === u.divisionId;
    default:
      return false;
  }
}

export const PRIVILEGED_ROLE = 3; // Manager ขึ้นไป

/**
 * ตัดสินสิทธิ์ของผู้ใช้บนโฟลเดอร์ (พอร์ตจาก PermissionService.CheckPermissionInternal / EvaluatePermissionRecursive)
 *
 * - Manager/Admin (AppRole >= 3): ผ่านทุกสิทธิ์ ยกเว้นมี Explicit Deny ที่ตรงกับผู้ใช้บน "โฟลเดอร์นี้" (ไม่ไล่ขึ้นไปหา parent)
 * - ผู้ใช้อื่น: ไล่จากโฟลเดอร์ขึ้นไปหา root — Deny ชนะเสมอ, มี Allow ตรงสิทธิ์ → ผ่าน, ไม่เจอก็ขึ้นไป parent, สุดทางไม่เจอ → ปฏิเสธ (default deny)
 *
 * หมายเหตุ InheritanceBroken: โค้ดเดิมอ่านคอลัมน์ `FolderPermission.InheritanceBroken` แต่ DB จริงไม่มีคอลัมน์นี้
 * จึงเทียบเท่า "ไม่เคยตัดการสืบทอด" เสมอ — ที่นี่คงพฤติกรรมนั้น (ดู docs/DECISIONS.md D-05)
 *
 * @param chain โฟลเดอร์จากตัวเองไปถึงราก (index 0 = โฟลเดอร์ที่ตรวจ)
 */
export function evaluateAcl(args: {
  subject: AclSubject;
  perm: PermissionType;
  chain: FolderLink[];
  aclByFolder: ReadonlyMap<number, readonly AclEntry[]>;
}): boolean {
  const { subject, perm, chain, aclByFolder } = args;
  if (chain.length === 0) return false; // ไม่พบโฟลเดอร์

  if (subject.appRole >= PRIVILEGED_ROLE) {
    const own = (aclByFolder.get(chain[0].folderId) ?? []).filter((e) => isApplicable(e, subject));
    return !own.some((e) => e.isDeny && matchesFlag(e, perm));
  }

  const visited = new Set<number>();
  for (const link of chain) {
    if (visited.has(link.folderId)) return false; // กันวงวน parent
    visited.add(link.folderId);
    const applicable = (aclByFolder.get(link.folderId) ?? []).filter((e) =>
      isApplicable(e, subject),
    );
    if (applicable.some((e) => e.isDeny && matchesFlag(e, perm))) return false;
    if (applicable.some((e) => !e.isDeny && matchesFlag(e, perm))) return true;
    // ไม่เจอ → ไล่ขึ้น parent (ตัว chain เรียงมาแล้ว)
  }
  return false;
}
