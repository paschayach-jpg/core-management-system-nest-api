import { PrincipalType } from '../../../common/constants/enums';

/** สิทธิ์ที่ตรวจต่อโฟลเดอร์ (ชื่อเดียวกับ PermissionType เดิม) */
export type PermissionType = 'Read' | 'Write' | 'Delete' | 'Modify' | 'FullControl';

/** แถว ACL ที่ยังไม่ถูกเพิกถอนและยังไม่หมดอายุ (security.FolderPermission) */
export interface AclEntry {
  folderId: number;
  principalType: PrincipalType;
  principalId: number;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModify: boolean;
  canFullControl: boolean;
  isDeny: boolean;
}

/** ข้อมูลของผู้ใช้ที่จำเป็นต่อการจับคู่ ACL */
export interface AclSubject {
  userId: number;
  appRole: number;
  departmentId?: number | null;
  divisionId?: number | null;
}

/** โฟลเดอร์ในสายเลือด (จากตัวมันขึ้นไปถึงราก) */
export interface FolderLink {
  folderId: number;
  parentFolderId: number | null;
}
