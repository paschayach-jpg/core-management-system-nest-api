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
import type { KbCategoryDto } from '../categories/dto/category.dto';
import { DISPLAY_SLOTS } from '../import-templates/kb-column-catalog';
import { KMS_OP } from '../kms.constants';
import { isUniqueViolation } from '../kms-sql';
import type {
  DisplayProfileDetailDto,
  DisplayProfileDto,
  EffectiveDisplayDto,
  ProfileColumnDto,
  SaveProfileDto,
} from './dto/display-profile.dto';
import { SLOT_KEYS, mergeSettings, resolveEffectiveProfileId } from './effective-display';

type Row = Record<string, unknown>;

/**
 * Article Display Profile (KMS.m_KBArticleDisplayProfile + m_KBArticleDisplayProfileColumn): ชุดตั้งค่าหัวคอลัมน์/การซ่อน-แสดงของหน้ารายการบทความ
 * ผูกกับหมวดผ่าน m_KBCategory.DisplayProfileID (สืบจากหมวดแม่ใกล้สุดที่ตั้งไว้) · ปิด/เปิดใช้งานแยกกัน ไม่ลบแถว
 */
@Injectable()
export class DisplayProfilesService extends CrudLoggedService {
  protected readonly logModule = 'KMS' as const;
  protected readonly logEntity = 'KbArticleDisplayProfile';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly categories: CategoriesService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ────────────────────────────────────────────────────

  async list(): Promise<DisplayProfileDto[]> {
    const rows: Row[] = await this.ds.query(
      `SELECT ProfileID, ProfileName, Description, IsActive, CreatedBy, CreatedDate
         FROM KMS.m_KBArticleDisplayProfile ORDER BY ProfileName`,
    );
    return rows.map(toProfile);
  }

  /** รายละเอียดพร้อม grid ครบทุก slot (ที่ยังไม่เคยบันทึกใช้ค่าเริ่มต้น) */
  async get(id: number): Promise<DisplayProfileDetailDto> {
    const rows: Row[] = await this.ds.query(
      `SELECT ProfileID, ProfileName, Description, IsActive, CreatedBy, CreatedDate
         FROM KMS.m_KBArticleDisplayProfile WHERE ProfileID = @0`,
      [id],
    );
    if (rows.length === 0) throw new ResourceNotFoundException('Display Profile', id);
    return { ...toProfile(rows[0]), columns: await this.columnGrid(id) };
  }

  /** grid เริ่มต้นสำหรับสร้าง profile ใหม่ (ค่าเริ่มต้นของทุก slot) */
  slotCatalog(): ProfileColumnDto[] {
    return DISPLAY_SLOTS.map((s) => ({
      slotKey: s.slotKey,
      displayLabel: s.defaultLabel,
      isVisible: s.defaultVisible,
      slotDescription: s.description,
    }));
  }

  /** หมวดที่ผูก profile นี้อยู่ */
  async categoriesUsing(
    profileId: number,
  ): Promise<Pick<KbCategoryDto, 'categoryId' | 'categoryCode' | 'categoryName'>[]> {
    await this.get(profileId);
    const rows: Row[] = await this.ds.query(
      `SELECT CategoryID, CategoryCode, CategoryName FROM KMS.m_KBCategory WHERE DisplayProfileID = @0 ORDER BY SortOrder, CategoryName`,
      [profileId],
    );
    return rows.map((raw) => {
      const r = camelizeKeys<Row>(raw);
      return {
        categoryId: Number(r.categoryId),
        categoryCode: String(r.categoryCode),
        categoryName: String(r.categoryName),
      };
    });
  }

