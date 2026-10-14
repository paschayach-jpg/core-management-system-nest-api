import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { LIKE_ESCAPE, likeContains } from '../../../../common/utils/query.util';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import type { TransactionScope } from '../../../../database/transaction-runner.service';
import { FileRow, mapFileRow, NewFile } from './file.types';

type Scope = TransactionScope | undefined;
type Raw = Record<string, unknown>;

const FILE_COLUMNS = `fd.FileID, fd.FileGUID, fd.FolderID, fd.OriginalFileName, fd.StoredFileName, fd.FileExtension,
  fd.MimeType, fd.FileSizeBytes, fd.PhysicalPath, fd.Checksum, fd.VirusScanStatus, fd.VirusScanDate, fd.FileStatus,
  fd.UploadedBy, fd.UploadedDate, fd.ArchivedBy, fd.ArchivedDate, fd.DeletedBy, fd.DeletedDate, fd.Version`;

/** ชื่อ field ที่ client เรียงได้ → คอลัมน์ (whitelist) */
export const FILE_SORT: Record<string, string> = {
  name: 'fd.OriginalFileName',
  size: 'fd.FileSizeBytes',
  uploadedDate: 'fd.UploadedDate',
  version: 'fd.Version',
  extension: 'fd.FileExtension',
};

export interface DeletedFileQuery {
  orgUnitIds: number[] | null;
  deletedBy?: number;
  page: number;
  pageSize: number;
}

/** ไฟล์ + ตำแหน่งกายภาพ (ใช้ตอนลบถาวร) */
export interface FileLocationRow {
  fileId: number;
  folderId: number;
  orgUnitId: number;
  storedFileName: string;
  physicalPath: string;
}

