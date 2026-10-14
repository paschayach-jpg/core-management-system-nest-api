import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { bool, dateOrNull, num, numOrNull, Row, rowsOf, str, strOrNull, Tx } from './db.types';

export interface UserLite {
  userId: number;
  adUserName: string;
  displayName: string;
  appRole: number;
  isActive: boolean;
  departmentId: number | null;
  divisionId: number | null;
}

export interface FolderLite {
  folderId: number;
  folderName: string;
  parentFolderId: number | null;
  orgUnitId: number;
  confidentialityLevel: number;
  isDeleted: boolean;
  isArchived: boolean;
}

export interface FileLite {
  fileId: number;
  folderId: number;
  originalFileName: string;
  fileSizeBytes: number;
  fileStatus: number;
  uploadedBy: number;
  deletedDate: Date | null;
}

export interface OrgUnitLite {
  orgUnitId: number;
  orgUnitCode: string;
  nameTh: string;
  orgUnitType: number;
  isDeleted: boolean;
}

const mapUser = (r: Row): UserLite => ({
  userId: num(r.UserID),
  adUserName: str(r.ADUserName),
  displayName: str(r.DisplayName),
  appRole: num(r.AppRole),
  isActive: bool(r.IsActive),
  departmentId: numOrNull(r.DepartmentId),
  divisionId: numOrNull(r.DivisionId),
});

const USER_COLS = 'UserID, ADUserName, DisplayName, AppRole, IsActive, DepartmentId, DivisionId';

/**
 * อ่านข้อมูลอ้างอิงเล็กๆ ที่งานอนุมัติ/แชร์/โควตาใช้ร่วมกัน (ผู้ใช้, โฟลเดอร์, ไฟล์, หน่วยงาน)
 * — เป็นการอ่านด้วย SQL ของ module นี้เอง (ห้าม import service ของ DmsCoreModule)
 */
@Injectable()
export class LookupStore {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private run(sql: string, params: unknown[], tx?: Tx): Promise<unknown> {
    return (tx?.manager ?? this.ds).query(sql, params);
  }

  async getUser(id: number, tx?: Tx): Promise<UserLite | null> {
    const rows = rowsOf(
      await this.run(`SELECT ${USER_COLS} FROM EMS.UserAccount WHERE UserID = @0`, [id], tx),
    );
    return rows[0] ? mapUser(rows[0]) : null;
  }

  /** ผู้ใช้ที่ใช้งานอยู่ของ role นั้น (เหมือน sp_GetUserAccountsByRole) */
  async getActiveUsersByRole(role: number, tx?: Tx): Promise<UserLite[]> {
    const rows = rowsOf(
      await this.run(
        `SELECT ${USER_COLS} FROM EMS.UserAccount WHERE AppRole = @0 AND IsActive = 1 ORDER BY UserID`,
        [role],
        tx,
      ),
    );
    return rows.map(mapUser);
  }

  async getUsersByIds(ids: number[], tx?: Tx): Promise<UserLite[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const ph = unique.map((_, i) => `@${i}`).join(',');
    const rows = rowsOf(
      await this.run(
        `SELECT ${USER_COLS} FROM EMS.UserAccount WHERE UserID IN (${ph})`,
        unique,
        tx,
      ),
    );
    return rows.map(mapUser);
  }

