import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import {
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
import type { StepLite } from '../common/approval-flow';

/** workflow.ApprovalRequest (camelCase) */
export interface ApprovalRequestRow {
  requestId: number;
  requestType: string;
  folderId: number | null;
  fileId: number | null;
  permissionId: number | null;
  requestedBy: number;
  requestedDate: Date;
  requestStatus: number;
  subject: string | null;
  remark: string | null;
  expiryDate: Date | null;
  resolvedBy: number | null;
  resolvedDate: Date | null;
  resolveRemark: string | null;
}

/** workflow.ApprovalStep (camelCase) */
export interface ApprovalStepRow extends StepLite {
  requestId: number;
  actionDate: Date | null;
  actionRemark: string | null;
  notifiedDate: Date | null;
  escalatedDate: Date | null;
}

/** แถวรายการคำขอ (join ชื่อผู้ขอ/โฟลเดอร์/ไฟล์ให้ client) */
export interface ApprovalListRow extends ApprovalRequestRow {
  requesterName: string | null;
  folderName: string | null;
  fileName: string | null;
  /** step ของผู้เรียกที่ลงมติได้ในคำขอนี้ (null = ไม่มี step ของตัวเอง เช่น Admin ที่เห็น CREATE_HC) */
  myStepId: number | null;
}

export interface NewRequest {
  requestType: string;
  folderId?: number | null;
  fileId?: number | null;
  permissionId?: number | null;
  requestedBy: number;
  subject: string | null;
  remark: string | null;
  expiryDate: Date | null;
}

const REQUEST_COLS = `r.RequestID, r.RequestType, r.FolderID, r.FileID, r.PermissionID, r.RequestedBy,
       r.RequestedDate, r.RequestStatus, r.Subject, r.Remark, r.ExpiryDate, r.ResolvedBy, r.ResolvedDate, r.ResolveRemark`;

const STEP_COLS = `StepID, RequestID, StepOrder, ApproverID, StepStatus, ActionDate, ActionRemark,
       DelegatedTo, NotifiedDate, EscalatedDate`;

export const mapRequest = (r: Row): ApprovalRequestRow => ({
  requestId: num(r.RequestID),
  requestType: str(r.RequestType),
  folderId: numOrNull(r.FolderID),
  fileId: numOrNull(r.FileID),
  permissionId: numOrNull(r.PermissionID),
  requestedBy: num(r.RequestedBy),
  requestedDate: dateOrNull(r.RequestedDate) as Date,
  requestStatus: num(r.RequestStatus),
  subject: strOrNull(r.Subject),
  remark: strOrNull(r.Remark),
  expiryDate: dateOrNull(r.ExpiryDate),
  resolvedBy: numOrNull(r.ResolvedBy),
  resolvedDate: dateOrNull(r.ResolvedDate),
  resolveRemark: strOrNull(r.ResolveRemark),
});

export const mapStep = (r: Row): ApprovalStepRow => ({
  stepId: num(r.StepID),
  requestId: num(r.RequestID),
  stepOrder: num(r.StepOrder),
  approverId: num(r.ApproverID),
  stepStatus: num(r.StepStatus),
  actionDate: dateOrNull(r.ActionDate),
  actionRemark: strOrNull(r.ActionRemark),
  delegatedTo: numOrNull(r.DelegatedTo),
  notifiedDate: dateOrNull(r.NotifiedDate),
  escalatedDate: dateOrNull(r.EscalatedDate),
});

/**
 * SQL ของ workflow.ApprovalRequest / ApprovalStep
 * (ApprovalStep มี ~2.2e5 แถว → ทุก query ผ่าน index (RequestID,StepOrder) หรือ (ApproverID,StepStatus) และแบ่งหน้า)
 */
@Injectable()
export class ApprovalsStore {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly sp: SpExecutor,
  ) {}

  private run(sql: string, params: unknown[], tx?: Tx): Promise<unknown> {
    return (tx?.manager ?? this.ds).query(sql, params);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** forUpdate = ล็อกแถวคำขอ (UPDLOCK) เพื่อกันสองคนลงมติพร้อมกัน */
  async getRequest(id: number, tx?: Tx, forUpdate = false): Promise<ApprovalRequestRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT ${REQUEST_COLS} FROM workflow.ApprovalRequest r ${
          forUpdate ? 'WITH (UPDLOCK, ROWLOCK)' : ''
        } WHERE r.RequestID = @0`,
        [id],
        tx,
      ),
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async getStep(stepId: number, tx?: Tx): Promise<ApprovalStepRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT ${STEP_COLS} FROM workflow.ApprovalStep WHERE StepID = @0`,
        [stepId],
        tx,
      ),
    );
    return rows[0] ? mapStep(rows[0]) : null;
  }

  /** ผู้ใช้นี้มี step (เป็นผู้อนุมัติ/ผู้รับมอบ) ในคำขอหรือไม่ — ใช้ index (RequestID, StepOrder) */
  async isAssignedApprover(requestId: number, userId: number): Promise<boolean> {
    const rows = rowsOf(
      await this.run(
        `SELECT TOP 1 1 AS X FROM workflow.ApprovalStep WHERE RequestID = @0 AND (ApproverID = @1 OR DelegatedTo = @1)`,
        [requestId, userId],
      ),
    );
    return rows.length > 0;
  }

  /** step ทั้งหมดของคำขอ เรียงตามลำดับ (ใช้ตัดสินการอนุมัติ — ไม่แบ่งหน้า) */
  async getSteps(requestId: number, tx?: Tx): Promise<ApprovalStepRow[]> {
    const rows = rowsOf(
      await this.run(
        `SELECT ${STEP_COLS} FROM workflow.ApprovalStep WHERE RequestID = @0 ORDER BY StepOrder`,
        [requestId],
        tx,
      ),
    );
    return rows.map(mapStep);
  }

  /** step ของคำขอแบบแบ่งหน้า (คำขอเก่าบางรายการมี step นับพัน จากบั๊ก escalation เดิม) */
  async pageSteps(
    requestId: number,
    page: PageArgs,
    dir: 'ASC' | 'DESC',
  ): Promise<{ items: ApprovalStepRow[]; total: number }> {
    const totalRows = rowsOf(
      await this.run(`SELECT COUNT(*) AS C FROM workflow.ApprovalStep WHERE RequestID = @0`, [
        requestId,
      ]),
    );
    const rows = rowsOf(
      await this.run(
        `SELECT ${STEP_COLS} FROM workflow.ApprovalStep WHERE RequestID = @0
          ORDER BY StepOrder ${dir} OFFSET @1 ROWS FETCH NEXT @2 ROWS ONLY`,
        [requestId, page.skip, page.take],
      ),
    );
    return { items: rows.map(mapStep), total: num(totalRows[0]?.C) };
  }

  private listSelect(withMyStep: boolean): string {
    return `SELECT ${REQUEST_COLS},
       u.DisplayName AS RequesterName, f.FolderName AS FolderName, d.OriginalFileName AS FileName,
       ${
         withMyStep
           ? `(SELECT TOP 1 s.StepID FROM workflow.ApprovalStep s
                WHERE s.RequestID = r.RequestID AND s.StepStatus IN (1, 4)
                  AND (s.ApproverID = @0 OR s.DelegatedTo = @0)
                ORDER BY CASE WHEN s.StepStatus = 1 THEN 0 ELSE 1 END, s.StepOrder)`
           : 'CAST(NULL AS INT)'
       } AS MyStepId
  FROM workflow.ApprovalRequest r
  LEFT JOIN EMS.UserAccount u ON u.UserID = r.RequestedBy
  LEFT JOIN storage.Folder f ON f.FolderID = r.FolderID
  LEFT JOIN storage.FileDocument d ON d.FileID = r.FileID`;
  }

  private mapList(r: Row): ApprovalListRow {
    return {
      ...mapRequest(r),
      requesterName: strOrNull(r.RequesterName),
      folderName: strOrNull(r.FolderName),
      fileName: strOrNull(r.FileName),
      myStepId: numOrNull(r.MyStepId),
    };
  }

  /**
   * คำขอที่รอฉันอนุมัติ (RequestStatus=1) — เงื่อนไขเดียวกับ GetPendingForApprover เดิม แต่ทำใน SQL ครั้งเดียวแทนการวนดึง step ทุกคำขอ:
   *  - มี step ของฉัน (ApproverID/DelegatedTo) ที่ Pending/Delegated
   *  - Admin เห็นคำขอ CREATE_HC ทุกอัน
   *  - Manager/Admin เห็นคำขอ DELETE_FOLDER ที่ยังมี step ค้าง (fallback เดิม)
   */
  async pagePendingFor(
    userId: number,
    appRole: number,
    page: PageArgs,
  ): Promise<{ items: ApprovalListRow[]; total: number }> {
    const isAdmin = appRole >= 4 ? 1 : 0;
    const isManager = appRole >= 3 ? 1 : 0;
    const where = `r.RequestStatus = 1 AND (
         EXISTS (SELECT 1 FROM workflow.ApprovalStep s WHERE s.RequestID = r.RequestID
                   AND s.StepStatus IN (1, 4) AND (s.ApproverID = @0 OR s.DelegatedTo = @0))
      OR (@1 = 1 AND r.RequestType = 'CREATE_HC')
      OR (@2 = 1 AND r.RequestType = 'DELETE_FOLDER'
          AND EXISTS (SELECT 1 FROM workflow.ApprovalStep s2 WHERE s2.RequestID = r.RequestID AND s2.StepStatus IN (1, 4))))`;
    const totalRows = rowsOf(
      await this.run(`SELECT COUNT(*) AS C FROM workflow.ApprovalRequest r WHERE ${where}`, [
        userId,
        isAdmin,
        isManager,
      ]),
    );
    const rows = rowsOf(
      await this.run(
        `${this.listSelect(true)} WHERE ${where}
          ORDER BY r.RequestedDate DESC, r.RequestID DESC OFFSET @3 ROWS FETCH NEXT @4 ROWS ONLY`,
        [userId, isAdmin, isManager, page.skip, page.take],
      ),
    );
    return { items: rows.map((r) => this.mapList(r)), total: num(totalRows[0]?.C) };
  }

  /** คำขอที่ฉันยื่น (กรองสถานะได้) */
  async pageRequestedBy(
    userId: number,
    status: number | null,
    page: PageArgs,
  ): Promise<{ items: ApprovalListRow[]; total: number }> {
    const where = `r.RequestedBy = @0 AND (@1 IS NULL OR r.RequestStatus = @1)`;
    const totalRows = rowsOf(
      await this.run(`SELECT COUNT(*) AS C FROM workflow.ApprovalRequest r WHERE ${where}`, [
        userId,
        status,
      ]),
    );
    const rows = rowsOf(
      await this.run(
        `${this.listSelect(true)} WHERE ${where}
          ORDER BY r.RequestedDate DESC, r.RequestID DESC OFFSET @2 ROWS FETCH NEXT @3 ROWS ONLY`,
        [userId, status, page.skip, page.take],
      ),
    );
    return { items: rows.map((r) => this.mapList(r)), total: num(totalRows[0]?.C) };
  }

  /** ทุกสถานะของโฟลเดอร์ (GetAllRequestsByFolder เดิม) */
  async pageByFolder(
    folderId: number,
    page: PageArgs,
  ): Promise<{ items: ApprovalListRow[]; total: number }> {
    const totalRows = rowsOf(
      await this.run(`SELECT COUNT(*) AS C FROM workflow.ApprovalRequest r WHERE r.FolderID = @0`, [
        folderId,
      ]),
    );
    const rows = rowsOf(
      await this.run(
        `${this.listSelect(false)} WHERE r.FolderID = @0
          ORDER BY r.RequestedDate DESC, r.RequestID DESC OFFSET @1 ROWS FETCH NEXT @2 ROWS ONLY`,
        [folderId, page.skip, page.take],
      ),
    );
    return { items: rows.map((r) => this.mapList(r)), total: num(totalRows[0]?.C) };
  }

  async getListRow(id: number, userId: number): Promise<ApprovalListRow | null> {
    const rows = rowsOf(
      await this.run(`${this.listSelect(true)} WHERE r.RequestID = @1`, [userId, id]),
    );
    return rows[0] ? this.mapList(rows[0]) : null;
  }

  /** คำขอดาวน์โหลดที่อนุมัติแล้วและยังไม่ถูกใช้ (RequestStatus=2) ของผู้ใช้กับไฟล์นี้ */
  async findApprovedDownload(userId: number, fileId: number): Promise<ApprovalRequestRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT TOP 1 ${REQUEST_COLS} FROM workflow.ApprovalRequest r
          WHERE r.RequestType = 'DOWNLOAD_FILE' AND r.FileID = @0 AND r.RequestedBy = @1 AND r.RequestStatus = 2
          ORDER BY r.RequestedDate DESC`,
        [fileId, userId],
      ),
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  /** คำขอที่ยัง Pending แต่เลยกำหนด (sp_GetExpiredPendingRequests) เก่าสุดก่อน จำกัดจำนวนต่อรอบ */
  async getExpiredPending(limit: number): Promise<ApprovalRequestRow[]> {
    const rows = await this.sp.call(Sp.workflow.getExpiredPendingRequests).rows<Row>({});
    return rows
      .map(mapRequest)
      .sort((a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0))
      .slice(0, limit);
  }

  // ── เขียน (ต้องอยู่ใน transaction) ──────────────────────────

  async insertRequest(tx: Tx, r: NewRequest): Promise<number> {
    const rows = rowsOf(
      await tx.manager.query(
        `INSERT INTO workflow.ApprovalRequest
           (RequestType, FolderID, FileID, PermissionID, RequestedBy, RequestedDate, RequestStatus, Subject, Remark, ExpiryDate)
         VALUES (@0, @1, @2, @3, @4, GETDATE(), 1, @5, @6, @7);
         SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`,
        [
          r.requestType,
          r.folderId ?? null,
          r.fileId ?? null,
          r.permissionId ?? null,
          r.requestedBy,
          r.subject,
          r.remark,
          r.expiryDate,
        ],
      ),
    );
    return num(rows[0]?.Id);
  }

  async insertStep(
    tx: Tx,
    requestId: number,
    stepOrder: number,
    approverId: number,
  ): Promise<number> {
    const rows = rowsOf(
      await tx.manager.query(
        `INSERT INTO workflow.ApprovalStep (RequestID, StepOrder, ApproverID, StepStatus)
         VALUES (@0, @1, @2, 1);
         SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`,
        [requestId, stepOrder, approverId],
      ),
    );
    return num(rows[0]?.Id);
  }

  /** sp_UpdateApprovalStepStatus: ตั้งสถานะ + ActionDate=now + ActionRemark */
  async updateStepStatus(
    tx: Tx,
    stepId: number,
    status: number,
    remark: string | null,
  ): Promise<void> {
    await this.sp.call(Sp.workflow.updateApprovalStepStatus, tx.sp).exec({
      StepID: stepId,
      StepStatus: status,
      ActionRemark: remark,
    });
  }

  async markStepEscalated(tx: Tx, stepId: number): Promise<void> {
    await tx.manager.query(
      `UPDATE workflow.ApprovalStep SET EscalatedDate = GETDATE() WHERE StepID = @0`,
      [stepId],
    );
  }

  /** sp_UpdateApprovalRequestStatus: ตั้งสถานะ + ResolvedBy/ResolvedDate/ResolveRemark */
  async updateRequestStatus(
    tx: Tx,
    requestId: number,
    status: number,
    resolvedBy: number,
    remark: string | null,
  ): Promise<void> {
    await this.sp.call(Sp.workflow.updateApprovalRequestStatus, tx.sp).exec({
      RequestID: requestId,
      RequestStatus: status,
      ResolvedBy: resolvedBy,
      ResolveRemark: remark,
    });
  }

  async extendExpiry(tx: Tx, requestId: number, newExpiry: Date): Promise<void> {
    await tx.manager.query(
      `UPDATE workflow.ApprovalRequest SET ExpiryDate = @1 WHERE RequestID = @0`,
      [requestId, newExpiry],
    );
  }

  /**
   * ใช้สิทธิ์ดาวน์โหลด (Approved → 5): สำเร็จครั้งเดียวต่อคำขอเท่านั้น (เงื่อนไขอยู่ใน WHERE) · คืน true ถ้าเป็นผู้ใช้สิทธิ์
   * ไม่ทับ ResolvedBy/ResolvedDate (ระบบเดิมทับด้วยผู้ดาวน์โหลด ทำให้ไม่รู้ว่าใครอนุมัติ)
   */
  async consumeDownload(tx: Tx, requestId: number, userId: number): Promise<boolean> {
    const rows = rowsOf(
      await tx.manager.query(
        `UPDATE workflow.ApprovalRequest
            SET RequestStatus = 5,
                ResolveRemark = LEFT(ISNULL(ResolveRemark + N' | ', N'') + N'ดาวน์โหลดเรียบร้อยแล้ว', 500)
          WHERE RequestID = @0 AND RequestedBy = @1 AND RequestType = 'DOWNLOAD_FILE' AND RequestStatus = 2;
         SELECT @@ROWCOUNT AS Affected;`,
        [requestId, userId],
      ),
    );
    return num(rows[0]?.Affected) > 0;
  }

  /**
   * หาคำขออนุมัติที่ผูกกับแชร์ภายนอกและยัง Pending (ใช้ปิดคำขอเมื่อแชร์ถูกอนุมัติ/ปฏิเสธ/ยกเลิกจากหน้าจัดการแชร์)
   * ค้นจาก Remark: รูปแบบเก่า `ExternalShareID:<n>` หรือ JSON ใหม่ `"externalShareId":<n>` — จำกัดชนิด EXTERNAL_SHARE/CHANGE_PERMISSION
   * (CHANGE_PERMISSION = กรณีสำรองของ DB รุ่นเก่า) และสถานะ Pending จึงสแกนแถวน้อยมาก (ตารางนี้ ~40 แถว)
   */
  async findPendingRequestForExternalShare(
    tx: Tx,
    externalShareId: number,
  ): Promise<ApprovalRequestRow | null> {
    const rows = rowsOf(
      await tx.manager.query(
        `SELECT TOP 1 ${REQUEST_COLS} FROM workflow.ApprovalRequest r WITH (UPDLOCK, ROWLOCK)
          WHERE r.RequestStatus = 1 AND r.RequestType IN ('EXTERNAL_SHARE', 'CHANGE_PERMISSION')
            AND (r.Remark = @0 OR r.Remark LIKE @1)
          ORDER BY r.RequestID DESC`,
        [`ExternalShareID:${externalShareId}`, `%"externalShareId":${externalShareId}[,}]%`],
      ),
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }
}
