import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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

/** หน่วยงานหลักที่เก็บโควตา (คอลัมน์ quota_size): 1=EMS.m_SubCommittee, 2=EMS.m_Division, 3=EMS.m_Department */
export type QuotaUnitType = 1 | 2 | 3;

export interface QuotaUnitRow {
  unitType: QuotaUnitType;
  /** PK ของตารางหลัก: SubCommitteeID / DivisionID / DepartmentID */
  unitId: number;
  /** EMS.OrgUnit ที่รหัสตรงกัน (ใช้ยื่นคำขอเพิ่มโควตา/ตรวจโควตาตอนอัปโหลด) — null ถ้าไม่มี */
  emsOrgUnitId: number | null;
  code: string;
  name: string;
  parentUnitId: number | null;
  quotaBytes: number;
}

export interface FileStat {
  fileCount: number;
  usedBytes: number;
}

/** โควตาของ EMS.OrgUnit หนึ่งหน่วย (ผ่านการจับคู่รหัสกับตารางหลัก) */
export interface OrgQuota {
  orgUnitId: number;
  orgUnitCode: string;
  orgUnitName: string;
  orgUnitType: number;
  /** 0 = ยังไม่ตั้งโควตา (ไม่จำกัด) */
  quotaBytes: number;
  unitType: QuotaUnitType | null;
  unitId: number | null;
}

export interface QuotaRequestRow {
  requestId: number;
  orgUnitId: number;
  orgUnitName: string | null;
  currentQuotaBytes: number;
  requestedQuotaBytes: number;
  reason: string | null;
  status: number;
  requestedBy: number;
  requestedByName: string | null;
  requestedDate: Date;
  reviewedBy: number | null;
  reviewedDate: Date | null;
  reviewRemark: string | null;
}

const UNIT_UNION = `
SELECT 1 AS UnitType, sc.SubCommitteeID AS UnitId, sc.OrgUnitID AS EmsOrgUnitId, sc.SubCommitteeCode AS Code,
       COALESCE(NULLIF(sc.SubCommitteeNameTH, ''), NULLIF(sc.SubCommitteeNameEN, ''), sc.SubCommitteeCode) AS Name,
       CAST(NULL AS INT) AS ParentUnitId, CAST(ISNULL(sc.quota_size, 0) AS BIGINT) AS QuotaBytes
  FROM EMS.m_SubCommittee sc WHERE sc.IsActive = 1 AND sc.IsDeleted = 0
UNION ALL
SELECT 2, d.DivisionID,
       (SELECT TOP 1 ou.OrgUnitID FROM EMS.OrgUnit ou WHERE ou.OrgUnitCode = d.DivisionCode AND ou.OrgUnitType = 2 AND ou.IsDeleted = 0),
       d.DivisionCode, d.DivisionName, CAST(NULL AS INT), CAST(ISNULL(d.quota_size, 0) AS BIGINT)
  FROM EMS.m_Division d WHERE d.IsActive = 1
UNION ALL
SELECT 3, dep.DepartmentID,
       (SELECT TOP 1 ou.OrgUnitID FROM EMS.OrgUnit ou WHERE ou.OrgUnitCode = dep.DepartmentCode AND ou.OrgUnitType = 3 AND ou.IsDeleted = 0),
       dep.DepartmentCode,
       COALESCE(NULLIF(dep.DepartmentNameTh, ''), NULLIF(dep.DepartmentNameEn, ''), dep.DepartmentName),
       CAST(dep.DivisionID AS INT), CAST(ISNULL(dep.quota_size, 0) AS BIGINT)
  FROM EMS.m_Department dep WHERE dep.IsActive = 1`;