  /** ค่าแสดงผลที่มีผลจริงของหมวด (สืบจากหมวดแม่ · ข้าม profile ที่ปิดใช้งาน · ไม่พบ = ค่าเริ่มต้น) */
  async effective(categoryId: number): Promise<EffectiveDisplayDto> {
    const rows = await this.categories.allRows();
    if (!rows.some((c) => c.categoryId === categoryId))
      throw new ResourceNotFoundException('หมวดหมู่ความรู้', categoryId);

    const profiles = await this.ds.query(
      'SELECT ProfileID, IsActive FROM KMS.m_KBArticleDisplayProfile',
    );
    const profileId = resolveEffectiveProfileId(
      rows,
      new Map(
        (profiles as Row[]).map((p) => [Number(p.ProfileID), { isActive: Boolean(p.IsActive) }]),
      ),
      categoryId,
    );
    if (profileId === null) return { categoryId, profileId: null, settings: mergeSettings([]) };

    const cols = await this.rawColumns(profileId);
    return { categoryId, profileId, settings: mergeSettings(cols) };
  }

  // ── เขียน ───────────────────────────────────────────────────

  create(dto: SaveProfileDto, user: UserContext): Promise<DisplayProfileDetailDto> {
    return this.logged(
      { action: 'CREATE', operation: KMS_OP.createProfile },
      async () => {
        const name = dto.profileName.trim();
        await this.assertNameFree(name, 0);
        const id = await this.save(null, dto, user);
        return this.get(id);
      },
      (r) => ({ recordId: r.profileId, after: r }),
    );
  }

  update(id: number, dto: SaveProfileDto, user: UserContext): Promise<DisplayProfileDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: KMS_OP.updateProfile,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        await this.get(id);
        await this.assertNameFree(dto.profileName.trim(), id);
        await this.save(id, dto, user);
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  deactivate(id: number): Promise<DisplayProfileDto> {
    return this.logged(
      {
        action: 'DELETE',
        operation: KMS_OP.deactivateProfile,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        await this.get(id);
        await this.ds.query(
          'UPDATE KMS.m_KBArticleDisplayProfile SET IsActive = 0 WHERE ProfileID = @0',
          [id],
        );
        return this.get(id);
      },
      (r) => ({ after: { isActive: r.isActive } }),
    );
  }

