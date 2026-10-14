import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import type { TransactionScope } from '../../../../database/transaction-runner.service';
import type { TemplateItemLike } from '../rules/template.rules';
import type { FolderTemplateDto, FolderTemplateItemDto } from './dto/folder-template.dto';

type Scope = TransactionScope | undefined;
type Raw = Record<string, unknown>;

const mapTemplate = (r: Raw): FolderTemplateDto => ({
  templateId: Number(r.TemplateID),
  templateCode: String(r.TemplateCode ?? ''),
  templateName: String(r.TemplateName ?? ''),
  targetType: String(r.TargetType ?? 'Any'),
  description: (r.Description as string | null | undefined) ?? null,
  orgUnitId: r.OrgUnitID === null || r.OrgUnitID === undefined ? null : Number(r.OrgUnitID),
  orgUnitName: (r.OrgUnitName as string | null | undefined) ?? null,
  isActive: Boolean(r.IsActive),
  createdBy: Number(r.CreatedBy ?? 0),
  createdDate: (r.CreatedDate as Date | null | undefined) ?? null,
});

const mapItem = (r: Raw): FolderTemplateItemDto & TemplateItemLike => ({
  itemId: Number(r.ItemID),
  templateId: Number(r.TemplateID),
  parentItemId:
    r.ParentItemID === null || r.ParentItemID === undefined ? null : Number(r.ParentItemID),
  folderName: String(r.FolderName ?? ''),
  confidentialityLevel: Number(r.ConfidentialityLevel ?? 4),
  sortOrder: Number(r.SortOrder ?? 0),
  inheritPermission: Boolean(r.InheritPermission),
});