/**
 * สรุปไฟล์/ขนาดที่ใช้ต่อหน่วยงานแบบรวมลำดับชั้น (พอร์ตจาก FolderQuotaConfigRepository.GetAllFileStats)
 *  - SubCommittee = ของตัวเอง + Division ที่เชื่อม (OrgUnitRelationship) + Department ใต้ Division เหล่านั้น
 *  - Division     = ของตัวเอง + Department ใต้ Division
 *  - Department   = OrgUnit ทุกตัวที่รหัสตรงกัน
 * ผลลัพธ์ติด UnitType เพราะ ID ของสามตารางหลักซ้ำกันได้ (ระบบเดิมใช้ dictionary เดียวทำให้ชนกัน)
 */
const FILE_STATS_SQL = `
SELECT 1 AS UnitType, EntityID, SUM(FileCount) AS FileCount, SUM(UsedBytes) AS UsedBytes
FROM (
    SELECT sc.SubCommitteeID AS EntityID, COUNT(fd.FileID) AS FileCount, ISNULL(SUM(fd.FileSizeBytes), 0) AS UsedBytes
      FROM EMS.m_SubCommittee sc
      JOIN storage.Folder f ON f.OrgUnitID = sc.OrgUnitID AND f.IsDeleted = 0
      LEFT JOIN storage.FileDocument fd ON fd.FolderID = f.FolderID AND fd.FileStatus = 1
     WHERE sc.IsActive = 1 AND sc.IsDeleted = 0 GROUP BY sc.SubCommitteeID
    UNION ALL
    SELECT sc.SubCommitteeID, COUNT(fd.FileID), ISNULL(SUM(fd.FileSizeBytes), 0)
      FROM EMS.m_SubCommittee sc
      JOIN EMS.OrgUnitRelationship rel ON rel.SubCommitteeID = sc.OrgUnitID AND rel.IsActive = 1
      JOIN EMS.m_Division d ON d.DivisionID = rel.DivisionID AND d.IsActive = 1
      JOIN EMS.OrgUnit ou ON ou.OrgUnitCode = d.DivisionCode AND ou.OrgUnitType = 2 AND ou.IsDeleted = 0
      JOIN storage.Folder f ON f.OrgUnitID = ou.OrgUnitID AND f.IsDeleted = 0
      LEFT JOIN storage.FileDocument fd ON fd.FolderID = f.FolderID AND fd.FileStatus = 1
     WHERE sc.IsActive = 1 AND sc.IsDeleted = 0 GROUP BY sc.SubCommitteeID
    UNION ALL
    SELECT sc.SubCommitteeID, COUNT(fd.FileID), ISNULL(SUM(fd.FileSizeBytes), 0)
      FROM EMS.m_SubCommittee sc
      JOIN EMS.OrgUnitRelationship rel ON rel.SubCommitteeID = sc.OrgUnitID AND rel.IsActive = 1
      JOIN EMS.m_Department dep ON dep.DivisionID = rel.DivisionID AND dep.IsActive = 1
      JOIN EMS.OrgUnit ou ON ou.OrgUnitCode = dep.DepartmentCode AND ou.OrgUnitType = 3 AND ou.IsDeleted = 0
      JOIN storage.Folder f ON f.OrgUnitID = ou.OrgUnitID AND f.IsDeleted = 0
      LEFT JOIN storage.FileDocument fd ON fd.FolderID = f.FolderID AND fd.FileStatus = 1
     WHERE sc.IsActive = 1 AND sc.IsDeleted = 0 GROUP BY sc.SubCommitteeID
) sc_agg GROUP BY EntityID
UNION ALL
SELECT 2, EntityID, SUM(FileCount), SUM(UsedBytes)
FROM (
    SELECT d.DivisionID AS EntityID, COUNT(fd.FileID) AS FileCount, ISNULL(SUM(fd.FileSizeBytes), 0) AS UsedBytes
      FROM EMS.m_Division d
      JOIN EMS.OrgUnit ou ON ou.OrgUnitCode = d.DivisionCode AND ou.OrgUnitType = 2 AND ou.IsDeleted = 0
      JOIN storage.Folder f ON f.OrgUnitID = ou.OrgUnitID AND f.IsDeleted = 0
      LEFT JOIN storage.FileDocument fd ON fd.FolderID = f.FolderID AND fd.FileStatus = 1
     WHERE d.IsActive = 1 GROUP BY d.DivisionID
    UNION ALL
    SELECT d.DivisionID, COUNT(fd.FileID), ISNULL(SUM(fd.FileSizeBytes), 0)
      FROM EMS.m_Division d
      JOIN EMS.m_Department dep ON dep.DivisionID = d.DivisionID AND dep.IsActive = 1
      JOIN EMS.OrgUnit ou ON ou.OrgUnitCode = dep.DepartmentCode AND ou.OrgUnitType = 3 AND ou.IsDeleted = 0
      JOIN storage.Folder f ON f.OrgUnitID = ou.OrgUnitID AND f.IsDeleted = 0
      LEFT JOIN storage.FileDocument fd ON fd.FolderID = f.FolderID AND fd.FileStatus = 1
     WHERE d.IsActive = 1 GROUP BY d.DivisionID
) div_agg GROUP BY EntityID
UNION ALL
SELECT 3, dep.DepartmentID, COUNT(fd.FileID), ISNULL(SUM(fd.FileSizeBytes), 0)
  FROM EMS.m_Department dep
  JOIN EMS.OrgUnit ou ON ou.OrgUnitCode = dep.DepartmentCode AND ou.OrgUnitType = 3 AND ou.IsDeleted = 0
  JOIN storage.Folder f ON f.OrgUnitID = ou.OrgUnitID AND f.IsDeleted = 0
  LEFT JOIN storage.FileDocument fd ON fd.FolderID = f.FolderID AND fd.FileStatus = 1
 WHERE dep.IsActive = 1 GROUP BY dep.DepartmentID`;