  async getFolder(id: number, tx?: Tx): Promise<FolderLite | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT FolderID, FolderName, ParentFolderID, OrgUnitID, ConfidentialityLevel, IsDeleted, IsArchived
           FROM storage.Folder WHERE FolderID = @0`,
        [id],
        tx,
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      folderId: num(r.FolderID),
      folderName: str(r.FolderName),
      parentFolderId: numOrNull(r.ParentFolderID),
      orgUnitId: num(r.OrgUnitID),
      confidentialityLevel: num(r.ConfidentialityLevel),
      isDeleted: bool(r.IsDeleted),
      isArchived: bool(r.IsArchived),
    };
  }

  async getFile(id: number, tx?: Tx): Promise<FileLite | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT FileID, FolderID, OriginalFileName, FileSizeBytes, FileStatus, UploadedBy, DeletedDate
           FROM storage.FileDocument WHERE FileID = @0`,
        [id],
        tx,
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      fileId: num(r.FileID),
      folderId: num(r.FolderID),
      originalFileName: str(r.OriginalFileName),
      fileSizeBytes: num(r.FileSizeBytes),
      fileStatus: num(r.FileStatus),
      uploadedBy: num(r.UploadedBy),
      deletedDate: dateOrNull(r.DeletedDate),
    };
  }

  /** ไฟล์ที่ยังใช้งานในโฟลเดอร์ (ไม่ถูกลบ) — ใช้ตอนเปิดโฟลเดอร์ที่แชร์ภายนอก */
  async listActiveFilesInFolder(folderId: number): Promise<FileLite[]> {
    const rows = rowsOf(
      await this.run(
        `SELECT FileID, FolderID, OriginalFileName, FileSizeBytes, FileStatus, UploadedBy, DeletedDate
           FROM storage.FileDocument
          WHERE FolderID = @0 AND FileStatus <> 3 AND DeletedDate IS NULL
          ORDER BY OriginalFileName`,
        [folderId],
      ),
    );
    return rows.map((r) => ({
      fileId: num(r.FileID),
      folderId: num(r.FolderID),
      originalFileName: str(r.OriginalFileName),
      fileSizeBytes: num(r.FileSizeBytes),
      fileStatus: num(r.FileStatus),
      uploadedBy: num(r.UploadedBy),
      deletedDate: dateOrNull(r.DeletedDate),
    }));
  }

  /**
   * ผู้ถือสิทธิ์มีอยู่จริงหรือไม่ (1=User ที่ใช้งานอยู่, 2=Role 1–4, 3=Department, 4=Division) —
   * PrincipalType อื่นๆ ใช้ไม่ได้ (DB CHECK ของ FolderPermission อนุญาตแค่ 1–4; OPEN_QUESTIONS C16)
   */
  async principalExists(principalType: number, principalId: number, tx?: Tx): Promise<boolean> {
    switch (principalType) {
      case 1:
        return (await this.getUser(principalId, tx))?.isActive === true;
      case 2:
        return Number.isInteger(principalId) && principalId >= 1 && principalId <= 4;
      case 3:
        return (
          rowsOf(
            await this.run(
              `SELECT 1 AS X FROM EMS.m_Department WHERE DepartmentID = @0 AND IsActive = 1`,
              [principalId],
              tx,
            ),
          ).length > 0
        );
      case 4:
        return (
          rowsOf(
            await this.run(
              `SELECT 1 AS X FROM EMS.m_Division WHERE DivisionID = @0 AND IsActive = 1`,
              [principalId],
              tx,
            ),
          ).length > 0
        );
      default:
        return false;
    }
  }

  async getOrgUnit(id: number, tx?: Tx): Promise<OrgUnitLite | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT OrgUnitID, OrgUnitCode, OrgUnitNameTH, OrgUnitType, IsDeleted FROM EMS.OrgUnit WHERE OrgUnitID = @0`,
        [id],
        tx,
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      orgUnitId: num(r.OrgUnitID),
      orgUnitCode: str(r.OrgUnitCode),
      nameTh: strOrNull(r.OrgUnitNameTH) ?? '',
      orgUnitType: num(r.OrgUnitType),
      isDeleted: bool(r.IsDeleted),
    };
  }
}

/** ไฟล์ยังใช้งานอยู่ (ไม่ถูกลบ) */
export const isFileActive = (f: Pick<FileLite, 'fileStatus' | 'deletedDate'>): boolean =>
  f.fileStatus !== 3 && f.deletedDate === null;
