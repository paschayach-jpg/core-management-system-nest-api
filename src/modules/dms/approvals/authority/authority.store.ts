import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LIKE_ESCAPE, likeContains } from '../../../../common/utils/query.util';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import { bool, dateOrNull, num, PageArgs, Row, rowsOf, strOrNull, Tx } from '../common/db.types';
import type { ExistingConfig, ImportUser, ResolveParams } from './authority-rules';

export interface AuthorityConfigRow extends ExistingConfig {
  isActive: boolean;
  updatedDate: Date | null;
}

export interface SaveConfigInput {
  configLabel: string;
  positionName?: string | null;
  departmentCode?: string | null;
  divisionCode?: string | null;
  levelCode?: string | null;
  confidentialityLevel: number;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canApprove: boolean;
  /** ไม่ส่ง = ไม่แตะคอลัมน์ CanDownload (SP เดิมไม่รับค่านี้) */
  canDownload?: boolean;
}

const COLS = `ConfigID, ConfigLabel, PositionName, DepartmentCode, DivisionCode, LevelCode, ConfidentialityLevel,
       CanView, CanAdd, CanEdit, CanApprove, CanDownload, IsActive, UpdatedDate`;

export const mapConfig = (r: Row): AuthorityConfigRow => ({
  configId: num(r.ConfigID),
  configLabel: strOrNull(r.ConfigLabel) ?? '',
  positionName: strOrNull(r.PositionName),
  departmentCode: strOrNull(r.DepartmentCode),
  divisionCode: strOrNull(r.DivisionCode),
  levelCode: strOrNull(r.LevelCode)?.trim() || null,
  confidentialityLevel: num(r.ConfidentialityLevel),
  canView: bool(r.CanView),
  canAdd: bool(r.CanAdd),
  canEdit: bool(r.CanEdit),
  canApprove: bool(r.CanApprove),
  canDownload: bool(r.CanDownload),
  isActive: r.IsActive === undefined ? true : bool(r.IsActive),
  updatedDate: dateOrNull(r.UpdatedDate),
});

