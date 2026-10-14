import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConflictBusinessException } from '../../../common/exceptions/business.exception';
import { EntityCrudService } from '../../../common/crud/entity-crud.service';
import { camelizeKeys } from '../../../common/utils/camelize';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { HrDepartment } from '../entities/hr-department.entity';
import { HrDivision } from '../entities/hr-division.entity';
import { HrPositionLevel } from '../entities/hr-position-level.entity';
import { HrPositionMapping } from '../entities/hr-position-mapping.entity';
import { HrPosition } from '../entities/hr-position.entity';
import type { PositionMappingViewDto } from './dto/hr-masters.dto';

/** ฝ่าย — `quotaSize` ไม่เปิดให้แก้ตรงนี้ (จัดการผ่าน DMS quota) */
@Injectable()
export class HrDivisionsService extends EntityCrudService<HrDivision> {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'HrDivision';
  constructor(crudLog: CrudLogService, @InjectRepository(HrDivision) repo: Repository<HrDivision>) {
    super(crudLog, repo, {
      entityName: 'HrDivision',
      idProperty: 'divisionId',
      searchProperties: ['divisionCode', 'divisionName', 'divisionNameTh'],
      sortable: ['divisionCode', 'divisionName'],
      defaultSort: { property: 'divisionCode' },
      immutable: ['createdDate', 'quotaSize'],
    });
  }
}

@Injectable()
export class HrDepartmentsService extends EntityCrudService<HrDepartment> {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'HrDepartment';
  constructor(
    crudLog: CrudLogService,
    @InjectRepository(HrDepartment) repo: Repository<HrDepartment>,
  ) {
    super(crudLog, repo, {
      entityName: 'HrDepartment',
      idProperty: 'departmentId',
      searchProperties: ['departmentCode', 'departmentName', 'departmentNameTh'],
      sortable: ['departmentCode', 'departmentName', 'divisionId'],
      defaultSort: { property: 'departmentCode' },
      immutable: ['createdDate', 'quotaSize'],
    });
  }
}

/** ตำแหน่ง (ตาราง EMS.m_Role ชื่อทำให้สับสน — เก็บ "ตำแหน่งงาน" ไม่ใช่สิทธิ์) */
@Injectable()
export class HrPositionsService extends EntityCrudService<HrPosition> {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'HrPosition';
  constructor(crudLog: CrudLogService, @InjectRepository(HrPosition) repo: Repository<HrPosition>) {
    super(crudLog, repo, {
      entityName: 'HrPosition',
      idProperty: 'positionId',
      searchProperties: ['positionCode', 'positionName'],
      sortable: ['positionCode', 'positionName'],
      defaultSort: { property: 'positionCode' },
      immutable: ['createdDate'],
    });
  }
}

/** ระดับตำแหน่ง (EMS.m_Position) — PK เป็นรหัสข้อความ จึงสร้างเองด้วย levelCode */
@Injectable()
export class HrPositionLevelsService extends EntityCrudService<HrPositionLevel> {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'HrPositionLevel';
  constructor(
    crudLog: CrudLogService,
    @InjectRepository(HrPositionLevel) repo: Repository<HrPositionLevel>,
  ) {
    super(crudLog, repo, {
      entityName: 'HrPositionLevel',
      idProperty: 'levelCode',
      searchProperties: ['levelCode', 'levelName'],
      sortable: ['levelCode', 'sortOrder', 'levelName'],
      defaultSort: { property: 'sortOrder' },
    });
  }

  /** PK เป็นรหัสข้อความ — TypeORM save() จะ "แก้ทับ" ถ้ารหัสซ้ำ จึงต้องกันเอง */
  override async create(
    input: Parameters<EntityCrudService<HrPositionLevel>['create']>[0],
  ): Promise<HrPositionLevel> {
    const code = (input as { levelCode?: string }).levelCode;
    if (code && (await this.repo.existsBy({ levelCode: code }))) {
      throw new ConflictBusinessException(`รหัสระดับ ${code} มีอยู่แล้ว`, 'LEVEL_CODE_DUPLICATE');
    }
    return super.create(input);
  }
}

@Injectable()
export class HrPositionMappingsService extends EntityCrudService<HrPositionMapping> {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'HrPositionMapping';
  constructor(
    crudLog: CrudLogService,
    @InjectRepository(HrPositionMapping) repo: Repository<HrPositionMapping>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {
    super(crudLog, repo, {
      entityName: 'HrPositionMapping',
      idProperty: 'mappingId',
      immutable: ['createdDate'],
    });
  }

  /** รายการพร้อมชื่อตำแหน่ง/ฝ่าย/แผนก (เหมือน HrPositionMapping.GetAll เดิม) */
  async listWithNames(departmentId?: number): Promise<PositionMappingViewDto[]> {
    const rows: Record<string, unknown>[] = await this.ds.query(
      `SELECT m.MappingID, m.PositionID, p.PositionName, m.DivisionID, v.DivisionName,
              m.DepartmentID, d.DepartmentName, m.HeadCount, m.IsActive
         FROM EMS.m_PositionMapping m
         LEFT JOIN EMS.m_Role p       ON p.PositionID   = m.PositionID
         LEFT JOIN EMS.m_Division v   ON v.DivisionID   = m.DivisionID
         LEFT JOIN EMS.m_Department d ON d.DepartmentID = m.DepartmentID
        WHERE (@0 IS NULL OR m.DepartmentID = @0)
        ORDER BY v.DivisionName, d.DepartmentName, p.PositionName`,
      [departmentId ?? null],
    );
    return rows.map((r) => camelizeKeys<PositionMappingViewDto>(r));
  }
}