  activate(id: number): Promise<DisplayProfileDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: KMS_OP.activateProfile,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        await this.get(id);
        await this.ds.query(
          'UPDATE KMS.m_KBArticleDisplayProfile SET IsActive = 1 WHERE ProfileID = @0',
          [id],
        );
        return this.get(id);
      },
      (r) => ({ after: { isActive: r.isActive } }),
    );
  }

  /** ผูก/ยกเลิกผูก profile กับหมวด (เฉพาะ DisplayProfileID — ไม่แตะคอลัมน์อื่นของหมวด) */
  assignToCategory(
    categoryId: number,
    profileId: number | null,
    _user: UserContext,
  ): Promise<EffectiveDisplayDto> {
    return this.logged(
      {
        action: 'UPDATE',
        entity: 'KbCategory',
        operation: KMS_OP.assignProfile,
        recordId: categoryId,
        meta: { profileId },
      },
      async () => {
        const rows = await this.categories.allRows();
        if (!rows.some((c) => c.categoryId === categoryId))
          throw new ResourceNotFoundException('หมวดหมู่ความรู้', categoryId);
        if (profileId !== null) {
          const p = await this.get(profileId);
          if (!p.isActive)
            throw new BusinessException(
              `Profile "${p.profileName}" ถูกปิดใช้งาน ผูกกับหมวดไม่ได้`,
              'PROFILE_INACTIVE',
            );
        }
        await this.ds.query(
          'UPDATE KMS.m_KBCategory SET DisplayProfileID = @0 WHERE CategoryID = @1',
          [profileId, categoryId],
        );
        return this.effective(categoryId);
      },
    );
  }

  // ── ภายใน ───────────────────────────────────────────────────

  private async assertNameFree(name: string, excludeId: number): Promise<void> {
    const rows = await this.ds.query(
      'SELECT TOP 1 1 AS X FROM KMS.m_KBArticleDisplayProfile WHERE ProfileName = @0 AND ProfileID <> @1',
      [name, excludeId],
    );
    if (rows.length > 0)
      throw new ConflictBusinessException(
        `มี Profile ชื่อ "${name}" อยู่แล้ว`,
        'PROFILE_NAME_DUPLICATE',
      );
  }

  /** บันทึก profile + ชุด slot ใน transaction เดียว (ลบ-ใส่ใหม่ทั้งชุด) · คืน ProfileID */
  private async save(id: number | null, dto: SaveProfileDto, user: UserContext): Promise<number> {
    const seen = new Set<string>();
    for (const c of dto.columns) {
      const key = c.slotKey.toLowerCase();
      if (seen.has(key))
        throw new BusinessException(`slotKey "${c.slotKey}" ซ้ำกัน`, 'PROFILE_SLOT_DUPLICATE');
      seen.add(key);
    }

    try {
      return await this.tx.run(async ({ manager }) => {
        let profileId = id;
        if (profileId === null) {
          const ins: { ProfileID: number }[] = await manager.query(
            `INSERT INTO KMS.m_KBArticleDisplayProfile (ProfileName, Description, IsActive, CreatedBy, CreatedDate)
             VALUES (@0, @1, 1, @2, GETDATE());
             SELECT CONVERT(INT, SCOPE_IDENTITY()) AS ProfileID;`,
            [dto.profileName.trim(), dto.description ?? null, user.adUserName],
          );
          profileId = Number(ins[0].ProfileID);
        } else {
          await manager.query(
            'UPDATE KMS.m_KBArticleDisplayProfile SET ProfileName = @0, Description = @1 WHERE ProfileID = @2',
            [dto.profileName.trim(), dto.description ?? null, profileId],
          );
          await manager.query(
            'DELETE FROM KMS.m_KBArticleDisplayProfileColumn WHERE ProfileID = @0',
            [profileId],
          );
        }
        for (const c of dto.columns) {
          const key = SLOT_KEYS.find((k) => k.toLowerCase() === c.slotKey.toLowerCase()) as string;
          await manager.query(
            `INSERT INTO KMS.m_KBArticleDisplayProfileColumn (ProfileID, SlotKey, SlotDescription, DisplayLabel, IsVisible)
             VALUES (@0, @1, @2, @3, @4)`,
            [profileId, key, (c.slotDescription ?? '').trim(), c.displayLabel, c.isVisible ? 1 : 0],
          );
        }
        return profileId;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictBusinessException(
          `มี Profile ชื่อ "${dto.profileName.trim()}" อยู่แล้ว`,
          'PROFILE_NAME_DUPLICATE',
        );
      throw err;
    }
  }

  private async rawColumns(profileId: number) {
    const rows: Row[] = await this.ds.query(
      `SELECT SlotKey, SlotDescription, DisplayLabel, IsVisible FROM KMS.m_KBArticleDisplayProfileColumn WHERE ProfileID = @0`,
      [profileId],
    );
    return rows.map((raw) => {
      const r = camelizeKeys<Row>(raw);
      return {
        slotKey: String(r.slotKey),
        slotDescription: (r.slotDescription as string | null) ?? null,
        displayLabel: String(r.displayLabel ?? ''),
        isVisible: Boolean(r.isVisible),
      };
    });
  }

  /** grid ครบทุก slot: ค่าที่บันทึกไว้ ถ้าไม่มี (หรือ SlotDescription เป็น NULL) ใช้ค่าเริ่มต้นจาก catalog */
  private async columnGrid(profileId: number): Promise<ProfileColumnDto[]> {
    const saved = await this.rawColumns(profileId);
    return DISPLAY_SLOTS.map((s) => {
      const c = saved.find((x) => x.slotKey.toLowerCase() === s.slotKey.toLowerCase());
      return {
        slotKey: s.slotKey,
        slotDescription: c && c.slotDescription !== null ? c.slotDescription : s.description,
        displayLabel: c ? c.displayLabel : s.defaultLabel,
        isVisible: c ? c.isVisible : s.defaultVisible,
      };
    });
  }
}

function toProfile(raw: Row): DisplayProfileDto {
  const r = camelizeKeys<Row>(raw);
  return {
    profileId: Number(r.profileId),
    profileName: String(r.profileName),
    description: (r.description as string | null) ?? null,
    isActive: Boolean(r.isActive),
    createdBy: (r.createdBy as string | null) ?? null,
    createdDate: (r.createdDate as Date | null) ?? null,
  };
}
