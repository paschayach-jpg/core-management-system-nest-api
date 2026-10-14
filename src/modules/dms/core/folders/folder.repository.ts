import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import type { TransactionScope } from '../../../../database/transaction-runner.service';
import { buildFolderPhysicalPath } from '../rules/folder.rules';
import { FolderPathItem, FolderRow, mapFolderRow, NewFolder } from './folder.types';

type Scope = TransactionScope | undefined;
type Raw = Record<string, unknown>;

/** คอลัมน์โฟลเดอร์มาตรฐาน — FileCount นับสดเหมือน SP ของระบบเดิม */
export const FOLDER_COLUMNS = `f.FolderID, f.FolderGUID, f.FolderName, f.ParentFolderID, f.OrgUnitID, f.TemplateID,
  f.ConfidentialityLevel, f.FolderDepth, f.FolderSizeBytes,
  (SELECT COUNT(*) FROM storage.FileDocument fd
    WHERE fd.FolderID = f.FolderID AND fd.FileStatus <> 3 AND fd.DeletedDate IS NULL) AS FileCount,
  f.IsArchived, f.ArchivedBy, f.ArchivedDate, f.IsDeleted, f.DeletedBy, f.DeletedDate, f.RecycleBinExpiry,
  f.InheritPermission, f.CreatedBy, f.CreatedDate, f.UpdatedBy, f.UpdatedDate`;

/** recursive CTE: โฟลเดอร์ตัวเองและลูกหลานทุกชั้น (รวมที่ถูกลบ) — จำกัดชั้นกันวงวน */
const SUBTREE_CTE = `WITH t AS (
    SELECT FolderID, 0 AS Lvl FROM storage.Folder WHERE FolderID = @0
    UNION ALL
    SELECT c.FolderID, t.Lvl + 1 FROM storage.Folder c JOIN t ON c.ParentFolderID = t.FolderID WHERE t.Lvl < 30
  )`;

export interface SubtreeStats {
  folderCount: number;
  fileCount: number;
  sizeBytes: string;
}

export interface DeletedFolderQuery {
  /** null = ไม่กรองหน่วยงาน */
  orgUnitIds: number[] | null;
  deletedBy?: number;
  /** แสดงเฉพาะโฟลเดอร์ที่ถูกลบโดยตรง (แม่ของมันยังไม่ถูกลบ) */
  topLevelOnly: boolean;
  /** เฉพาะที่ยังกู้คืนได้ (DeletedDate >= since) */
  deletedSince?: Date;
  page: number;
  pageSize: number;
}

/**
 * การเข้าถึงข้อมูล storage.Folder (SP เดิมเป็นหลัก, SQL ตรงเมื่อ SP ไม่รองรับ)
 * ทุกเมธอดรับ `scope` (ถ้ามี) เพื่อรันใน transaction เดียวกับผู้เรียก
 */