/** การเข้าถึงข้อมูล storage.FileDocument */
@Injectable()
export class FileRepository {
  constructor(
    private readonly sp: SpExecutor,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  private query<T = Raw>(sql: string, params: unknown[], scope?: Scope): Promise<T[]> {
    return (scope ? scope.manager.query(sql, params) : this.ds.query(sql, params)) as Promise<T[]>;
  }

  /** รวมไฟล์ที่ถูกลบ (soft) ด้วย — ผู้เรียกตรวจ fileStatus เอง */
  async getById(fileId: number, scope?: Scope): Promise<FileRow | null> {
    const row = await this.sp
      .call(Sp.storage.getFileDocumentById, scope?.sp)
      .one<Raw>({ FileID: fileId });
    return row ? mapFileRow(row) : null;
  }

  async listByFolder(
    folderId: number,
    q: Pick<PaginationQueryDto, 'page' | 'pageSize' | 'q' | 'sortBy' | 'sortDir'>,
  ): Promise<{ items: FileRow[]; total: number }> {
    const params: unknown[] = [folderId];
    let where = 'fd.FolderID = @0 AND fd.FileStatus <> 3';
    if (q.q?.trim()) {
      params.push(likeContains(q.q.trim()));
      where += ` AND fd.OriginalFileName LIKE @${params.length - 1} ${LIKE_ESCAPE}`;
    }
    const col =
      q.sortBy && Object.hasOwn(FILE_SORT, q.sortBy) ? FILE_SORT[q.sortBy] : 'fd.OriginalFileName';
    const dir = q.sortDir === 'desc' ? 'DESC' : 'ASC';
    const [count] = await this.query<{ C: number }>(
      `SELECT COUNT(*) AS C FROM storage.FileDocument fd WHERE ${where}`,
      params,
    );
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.query<Raw>(
      `SELECT ${FILE_COLUMNS}, ISNULL(u.DisplayName, u.ADUserName) AS UploadedByName
         FROM storage.FileDocument fd
         LEFT JOIN EMS.UserAccount u ON u.UserID = fd.UploadedBy
        WHERE ${where}
        ORDER BY ${col} ${dir}, fd.FileID
        OFFSET ${offset} ROWS FETCH NEXT ${q.pageSize} ROWS ONLY`,
      params,
    );
    return { items: rows.map(mapFileRow), total: Number(count?.C ?? 0) };
  }

  /** ไฟล์ที่ยังใช้งานทั้งหมดในโฟลเดอร์ (ไม่แบ่งหน้า — สำหรับ port ของ module อื่น; จำกัด 5,000) */
  async listActiveByFolder(folderId: number): Promise<FileRow[]> {
    const rows = await this.query<Raw>(
      `SELECT TOP (5000) ${FILE_COLUMNS} FROM storage.FileDocument fd
        WHERE fd.FolderID = @0 AND fd.FileStatus = 1 ORDER BY fd.OriginalFileName, fd.FileID`,
      [folderId],
    );
    return rows.map(mapFileRow);
  }

  async findActiveByName(folderId: number, name: string, scope?: Scope): Promise<FileRow | null> {
    // ใน transaction ล็อกช่วงของโฟลเดอร์เพื่อกันสองคำขอแทนที่ไฟล์ชื่อเดียวกันพร้อมกัน
    const hint = scope ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
    const rows = await this.query<Raw>(
      `SELECT TOP 1 ${FILE_COLUMNS} FROM storage.FileDocument fd${hint}
        WHERE fd.FolderID = @0 AND fd.OriginalFileName = @1 AND fd.FileStatus <> 3
        ORDER BY fd.Version DESC, fd.FileID DESC`,
      [folderId, name],
      scope,
    );
    return rows[0] ? mapFileRow(rows[0]) : null;
  }

  /**
   * ชื่อไฟล์ที่ยังใช้งานในโฟลเดอร์ซึ่งขึ้นต้นด้วย `prefix` — ใช้ตั้งชื่อ copy(N)
   * ใน transaction จะล็อกช่วงของโฟลเดอร์นั้น (UPDLOCK,HOLDLOCK) เพื่อไม่ให้สองคำขอเลือกชื่อซ้ำกัน
   */
  async activeNamesStartingWith(
    folderId: number,
    prefix: string,
    scope?: Scope,
  ): Promise<string[]> {
    const hint = scope ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
    const rows = await this.query<{ OriginalFileName: string }>(
      `SELECT OriginalFileName FROM storage.FileDocument${hint}
        WHERE FolderID = @0 AND FileStatus <> 3 AND OriginalFileName LIKE @1 ${LIKE_ESCAPE}`,
      [folderId, `${prefix.replace(/[\\%_[\]]/g, (c) => `\\${c}`)}%`],
      scope,
    );
    return rows.map((r) => r.OriginalFileName);
  }

  async namesExist(folderId: number, names: readonly string[]): Promise<string[]> {
    if (names.length === 0) return [];
    const ph = names.map((_, i) => `@${i + 1}`).join(',');
    const rows = await this.query<{ OriginalFileName: string }>(
      `SELECT DISTINCT OriginalFileName FROM storage.FileDocument
        WHERE FolderID = @0 AND FileStatus <> 3 AND OriginalFileName IN (${ph})`,
      [folderId, ...names],
    );
    const found = new Set(rows.map((r) => r.OriginalFileName.toLowerCase()));
    return names.filter((n) => found.has(n.toLowerCase()));
  }

  async versionsOf(folderId: number, name: string): Promise<FileRow[]> {
    const rows = await this.query<Raw>(
      `SELECT ${FILE_COLUMNS}, ISNULL(u.DisplayName, u.ADUserName) AS UploadedByName
         FROM storage.FileDocument fd LEFT JOIN EMS.UserAccount u ON u.UserID = fd.UploadedBy
        WHERE fd.FolderID = @0 AND fd.OriginalFileName = @1
        ORDER BY fd.Version DESC, fd.FileID DESC`,
      [folderId, name],
    );
    return rows.map(mapFileRow);
  }

  async listDeleted(q: DeletedFileQuery): Promise<{ items: FileRow[]; total: number }> {
    const params: unknown[] = [];
    const where: string[] = ['fd.FileStatus = 3', 'f.IsDeleted = 0'];
    if (q.orgUnitIds) {
      if (q.orgUnitIds.length === 0) return { items: [], total: 0 };
      const ph = q.orgUnitIds.slice(0, 2000).map((id) => {
        params.push(id);
        return `@${params.length - 1}`;
      });
      where.push(`f.OrgUnitID IN (${ph.join(',')})`);
    }
    if (q.deletedBy !== undefined) {
      params.push(q.deletedBy);
      where.push(`fd.DeletedBy = @${params.length - 1}`);
    }
    const whereSql = where.join(' AND ');
    const [count] = await this.query<{ C: number }>(
      `SELECT COUNT(*) AS C FROM storage.FileDocument fd JOIN storage.Folder f ON f.FolderID = fd.FolderID WHERE ${whereSql}`,
      params,
    );
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.query<Raw>(
      `SELECT ${FILE_COLUMNS}, f.FolderName, f.OrgUnitID
         FROM storage.FileDocument fd JOIN storage.Folder f ON f.FolderID = fd.FolderID
        WHERE ${whereSql}
        ORDER BY fd.DeletedDate DESC, fd.FileID DESC
        OFFSET ${offset} ROWS FETCH NEXT ${q.pageSize} ROWS ONLY`,
      params,
    );
    return { items: rows.map(mapFileRow), total: Number(count?.C ?? 0) };
  }

  // ── เขียน ──────────────────────────────────────────────────

  async insert(d: NewFile, scope?: Scope): Promise<number> {
    const id = Number(
      await this.sp.call(Sp.storage.insertFileDocument, scope?.sp).scalar<number>({
        FolderID: d.folderId,
        OriginalFileName: d.originalFileName,
        StoredFileName: d.storedFileName,
        FileExtension: d.fileExtension,
        MimeType: d.mimeType,
        FileSizeBytes: d.fileSizeBytes,
        PhysicalPath: d.physicalPath,
        Checksum: d.checksum,
        UploadedBy: d.uploadedBy,
      }),
    );
    if (d.version !== 1) {
      await this.query(
        'UPDATE storage.FileDocument SET Version = @1 WHERE FileID = @0',
        [id, d.version],
        scope,
      );
    }
    return id;
  }

  async softDelete(fileId: number, deletedBy: number, scope?: Scope): Promise<void> {
    await this.sp
      .call(Sp.storage.softDeleteFileDocument, scope?.sp)
      .exec({ FileID: fileId, DeletedBy: deletedBy });
  }

  async rename(fileId: number, newName: string, scope?: Scope): Promise<void> {
    await this.sp
      .call(Sp.storage.renameFileDocument, scope?.sp)
      .exec({ FileID: fileId, OriginalFileName: newName });
  }

  /** ย้ายไฟล์ไปโฟลเดอร์อื่น (อาจเปลี่ยนชื่อ/ที่เก็บ/ชื่อที่แสดงตามผลการตั้งชื่อ) */
  async relocate(
    fileId: number,
    to: {
      folderId: number;
      physicalPath: string;
      storedFileName: string;
      originalFileName: string;
    },
    scope?: Scope,
  ): Promise<void> {
    await this.query(
      `UPDATE storage.FileDocument
          SET FolderID = @1, PhysicalPath = @2, StoredFileName = @3, OriginalFileName = @4
        WHERE FileID = @0`,
      [fileId, to.folderId, to.physicalPath, to.storedFileName, to.originalFileName],
      scope,
    );
  }

  /** กู้คืนไฟล์จากถังขยะ (FileStatus=1) พร้อมตั้งชื่อใหม่ถ้าชนกับไฟล์ที่ใช้งานอยู่ */
  async restore(fileId: number, newName: string | null, scope?: Scope): Promise<void> {
    await this.query(
      `UPDATE storage.FileDocument
          SET FileStatus = 1, DeletedBy = NULL, DeletedDate = NULL,
              OriginalFileName = ISNULL(@1, OriginalFileName)
        WHERE FileID = @0`,
      [fileId, newName],
      scope,
    );
  }

  // ── ลบถาวร ─────────────────────────────────────────────────

  /** ไฟล์ทุกสถานะในโฟลเดอร์ที่ระบุ พร้อมข้อมูลหาไฟล์กายภาพ */
  async locationsInFolders(
    folderIds: readonly number[],
    scope?: Scope,
  ): Promise<FileLocationRow[]> {
    const out: FileLocationRow[] = [];
    for (let i = 0; i < folderIds.length; i += 1000) {
      const chunk = folderIds.slice(i, i + 1000);
      const ph = chunk.map((_, k) => `@${k}`).join(',');
      const rows = await this.query<Raw>(
        `SELECT fd.FileID, fd.FolderID, f.OrgUnitID, fd.StoredFileName, fd.PhysicalPath
           FROM storage.FileDocument fd JOIN storage.Folder f ON f.FolderID = fd.FolderID
          WHERE fd.FolderID IN (${ph})`,
        chunk,
        scope,
      );
      for (const r of rows) {
        out.push({
          fileId: Number(r.FileID),
          folderId: Number(r.FolderID),
          orgUnitId: Number(r.OrgUnitID),
          storedFileName: String(r.StoredFileName),
          physicalPath: String(r.PhysicalPath ?? ''),
        });
      }
    }
    return out;
  }

  /** สิ่งที่ยังอ้างอิงโฟลเดอร์/ไฟล์เหล่านี้อยู่ (ลบถาวรไม่ได้จนกว่าจะแก้) */
  async blockers(
    folderIds: readonly number[],
    fileIds: readonly number[],
    scope?: Scope,
  ): Promise<{ kmsAttachments: number; projectAttachments: number; externalShares: number }> {
    const count = async (sql: string, ids: readonly number[], extra: readonly number[] = []) => {
      if (ids.length === 0 && extra.length === 0) return 0;
      const params: number[] = [];
      const ph = (list: readonly number[]) =>
        list.length === 0
          ? 'NULL'
          : list
              .map((v) => {
                params.push(v);
                return `@${params.length - 1}`;
              })
              .join(',');
      const sqlText = sql.replace('{A}', ph(ids)).replace('{B}', ph(extra));
      const rows = await this.query<{ C: number }>(sqlText, params, scope);
      return Number(rows[0]?.C ?? 0);
    };
    const f = fileIds.slice(0, 2000);
    const d = folderIds.slice(0, 2000);
    return {
      kmsAttachments: await count(
        'SELECT COUNT(*) AS C FROM KMS.t_KBArticleAttachment WHERE FileID IN ({A})',
        f,
      ),
      projectAttachments: await count(
        'SELECT COUNT(*) AS C FROM storage.t_project_attachment WHERE i_file_id IN ({A})',
        f,
      ),
      externalShares: await count(
        'SELECT COUNT(*) AS C FROM storage.ExternalShare WHERE FileID IN ({A}) OR FolderID IN ({B})',
        f,
        d,
      ),
    };
  }

  /**
   * ลบข้อมูลที่เกี่ยวข้องกับโฟลเดอร์/ไฟล์เหล่านี้แล้วลบแถวไฟล์และโฟลเดอร์จริง (ต้องเรียกใน transaction)
   * ลำดับ: ใบอนุมัติ → สิทธิ์ไฟล์/โฟลเดอร์ → ทางลัด → ไฟล์ → โฟลเดอร์
   */
  async hardDeleteTree(
    folderIds: readonly number[],
    fileIds: readonly number[],
    scope: TransactionScope,
  ): Promise<void> {
    const inList = (ids: readonly number[], offset = 0) =>
      ids.map((_, k) => `@${k + offset}`).join(',');
    const chunks = <T>(arr: readonly T[], n = 900): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    for (const fc of chunks(folderIds)) {
      const ph = inList(fc);
      await scope.manager.query(
        `DELETE s FROM workflow.ApprovalStep s JOIN workflow.ApprovalRequest r ON r.RequestID = s.RequestID
          WHERE r.FolderID IN (${ph})`,
        fc,
      );
      await scope.manager.query(
        `DELETE FROM workflow.ApprovalRequest WHERE FolderID IN (${ph})`,
        fc,
      );
    }
    for (const ic of chunks(fileIds)) {
      const ph = inList(ic);
      await scope.manager.query(
        `DELETE s FROM workflow.ApprovalStep s JOIN workflow.ApprovalRequest r ON r.RequestID = s.RequestID
          WHERE r.FileID IN (${ph})`,
        ic,
      );
      await scope.manager.query(`DELETE FROM workflow.ApprovalRequest WHERE FileID IN (${ph})`, ic);
      await scope.manager.query(`DELETE FROM security.FilePermission WHERE FileID IN (${ph})`, ic);
    }
    for (const fc of chunks(folderIds)) {
      const ph = inList(fc);
      await scope.manager.query(
        `DELETE FROM security.FolderPermission WHERE FolderID IN (${ph})`,
        fc,
      );
      await scope.manager.query(
        `DELETE FROM storage.QuickAccessFolder WHERE FolderID IN (${ph})`,
        fc,
      );
      await scope.manager.query(`DELETE FROM storage.FileDocument WHERE FolderID IN (${ph})`, fc);
    }
    // ลบโฟลเดอร์ทั้งต้นไม้ในคำสั่งเดียว (self-FK ตรวจเมื่อจบคำสั่ง) — แบ่งก้อนไม่ได้เพราะแม่-ลูกต้องไปพร้อมกัน
    const all = [...folderIds];
    if (all.length > 2000) {
      throw new Error('ต้นไม้โฟลเดอร์ใหญ่เกินกว่าจะลบถาวรในครั้งเดียว (เกิน 2,000 โฟลเดอร์)');
    }
    await scope.manager.query(`DELETE FROM storage.Folder WHERE FolderID IN (${inList(all)})`, all);
  }
}
