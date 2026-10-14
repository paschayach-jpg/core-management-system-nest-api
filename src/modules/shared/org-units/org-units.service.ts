import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Confidentiality, OrgUnitType } from '../../../common/constants/enums';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutionError } from '../../../database/sp/sp-execution.error';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { OrgUnitRelationship } from '../entities/org-unit-relationship.entity';
import type {
  CreateOrgUnitDto,
  OrgUnitDto,
  OrgUnitListQueryDto,
  UpdateOrgUnitDto,
} from './dto/org-unit.dto';

const CODE_PREFIX: Record<number, string> = { 1: 'SC', 2: 'DIV', 3: 'DEPT' };
const DUPLICATE_CODE_MESSAGE = 'มีอยู่ในระบบแล้ว';
const MAX_CODE_RETRIES = 3;

/**
 * โครงสร้างหน่วยงาน 3 ระดับ: 1=SubCommittee → 2=Division → 3=Department (EMS.OrgUnit)
 * พอร์ตจาก OrgStructureService — การเขียนทั้งหมดเป็น Admin เท่านั้น (บังคับที่ controller ด้วย @MinRole)
 *
 * ต่างจากโปรแกรมเดิม: "ย้ายหน่วยงาน" เดิมเรียก sp_UpdateOrgUnit ซึ่งไม่แก้ ParentOrgUnitID (ย้ายไม่เกิดผลจริง)
 * → API นี้อัปเดต ParentOrgUnitID จริง (ดู docs/DECISIONS.md D-03)
 */
@Injectable()
export class OrgUnitsService extends CrudLoggedService {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'OrgUnit';