/** SQL/SP ของ EMS.FolderAuthorityConfig (เขียนผ่าน SP ตามระบบเดิม; อ่านรายการด้วย SQL เพื่อค้น/แบ่งหน้าได้) */
@Injectable()
export class AuthorityStore {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly sp: SpExecutor,
  ) {}

  private run(sql: string, params: unknown[], tx?: Tx): Promise<unknown> {
    return (tx?.manager ?? this.ds).query(sql, params);
  }

  async page(
    q: string | undefined,
    page: PageArgs,
  ): Promise<{ items: AuthorityConfigRow[]; total: number }> {
    const term = q?.trim() ? likeContains(q.trim()) : null;
    const where = `IsActive = 1 AND (@0 IS NULL OR ConfigLabel LIKE @0 ${LIKE_ESCAPE}
       OR PositionName LIKE @0 ${LIKE_ESCAPE} OR DepartmentCode LIKE @0 ${LIKE_ESCAPE} OR DivisionCode LIKE @0 ${LIKE_ESCAPE})`;
    const totalRows = rowsOf(
      await this.run(`SELECT COUNT(*) AS C FROM EMS.FolderAuthorityConfig WHERE ${where}`, [term]),
    );
    const rows = rowsOf(
      await this.run(
        `SELECT ${COLS} FROM EMS.FolderAuthorityConfig WHERE ${where}
          ORDER BY ConfigLabel, ConfidentialityLevel, ConfigID OFFSET @1 ROWS FETCH NEXT @2 ROWS ONLY`,
        [term, page.skip, page.take],
      ),
    );
    return { items: rows.map(mapConfig), total: num(totalRows[0]?.C) };
  }

  async get(id: number, tx?: Tx): Promise<AuthorityConfigRow | null> {
    const rows = rowsOf(
      await this.run(`SELECT ${COLS} FROM EMS.FolderAuthorityConfig WHERE ConfigID = @0`, [id], tx),
    );
    return rows[0] ? mapConfig(rows[0]) : null;
  }

  /** config ที่ใช้งานอยู่ทั้งหมด (sp_GetAllFolderAuthorityConfigs — ~750 แถว) */
  async allActive(tx?: Tx): Promise<AuthorityConfigRow[]> {
    const rows = await this.sp.call(Sp.ems.getAllFolderAuthorityConfigs, tx?.sp).rows<Row>({});
    return rows.map(mapConfig);
  }

  async findActive(
    label: string,
    level: number,
    excludeId: number | null,
    tx?: Tx,
  ): Promise<AuthorityConfigRow | null> {
    const rows = rowsOf(
      await this.run(
        `SELECT TOP 1 ${COLS} FROM EMS.FolderAuthorityConfig
          WHERE IsActive = 1 AND ConfigLabel = @0 AND ConfidentialityLevel = @1 AND (@2 IS NULL OR ConfigID <> @2)`,
        [label, level, excludeId],
        tx,
      ),
    );
    return rows[0] ? mapConfig(rows[0]) : null;
  }

  async countActiveByLabel(label: string, tx?: Tx): Promise<number> {
    const rows = rowsOf(
      await this.run(
        `SELECT COUNT(*) AS C FROM EMS.FolderAuthorityConfig WHERE IsActive = 1 AND ConfigLabel = @0`,
        [label],
        tx,
      ),
    );
    return num(rows[0]?.C);
  }

  async insert(tx: Tx, c: SaveConfigInput, createdBy: number): Promise<number> {
    const id = await this.sp.call(Sp.ems.insertFolderAuthorityConfig, tx.sp).scalar<number>({
      ConfigLabel: c.configLabel,
      PositionName: c.positionName ?? null,
      DepartmentCode: c.departmentCode ?? null,
      DivisionCode: c.divisionCode ?? null,
      LevelCode: c.levelCode ?? null,
      ConfidentialityLevel: c.confidentialityLevel,
      CanView: c.canView,
      CanAdd: c.canAdd,
      CanEdit: c.canEdit,
      CanApprove: c.canApprove,
      CreatedBy: createdBy,
    });
    const newId = Number(id);
    if (c.canDownload !== undefined) await this.setDownload(tx, newId, c.canDownload);
    return newId;
  }

  async update(tx: Tx, id: number, c: SaveConfigInput, updatedBy: number): Promise<void> {
    await this.sp.call(Sp.ems.updateFolderAuthorityConfig, tx.sp).exec({
      ConfigID: id,
      ConfigLabel: c.configLabel,
      PositionName: c.positionName ?? null,
      DepartmentCode: c.departmentCode ?? null,
      DivisionCode: c.divisionCode ?? null,
      LevelCode: c.levelCode ?? null,
      ConfidentialityLevel: c.confidentialityLevel,
      CanView: c.canView,
      CanAdd: c.canAdd,
      CanEdit: c.canEdit,
      CanApprove: c.canApprove,
      UpdatedBy: updatedBy,
    });
    if (c.canDownload !== undefined) await this.setDownload(tx, id, c.canDownload);
  }

  /** CanDownload มีในตารางแต่ sp_Insert/UpdateFolderAuthorityConfig ไม่รับพารามิเตอร์นี้ → ตั้งตรงในธุรกรรมเดียวกัน */
  private async setDownload(tx: Tx, id: number, value: boolean): Promise<void> {
    await tx.manager.query(
      `UPDATE EMS.FolderAuthorityConfig SET CanDownload = @1 WHERE ConfigID = @0`,
      [id, value ? 1 : 0],
    );
  }

  /** soft delete ทั้งกลุ่มตาม ConfigLabel (IsActive=0) — พฤติกรรมของ sp_DeleteFolderAuthorityConfig */
  async softDeleteGroup(tx: Tx, label: string, deletedBy: number): Promise<void> {
    await this.sp
      .call(Sp.ems.deleteFolderAuthorityConfig, tx.sp)
      .exec({ ConfigLabel: label, DeletedBy: deletedBy });
  }

  async resolve(p: ResolveParams): Promise<AuthorityConfigRow[]> {
    const rows = await this.sp.call(Sp.ems.resolveFolderAuthority).rows<Row>({
      LevelCode: p.levelCode ?? null,
      PositionName: p.positionName ?? null,
      DepartmentCode: p.departmentCode ?? null,
      DivisionCode: p.divisionCode ?? null,
    });
    return rows.map(mapConfig);
  }

  // ── นำเข้า ────────────────────────────────────────────────

  async usersWithEmployeeCode(): Promise<ImportUser[]> {
    const rows = rowsOf(
      await this.run(
        `SELECT UserID, EmployeeCode, LevelCode FROM EMS.UserAccount WHERE EmployeeCode IS NOT NULL AND EmployeeCode <> ''`,
        [],
      ),
    );
    return rows.map((r) => ({
      userId: num(r.UserID),
      employeeCode: strOrNull(r.EmployeeCode),
      levelCode: strOrNull(r.LevelCode),
    }));
  }

  async updateUserLevel(tx: Tx, userId: number, levelCode: string): Promise<void> {
    await tx.manager.query(
      `UPDATE EMS.UserAccount SET LevelCode = @1, UpdatedAt = GETUTCDATE() WHERE UserID = @0`,
      [userId, levelCode],
    );
  }
}
