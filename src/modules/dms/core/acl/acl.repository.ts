import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { PrincipalType } from '../../../../common/constants/enums';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import type { TransactionScope } from '../../../../database/transaction-runner.service';
import type { FileAclEntry } from '../rules/file-acl.rules';

type Scope = TransactionScope | undefined;
type Raw = Record<string, unknown>;

/** แถวสิทธิ์ (โฟลเดอร์/ไฟล์ใช้โครงเดียวกัน) พร้อมชื่อผู้ถือสิทธิ์/ผู้ให้สิทธิ์ */
export interface PermissionRow {
  /** PermissionID (โฟลเดอร์) หรือ FilePermissionID (ไฟล์) */
  id: number;
  /** FolderID หรือ FileID */
  targetId: number;
  principalType: PrincipalType;
  principalId: number;
  principalName: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModify: boolean;
  canFullControl: boolean;
  /** เฉพาะสิทธิ์ไฟล์ */
  canDownload: boolean;
  isDeny: boolean;
  expiryDate: Date | null;
  grantedBy: number;
  grantedByName: string | null;
  grantedDate: Date | null;
  revokedBy: number | null;
  revokedDate: Date | null;
  revokeReason: string | null;
}

export interface NewPermission {
  principalType: PrincipalType;
  principalId: number;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModify: boolean;
  canFullControl: boolean;
  canDownload?: boolean;
  isDeny: boolean;
  expiryDate: Date | null;
  grantedBy: number;
}

const PRINCIPAL_NAME_SQL = `CASE p.PrincipalType
    WHEN 1 THEN ISNULL(pu.DisplayName, pu.ADUserName)
    WHEN 3 THEN ISNULL(d.DepartmentNameTh, d.DepartmentName)
    WHEN 4 THEN ISNULL(v.DivisionNameTh, v.DivisionName)
    ELSE NULL END`;

const PRINCIPAL_JOINS = `
  LEFT JOIN EMS.UserAccount pu ON p.PrincipalType = 1 AND pu.UserID = p.PrincipalID
  LEFT JOIN EMS.m_Department d ON p.PrincipalType = 3 AND d.DepartmentID = p.PrincipalID
  LEFT JOIN EMS.m_Division v ON p.PrincipalType = 4 AND v.DivisionID = p.PrincipalID
  LEFT JOIN EMS.UserAccount gu ON gu.UserID = p.GrantedBy`;

const ACTIVE = 'p.RevokedDate IS NULL AND (p.ExpiryDate IS NULL OR p.ExpiryDate > GETDATE())';

function mapPermission(r: Raw, idCol: string, targetCol: string): PermissionRow {
  return {
    id: Number(r[idCol]),
    targetId: Number(r[targetCol]),
    principalType: Number(r.PrincipalType) as PrincipalType,
    principalId: Number(r.PrincipalID),
    principalName: (r.PrincipalName as string | null | undefined) ?? null,
    canRead: Boolean(r.CanRead),
    canWrite: Boolean(r.CanWrite),
    canDelete: Boolean(r.CanDelete),
    canModify: Boolean(r.CanModify),
    canFullControl: Boolean(r.CanFullControl),
    canDownload: Boolean(r.CanDownload),
    isDeny: Boolean(r.IsDeny),
    expiryDate: (r.ExpiryDate as Date | null | undefined) ?? null,
    grantedBy: Number(r.GrantedBy),
    grantedByName: (r.GrantedByName as string | null | undefined) ?? null,
    grantedDate: (r.GrantedDate as Date | null | undefined) ?? null,
    revokedBy: r.RevokedBy === null || r.RevokedBy === undefined ? null : Number(r.RevokedBy),
    revokedDate: (r.RevokedDate as Date | null | undefined) ?? null,
    revokeReason: (r.RevokeReason as string | null | undefined) ?? null,
  };
}

/**
 * การเข้าถึงข้อมูลสิทธิ์: security.FolderPermission / security.FilePermission
 * หมายเหตุ: ตาราง FolderPermission ใน DB จริงไม่มีคอลัมน์ InheritanceBroken — ห้ามอ้างถึง
 */