  constructor(
    crudLog: CrudLogService,
    private readonly sp: SpExecutor,
    private readonly tx: TransactionRunner,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(OrgUnitRelationship)
    private readonly relRepo: Repository<OrgUnitRelationship>,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  async list(q: OrgUnitListQueryDto = {}): Promise<OrgUnitDto[]> {
    const rows = await this.sp.call(Sp.ems.getOrgUnitHierarchy).rows<Record<string, unknown>>({});
    return rows
      .map(toDto)
      .filter(
        (u) =>
          !u.isDeleted &&
          (q.includeInactive || u.isActive) &&
          (q.type === undefined || u.orgUnitType === q.type),
      );
  }

  async get(id: number): Promise<OrgUnitDto> {
    const row = await this.sp
      .call(Sp.ems.getOrgUnitById)
      .one<Record<string, unknown>>({ OrgUnitID: id });
    if (!row) throw new ResourceNotFoundException('OrgUnit', id);
    return toDto(row);
  }

  async byConfidentiality(level: Confidentiality): Promise<OrgUnitDto[]> {
    const rows = await this.sp
      .call(Sp.ems.getOrgUnitByConfidentialityLevel)
      .rows<Record<string, unknown>>({ ConfidentialityLevel: level });
    return rows.map(toDto);
  }

  async hasActiveDependents(id: number): Promise<boolean> {
    const v = await this.sp.call(Sp.ems.hasActiveDependents).scalar<number>({ OrgUnitID: id });
    return Number(v) === 1;
  }

  async relationships(): Promise<OrgUnitRelationship[]> {
    return this.relRepo.find({ where: { isActive: true } });
  }

  // ── เขียน ──────────────────────────────────────────────────

  create(dto: CreateOrgUnitDto, user: UserContext): Promise<OrgUnitDto> {
    return this.logged(
      { action: 'CREATE', meta: { type: dto.orgUnitType, name: dto.orgUnitNameTh } },
      async () => {
        const name = dto.orgUnitNameTh.trim();
        await this.validateParentTier(dto.orgUnitType, dto.parentOrgUnitId ?? null);
        await this.validateNameUnique(name, dto.parentOrgUnitId ?? null, null);

        let code = dto.orgUnitCode?.trim() ?? '';
        if (!code || (await this.codeExists(code))) code = await this.generateCode(dto.orgUnitType);

        for (let attempt = 1; ; attempt++) {
          try {
            const newId = await this.tx.run(async ({ sp }) => {
              const id = await this.sp.call(Sp.ems.insertOrgUnit, sp).scalar<number>({
                OrgUnitCode: code,
                OrgUnitNameTH: name,
                OrgUnitNameEN: dto.orgUnitNameEn ?? '',
                OrgUnitType: dto.orgUnitType,
                ParentOrgUnitID: (dto.parentOrgUnitId ?? null) as number,
                SortOrder: dto.sortOrder ?? 0,
                CreatedBy: user.userId,
              });
              if (dto.orgUnitType === OrgUnitType.SubCommittee) {
                await this.sp.call(Sp.dbo.insertSubCommittee, sp).exec({
                  OrgUnitID: Number(id),
                  SubCommitteeCode: code,
                  SubCommitteeNameTH: name,
                  SubCommitteeNameEN: dto.orgUnitNameEn ?? null,
                  CreatedBy: user.adUserName,
                });
              }
              return Number(id);
            });
            return await this.get(newId);
          } catch (err) {
            // รหัสชนกัน (race) → สร้างรหัสใหม่แล้วลองซ้ำ
            const dup =
              err instanceof SpExecutionError && err.message.includes(DUPLICATE_CODE_MESSAGE);
            if (!dup || attempt >= MAX_CODE_RETRIES) {
              if (dup)
                throw new ConflictBusinessException(
                  `ไม่สามารถสร้างรหัสหน่วยงานที่ไม่ซ้ำได้หลังจากพยายาม ${MAX_CODE_RETRIES} ครั้ง`,
                  'ORG_UNIT_CODE_CONFLICT',
                );
              throw err;
            }
            code = await this.generateCode(dto.orgUnitType);
          }
        }
      },
      (r) => ({ recordId: r.orgUnitId, after: r }),
    );
  }

  update(id: number, dto: UpdateOrgUnitDto): Promise<OrgUnitDto> {
    return this.logged(
      { action: 'UPDATE', recordId: id, captureBefore: () => this.get(id) },
      async () => {
        const existing = await this.requireActive(id, 'แก้ไข');
        const name = dto.orgUnitNameTh.trim();
        await this.validateNameUnique(name, existing.parentOrgUnitId ?? null, id);
        await this.sp.call(Sp.ems.updateOrgUnit).exec({
          OrgUnitID: id,
          OrgUnitNameTH: name,
          OrgUnitNameEN: dto.orgUnitNameEn ?? existing.orgUnitNameEn ?? '',
          SortOrder: dto.sortOrder ?? existing.sortOrder,
        });
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  move(id: number, newParentId: number | null): Promise<OrgUnitDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'MOVE_ORG_UNIT',
        recordId: id,
        captureBefore: () => this.get(id),
        meta: { newParentId },
      },
      async () => {
        const existing = await this.requireActive(id, 'ย้าย');
        await this.validateParentTier(existing.orgUnitType, newParentId);
        await this.validateNameUnique(existing.orgUnitNameTh, newParentId, id);
        await this.ds.query('UPDATE EMS.OrgUnit SET ParentOrgUnitID = @0 WHERE OrgUnitID = @1', [
          newParentId,
          id,
        ]);
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบ (soft delete) — ถ้ายังมีโฟลเดอร์/ผู้ใช้ที่ใช้งานอยู่ต้องส่ง force=true */
  remove(id: number, user: UserContext, force = false): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: force ? 'FORCE_DELETE_ORG_UNIT' : 'DELETE_ORG_UNIT',
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        const existing = await this.get(id);
        if (existing.isDeleted) return; // ลบไปแล้ว — idempotent
        if (!force && (await this.hasActiveDependents(id))) {
          throw new ConflictBusinessException(
            `ลบหน่วยงาน '${existing.orgUnitNameTh}' ไม่ได้ เพราะยังมีโฟลเดอร์หรือผู้ใช้ที่ใช้งานอยู่`,
            'ORG_UNIT_HAS_DEPENDENTS',
          );
        }
        await this.tx.run(async ({ sp, manager }) => {
          if (force) {
            // soft delete โฟลเดอร์ทั้งหมดของหน่วยงาน (ผู้ใช้ยังคงอ้างอิงได้ เพราะ UserAccount.OrgUnitID เป็น NOT NULL)
            await manager.query(
              'UPDATE storage.Folder SET IsDeleted = 1, DeletedDate = GETDATE(), DeletedBy = @0 WHERE OrgUnitID = @1 AND IsDeleted = 0',
              [user.userId, id],
            );
          }
          await this.sp
            .call(Sp.ems.softDeleteOrgUnit, sp)
            .exec({ OrgUnitID: id, DeletedBy: user.userId });
          if (existing.orgUnitType === OrgUnitType.SubCommittee) {
            await this.sp
              .call(Sp.dbo.softDeleteSubCommittee, sp)
              .exec({ OrgUnitID: id, DeletedBy: user.adUserName });
          }
        });
      },
    );
  }

  /** เชื่อม Division กับ SubCommittee (many-to-many ผ่าน EMS.OrgUnitRelationship) */
  linkDivision(divisionId: number, subCommitteeId: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'OrgUnitRelationship',
        operation: 'LINK_DIVISION',
        recordId: divisionId,
        meta: { subCommitteeId },
      },
      async () => {
        const division = await this.get(divisionId);
        if (division.isDeleted || division.orgUnitType !== OrgUnitType.Division) {
          throw new BusinessException('OrgUnit ที่ระบุต้องเป็น Division', 'NOT_A_DIVISION');
        }
        const sub = await this.get(subCommitteeId);
        if (sub.isDeleted || sub.orgUnitType !== OrgUnitType.SubCommittee) {
          throw new BusinessException('Parent ที่ระบุต้องเป็น SubCommittee', 'NOT_A_SUBCOMMITTEE');
        }
        await this.sp
          .call(Sp.ems.addOrgUnitRelationship)
          .exec({ SubCommitteeID: subCommitteeId, DivisionID: divisionId, CreatedBy: user.userId });
      },
    );
  }

  unlinkDivision(divisionId: number, subCommitteeId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        entity: 'OrgUnitRelationship',
        operation: 'UNLINK_DIVISION',
        recordId: divisionId,
        meta: { subCommitteeId },
      },
      () =>
        this.sp
          .call(Sp.ems.removeOrgUnitRelationship)
          .exec({ SubCommitteeID: subCommitteeId, DivisionID: divisionId }),
    );
  }

  // ── กฎ ─────────────────────────────────────────────────────

  private async requireActive(id: number, verb: string): Promise<OrgUnitDto> {
    const u = await this.get(id);
    if (u.isDeleted || !u.isActive) {
      throw new BusinessException(
        `หน่วยงาน '${u.orgUnitNameTh}' ถูกปิดใช้งาน ไม่สามารถ${verb}ได้`,
        'ORG_UNIT_INACTIVE',
      );
    }
    return u;
  }

  /** SubCommittee ห้ามมี parent · Division parent (ถ้ามี) = SubCommittee · Department ต้องมี parent = Division */
  async validateParentTier(type: number, parentId: number | null): Promise<void> {
    switch (type) {
      case OrgUnitType.SubCommittee:
        if (parentId !== null)
          throw new BusinessException(
            'Sub-Committee (ระดับ 1) ต้องไม่มีหน่วยงานแม่',
            'ORG_PARENT_NOT_ALLOWED',
          );
        return;
      case OrgUnitType.Division:
        if (parentId !== null)
          await this.assertParent(parentId, OrgUnitType.SubCommittee, 'Division', 'Sub-Committee');
        return;
      case OrgUnitType.Department:
        if (parentId === null)
          throw new BusinessException(
            'Department (ระดับ 3) ต้องมีหน่วยงานแม่เป็น Division',
            'ORG_PARENT_REQUIRED',
          );
        await this.assertParent(parentId, OrgUnitType.Division, 'Department', 'Division');
        return;
      default:
        throw new BusinessException(`ไม่รู้จักประเภทหน่วยงาน ${type}`, 'ORG_UNKNOWN_TYPE');
    }
  }

  private async assertParent(
    parentId: number,
    expected: OrgUnitType,
    childLabel: string,
    parentLabel: string,
  ): Promise<void> {
    const parent = await this.sp
      .call(Sp.ems.getOrgUnitById)
      .one<Record<string, unknown>>({ OrgUnitID: parentId });
    if (!parent)
      throw new BusinessException(`ไม่พบหน่วยงานแม่ ID ${parentId}`, 'ORG_PARENT_NOT_FOUND');
    const p = toDto(parent);
    if (p.isDeleted || !p.isActive)
      throw new BusinessException(
        `หน่วยงานแม่ '${p.orgUnitNameTh}' ถูกปิดใช้งาน`,
        'ORG_PARENT_INACTIVE',
      );
    if (p.orgUnitType !== expected) {
      throw new BusinessException(
        `${childLabel} ต้องอยู่ใต้ ${parentLabel} เท่านั้น แต่หน่วยงานที่เลือก '${p.orgUnitNameTh}' เป็นระดับ ${p.orgUnitType}`,
        'ORG_PARENT_WRONG_TYPE',
      );
    }
  }

  private async validateNameUnique(
    name: string,
    parentId: number | null,
    excludeId: number | null,
  ): Promise<void> {
    const rows: { c: number }[] = await this.ds.query(
      `SELECT COUNT(*) AS c FROM EMS.OrgUnit
        WHERE OrgUnitNameTH = @0 AND IsDeleted = 0
          AND ((@1 IS NULL AND ParentOrgUnitID IS NULL) OR ParentOrgUnitID = @1)
          AND (@2 IS NULL OR OrgUnitID <> @2)`,
      [name, parentId, excludeId],
    );
    if (Number(rows[0]?.c) > 0) {
      const where = parentId !== null ? `ภายใต้หน่วยงาน ID ${parentId}` : 'ระดับ Sub-Committee';
      throw new ConflictBusinessException(
        `ชื่อหน่วยงาน '${name}' มีอยู่แล้ว${where} กรุณาใช้ชื่ออื่น`,
        'ORG_NAME_DUPLICATE',
      );
    }
  }

  private async codeExists(code: string): Promise<boolean> {
    const rows: { c: number }[] = await this.ds.query(
      'SELECT COUNT(*) AS c FROM EMS.OrgUnit WHERE OrgUnitCode = @0 AND IsDeleted = 0',
      [code],
    );
    return Number(rows[0]?.c) > 0;
  }

  /** SC-001 / DIV-001 / DEPT-001 … เลขถัดจากมากสุดที่มี */
  private async generateCode(type: number): Promise<string> {
    const prefix = CODE_PREFIX[type] ?? 'ORG';
    const all = await this.sp.call(Sp.ems.getOrgUnitHierarchy).rows<Record<string, unknown>>({});
    let max = 0;
    for (const r of all) {
      const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(r.OrgUnitCode ?? ''));
      if (m) max = Math.max(max, Number(m[1]));
    }
    for (let n = max + 1, tries = 0; tries < 100; n++, tries++) {
      const code = `${prefix}-${String(n).padStart(3, '0')}`;
      if (!(await this.codeExists(code))) return code;
    }
    const d = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${prefix}-${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
}

function toDto(row: Record<string, unknown>): OrgUnitDto {
  const c = camelizeKeys<Record<string, unknown>>(row);
  return {
    orgUnitId: Number(c.orgUnitId),
    orgUnitCode: String(c.orgUnitCode),
    orgUnitNameTh: String(c.orgUnitNameTh),
    orgUnitNameEn: (c.orgUnitNameEn as string | null | undefined) ?? null,
    orgUnitType: Number(c.orgUnitType),
    parentOrgUnitId:
      c.parentOrgUnitId === null || c.parentOrgUnitId === undefined
        ? null
        : Number(c.parentOrgUnitId),
    sortOrder: Number(c.sortOrder ?? 0),
    isActive: Boolean(c.isActive),
    isDeleted: Boolean(c.isDeleted),
    createdDate: (c.createdDate as Date | undefined) ?? null,
  };
}