@Injectable()
export class FolderRepository {
  constructor(
    private readonly sp: SpExecutor,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  private query<T = Raw>(sql: string, params: unknown[], scope?: Scope): Promise<T[]> {
    return (scope ? scope.manager.query(sql, params) : this.ds.query(sql, params)) as Promise<T[]>;
  }

  // ── อ่านด้วย SP ────────────────────────────────────────────

  async getById(folderId: number, scope?: Scope): Promise<FolderRow | null> {
    const row = await this.sp
      .call(Sp.storage.getFolderById, scope?.sp)
      .one<Raw>({ FolderID: folderId });
    return row ? mapFolderRow(row) : null;
  }

  async getChildren(parentId: number, scope?: Scope): Promise<FolderRow[]> {
    const rows = await this.sp
      .call(Sp.storage.getFolderChildren, scope?.sp)
      .rows<Raw>({ ParentFolderID: parentId });
    return rows.map(mapFolderRow);
  }

  async getRootsByOrgUnit(orgUnitId: number, scope?: Scope): Promise<FolderRow[]> {
    const rows = await this.sp
      .call(Sp.storage.getRootFoldersByOrgUnit, scope?.sp)
      .rows<Raw>({ OrgUnitID: orgUnitId });
    return rows.map(mapFolderRow);
  }

  /** โฟลเดอร์ตามรหัส (รวมที่ถูกลบ/เก็บถาวร) */
  async getByIds(folderIds: readonly number[]): Promise<FolderRow[]> {
    const ids = [...new Set(folderIds)].slice(0, 2000);
    if (ids.length === 0) return [];
    const ph = ids.map((_, i) => `@${i}`).join(',');
    const rows = await this.query<Raw>(
      `SELECT ${FOLDER_COLUMNS} FROM storage.Folder f WHERE f.FolderID IN (${ph})`,
      ids,
    );
    return rows.map(mapFolderRow);
  }

  async getByOrgUnit(orgUnitId: number): Promise<FolderRow[]> {
    const rows = await this.sp
      .call(Sp.storage.getFoldersByOrgUnit)
      .rows<Raw>({ OrgUnitID: orgUnitId });
    return rows.map(mapFolderRow);
  }

  async getAllActive(): Promise<FolderRow[]> {
    const rows = await this.sp.call(Sp.storage.getAllFolders).rows<Raw>({});
    return rows.map(mapFolderRow);
  }

  /** โฟลเดอร์พี่น้อง (ไม่รวมที่ถูกลบ) ใต้แม่เดียวกันในหน่วยงานเดียวกัน */
  async getSiblings(
    parentId: number | null,
    orgUnitId: number,
    scope?: Scope,
  ): Promise<FolderRow[]> {
    const rows = await this.sp
      .call(Sp.storage.getFolderSiblings, scope?.sp)
      .rows<Raw>({ ParentFolderID: parentId, OrgUnitID: orgUnitId });
    return rows.map(mapFolderRow);
  }

  /** ตัวมันเองและลูกหลานทุกชั้น (SP รวมตัวมันเอง และรวมที่ถูกลบ) */
  async getSubtree(folderId: number, scope?: Scope): Promise<FolderRow[]> {
    const rows = await this.sp
      .call(Sp.storage.getFolderDescendants, scope?.sp)
      .rows<Raw>({ FolderID: folderId });
    return rows.map(mapFolderRow);
  }

  // ── อ่านด้วย SQL ───────────────────────────────────────────

  /** เส้นทางจาก Root ถึงโฟลเดอร์ (รวมตัวมันเอง) */
  async getPath(folderId: number, scope?: Scope): Promise<FolderPathItem[]> {
    const rows = await this.query<{ FolderID: number; FolderName: string }>(
      `WITH chain AS (
         SELECT FolderID, ParentFolderID, FolderName, 0 AS Lvl FROM storage.Folder WHERE FolderID = @0
         UNION ALL
         SELECT p.FolderID, p.ParentFolderID, p.FolderName, c.Lvl + 1
           FROM storage.Folder p JOIN chain c ON p.FolderID = c.ParentFolderID WHERE c.Lvl < 20
       )
       SELECT FolderID, FolderName FROM chain ORDER BY Lvl DESC`,
      [folderId],
      scope,
    );
    return rows.map((r) => ({ folderId: Number(r.FolderID), folderName: r.FolderName }));
  }

  /** Root ของสายเลือด (โฟลเดอร์ที่ไม่มีแม่) — null ถ้าสายขาด/วนลูป */
  async getRootAncestor(folderId: number, scope?: Scope): Promise<FolderRow | null> {
    const rows = await this.query<Raw>(
      `WITH chain AS (
         SELECT FolderID, ParentFolderID, 0 AS Lvl FROM storage.Folder WHERE FolderID = @0
         UNION ALL
         SELECT p.FolderID, p.ParentFolderID, c.Lvl + 1
           FROM storage.Folder p JOIN chain c ON p.FolderID = c.ParentFolderID WHERE c.Lvl < 20
       )
       SELECT TOP 1 ${FOLDER_COLUMNS}
         FROM storage.Folder f JOIN chain ON chain.FolderID = f.FolderID
        WHERE f.ParentFolderID IS NULL ORDER BY chain.Lvl DESC`,
      [folderId],
      scope,
    );
    return rows[0] ? mapFolderRow(rows[0]) : null;
  }

  /** รหัสโฟลเดอร์ทั้งต้นไม้ย่อย (รวมตัวมันเองและที่ถูกลบ) */
  async getSubtreeIds(folderId: number, scope?: Scope): Promise<number[]> {
    const rows = await this.query<{ FolderID: number }>(
      `${SUBTREE_CTE} SELECT DISTINCT FolderID FROM t`,
      [folderId],
      scope,
    );
    return rows.map((r) => Number(r.FolderID));
  }

  /** จำนวนไฟล์ที่ยังใช้งานอยู่ทั้งต้นไม้ย่อย */
  async countActiveFilesInSubtree(folderId: number, scope?: Scope): Promise<number> {
    const rows = await this.query<{ C: number }>(
      `${SUBTREE_CTE}
       SELECT COUNT(*) AS C FROM storage.FileDocument fd
        WHERE fd.FolderID IN (SELECT FolderID FROM t) AND fd.FileStatus <> 3 AND fd.DeletedDate IS NULL`,
      [folderId],
      scope,
    );
    return Number(rows[0]?.C ?? 0);
  }

  async subtreeStats(folderId: number): Promise<SubtreeStats> {
    const rows = await this.query<{ FolderCount: number; FileCount: number; SizeBytes: string }>(
      `${SUBTREE_CTE}
       SELECT
         (SELECT COUNT(DISTINCT FolderID) FROM storage.Folder
           WHERE FolderID IN (SELECT FolderID FROM t) AND IsDeleted = 0) AS FolderCount,
         (SELECT COUNT(*) FROM storage.FileDocument fd
           WHERE fd.FolderID IN (SELECT FolderID FROM t) AND fd.FileStatus <> 3 AND fd.DeletedDate IS NULL) AS FileCount,
         (SELECT ISNULL(SUM(CAST(fd.FileSizeBytes AS BIGINT)), 0) FROM storage.FileDocument fd
           WHERE fd.FolderID IN (SELECT FolderID FROM t) AND fd.FileStatus <> 3 AND fd.DeletedDate IS NULL) AS SizeBytes`,
      [folderId],
    );
    const r = rows[0];
    return {
      folderCount: Number(r?.FolderCount ?? 0),
      fileCount: Number(r?.FileCount ?? 0),
      sizeBytes: String(r?.SizeBytes ?? '0'),
    };
  }

  /** จำนวน/ขนาดไฟล์ที่ยังใช้งานในโฟลเดอร์นี้โดยตรง (นับสด) */
  async directStats(folderId: number): Promise<{ fileCount: number; sizeBytes: string }> {
    const rows = await this.query<{ C: number; S: string }>(
      `SELECT COUNT(*) AS C, ISNULL(SUM(CAST(FileSizeBytes AS BIGINT)), 0) AS S
         FROM storage.FileDocument WHERE FolderID = @0 AND FileStatus <> 3 AND DeletedDate IS NULL`,
      [folderId],
    );
    return { fileCount: Number(rows[0]?.C ?? 0), sizeBytes: String(rows[0]?.S ?? '0') };
  }

  async orgUnitIsUsable(orgUnitId: number, scope?: Scope): Promise<boolean> {
    const rows = await this.query<{ C: number }>(
      'SELECT COUNT(*) AS C FROM EMS.OrgUnit WHERE OrgUnitID = @0 AND IsDeleted = 0 AND IsActive = 1',
      [orgUnitId],
      scope,
    );
    return Number(rows[0]?.C ?? 0) > 0;
  }

  /** ผู้ใช้ที่ใช้งานอยู่ตามบทบาท (ใช้หาผู้อนุมัติ DELETE_FOLDER = Admin) */
  async activeUserIdsByRole(appRole: number): Promise<number[]> {
    const rows = await this.query<{ UserID: number }>(
      'SELECT UserID FROM EMS.UserAccount WHERE AppRole = @0 AND IsActive = 1 ORDER BY UserID',
      [appRole],
    );
    return rows.map((r) => Number(r.UserID));
  }

  /** รายการโฟลเดอร์ในถังขยะ (แบ่งหน้า) */
  async listDeleted(q: DeletedFolderQuery): Promise<{ items: FolderRow[]; total: number }> {
    const where: string[] = ['f.IsDeleted = 1'];
    const params: unknown[] = [];
    const add = (sql: string, ...values: unknown[]) => {
      let s = sql;
      for (const v of values) {
        params.push(v);
        s = s.replace('?', `@${params.length - 1}`);
      }
      where.push(s);
    };
    if (q.orgUnitIds) {
      if (q.orgUnitIds.length === 0) return { items: [], total: 0 };
      const ids = q.orgUnitIds.slice(0, 2000);
      const ph = ids.map((id) => {
        params.push(id);
        return `@${params.length - 1}`;
      });
      where.push(`f.OrgUnitID IN (${ph.join(',')})`);
    }
    if (q.deletedBy !== undefined) add('f.DeletedBy = ?', q.deletedBy);
    if (q.deletedSince) add('(f.DeletedDate IS NULL OR f.DeletedDate >= ?)', q.deletedSince);
    if (q.topLevelOnly) {
      where.push(
        `(f.ParentFolderID IS NULL OR NOT EXISTS (
            SELECT 1 FROM storage.Folder p WHERE p.FolderID = f.ParentFolderID AND p.IsDeleted = 1))`,
      );
    }
    const whereSql = where.join(' AND ');
    const [count] = await this.query<{ C: number }>(
      `SELECT COUNT(*) AS C FROM storage.Folder f WHERE ${whereSql}`,
      params,
    );
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.query<Raw>(
      `SELECT ${FOLDER_COLUMNS} FROM storage.Folder f
        WHERE ${whereSql}
        ORDER BY f.DeletedDate DESC, f.FolderID DESC
        OFFSET ${offset} ROWS FETCH NEXT ${q.pageSize} ROWS ONLY`,
      params,
    );
    return { items: rows.map(mapFolderRow), total: Number(count?.C ?? 0) };
  }

  /** โฟลเดอร์ระดับบนสุดที่ถูกลบและเลยกำหนดในถังขยะแล้ว (ให้งานลบถาวรอัตโนมัติ) */
  async findExpiredDeletedRoots(limit: number): Promise<number[]> {
    const rows = await this.query<{ FolderID: number }>(
      `SELECT TOP (${Math.max(1, Math.floor(limit))}) f.FolderID FROM storage.Folder f
        WHERE f.IsDeleted = 1 AND f.RecycleBinExpiry IS NOT NULL AND f.RecycleBinExpiry < GETDATE()
          AND (f.ParentFolderID IS NULL OR NOT EXISTS (
                SELECT 1 FROM storage.Folder p WHERE p.FolderID = f.ParentFolderID AND p.IsDeleted = 1))
        ORDER BY f.RecycleBinExpiry`,
      [],
    );
    return rows.map((r) => Number(r.FolderID));
  }

  // ── เขียน ──────────────────────────────────────────────────

  async insert(f: NewFolder, scope?: Scope): Promise<number> {
    const id = await this.sp.call(Sp.storage.insertFolder, scope?.sp).scalar<number>({
      FolderName: f.folderName,
      ParentFolderID: f.parentFolderId,
      OrgUnitID: f.orgUnitId,
      TemplateID: f.templateId ?? null,
      ConfidentialityLevel: f.confidentialityLevel,
      FolderDepth: f.folderDepth,
      PhysicalPath: buildFolderPhysicalPath(f.orgUnitId, randomUUID().replace(/-/g, '')),
      InheritPermission: f.inheritPermission,
      CreatedBy: f.createdBy,
    });
    return Number(id);
  }

  /** เปลี่ยนชื่อ (sp_UpdateFolder ต้องส่งค่าปัจจุบันของฟิลด์อื่นกลับไปด้วย) */
  async rename(
    folder: FolderRow,
    newName: string,
    updatedBy: number,
    scope?: Scope,
  ): Promise<void> {
    await this.sp.call(Sp.storage.updateFolder, scope?.sp).exec({
      FolderID: folder.folderId,
      FolderName: newName,
      ParentFolderID: folder.parentFolderId,
      FolderDepth: folder.folderDepth,
      PhysicalPath: null,
      ConfidentialityLevel: folder.confidentialityLevel,
      InheritPermission: folder.inheritPermission,
      UpdatedBy: updatedBy,
    });
  }

  /**
   * ย้ายต้นไม้ย่อยไปใต้แม่ใหม่ — ปรับความลึก/ชั้นความลับ/หน่วยงานของทั้งต้นไม้
   * (ต่างจากระบบเดิมที่ sp_UpdateFolder ไม่เขียน OrgUnitID ทำให้การย้ายข้ามหน่วยงานไม่เกิดผลจริง)
   */
  async reparent(
    args: {
      sourceId: number;
      newParentId: number;
      depthDelta: number;
      orgUnitId: number;
      confidentialityLevel: number;
      /** ลูกหลานของต้นทาง (ไม่รวมตัวมันเอง) */
      descendantIds: number[];
      updatedBy: number;
    },
    scope?: Scope,
  ): Promise<void> {
    await this.query(
      `UPDATE storage.Folder
          SET ParentFolderID = @1, FolderDepth = FolderDepth + @2, ConfidentialityLevel = @3,
              OrgUnitID = @4, UpdatedBy = @5, UpdatedDate = GETDATE()
        WHERE FolderID = @0`,
      [
        args.sourceId,
        args.newParentId,
        args.depthDelta,
        args.confidentialityLevel,
        args.orgUnitId,
        args.updatedBy,
      ],
      scope,
    );
    await this.updateDescendants(args, scope);
  }

  private async updateDescendants(
    args: {
      depthDelta: number;
      orgUnitId: number;
      confidentialityLevel: number;
      descendantIds: number[];
      updatedBy: number;
    },
    scope?: Scope,
  ): Promise<void> {
    for (let i = 0; i < args.descendantIds.length; i += 1000) {
      const chunk = args.descendantIds.slice(i, i + 1000);
      const ph = chunk.map((_, k) => `@${k + 4}`).join(',');
      await this.query(
        `UPDATE storage.Folder
            SET FolderDepth = FolderDepth + @0, ConfidentialityLevel = @1, OrgUnitID = @2,
                UpdatedBy = @3, UpdatedDate = GETDATE()
          WHERE FolderID IN (${ph})`,
        [args.depthDelta, args.confidentialityLevel, args.orgUnitId, args.updatedBy, ...chunk],
        scope,
      );
    }
  }

  /** ย้ายโฟลเดอร์ไปอยู่ใต้ Root ของชั้นความลับใหม่ (ChangeConfidentialityLevel) — ทั้งต้นไม้ย่อยเปลี่ยนชั้นตาม */
  async changeConfidentiality(
    args: {
      folderId: number;
      newRootId: number;
      newLevel: number;
      descendantIds: number[];
      updatedBy: number;
    },
    scope?: Scope,
  ): Promise<void> {
    await this.query(
      `UPDATE storage.Folder
          SET ParentFolderID = @1, ConfidentialityLevel = @2, InheritPermission = 0,
              UpdatedBy = @3, UpdatedDate = GETDATE()
        WHERE FolderID = @0`,
      [args.folderId, args.newRootId, args.newLevel, args.updatedBy],
      scope,
    );
    for (let i = 0; i < args.descendantIds.length; i += 1000) {
      const chunk = args.descendantIds.slice(i, i + 1000);
      const ph = chunk.map((_, k) => `@${k + 2}`).join(',');
      await this.query(
        `UPDATE storage.Folder SET ConfidentialityLevel = @0, UpdatedBy = @1, UpdatedDate = GETDATE()
          WHERE FolderID IN (${ph})`,
        [args.newLevel, args.updatedBy, ...chunk],
        scope,
      );
    }
  }

  async softDeleteTree(folderId: number, deletedBy: number, scope?: Scope): Promise<void> {
    await this.sp
      .call(Sp.storage.softDeleteFolder, scope?.sp)
      .exec({ FolderID: folderId, DeletedBy: deletedBy });
  }

  async restoreTree(folderId: number, scope?: Scope): Promise<void> {
    await this.sp.call(Sp.storage.restoreFolder, scope?.sp).exec({ FolderID: folderId });
  }

  /** คำนวณจำนวนไฟล์/ขนาดรวมของโฟลเดอร์ใหม่จาก FileDocument (ระบบเดิม sp_UpdateFolder ไม่เขียนคอลัมน์ขนาด จึงเป็น 0 เสมอ) */
  async refreshCounters(folderIds: readonly number[], scope?: Scope): Promise<void> {
    const ids = [...new Set(folderIds)].filter((x) => x > 0);
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const ph = chunk.map((_, k) => `@${k}`).join(',');
      await this.query(
        `UPDATE f SET FileCount = c.Cnt, FolderSizeBytes = c.Sz
           FROM storage.Folder f
          CROSS APPLY (SELECT COUNT(*) AS Cnt, ISNULL(SUM(CAST(fd.FileSizeBytes AS BIGINT)), 0) AS Sz
                         FROM storage.FileDocument fd
                        WHERE fd.FolderID = f.FolderID AND fd.FileStatus <> 3 AND fd.DeletedDate IS NULL) c
          WHERE f.FolderID IN (${ph})`,
        chunk,
        scope,
      );
    }
  }
}
