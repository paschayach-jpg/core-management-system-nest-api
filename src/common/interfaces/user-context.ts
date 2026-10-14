import { AppRole } from '../constants/enums';

/** สิทธิ์ต่อชั้นความลับที่ได้จาก EMS.sp_ResolveFolderAuthority (แถวใน EMS.FolderAuthorityConfig) */
export interface FolderAuthority {
  configId: number;
  configLabel: string;
  confidentialityLevel: number;
  levelCode: string | null;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canDownload: boolean;
}

/** ผู้ใช้ที่ผ่านการยืนยันตัวตนในคำขอปัจจุบัน — เทียบเท่า CMS.Domain.UserContext */
export interface UserContext {
  userId: number;
  adUserName: string;
  displayName: string;
  appRole: AppRole;
  orgUnitId: number;
  employeeCode?: string | null;
  departmentId?: number | null;
  departmentCode?: string | null;
  divisionId?: number | null;
  divisionCode?: string | null;
  positionName?: string | null;
  levelCode?: string | null;
  consentGiven: boolean;
  /** รหัส session ของ JWT ที่ใช้ยืนยัน (ใช้ผูก log) */
  sessionId?: string;
  /** สิทธิ์ตามชั้นความลับ (index = ConfidentialityLevel) */
  authority?: Record<number, FolderAuthority>;
}

/** payload ใน JWT (เล็ก — ข้อมูลอื่นโหลดสดจาก DB ตอนตรวจ token) */
export interface JwtPayload {
  sub: number;
  username: string;
  role: AppRole;
  sid: string;
  iat?: number;
  exp?: number;
}