const mapUnit = (r: Row): QuotaUnitRow => ({
  unitType: num(r.UnitType) as QuotaUnitType,
  unitId: num(r.UnitId),
  emsOrgUnitId: numOrNull(r.EmsOrgUnitId),
  code: str(r.Code),
  name: str(r.Name),
  parentUnitId: numOrNull(r.ParentUnitId),
  quotaBytes: num(r.QuotaBytes),
});

const REQUEST_SELECT = `SELECT q.RequestID, q.OrgUnitID, ou.OrgUnitNameTH AS OrgUnitName, q.CurrentQuotaBytes, q.RequestedQuotaBytes,
       q.Reason, q.Status, q.RequestedBy, u.DisplayName AS RequestedByName, q.RequestedDate, q.ReviewedBy, q.ReviewedDate, q.ReviewRemark
  FROM dms.FolderQuotaChangeRequest q
  LEFT JOIN EMS.OrgUnit ou ON ou.OrgUnitID = q.OrgUnitID
  LEFT JOIN EMS.UserAccount u ON u.UserID = q.RequestedBy`;

const mapRequest = (r: Row): QuotaRequestRow => ({
  requestId: num(r.RequestID),
  orgUnitId: num(r.OrgUnitID),
  orgUnitName: strOrNull(r.OrgUnitName),
  currentQuotaBytes: num(r.CurrentQuotaBytes),
  requestedQuotaBytes: num(r.RequestedQuotaBytes),
  reason: strOrNull(r.Reason),
  status: num(r.Status),
  requestedBy: num(r.RequestedBy),
  requestedByName: strOrNull(r.RequestedByName),
  requestedDate: dateOrNull(r.RequestedDate) as Date,
  reviewedBy: numOrNull(r.ReviewedBy),
  reviewedDate: dateOrNull(r.ReviewedDate),
  reviewRemark: strOrNull(r.ReviewRemark),
});

