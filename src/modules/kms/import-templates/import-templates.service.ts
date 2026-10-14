import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { CategoriesService } from '../categories/categories.service';
import { KbCategoryRow, isRootOrUnder } from '../codes/kb-category-tree';
import { KbLayout, KbLayoutType, LAYOUT_OPTIONS, normalizeLayout } from '../codes/kb-layout';
import type { TemplateColumnRow } from '../import/kb-import-row';
import { KMS_OP } from '../kms.constants';
import { isUniqueViolation } from '../kms-sql';
import type {
  ImportTemplateDetailDto,
  ImportTemplateDto,
  SaveTemplateDto,
  TemplateColumnDto,
  TemplateOptionsDto,
} from './dto/import-template.dto';
import {
  ARTICLE_TYPE_OPTIONS,
  IMPORTABLE_TARGET_COLUMNS,
  KbArticleColumn,
  VIRTUAL_TARGET_COLUMNS,
  describeColumn,
} from './kb-column-catalog';
import {
  getTemplateProblems,
  hasAttachmentMapping,
  mappedRows,
  resolveArticleType,
  resolveTemplateLayout,
} from './kb-template-rules';

type Row = Record<string, unknown>;

/** ลำดับคอลัมน์เป้าหมายตามตาราง mapping (คอลัมน์จริง → Attachment → LawReference → LayoutType) */
const GRID_COLUMNS: readonly string[] = [...IMPORTABLE_TARGET_COLUMNS, ...VIRTUAL_TARGET_COLUMNS];

/**
 * Excel Import Template (KMS.m_KBImportTemplate + m_KBImportTemplateColumn): รายการ mapping TargetColumn → ExcelColumnRef
 * Template ไม่ผูกหมวด (CategoryID หาจาก ArticleCode ของแต่ละแถวตอน import) · ค่าคงที่เก็บเป็นแถวเสมือน: ArticleType, LayoutType (Law/Decree/NonLaw),
 * Attachment, LawReference · ปิด/เปิดใช้งานแยกกัน ไม่ลบแถว
 */
