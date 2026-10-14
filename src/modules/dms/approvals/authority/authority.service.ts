import { Injectable } from '@nestjs/common';
import { paginated, Paginated } from '../../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../../database/transaction-runner.service';
import type { Tx } from '../common/db.types';
import { describeResolveMatch, validateConfigInput } from './authority-rules';
import { AuthorityConfigRow, AuthorityStore, SaveConfigInput } from './authority.store';
import type {
  AuthorityConfigDto,
  AuthorityListQueryDto,
  ResolvedAuthorityDto,
  ResolveQueryDto,
  SaveAuthorityConfigDto,
} from './dto/authority.dto';

/**
 * ระดับสิทธิ์ตามชั้นความลับ (EMS.FolderAuthorityConfig) — พอร์ตจาก FolderAuthorityService
 * แถวหนึ่ง = หนึ่งชั้นความลับ (1HC..4PC) ของกลุ่ม (ConfigLabel); ลบ = soft delete ทั้งกลุ่ม
 * การเขียนทั้งหมดเป็น Admin (บังคับที่ controller ด้วย @MinRole)
 */
@Injectable()
export class FolderAuthorityService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'FolderAuthorityConfig';

  constructor(
    crudLog: CrudLogService,
    private readonly store: AuthorityStore,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  async list(q: AuthorityListQueryDto): Promise<Paginated<AuthorityConfigDto>> {
    const r = await this.store.page(q.q, { skip: (q.page - 1) * q.pageSize, take: q.pageSize });
    return paginated(r.items.map(toDto), r.total, q);
  }

  async get(id: number): Promise<AuthorityConfigDto> {
    const row = await this.store.get(id);
    if (!row) throw new ResourceNotFoundException('FolderAuthorityConfig', id);
    return toDto(row);
  }

  /** ดูว่าพนักงานที่มีตำแหน่ง/แผนก/ฝ่าย/Level แบบนี้จะได้สิทธิ์ใด (sp_ResolveFolderAuthority) */
  async resolve(q: ResolveQueryDto): Promise<ResolvedAuthorityDto> {
    const rows = await this.store.resolve(q);
    return {
      matchedBy: describeResolveMatch(q, rows[0]),
      rows: rows.map(toDto),
    };
  }

  create(dto: SaveAuthorityConfigDto, user: UserContext): Promise<AuthorityConfigDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'SAVE_FOLDER_AUTHORITY',
        meta: { label: dto.configLabel, level: dto.confidentialityLevel },
      },
      async () => {
        const input = this.validate(dto);
        const id = await this.tx.run(async (t) => {
          await this.assertUnique(input, null, t);
          return this.store.insert(t, input, user.userId);
        });
        return this.get(id);
      },
      (r) => ({ recordId: r.configId, after: r }),
    );
  }

  update(id: number, dto: SaveAuthorityConfigDto, user: UserContext): Promise<AuthorityConfigDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'SAVE_FOLDER_AUTHORITY',
        recordId: id,
        captureBefore: () => this.store.get(id),
      },
      async () => {
        const input = this.validate(dto);
        await this.tx.run(async (t) => {
          const existing = await this.store.get(id, t);
          if (!existing || !existing.isActive)
            throw new ResourceNotFoundException('FolderAuthorityConfig', id);
          await this.assertUnique(input, id, t);
          await this.store.update(t, id, input, user.userId);
        });
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบทั้งกลุ่ม (soft delete ทุกชั้นความลับของ ConfigLabel เดียวกัน) */
  removeGroup(label: string, user: UserContext): Promise<{ deletedRows: number }> {
    return this.logged(
      { action: 'DELETE', operation: 'DELETE_FOLDER_AUTHORITY_GROUP', recordId: label },
      async () => {
        return this.tx.run(async (t) => {
          const count = await this.store.countActiveByLabel(label, t);
          if (count === 0) throw new ResourceNotFoundException('FolderAuthorityConfig', label);
          await this.store.softDeleteGroup(t, label, user.userId);
          return { deletedRows: count };
        });
      },
      (r) => ({ meta: { deletedRows: r.deletedRows } }),
    );
  }

  private validate(dto: SaveAuthorityConfigDto): SaveConfigInput {
    const clean = (s?: string): string | null => (s && s.trim() !== '' ? s.trim() : null);
    const input: SaveConfigInput = {
      configLabel: dto.configLabel.trim(),
      positionName: clean(dto.positionName),
      departmentCode: clean(dto.departmentCode),
      divisionCode: clean(dto.divisionCode),
      levelCode: clean(dto.levelCode),
      confidentialityLevel: dto.confidentialityLevel,
      canView: dto.canView,
      canAdd: dto.canAdd,
      canEdit: dto.canEdit,
      canApprove: dto.canApprove,
      canDownload: dto.canDownload,
    };
    const problem = validateConfigInput(input);
    if (problem) throw new BusinessException(problem.message, problem.code);
    return input;
  }

  /** กลุ่มเดียวกัน (ConfigLabel) มีได้แถวเดียวต่อชั้นความลับ — ตารางไม่มี unique index จึงตรวจเอง (resolve จะได้ผลไม่แน่นอนถ้าซ้ำ) */
  private async assertUnique(
    input: SaveConfigInput,
    excludeId: number | null,
    t: Tx,
  ): Promise<void> {
    const dup = await this.store.findActive(
      input.configLabel,
      input.confidentialityLevel,
      excludeId,
      t,
    );
    if (dup) {
      throw new ConflictBusinessException(
        `กลุ่ม "${input.configLabel}" มีสิทธิ์ของชั้นความลับ ${input.confidentialityLevel} อยู่แล้ว (ConfigID ${dup.configId})`,
        'AUTHORITY_DUPLICATE',
        { configId: dup.configId },
      );
    }
  }
}

export function toDto(r: AuthorityConfigRow): AuthorityConfigDto {
  return {
    configId: r.configId,
    configLabel: r.configLabel,
    positionName: r.positionName,
    departmentCode: r.departmentCode,
    divisionCode: r.divisionCode,
    levelCode: r.levelCode,
    confidentialityLevel: r.confidentialityLevel,
    canView: r.canView,
    canAdd: r.canAdd,
    canEdit: r.canEdit,
    canApprove: r.canApprove,
    canDownload: r.canDownload,
    isActive: r.isActive,
    updatedDate: r.updatedDate,
  };
}