const MASTER_BY_CODE: Record<number, string> = {
  1: `SELECT TOP 1 1 AS UnitType, sc.SubCommitteeID AS UnitId, CAST(ISNULL(sc.quota_size, 0) AS BIGINT) AS QuotaBytes
        FROM EMS.m_SubCommittee sc WHERE sc.IsActive = 1 AND sc.IsDeleted = 0
         AND (sc.SubCommitteeCode = @0 OR sc.OrgUnitID = @1)
        ORDER BY CASE WHEN sc.SubCommitteeCode = @0 THEN 0 ELSE 1 END`,
  2: `SELECT TOP 1 2 AS UnitType, d.DivisionID AS UnitId, CAST(ISNULL(d.quota_size, 0) AS BIGINT) AS QuotaBytes
        FROM EMS.m_Division d WHERE d.IsActive = 1 AND d.DivisionCode = @0`,
  3: `SELECT TOP 1 3 AS UnitType, dep.DepartmentID AS UnitId, CAST(ISNULL(dep.quota_size, 0) AS BIGINT) AS QuotaBytes
        FROM EMS.m_Department dep WHERE dep.IsActive = 1 AND dep.DepartmentCode = @0`,
};

/** SQL ของโควตา: คอลัมน์ quota_size บนตารางหลัก 3 ตาราง + dms.FolderQuotaChangeRequest */
@Injectable()
export class QuotaStore {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private run(sql: string, params: unknown[], tx?: Tx): Promise<unknown> {
    return (tx?.manager ?? this.ds).query(sql, params);
  }

  async listUnits(): Promise<QuotaUnitRow[]> {
    const rows = rowsOf(
      await this.run(`SELECT * FROM (${UNIT_UNION}) q ORDER BY q.UnitType, q.Name`, []),
    );
    return rows.map(mapUnit);
  }