@Injectable()
export class AclRepository {
  constructor(
    private readonly sp: SpExecutor,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  private query<T = Raw>(sql: string, params: unknown[], scope?: Scope): Promise<T[]> {
    return (scope ? scope.manager.query(sql, params) : this.ds.query(sql, params)) as Promise<T[]>;
  }

  /** ผู้ถือสิทธิ์มีอยู่จริงหรือไม่ (User ต้อง Active · Role = AppRole 1–4 · Department/Division ตามตารางหลัก) */
  async principalExists(type: PrincipalType, id: number, scope?: Scope): Promise<boolean> {
    if (type === PrincipalType.Role) return id >= 1 && id <= 4;
    const sql =
      type === PrincipalType.User
        ? 'SELECT COUNT(*) AS C FROM EMS.UserAccount WHERE UserID = @0 AND IsActive = 1'
        : type === PrincipalType.Department
          ? 'SELECT COUNT(*) AS C FROM EMS.m_Department WHERE DepartmentID = @0'
          : 'SELECT COUNT(*) AS C FROM EMS.m_Division WHERE DivisionID = @0';
    const rows = await this.query<{ C: number }>(sql, [id], scope);
    return Number(rows[0]?.C ?? 0) > 0;
  }

  // ── โฟลเดอร์ ───────────────────────────────────────────────

  async listFolderPermissions(
    folderId: number,
    includeHistory: boolean,
    scope?: Scope,
  ): Promise<PermissionRow[]> {
    const rows = await this.query<Raw>(
      `SELECT p.PermissionID, p.FolderID, p.PrincipalType, p.PrincipalID, ${PRINCIPAL_NAME_SQL} AS PrincipalName,
              p.CanRead, p.CanWrite, p.CanDelete, p.CanModify, p.CanFullControl, p.IsDeny, p.ExpiryDate,
              p.GrantedBy, ISNULL(gu.DisplayName, gu.ADUserName) AS GrantedByName, p.GrantedDate,
              p.RevokedBy, p.RevokedDate, p.RevokeReason
         FROM security.FolderPermission p ${PRINCIPAL_JOINS}
        WHERE p.FolderID = @0 ${includeHistory ? '' : `AND ${ACTIVE}`}
        ORDER BY CASE WHEN p.RevokedDate IS NULL THEN 0 ELSE 1 END, p.GrantedDate DESC, p.PermissionID DESC`,
      [folderId],
      scope,
    );
    return rows.map((r) => mapPermission(r, 'PermissionID', 'FolderID'));
  }

  async getFolderPermission(permissionId: number, scope?: Scope): Promise<PermissionRow | null> {
    const rows = await this.query<Raw>(
      `SELECT p.PermissionID, p.FolderID, p.PrincipalType, p.PrincipalID, ${PRINCIPAL_NAME_SQL} AS PrincipalName,
              p.CanRead, p.CanWrite, p.CanDelete, p.CanModify, p.CanFullControl, p.IsDeny, p.ExpiryDate,
              p.GrantedBy, ISNULL(gu.DisplayName, gu.ADUserName) AS GrantedByName, p.GrantedDate,
              p.RevokedBy, p.RevokedDate, p.RevokeReason
         FROM security.FolderPermission p ${PRINCIPAL_JOINS}
        WHERE p.PermissionID = @0`,
      [permissionId],
      scope,
    );
    return rows[0] ? mapPermission(rows[0], 'PermissionID', 'FolderID') : null;
  }

  /** รายการที่ยังใช้งานของ principal+IsDeny เดียวกัน (จะถูก revoke เมื่อตั้งสิทธิ์ใหม่) */
  async findActiveFolderEntries(
    folderId: number,
    principalType: number,
    principalId: number,
    isDeny: boolean,
    scope?: Scope,
  ): Promise<number[]> {
    const rows = await this.sp
      .call(Sp.security.getPermissionsByFolder, scope?.sp)
      .rows<Raw>({ FolderID: folderId });
    return rows
      .filter(
        (r) =>
          Number(r.PrincipalType) === principalType &&
          Number(r.PrincipalID) === principalId &&
          Boolean(r.IsDeny) === isDeny,
      )
      .map((r) => Number(r.PermissionID));
  }

  async insertFolderPermission(folderId: number, p: NewPermission, scope?: Scope): Promise<number> {
    const id = await this.sp.call(Sp.security.insertFolderPermission, scope?.sp).scalar<number>({
      FolderID: folderId,
      PrincipalType: p.principalType,
      PrincipalID: p.principalId,
      CanRead: p.canRead,
      CanWrite: p.canWrite,
      CanDelete: p.canDelete,
      CanModify: p.canModify,
      CanFullControl: p.canFullControl,
      IsDeny: p.isDeny,
      ExpiryDate: p.expiryDate,
      GrantedBy: p.grantedBy,
    });
    return Number(id);
  }

  async revokeFolderPermission(
    permissionId: number,
    revokedBy: number,
    reason: string,
    scope?: Scope,
  ): Promise<void> {
    await this.sp
      .call(Sp.security.revokePermission, scope?.sp)
      .exec({ PermissionID: permissionId, RevokedBy: revokedBy, RevokeReason: reason });
  }

  // ── ไฟล์ ───────────────────────────────────────────────────

  async listFilePermissions(fileId: number, includeHistory: boolean): Promise<PermissionRow[]> {
    const rows = await this.query<Raw>(
      `SELECT p.FilePermissionID, p.FileID, p.PrincipalType, p.PrincipalID, ${PRINCIPAL_NAME_SQL} AS PrincipalName,
              p.CanRead, p.CanWrite, p.CanDelete, p.CanModify, p.CanFullControl, p.CanDownload, p.IsDeny, p.ExpiryDate,
              p.GrantedBy, ISNULL(gu.DisplayName, gu.ADUserName) AS GrantedByName, p.GrantedDate,
              p.RevokedBy, p.RevokedDate, p.RevokeReason
         FROM security.FilePermission p ${PRINCIPAL_JOINS}
        WHERE p.FileID = @0 ${includeHistory ? '' : `AND ${ACTIVE}`}
        ORDER BY CASE WHEN p.RevokedDate IS NULL THEN 0 ELSE 1 END, p.GrantedDate DESC, p.FilePermissionID DESC`,
      [fileId],
    );
    return rows.map((r) => mapPermission(r, 'FilePermissionID', 'FileID'));
  }

  async getFilePermission(filePermissionId: number): Promise<PermissionRow | null> {
    const rows = await this.query<Raw>(
      `SELECT p.FilePermissionID, p.FileID, p.PrincipalType, p.PrincipalID, ${PRINCIPAL_NAME_SQL} AS PrincipalName,
              p.CanRead, p.CanWrite, p.CanDelete, p.CanModify, p.CanFullControl, p.CanDownload, p.IsDeny, p.ExpiryDate,
              p.GrantedBy, ISNULL(gu.DisplayName, gu.ADUserName) AS GrantedByName, p.GrantedDate,
              p.RevokedBy, p.RevokedDate, p.RevokeReason
         FROM security.FilePermission p ${PRINCIPAL_JOINS}
        WHERE p.FilePermissionID = @0`,
      [filePermissionId],
    );
    return rows[0] ? mapPermission(rows[0], 'FilePermissionID', 'FileID') : null;
  }

  /** entry ที่ยังใช้งาน (ไม่ถูกเพิกถอน ไม่หมดอายุ) ของไฟล์ — ใช้ตัดสินสิทธิ์ */
  async activeFileEntries(fileId: number, scope?: Scope): Promise<FileAclEntry[]> {
    const rows = await this.query<Raw>(
      `SELECT p.FilePermissionID, p.FileID, p.PrincipalType, p.PrincipalID, p.CanRead, p.CanWrite, p.CanDelete,
              p.CanModify, p.CanFullControl, p.CanDownload, p.IsDeny
         FROM security.FilePermission p WHERE p.FileID = @0 AND ${ACTIVE}`,
      [fileId],
      scope,
    );
    return rows.map((r) => ({
      filePermissionId: Number(r.FilePermissionID),
      fileId: Number(r.FileID),
      principalType: Number(r.PrincipalType) as PrincipalType,
      principalId: Number(r.PrincipalID),
      canRead: Boolean(r.CanRead),
      canWrite: Boolean(r.CanWrite),
      canDelete: Boolean(r.CanDelete),
      canModify: Boolean(r.CanModify),
      canFullControl: Boolean(r.CanFullControl),
      canDownload: Boolean(r.CanDownload),
      isDeny: Boolean(r.IsDeny),
    }));
  }

  async findActiveFileEntryIds(
    fileId: number,
    principalType: number,
    principalId: number,
    isDeny: boolean,
    scope?: Scope,
  ): Promise<number[]> {
    const rows = await this.query<{ FilePermissionID: number }>(
      `SELECT p.FilePermissionID FROM security.FilePermission p
        WHERE p.FileID = @0 AND p.PrincipalType = @1 AND p.PrincipalID = @2 AND p.IsDeny = @3
          AND p.RevokedDate IS NULL`,
      [fileId, principalType, principalId, isDeny ? 1 : 0],
      scope,
    );
    return rows.map((r) => Number(r.FilePermissionID));
  }

  async insertFilePermission(fileId: number, p: NewPermission, scope?: Scope): Promise<number> {
    const id = await this.sp.call(Sp.security.insertFilePermission, scope?.sp).scalar<number>({
      FileID: fileId,
      PrincipalType: p.principalType,
      PrincipalID: p.principalId,
      CanRead: p.canRead,
      CanWrite: p.canWrite,
      CanDelete: p.canDelete,
      CanModify: p.canModify,
      CanFullControl: p.canFullControl,
      IsDeny: p.isDeny,
      ExpiryDate: p.expiryDate,
      GrantedBy: p.grantedBy,
      CanDownload: p.canDownload ?? false,
    });
    return Number(id);
  }

  async revokeFilePermission(
    filePermissionId: number,
    revokedBy: number,
    reason: string,
    scope?: Scope,
  ): Promise<void> {
    await this.sp.call(Sp.security.revokeFilePermission, scope?.sp).exec({
      FilePermissionID: filePermissionId,
      RevokedBy: revokedBy,
      RevokeReason: reason,
    });
  }

  // ── คัดลอกสิทธิ์โฟลเดอร์ลงไฟล์ ─────────────────────────────

  /**
   * คัดลอกสิทธิ์ของโฟลเดอร์ (ที่ยังไม่ถูกเพิกถอน/หมดอายุ) ลงไฟล์ที่ระบุ — ใช้ตอนอัปโหลดไฟล์ใหม่
   * (ไฟล์ใหม่ยังไม่มีสิทธิ์ระดับไฟล์ จึงไม่ต้อง revoke ของเดิม)
   */
  async copyFolderPermissionsToFile(
    folderId: number,
    fileId: number,
    grantedBy: number,
    scope: TransactionScope,
  ): Promise<number> {
    const rows = await this.query<{ N: number }>(
      `INSERT INTO security.FilePermission
         (FileID, PrincipalType, PrincipalID, CanRead, CanWrite, CanDelete, CanModify, CanFullControl, CanDownload,
          IsDeny, ExpiryDate, GrantedBy, GrantedDate)
       SELECT @1, p.PrincipalType, p.PrincipalID, p.CanRead, p.CanWrite, p.CanDelete, p.CanModify, p.CanFullControl, 0,
              p.IsDeny, p.ExpiryDate, @2, GETDATE()
         FROM security.FolderPermission p WHERE p.FolderID = @0 AND ${ACTIVE};
       SELECT @@ROWCOUNT AS N;`,
      [folderId, fileId, grantedBy],
      scope,
    );
    return Number(rows[0]?.N ?? 0);
  }

  /**
   * PropagatePermissionsToFiles: เพิกถอนสิทธิ์ระดับไฟล์เดิมของทุกไฟล์ที่ยังใช้งานในโฟลเดอร์ แล้วคัดลอกสิทธิ์โฟลเดอร์ลงไฟล์
   * (พฤติกรรมเดิม — สิทธิ์ที่แชร์ตรงให้ไฟล์ถูกเพิกถอนด้วย) · คืนจำนวนไฟล์ที่ได้รับผล
   */
  async propagateFolderToFiles(
    folderId: number,
    grantedBy: number,
    scope: TransactionScope,
  ): Promise<{ files: number; entries: number }> {
    const files = await this.query<{ C: number }>(
      'SELECT COUNT(*) AS C FROM storage.FileDocument WHERE FolderID = @0 AND FileStatus <> 3 AND DeletedDate IS NULL',
      [folderId],
      scope,
    );
    const fileCount = Number(files[0]?.C ?? 0);
    if (fileCount === 0) return { files: 0, entries: 0 };

    await this.query(
      `UPDATE fp SET RevokedBy = @1, RevokedDate = GETDATE(), RevokeReason = N'Propagated from folder permission'
         FROM security.FilePermission fp JOIN storage.FileDocument fd ON fd.FileID = fp.FileID
        WHERE fd.FolderID = @0 AND fd.FileStatus <> 3 AND fd.DeletedDate IS NULL AND fp.RevokedDate IS NULL`,
      [folderId, grantedBy],
      scope,
    );
    const inserted = await this.query<{ N: number }>(
      `INSERT INTO security.FilePermission
         (FileID, PrincipalType, PrincipalID, CanRead, CanWrite, CanDelete, CanModify, CanFullControl, CanDownload,
          IsDeny, ExpiryDate, GrantedBy, GrantedDate)
       SELECT fd.FileID, p.PrincipalType, p.PrincipalID, p.CanRead, p.CanWrite, p.CanDelete, p.CanModify,
              p.CanFullControl, 0, p.IsDeny, p.ExpiryDate, @1, GETDATE()
         FROM storage.FileDocument fd
        CROSS JOIN security.FolderPermission p
        WHERE fd.FolderID = @0 AND fd.FileStatus <> 3 AND fd.DeletedDate IS NULL
          AND p.FolderID = @0 AND ${ACTIVE};
       SELECT @@ROWCOUNT AS N;`,
      [folderId, grantedBy],
      scope,
    );
    return { files: fileCount, entries: Number(inserted[0]?.N ?? 0) };
  }
}