@Injectable()
export class ImportTemplatesService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbImportTemplate';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly categories: CategoriesService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ────────────────────────────────────────────────────

  options(): TemplateOptionsDto {
    return { layouts: LAYOUT_OPTIONS, articleTypes: ARTICLE_TYPE_OPTIONS };
  }

  /** รายการ Template พร้อมประเภทไฟล์/ArticleType ที่ตั้งไว้ (อ่าน mapping ทั้งหมดครั้งเดียว) */
  async list(activeOnly = false): Promise<ImportTemplateDto[]> {
    const templates: Row[] = await this.ds.query(
      `SELECT TemplateID, TemplateName, Description, SortOrder, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
         FROM KMS.m_KBImportTemplate ${activeOnly ? 'WHERE IsActive = 1' : ''} ORDER BY SortOrder, TemplateName`,
    );
    const all: Row[] = await this.ds.query(
      `SELECT TemplateID, TargetColumnName, ExcelColumnRef, DisplayOrder FROM KMS.m_KBImportTemplateColumn ORDER BY TemplateID, DisplayOrder`,
    );
    const catRows = await this.categories.allRows();
    const byTemplate = new Map<number, Row[]>();
    for (const m of all) {
      const id = Number(m.TemplateID);
      byTemplate.set(id, [...(byTemplate.get(id) ?? []), m]);
    }
    return templates.map((t) => {
      const id = Number(t.TemplateID);
      const cols = this.buildGrid(byTemplate.get(id) ?? [], catRows);
      return toTemplate(t, cols);
    });
  }

  /** Template พร้อมตาราง mapping ครบทุกคอลัมน์และข้อที่ยังตั้งค่าไม่ครบ */
  async get(id: number): Promise<ImportTemplateDetailDto> {
    const t = await this.loadTemplate(id);
    const cols = await this.columnRows(id);
    return {
      ...toTemplate(t, cols),
      columns: cols.map(toColumnDto),
      problems: getTemplateProblems(cols),
    };
  }

  /** ตาราง mapping ว่างสำหรับสร้าง Template ใหม่ */
  emptyGrid(): TemplateColumnDto[] {
    return GRID_COLUMNS.map((name, i) =>
      toColumnDto({ targetColumnName: name, excelColumnRef: null, displayOrder: i }),
    );
  }

  /**
   * ตาราง mapping ของ Template (ครบทุกคอลัมน์เป้าหมาย) — ใช้ตอน import · Template รุ่นเก่า:
   *  - ไม่มีแถว LayoutType แต่มีแถว CategoryID เดิม → derive จากหมวด (ใต้ LW = Law ไม่งั้น NonLaw)
   *  - Law + map LawReference → ตีความเป็น Decree (บันทึกเป็น Decree จริงเมื่อบันทึกครั้งถัดไป)
   */
  async columnRows(id: number): Promise<TemplateColumnRow[]> {
    const saved: Row[] = await this.ds.query(
      `SELECT TargetColumnName, ExcelColumnRef, DisplayOrder FROM KMS.m_KBImportTemplateColumn WHERE TemplateID = @0 ORDER BY DisplayOrder`,
      [id],
    );
    return this.buildGrid(saved, await this.categories.allRows());
  }

  /** ประเภทไฟล์ของ Template ที่ใช้งานอยู่ทั้งหมด (ใช้แนะนำ Template ที่ตรงกับไฟล์เมื่อเลือกผิด) */
  async activeLayouts(): Promise<{ templateName: string; layout: KbLayoutType | null }[]> {
    return (await this.list(true)).map((t) => ({
      templateName: t.templateName,
      layout: normalizeLayout(t.layoutType),
    }));
  }

  /** แถวของ Template สำหรับ import: ต้องมีอยู่และเปิดใช้งาน */
  async requireActiveForImport(
    id: number,
  ): Promise<{ name: string; columns: TemplateColumnRow[] }> {
    const t = await this.loadTemplate(id);
    if (!t.IsActive)
      throw new BusinessException(
        `Template "${String(t.TemplateName)}" ถูกปิดใช้งาน เลือก Template อื่นหรือเปิดใช้งานก่อน`,
        'TEMPLATE_INACTIVE',
      );
    return { name: String(t.TemplateName), columns: await this.columnRows(id) };
  }

  // ── เขียน ───────────────────────────────────────────────────

  create(dto: SaveTemplateDto, user: UserContext): Promise<ImportTemplateDetailDto> {
    return this.logged(
      { action: 'CREATE', operation: KMS_OP.createTemplate },
      async () => {
        const id = await this.save(null, dto, user);
        return this.get(id);
      },
      (r) => ({ recordId: r.templateId, after: r }),
    );
  }

  update(id: number, dto: SaveTemplateDto, user: UserContext): Promise<ImportTemplateDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: KMS_OP.updateTemplate,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        await this.loadTemplate(id);
        await this.save(id, dto, user);
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  deactivate(id: number, user: UserContext): Promise<ImportTemplateDto> {
    return this.logged(
      {
        action: 'DELETE',
        operation: KMS_OP.deactivateTemplate,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        await this.setActive(id, false, user);
        return this.get(id);
      },
      (r) => ({ after: { isActive: r.isActive } }),
    );
  }

  activate(id: number, user: UserContext): Promise<ImportTemplateDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: KMS_OP.activateTemplate,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        await this.setActive(id, true, user);
        return this.get(id);
      },
      (r) => ({ after: { isActive: r.isActive } }),
    );
  }

  // ── ภายใน ───────────────────────────────────────────────────

  private async setActive(id: number, active: boolean, user: UserContext): Promise<void> {
    await this.loadTemplate(id);
    await this.ds.query(
      'UPDATE KMS.m_KBImportTemplate SET IsActive = @0, UpdatedBy = @1, UpdatedDate = GETDATE() WHERE TemplateID = @2',
      [active ? 1 : 0, user.adUserName, id],
    );
  }

  private async loadTemplate(id: number): Promise<Row> {
    const rows: Row[] = await this.ds.query(
      `SELECT TemplateID, TemplateName, Description, SortOrder, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
         FROM KMS.m_KBImportTemplate WHERE TemplateID = @0`,
      [id],
    );
    if (rows.length === 0) throw new ResourceNotFoundException('Import Template', id);
    return rows[0];
  }

  /** ประกอบตาราง mapping ครบทุกคอลัมน์จากแถวที่บันทึกไว้ (+ ตีความ Template รุ่นเก่า) */
  private buildGrid(saved: Row[], catRows: readonly KbCategoryRow[]): TemplateColumnRow[] {
    const byName = new Map<string, Row>();
    for (const s of saved) byName.set(String(s.TargetColumnName).toLowerCase(), s);

    const rows: TemplateColumnRow[] = GRID_COLUMNS.map((name, i) => ({
      targetColumnName: name,
      excelColumnRef:
        (byName.get(name.toLowerCase())?.ExcelColumnRef as string | null | undefined) ?? null,
      displayOrder: i,
    }));
    const find = (n: string) => rows.find((r) => r.targetColumnName === n) as TemplateColumnRow;

    // Template เก่า (ผูกกับ 1 หมวด) ยังไม่มีแถว LayoutType — derive จากแถว CategoryID เดิม
    const layoutRow = find(KbArticleColumn.LayoutType);
    if (normalizeLayout(layoutRow.excelColumnRef) === null) {
      const legacy = byName.get(KbArticleColumn.CategoryID.toLowerCase())?.ExcelColumnRef;
      const legacyId = legacy && /^\d+$/.test(String(legacy)) ? Number(legacy) : 0;
      if (legacyId > 0) {
        const byId = new Map(catRows.map((c) => [c.categoryId, c]));
        if (byId.has(legacyId))
          layoutRow.excelColumnRef = isRootOrUnder(byId, legacyId, KbLayout.LawRootCategoryCode)
            ? KbLayout.Law
            : KbLayout.NonLaw;
      }
    }

    // Template พระราชกฤษฎีการุ่นก่อนเก็บเป็น Law + map LawReference → ตีความเป็น Decree
    const lawRef = find(KbArticleColumn.LawReference);
    if (lawRef.excelColumnRef?.trim() && normalizeLayout(layoutRow.excelColumnRef) === KbLayout.Law)
      layoutRow.excelColumnRef = KbLayout.Decree;

    return rows;
  }

  /** บันทึก Template + mapping ใน transaction เดียว (ลบ-ใส่ใหม่ทั้งชุด) · ตรวจกฎเดียวกับตอน import (getTemplateProblems) */
  private async save(id: number | null, dto: SaveTemplateDto, user: UserContext): Promise<number> {
    const name = dto.templateName.trim();
    const dup = await this.ds.query(
      'SELECT TOP 1 1 AS X FROM KMS.m_KBImportTemplate WHERE TemplateName = @0 AND TemplateID <> @1',
      [name, id ?? 0],
    );
    if (dup.length > 0)
      throw new ConflictBusinessException(
        `มี Template ชื่อ "${name}" อยู่แล้ว`,
        'TEMPLATE_NAME_DUPLICATE',
      );

    // ชื่อคอลัมน์เป้าหมายต้องอยู่ในรายการ (ไม่เชื่อ client) และไม่ซ้ำ
    const seen = new Set<string>();
    for (const c of dto.columns) {
      const canon = GRID_COLUMNS.find((g) => g.toLowerCase() === c.targetColumnName.toLowerCase());
      if (!canon)
        throw new BusinessException(
          `ไม่รู้จักคอลัมน์เป้าหมาย "${c.targetColumnName}"`,
          'TEMPLATE_COLUMN_UNKNOWN',
          { allowed: GRID_COLUMNS },
        );
      if (seen.has(canon))
        throw new BusinessException(`คอลัมน์ "${canon}" ซ้ำกัน`, 'TEMPLATE_COLUMN_DUPLICATE');
      seen.add(canon);
    }

    const rows: TemplateColumnRow[] = dto.columns.map((c) => ({
      targetColumnName: GRID_COLUMNS.find(
        (g) => g.toLowerCase() === c.targetColumnName.toLowerCase(),
      ) as string,
      excelColumnRef: c.excelColumnRef?.trim() ? c.excelColumnRef.trim() : null,
    }));
    const problems = getTemplateProblems(rows);
    if (problems.length > 0)
      throw new BusinessException(
        'ตั้งค่า Template ยังไม่ครบ:\n• ' + problems.join('\n• '),
        'TEMPLATE_INCOMPLETE',
        { problems },
      );

    // เก็บเฉพาะแถวที่ map แล้ว · LayoutType เก็บค่ามาตรฐาน (Law/Decree/NonLaw) · เรียงตามลำดับของตาราง
    const toSave = mappedRows(rows)
      .map((r) => ({
        targetColumnName: r.targetColumnName,
        excelColumnRef:
          r.targetColumnName === KbArticleColumn.LayoutType
            ? (normalizeLayout(r.excelColumnRef) as string)
            : (r.excelColumnRef as string),
      }))
      .sort(
        (a, b) =>
          GRID_COLUMNS.indexOf(a.targetColumnName) - GRID_COLUMNS.indexOf(b.targetColumnName),
      );

    try {
      return await this.tx.run(async ({ manager }) => {
        let templateId = id;
        if (templateId === null) {
          const ins: { TemplateID: number }[] = await manager.query(
            `INSERT INTO KMS.m_KBImportTemplate (TemplateName, Description, SortOrder, IsActive, CreatedBy, CreatedDate)
             VALUES (@0, @1, @2, 1, @3, GETDATE());
             SELECT CONVERT(INT, SCOPE_IDENTITY()) AS TemplateID;`,
            [name, dto.description ?? null, dto.sortOrder ?? 0, user.adUserName],
          );
          templateId = Number(ins[0].TemplateID);
        } else {
          await manager.query(
            `UPDATE KMS.m_KBImportTemplate SET TemplateName = @0, Description = @1, SortOrder = @2, UpdatedBy = @3, UpdatedDate = GETDATE()
              WHERE TemplateID = @4`,
            [name, dto.description ?? null, dto.sortOrder ?? 0, user.adUserName, templateId],
          );
          await manager.query('DELETE FROM KMS.m_KBImportTemplateColumn WHERE TemplateID = @0', [
            templateId,
          ]);
        }
        for (let i = 0; i < toSave.length; i++) {
          await manager.query(
            `INSERT INTO KMS.m_KBImportTemplateColumn (TemplateID, TargetColumnName, ExcelColumnRef, DisplayOrder) VALUES (@0, @1, @2, @3)`,
            [
              templateId,
              toSave[i].targetColumnName,
              toSave[i].excelColumnRef,
              GRID_COLUMNS.indexOf(toSave[i].targetColumnName),
            ],
          );
        }
        return templateId;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictBusinessException(
          `มี Template ชื่อ "${name}" อยู่แล้ว`,
          'TEMPLATE_NAME_DUPLICATE',
        );
      throw err;
    }
  }
}

function toColumnDto(r: TemplateColumnRow): TemplateColumnDto {
  return {
    targetColumnName: r.targetColumnName,
    columnDescription: describeColumn(r.targetColumnName),
    excelColumnRef: r.excelColumnRef ?? null,
    displayOrder: r.displayOrder ?? 0,
  };
}

function toTemplate(raw: Row, cols: TemplateColumnRow[]): ImportTemplateDto {
  const r = camelizeKeys<Row>(raw);
  return {
    templateId: Number(r.templateId),
    templateName: String(r.templateName),
    description: (r.description as string | null) ?? null,
    sortOrder: Number(r.sortOrder ?? 0),
    isActive: Boolean(r.isActive),
    createdBy: (r.createdBy as string | null) ?? null,
    createdDate: (r.createdDate as Date | null) ?? null,
    updatedBy: (r.updatedBy as string | null) ?? null,
    updatedDate: (r.updatedDate as Date | null) ?? null,
    layoutType: resolveTemplateLayout(cols),
    articleType: resolveArticleType(cols),
    hasAttachment: hasAttachmentMapping(cols),
  };
}