  async getUnit(unitType: number, unitId: number, tx?: Tx): Promise<QuotaUnitRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT * FROM (${UNIT_UNION}) q WHERE q.UnitType = @0 AND q.UnitId = @1`,
        [unitType, unitId],
        tx,
      ),
    );
    return rows[0] ? mapUnit(rows[0]) : null;
  }

  /** map key `${unitType}:${unitId}` */
  async fileStats(): Promise<Map<string, FileStat>> {
    const rows = rowsOf(await this.run(FILE_STATS_SQL, []));
    const map = new Map<string, FileStat>();
    for (const r of rows) {
      map.set(`${num(r.UnitType)}:${num(r.EntityID)}`, {
        fileCount: num(r.FileCount),
        usedBytes: num(r.UsedBytes),
      });
    }
    return map;
  }

  /**
   * โควตาของ EMS.OrgUnit: จับคู่กับตารางหลักด้วยรหัส (SubCommittee จับด้วย OrgUnitID ได้อีกทาง)
   * ไม่ใช้การเทียบ "ID ตรงๆ" ที่ระบบเดิมใช้เป็นทางสำรอง เพราะ DivisionID/DepartmentID กับ OrgUnitID เป็นคนละ namespace (อาจจับผิดหน่วย)
   */
  async resolveOrgQuota(orgUnitId: number, tx?: Tx): Promise<OrgQuota | null> {
    const ous = rowsOf(
      await this.run(
        `SELECT OrgUnitID, OrgUnitCode, OrgUnitNameTH, OrgUnitType FROM EMS.OrgUnit WHERE OrgUnitID = @0 AND IsDeleted = 0`,
        [orgUnitId],
        tx,
      ),
    );
    const ou = ous[0];
    if (!ou) return null;
    const type = num(ou.OrgUnitType);
    const base: OrgQuota = {
      orgUnitId: num(ou.OrgUnitID),
      orgUnitCode: str(ou.OrgUnitCode),
      orgUnitName: strOrNull(ou.OrgUnitNameTH) ?? str(ou.OrgUnitCode),
      orgUnitType: type,
      quotaBytes: 0,
      unitType: null,
      unitId: null,
    };
    const sql = MASTER_BY_CODE[type];
    if (!sql) return base;
    const params = type === 1 ? [base.orgUnitCode, orgUnitId] : [base.orgUnitCode];
    const m = rowsOf(await this.run(sql, params, tx))[0];
    if (!m) return base;
    return {
      ...base,
      quotaBytes: num(m.QuotaBytes),
      unitType: num(m.UnitType) as QuotaUnitType,
      unitId: num(m.UnitId),
    };
  }

  /**
   * ขนาดที่ใช้ของ OrgUnit ตามที่ EnforceQuota ใช้: รวม FolderSizeBytes ของโฟลเดอร์หลักชั้นความลับ (ชื่อขึ้นต้น 1HC/2SC/3NC/4PC)
   * และโฟลเดอร์ย่อยทั้งหมดที่ยังไม่ถูกลบ/เก็บถาวร — นับแต่ละโฟลเดอร์ครั้งเดียว (เดิมโฟลเดอร์ที่ชื่อขึ้นต้นรหัสและซ้อนอยู่ใต้โฟลเดอร์หลักถูกนับซ้ำ)
   */
  async orgUsedBytes(orgUnitId: number): Promise<number> {
    const rows = rowsOf(
      await this.run(
        `WITH tree AS (
           SELECT f.FolderID FROM storage.Folder f
            WHERE f.OrgUnitID = @0 AND f.IsDeleted = 0 AND f.IsArchived = 0 AND f.ConfidentialityLevel BETWEEN 1 AND 4
              AND LEFT(LTRIM(RTRIM(f.FolderName)), 3) =
                  CASE f.ConfidentialityLevel WHEN 1 THEN '1HC' WHEN 2 THEN '2SC' WHEN 3 THEN '3NC' ELSE '4PC' END
           UNION ALL
           SELECT c.FolderID FROM storage.Folder c JOIN tree t ON c.ParentFolderID = t.FolderID
            WHERE c.OrgUnitID = @0 AND c.IsDeleted = 0 AND c.IsArchived = 0
         )
         SELECT ISNULL(SUM(CAST(f.FolderSizeBytes AS BIGINT)), 0) AS Used
           FROM storage.Folder f WHERE f.FolderID IN (SELECT FolderID FROM tree)
         OPTION (MAXRECURSION 100)`,
        [orgUnitId],
      ),
    );
    return Math.max(0, num(rows[0]?.Used));
  }

  /** ตั้งโควตา (0 = ลบการตั้งค่า) · คืน true ถ้ามีหน่วยงานนั้นจริง */
  async setQuota(
    tx: Tx,
    unitType: number,
    unitId: number,
    bytes: number,
    updatedBy: string,
  ): Promise<boolean> {
    let sql: string;
    let params: unknown[] = [unitId, bytes];
    switch (unitType) {
      case 1:
        sql = `UPDATE EMS.m_SubCommittee SET quota_size = @1, UpdatedBy = @2, UpdatedDate = GETDATE()
                WHERE SubCommitteeID = @0 AND IsActive = 1 AND IsDeleted = 0;`;
        params = [unitId, bytes, updatedBy.slice(0, 200)];
        break;
      case 2:
        sql = `UPDATE EMS.m_Division SET quota_size = @1 WHERE DivisionID = @0 AND IsActive = 1;`;
        break;
      case 3:
        sql = `UPDATE EMS.m_Department SET quota_size = @1 WHERE DepartmentID = @0 AND IsActive = 1;`;
        break;
      default:
        return false;
    }
    const rows = rowsOf(await tx.manager.query(`${sql} SELECT @@ROWCOUNT AS Affected;`, params));
    return num(rows[0]?.Affected) > 0;
  }

  // ── คำขอเพิ่มโควตา ────────────────────────────────────────

  async insertRequest(
    tx: Tx,
    r: {
      orgUnitId: number;
      currentQuotaBytes: number;
      requestedQuotaBytes: number;
      reason: string;
      requestedBy: number;
    },
  ): Promise<number> {
    const rows = rowsOf(
      await tx.manager.query(
        `INSERT INTO dms.FolderQuotaChangeRequest
           (OrgUnitID, CurrentQuotaBytes, RequestedQuotaBytes, Reason, Status, RequestedBy, RequestedDate)
         VALUES (@0, @1, @2, @3, 1, @4, GETDATE());
         SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id;`,
        [r.orgUnitId, r.currentQuotaBytes, r.requestedQuotaBytes, r.reason, r.requestedBy],
      ),
    );
    return num(rows[0]?.Id);
  }

  async getRequest(id: number, tx?: Tx, forUpdate = false): Promise<QuotaRequestRow | null> {
    const rows = rowsOf(
      await this.run(
        `${REQUEST_SELECT.replace(
          'FROM dms.FolderQuotaChangeRequest q',
          `FROM dms.FolderQuotaChangeRequest q ${forUpdate ? 'WITH (UPDLOCK, ROWLOCK)' : ''}`,
        )} WHERE q.RequestID = @0`,
        [id],
        tx,
      ),
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async pageRequests(
    filter: { status?: number; requestedBy?: number; orgUnitId?: number },
    page: PageArgs,
  ): Promise<{ items: QuotaRequestRow[]; total: number }> {
    const where = `(@0 IS NULL OR q.Status = @0) AND (@1 IS NULL OR q.RequestedBy = @1) AND (@2 IS NULL OR q.OrgUnitID = @2)`;
    const params = [filter.status ?? null, filter.requestedBy ?? null, filter.orgUnitId ?? null];
    const totalRows = rowsOf(
      await this.run(
        `SELECT COUNT(*) AS C FROM dms.FolderQuotaChangeRequest q WHERE ${where}`,
        params,
      ),
    );
    const rows = rowsOf(
      await this.run(
        `${REQUEST_SELECT} WHERE ${where}
          ORDER BY q.RequestedDate DESC, q.RequestID DESC OFFSET @3 ROWS FETCH NEXT @4 ROWS ONLY`,
        [...params, page.skip, page.take],
      ),
    );
    return { items: rows.map(mapRequest), total: num(totalRows[0]?.C) };
  }

  /** Pending → สถานะใหม่ (เงื่อนไข Pending อยู่ใน WHERE กันลงมติซ้ำ) · คืน true ถ้าเปลี่ยนจริง */
  async resolveRequest(
    tx: Tx,
    id: number,
    status: number,
    reviewedBy: number,
    remark: string | null,
  ): Promise<boolean> {
    const rows = rowsOf(
      await tx.manager.query(
        `UPDATE dms.FolderQuotaChangeRequest
            SET Status = @1, ReviewedBy = @2, ReviewedDate = GETDATE(), ReviewRemark = @3
          WHERE RequestID = @0 AND Status = 1;
         SELECT @@ROWCOUNT AS Affected;`,
        [id, status, reviewedBy, remark],
      ),
    );
    return num(rows[0]?.Affected) > 0;
  }

  /** ผู้ที่ควรได้รับแจ้งเตือนโควตา: Manager/Admin ของหน่วยงานนั้น; ไม่มี → Admin ทั้งหมด */
  async alertRecipients(orgUnitId: number): Promise<number[]> {
    const own = rowsOf(
      await this.run(
        `SELECT UserID FROM EMS.UserAccount WHERE IsActive = 1 AND AppRole >= 3 AND OrgUnitID = @0`,
        [orgUnitId],
      ),
    );
    if (own.length > 0) return own.map((r) => num(r.UserID));
    const admins = rowsOf(
      await this.run(`SELECT UserID FROM EMS.UserAccount WHERE IsActive = 1 AND AppRole = 4`, []),
    );
    return admins.map((r) => num(r.UserID));
  }
}
