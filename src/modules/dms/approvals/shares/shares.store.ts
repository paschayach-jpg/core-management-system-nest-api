import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import {
  bool,
  dateOrNull,
  num,
  numOrNull,
  PageArgs,
  Row,
  rowsOf,
  str,
  strOrNull,
  Tx,
} from '../common/db.types';

/** storage.ExternalShare (camelCase) — passwordHash ใช้ภายในเท่านั้น ห้ามส่งออก API */
export interface ExternalShareRow {
  externalShareId: number;
  shareToken: string;
  fileId: number | null;
  folderId: number | null;
  sharerUserId: number;
  approverUserId: number | null;
  passwordHash: string | null;
  expiryDate: Date | null;
  downloadLimit: number | null;
  currentDownloadCount: number;
  status: string;
  createdDate: Date;
  approvedDate: Date | null;
  disabledDate: Date | null;
  disabledReason: string | null;
  revokedBy: number | null;
  revokedDate: Date | null;
  revocationReason: string | null;
  sharePurpose: string | null;
  notifyOnAccess: boolean;
}

export interface ExternalShareListRow extends ExternalShareRow {
  sharerName: string | null;
  fileName: string | null;
  folderName: string | null;
}

export interface InternalShareRow {
  filePermissionId: number;
  fileId: number;
  principalType: number;
  principalId: number;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  isDeny: boolean;
  expiryDate: Date | null;
  grantedBy: number;
  grantedDate: Date;
  revokedBy: number | null;
  revokedDate: Date | null;
  revokeReason: string | null;
  fileName: string | null;
  grantedByName: string | null;
}