/** การเข้าถึงข้อมูล storage.FolderTemplate / FolderTemplateItem */
@Injectable()
export class FolderTemplateRepository {
  constructor(
    private readonly sp: SpExecutor,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  private query<T = Raw>(sql: string, params: unknown[], scope?: Scope): Promise<T[]> {
    return (scope ? scope.manager.query(sql, params) : this.ds.query(sql, params)) as Promise<T[]>;
  }

  async list(includeInactive: boolean): Promise<FolderTemplateDto[]> {
    const rows = await this.query<Raw>(
      `SELECT ft.TemplateID, ft.TemplateCode, ft.TemplateName, ft.TargetType, ft.Description, ft.OrgUnitID,
              ou.OrgUnitNameTH AS OrgUnitName, ft.IsActive, ft.CreatedBy, ft.CreatedDate
         FROM storage.FolderTemplate ft LEFT JOIN EMS.OrgUnit ou ON ft.OrgUnitID = ou.OrgUnitID
        ${includeInactive ? '' : 'WHERE ft.IsActive = 1'}
        ORDER BY ft.TemplateName`,
      [],
    );
    return rows.map(mapTemplate);
  }

  async getById(templateId: number, scope?: Scope): Promise<FolderTemplateDto | null> {
    const row = await this.sp
      .call(Sp.storage.getFolderTemplateById, scope?.sp)
      .one<Raw>({ TemplateID: templateId });
    return row ? mapTemplate(row) : null;
  }

  async items(
    templateId: number,
    scope?: Scope,
  ): Promise<(FolderTemplateItemDto & TemplateItemLike)[]> {
    const rows = await this.sp
      .call(Sp.storage.getFolderTemplateItems, scope?.sp)
      .rows<Raw>({ TemplateID: templateId });
    return rows.map(mapItem);
  }

  async getItem(
    itemId: number,
    scope?: Scope,
  ): Promise<(FolderTemplateItemDto & TemplateItemLike) | null> {
    const rows = await this.query<Raw>(
      `SELECT ItemID, TemplateID, ParentItemID, FolderName, ConfidentialityLevel, SortOrder, InheritPermission
         FROM storage.FolderTemplateItem WHERE ItemID = @0`,
      [itemId],
      scope,
    );
    return rows[0] ? mapItem(rows[0]) : null;
  }

  async codeExists(code: string, excludeTemplateId?: number): Promise<boolean> {
    const rows = await this.query<{ C: number }>(
      `SELECT COUNT(*) AS C FROM storage.FolderTemplate
        WHERE TemplateCode = @0 AND (@1 IS NULL OR TemplateID <> @1)`,
      [code, excludeTemplateId ?? null],
    );
    return Number(rows[0]?.C ?? 0) > 0;
  }

  async foldersUsing(templateId: number): Promise<number> {
    const rows = await this.query<{ C: number }>(
      'SELECT COUNT(*) AS C FROM storage.Folder WHERE TemplateID = @0',
      [templateId],
    );
    return Number(rows[0]?.C ?? 0);
  }

  async insert(
    t: {
      templateCode: string;
      templateName: string;
      targetType: string;
      description: string | null;
      orgUnitId: number | null;
      createdBy: number;
    },
    scope?: Scope,
  ): Promise<number> {
    const id = await this.sp.call(Sp.storage.insertFolderTemplate, scope?.sp).scalar<number>({
      TemplateCode: t.templateCode,
      TemplateName: t.templateName,
      TargetType: t.targetType,
      Description: t.description,
      OrgUnitID: t.orgUnitId,
      CreatedBy: t.createdBy,
    });
    return Number(id);
  }

  async update(
    templateId: number,
    t: {
      templateCode: string;
      templateName: string;
      targetType: string;
      description: string | null;
      orgUnitId: number | null;
      isActive: boolean;
    },
    scope?: Scope,
  ): Promise<void> {
    await this.sp.call(Sp.storage.updateFolderTemplate, scope?.sp).exec({
      TemplateID: templateId,
      TemplateCode: t.templateCode,
      TemplateName: t.templateName,
      TargetType: t.targetType,
      Description: t.description,
      OrgUnitID: t.orgUnitId,
      IsActive: t.isActive,
    });
  }

  /** sp_DeleteFolderTemplate ลบรายการทั้งหมดของแม่แบบแล้วลบแม่แบบ */
  async delete(templateId: number, scope?: Scope): Promise<void> {
    await this.sp.call(Sp.storage.deleteFolderTemplate, scope?.sp).exec({ TemplateID: templateId });
  }

  async insertItem(
    i: {
      templateId: number;
      parentItemId: number | null;
      folderName: string;
      confidentialityLevel: number;
      sortOrder: number;
      inheritPermission: boolean;
    },
    scope?: Scope,
  ): Promise<number> {
    const id = await this.sp.call(Sp.storage.insertFolderTemplateItem, scope?.sp).scalar<number>({
      TemplateID: i.templateId,
      ParentItemID: i.parentItemId,
      FolderName: i.folderName,
      ConfidentialityLevel: i.confidentialityLevel,
      SortOrder: i.sortOrder,
      InheritPermission: i.inheritPermission,
    });
    return Number(id);
  }

  async updateItem(
    itemId: number,
    i: {
      folderName: string;
      confidentialityLevel: number;
      sortOrder: number;
      inheritPermission: boolean;
    },
    scope?: Scope,
  ): Promise<void> {
    await this.sp.call(Sp.storage.updateFolderTemplateItem, scope?.sp).exec({
      ItemID: itemId,
      FolderName: i.folderName,
      ConfidentialityLevel: i.confidentialityLevel,
      SortOrder: i.sortOrder,
      InheritPermission: i.inheritPermission,
    });
  }

  /**
   * ลบรายการพร้อมลูกหลานทุกชั้น (sp_DeleteFolderTemplateItem ลบได้แค่ 2 ชั้น ทำให้ชั้นลึกกว่าค้างเป็นกำพร้า — ที่นี่ใช้ CTE)
   * @returns จำนวนรายการที่ถูกลบ
   */
  async deleteItemTree(itemId: number, scope?: Scope): Promise<number> {
    const rows = await this.query<{ N: number }>(
      `WITH t AS (
         SELECT ItemID, 0 AS Lvl FROM storage.FolderTemplateItem WHERE ItemID = @0
         UNION ALL
         SELECT c.ItemID, t.Lvl + 1 FROM storage.FolderTemplateItem c JOIN t ON c.ParentItemID = t.ItemID WHERE t.Lvl < 30
       )
       DELETE FROM storage.FolderTemplateItem WHERE ItemID IN (SELECT ItemID FROM t);
       SELECT @@ROWCOUNT AS N;`,
      [itemId],
      scope,
    );
    return Number(rows[0]?.N ?? 0);
  }
}