export interface AccessLogRow {
  accessLogId: string;
  shareToken: string;
  externalShareId: number;
  recipientIdentifier: string | null;
  accessType: string;
  isSuccessful: boolean;
  failureReason: string | null;
  fileSizeBytes: string | null;
  accessTimestamp: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface NewAccessLog {
  shareToken: string;
  externalShareId: number;
  recipientIdentifier: string | null;
  accessType: 'View' | 'Download';
  isSuccessful: boolean;
  failureReason: string | null;
  fileSizeBytes: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

const SHARE_COLS = `e.ExternalShareID, e.ShareToken, e.FileID, e.FolderID, e.SharerUserID, e.ApproverUserID,
       e.PasswordHash, e.ExpiryDate, e.DownloadLimit, e.CurrentDownloadCount, e.ShareTokenStatus,
       e.CreatedDate, e.ApprovedDate, e.DisabledDate, e.DisabledReason, e.RevokedBy, e.RevokedDate,
       e.RevocationReason, e.SharePurpose, e.NotifyOnAccess`;

export const mapShare = (r: Row): ExternalShareRow => ({
  externalShareId: num(r.ExternalShareID),
  shareToken: str(r.ShareToken).toLowerCase(),
  fileId: numOrNull(r.FileID),
  folderId: numOrNull(r.FolderID),
  sharerUserId: num(r.SharerUserID),
  approverUserId: numOrNull(r.ApproverUserID),
  passwordHash: strOrNull(r.PasswordHash),
  expiryDate: dateOrNull(r.ExpiryDate),
  downloadLimit: numOrNull(r.DownloadLimit),
  currentDownloadCount: num(r.CurrentDownloadCount),
  status: str(r.ShareTokenStatus),
  createdDate: dateOrNull(r.CreatedDate) as Date,
  approvedDate: dateOrNull(r.ApprovedDate),
  disabledDate: dateOrNull(r.DisabledDate),
  disabledReason: strOrNull(r.DisabledReason),
  revokedBy: numOrNull(r.RevokedBy),
  revokedDate: dateOrNull(r.RevokedDate),
  revocationReason: strOrNull(r.RevocationReason),
  sharePurpose: strOrNull(r.SharePurpose),
  notifyOnAccess: bool(r.NotifyOnAccess),
});

const mapShareList = (r: Row): ExternalShareListRow => ({
  ...mapShare(r),
  sharerName: strOrNull(r.SharerName),
  fileName: strOrNull(r.FileName),
  folderName: strOrNull(r.FolderName),
});

const mapInternal = (r: Row): InternalShareRow => ({
  filePermissionId: num(r.FilePermissionID),
  fileId: num(r.FileID),
  principalType: num(r.PrincipalType),
  principalId: num(r.PrincipalID),
  canRead: bool(r.CanRead),
  canWrite: bool(r.CanWrite),
  canDelete: bool(r.CanDelete),
  isDeny: bool(r.IsDeny),
  expiryDate: dateOrNull(r.ExpiryDate),
  grantedBy: num(r.GrantedBy),
  grantedDate: dateOrNull(r.GrantedDate) as Date,
  revokedBy: numOrNull(r.RevokedBy),
  revokedDate: dateOrNull(r.RevokedDate),
  revokeReason: strOrNull(r.RevokeReason),
  fileName: strOrNull(r.FileName),
  grantedByName: strOrNull(r.GrantedByName),
});

/** SQL ของ storage.ExternalShare / ShareToken / ShareAccessLog และ security.FilePermission (ฝั่งแชร์ภายใน) */
@Injectable()
export class SharesStore {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly sp: SpExecutor,
  ) {}

  private run(sql: string, params: unknown[], tx?: Tx): Promise<unknown> {
    return (tx?.manager ?? this.ds).query(sql, params);
  }

  // ── External share: อ่าน ──────────────────────────────────

  async getExternal(id: number, tx?: Tx, forUpdate = false): Promise<ExternalShareRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT ${SHARE_COLS} FROM storage.ExternalShare e ${
          forUpdate ? 'WITH (UPDLOCK, ROWLOCK)' : ''
        } WHERE e.ExternalShareID = @0`,
        [id],
        tx,
      ),
    );
    return rows[0] ? mapShare(rows[0]) : null;
  }

  /** token ต้องเป็นรูปแบบ GUID ที่ผ่านการตรวจแล้ว (ไม่เช่นนั้น SQL Server error 8169) */
  async getExternalByToken(token: string): Promise<ExternalShareRow | null> {
    const rows = rowsOf(
      await this.run(`SELECT ${SHARE_COLS} FROM storage.ExternalShare e WHERE e.ShareToken = @0`, [
        token,
      ]),
    );
    return rows[0] ? mapShare(rows[0]) : null;
  }

  private listFrom(): string {
    return `FROM storage.ExternalShare e
  LEFT JOIN EMS.UserAccount u ON u.UserID = e.SharerUserID
  LEFT JOIN storage.FileDocument d ON d.FileID = e.FileID
  LEFT JOIN storage.Folder f ON f.FolderID = e.FolderID`;
  }

  async pageExternal(
    filter: { sharerUserId?: number; status?: string },
    page: PageArgs,
  ): Promise<{ items: ExternalShareListRow[]; total: number }> {
    const where = `(@0 IS NULL OR e.SharerUserID = @0) AND (@1 IS NULL OR e.ShareTokenStatus = @1)`;
    const params = [filter.sharerUserId ?? null, filter.status ?? null];
    const totalRows = rowsOf(
      await this.run(`SELECT COUNT(*) AS C FROM storage.ExternalShare e WHERE ${where}`, params),
    );
    const rows = rowsOf(
      await this.run(
        `SELECT ${SHARE_COLS}, u.DisplayName AS SharerName, d.OriginalFileName AS FileName, f.FolderName AS FolderName
           ${this.listFrom()} WHERE ${where}
          ORDER BY e.CreatedDate DESC, e.ExternalShareID DESC OFFSET @2 ROWS FETCH NEXT @3 ROWS ONLY`,
        [...params, page.skip, page.take],
      ),
    );
    return { items: rows.map(mapShareList), total: num(totalRows[0]?.C) };
  }

  async getExternalListRow(id: number): Promise<ExternalShareListRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT ${SHARE_COLS}, u.DisplayName AS SharerName, d.OriginalFileName AS FileName, f.FolderName AS FolderName
           ${this.listFrom()} WHERE e.ExternalShareID = @0`,
        [id],
      ),
    );
    return rows[0] ? mapShareList(rows[0]) : null;
  }

  // ── External share: เขียน ─────────────────────────────────

  async insertExternal(
    tx: Tx,
    s: {
      token: string;
      fileId: number | null;
      folderId: number | null;
      sharerUserId: number;
      passwordHash: string | null;
      expiryDate: Date | null;
      downloadLimit: number | null;
      sharePurpose: string | null;
      notifyOnAccess: boolean;
    },
  ): Promise<number> {
    const rows = rowsOf(
      await tx.manager.query(
        `INSERT INTO storage.ExternalShare
           (ShareToken, FileID, FolderID, SharerUserID, PasswordHash, ExpiryDate, DownloadLimit,
            CurrentDownloadCount, ShareTokenStatus, CreatedDate, SharePurpose, NotifyOnAccess)
         VALUES (@0, @1, @2, @3, @4, @5, @6, 0, N'Pending', GETDATE(), @7, @8);
         SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`,
        [
          s.token,
          s.fileId,
          s.folderId,
          s.sharerUserId,
          s.passwordHash,
          s.expiryDate,
          s.downloadLimit,
          s.sharePurpose,
          s.notifyOnAccess ? 1 : 0,
        ],
      ),
    );
    return num(rows[0]?.Id);
  }

  async insertToken(
    tx: Tx,
    token: string,
    externalShareId: number,
    expiry: Date | null,
  ): Promise<void> {
    await tx.manager.query(
      `INSERT INTO storage.ShareToken (TokenValue, ExternalShareID, Status, CreatedDate, ExpiryDate)
       VALUES (@0, @1, N'Pending', GETDATE(), @2)`,
      [token, externalShareId, expiry],
    );
  }

  /** Pending → Active (เงื่อนไข Pending อยู่ใน WHERE) · คืน true ถ้าเปลี่ยนจริง · token ทุกตัว → Active */
  async activate(tx: Tx, id: number, approverId: number): Promise<boolean> {
    const rows = rowsOf(
      await tx.manager.query(
        `UPDATE storage.ExternalShare
            SET ShareTokenStatus = N'Active', ApprovedDate = GETDATE(), ApproverUserID = @1
          WHERE ExternalShareID = @0 AND ShareTokenStatus = N'Pending';
         SELECT @@ROWCOUNT AS Affected;`,
        [id, approverId],
      ),
    );
    const ok = num(rows[0]?.Affected) > 0;
    if (ok) {
      await tx.manager.query(
        `UPDATE storage.ShareToken SET Status = N'Active', ActivatedDate = GETDATE() WHERE ExternalShareID = @0`,
        [id],
      );
    }
    return ok;
  }

  /** → Revoked (ปฏิเสธ/ยกเลิก) ตามสถานะเดิมที่อนุญาต · token ทุกตัว → Revoked */
  async revoke(
    tx: Tx,
    id: number,
    userId: number,
    reason: string | null,
    allowedFrom: string[],
  ): Promise<boolean> {
    const ph = allowedFrom.map((_, i) => `@${i + 3}`).join(',');
    const rows = rowsOf(
      await tx.manager.query(
        `UPDATE storage.ExternalShare
            SET ShareTokenStatus = N'Revoked', RevokedBy = @1, RevokedDate = GETDATE(), RevocationReason = @2
          WHERE ExternalShareID = @0 AND ShareTokenStatus IN (${ph});
         SELECT @@ROWCOUNT AS Affected;`,
        [id, userId, reason, ...allowedFrom],
      ),
    );
    const ok = num(rows[0]?.Affected) > 0;
    if (ok) {
      await tx.manager.query(
        `UPDATE storage.ShareToken
            SET Status = N'Revoked', DisabledDate = GETDATE(), DisabledByUserID = @1, DisabledReason = @2
          WHERE ExternalShareID = @0`,
        [id, userId, reason],
      );
    }
    return ok;
  }

  /** Active ↔ Disabled · คืนสถานะใหม่ หรือ null ถ้าสถานะเดิมไม่ใช่ Active/Disabled */
  async toggle(tx: Tx, id: number, userId: number): Promise<'Active' | 'Disabled' | null> {
    const rows = rowsOf(
      await tx.manager.query(
        `DECLARE @t TABLE (NewStatus NVARCHAR(20));
         UPDATE storage.ExternalShare
            SET ShareTokenStatus = CASE WHEN ShareTokenStatus = N'Active' THEN N'Disabled' ELSE N'Active' END,
                DisabledDate     = CASE WHEN ShareTokenStatus = N'Active' THEN GETDATE() ELSE NULL END,
                DisabledReason   = CASE WHEN ShareTokenStatus = N'Active' THEN N'Disabled by owner' ELSE NULL END
          OUTPUT INSERTED.ShareTokenStatus INTO @t
          WHERE ExternalShareID = @0 AND ShareTokenStatus IN (N'Active', N'Disabled');
         SELECT NewStatus FROM @t;`,
        [id],
      ),
    );
    const status = strOrNull(rows[0]?.NewStatus);
    if (status !== 'Active' && status !== 'Disabled') return null;
    await tx.manager.query(
      `UPDATE storage.ShareToken
          SET Status = @1, DisabledDate = CASE WHEN @1 = N'Disabled' THEN GETDATE() ELSE NULL END,
              DisabledByUserID = CASE WHEN @1 = N'Disabled' THEN @2 ELSE NULL END,
              DisabledReason = CASE WHEN @1 = N'Disabled' THEN N'Disabled by owner' ELSE NULL END
        WHERE ExternalShareID = @0`,
      [id, status, userId],
    );
    return status;
  }

  /** Active ที่เลยวันหมดอายุ → Expired (ทำแบบ lazy ตอนมีคนเปิดลิงก์) */
  async markExpired(id: number): Promise<void> {
    await this.ds.query(
      `UPDATE storage.ExternalShare SET ShareTokenStatus = N'Expired'
        WHERE ExternalShareID = @0 AND ShareTokenStatus = N'Active' AND ExpiryDate IS NOT NULL AND ExpiryDate < GETDATE();
       UPDATE storage.ShareToken SET Status = N'Expired' WHERE ExternalShareID = @0 AND Status = N'Active'
         AND EXISTS (SELECT 1 FROM storage.ExternalShare x WHERE x.ExternalShareID = @0 AND x.ShareTokenStatus = N'Expired');`,
      [id],
    );
  }

  /**
   * นับการดาวน์โหลด 1 ครั้งแบบ atomic: สำเร็จเฉพาะเมื่อยัง Active, ไม่หมดอายุ และยังไม่ถึงเพดาน
   * (ถ้าครบเพดานจะเปลี่ยนเป็น Disabled ทันที เหมือน IncrementDownloadCount เดิม)
   * คืนจำนวนที่นับหลังเพิ่ม หรือ null ถ้าถูกแย่งตัดสิทธิ์ไปแล้ว (เช่น อีก request เพิ่งใช้ครั้งสุดท้าย)
   */
  async consumeDownloadSlot(
    id: number,
  ): Promise<{ count: number; becameDisabled: boolean } | null> {
    const rows = rowsOf(
      await this.ds.query(
        `DECLARE @t TABLE (Cnt INT, St NVARCHAR(20));
         UPDATE storage.ExternalShare
            SET CurrentDownloadCount = CurrentDownloadCount + 1,
                ShareTokenStatus = CASE WHEN DownloadLimit IS NOT NULL AND CurrentDownloadCount + 1 >= DownloadLimit
                                        THEN N'Disabled' ELSE ShareTokenStatus END,
                DisabledDate = CASE WHEN DownloadLimit IS NOT NULL AND CurrentDownloadCount + 1 >= DownloadLimit
                                    THEN GETDATE() ELSE DisabledDate END,
                DisabledReason = CASE WHEN DownloadLimit IS NOT NULL AND CurrentDownloadCount + 1 >= DownloadLimit
                                      THEN N'Download limit reached' ELSE DisabledReason END
          OUTPUT INSERTED.CurrentDownloadCount, INSERTED.ShareTokenStatus INTO @t
          WHERE ExternalShareID = @0 AND ShareTokenStatus = N'Active'
            AND (ExpiryDate IS NULL OR ExpiryDate >= GETDATE())
            AND (DownloadLimit IS NULL OR CurrentDownloadCount < DownloadLimit);
         SELECT Cnt, St FROM @t;`,
        [id],
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return { count: num(r.Cnt), becameDisabled: str(r.St) === 'Disabled' };
  }

  // ── Access log ───────────────────────────────────────────

  async insertAccessLog(l: NewAccessLog): Promise<void> {
    await this.ds.query(
      `INSERT INTO storage.ShareAccessLog
         (ShareToken, ExternalShareID, RecipientIdentifier, AccessType, IsSuccessful, FailureReason, FileSizeBytes, AccessTimestamp, IPAddress, UserAgent)
       VALUES (@0, @1, @2, @3, @4, @5, @6, GETDATE(), @7, @8)`,
      [
        l.shareToken,
        l.externalShareId,
        l.recipientIdentifier,
        l.accessType,
        l.isSuccessful ? 1 : 0,
        l.failureReason,
        l.fileSizeBytes,
        l.ipAddress?.slice(0, 45) ?? null,
        l.userAgent?.slice(0, 500) ?? null,
      ],
    );
  }

  async pageAccessLog(
    externalShareId: number,
    page: PageArgs,
  ): Promise<{ items: AccessLogRow[]; total: number }> {
    const totalRows = rowsOf(
      await this.run(
        `SELECT COUNT(*) AS C FROM storage.ShareAccessLog WHERE ExternalShareID = @0`,
        [externalShareId],
      ),
    );
    const rows = rowsOf(
      await this.run(
        `SELECT AccessLogID, ShareToken, ExternalShareID, RecipientIdentifier, AccessType, IsSuccessful,
                FailureReason, FileSizeBytes, AccessTimestamp, IPAddress, UserAgent
           FROM storage.ShareAccessLog WHERE ExternalShareID = @0
          ORDER BY AccessTimestamp DESC, AccessLogID DESC OFFSET @1 ROWS FETCH NEXT @2 ROWS ONLY`,
        [externalShareId, page.skip, page.take],
      ),
    );
    return {
      items: rows.map((r) => ({
        accessLogId: str(r.AccessLogID),
        shareToken: str(r.ShareToken).toLowerCase(),
        externalShareId: num(r.ExternalShareID),
        recipientIdentifier: strOrNull(r.RecipientIdentifier),
        accessType: str(r.AccessType),
        isSuccessful: bool(r.IsSuccessful),
        failureReason: strOrNull(r.FailureReason),
        fileSizeBytes:
          r.FileSizeBytes === null || r.FileSizeBytes === undefined ? null : str(r.FileSizeBytes),
        accessTimestamp: dateOrNull(r.AccessTimestamp) as Date,
        ipAddress: strOrNull(r.IPAddress),
        userAgent: strOrNull(r.UserAgent),
      })),
      total: num(totalRows[0]?.C),
    };
  }

  // ── Internal share (security.FilePermission) ───────────────

  async insertFilePermission(
    tx: Tx | undefined,
    p: {
      fileId: number;
      principalType: number;
      principalId: number;
      canRead: boolean;
      canWrite: boolean;
      canDelete: boolean;
      expiryDate: Date | null;
      grantedBy: number;
    },
  ): Promise<number> {
    const id = await this.sp.call(Sp.security.insertFilePermission, tx?.sp).scalar<number>({
      FileID: p.fileId,
      PrincipalType: p.principalType,
      PrincipalID: p.principalId,
      CanRead: p.canRead,
      CanWrite: p.canWrite,
      CanDelete: p.canDelete,
      CanModify: false,
      CanFullControl: false,
      IsDeny: false,
      ExpiryDate: p.expiryDate,
      GrantedBy: p.grantedBy,
    });
    return Number(id);
  }

  async getFilePermission(id: number, tx?: Tx): Promise<InternalShareRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT p.FilePermissionID, p.FileID, p.PrincipalType, p.PrincipalID, p.CanRead, p.CanWrite, p.CanDelete, p.IsDeny,
                p.ExpiryDate, p.GrantedBy, p.GrantedDate, p.RevokedBy, p.RevokedDate, p.RevokeReason,
                d.OriginalFileName AS FileName, u.DisplayName AS GrantedByName
           FROM security.FilePermission p
           LEFT JOIN storage.FileDocument d ON d.FileID = p.FileID
           LEFT JOIN EMS.UserAccount u ON u.UserID = p.GrantedBy
          WHERE p.FilePermissionID = @0`,
        [id],
        tx,
      ),
    );
    return rows[0] ? mapInternal(rows[0]) : null;
  }

  /** สิทธิ์ระดับไฟล์ที่ยังไม่ถูกเพิกถอนของไฟล์ (sp_GetFilePermissionsByFile) */
  async activeFilePermissions(fileId: number): Promise<InternalShareRow[]> {
    const rows = await this.sp
      .call(Sp.security.getFilePermissionsByFile)
      .rows<Row>({ FileID: fileId });
    return rows.map(mapInternal);
  }

  async revokeFilePermission(tx: Tx, id: number, userId: number, reason: string): Promise<void> {
    await this.sp
      .call(Sp.security.revokeFilePermission, tx.sp)
      .exec({ FilePermissionID: id, RevokedBy: userId, RevokeReason: reason });
  }

  /** รายการแชร์ภายในที่ยังไม่ถูกเพิกถอน: ของผู้ให้สิทธิ์คนเดียว หรือทั้งหมด (Admin) */
  async pageInternal(
    grantedBy: number | null,
    page: PageArgs,
  ): Promise<{ items: InternalShareRow[]; total: number }> {
    const where = `p.RevokedDate IS NULL AND (@0 IS NULL OR p.GrantedBy = @0)`;
    const totalRows = rowsOf(
      await this.run(`SELECT COUNT(*) AS C FROM security.FilePermission p WHERE ${where}`, [
        grantedBy,
      ]),
    );
    const rows = rowsOf(
      await this.run(
        `SELECT p.FilePermissionID, p.FileID, p.PrincipalType, p.PrincipalID, p.CanRead, p.CanWrite, p.CanDelete, p.IsDeny,
                p.ExpiryDate, p.GrantedBy, p.GrantedDate, p.RevokedBy, p.RevokedDate, p.RevokeReason,
                d.OriginalFileName AS FileName, u.DisplayName AS GrantedByName
           FROM security.FilePermission p
           LEFT JOIN storage.FileDocument d ON d.FileID = p.FileID
           LEFT JOIN EMS.UserAccount u ON u.UserID = p.GrantedBy
          WHERE ${where}
          ORDER BY p.GrantedDate DESC, p.FilePermissionID DESC OFFSET @1 ROWS FETCH NEXT @2 ROWS ONLY`,
        [grantedBy, page.skip, page.take],
      ),
    );
    return { items: rows.map(mapInternal), total: num(totalRows[0]?.C) };
  }
}
