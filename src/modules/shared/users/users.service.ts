import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  applyPaging,
  applySort,
  LIKE_ESCAPE,
  likeContains,
} from '../../../common/utils/query.util';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { UserContextService } from '../../auth/services/user-context.service';
import { UserAccount } from '../entities/user-account.entity';
import type {
  CreateUserDto,
  UpdateUserDto,
  UserListQueryDto,
  UserLookupDto,
  UserSummaryDto,
} from './dto/user.dto';

const SORT = {
  displayName: 'u.DisplayName',
  adUserName: 'u.ADUserName',
  appRole: 'u.AppRole',
  lastLoginDate: 'u.LastLoginDate',
  employeeCode: 'u.EmployeeCode',
};

/** จัดการบัญชีผู้ใช้ (EMS.UserAccount) — แยกจาก AuthModule ที่ดูแลการ login */
@Injectable()
export class UsersService extends CrudLoggedService {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'UserAccount';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(UserAccount) private readonly repo: Repository<UserAccount>,
    private readonly sp: SpExecutor,
    private readonly userCtx: UserContextService,
  ) {
    super(crudLog);
  }

  async list(q: UserListQueryDto): Promise<Paginated<UserSummaryDto>> {
    const qb = this.repo.createQueryBuilder('u');
    if (q.role !== undefined) qb.andWhere('u.AppRole = :role', { role: q.role });
    if (q.orgUnitId !== undefined) qb.andWhere('u.OrgUnitID = :org', { org: q.orgUnitId });
    if (q.isActive !== undefined) qb.andWhere('u.IsActive = :active', { active: q.isActive });
    this.applySearch(qb, q.q);
    applySort(qb, q, SORT, { column: 'u.DisplayName' });
    applyPaging(qb, q);
    const [items, total] = await qb.getManyAndCount();
    return paginated(items.map(toSummary), total, q);
  }

  /** ค้นผู้ใช้สำหรับเลือกในหน้าแชร์/อนุมัติ (ทุกคนที่ login ใช้ได้ — คืนเฉพาะข้อมูลไม่อ่อนไหว, เฉพาะบัญชีที่ใช้งานอยู่) */
  async lookup(term: string, limit = 20): Promise<UserLookupDto[]> {
    const t = term.trim();
    if (t.length < 2) return [];
    const qb = this.repo.createQueryBuilder('u').where('u.IsActive = 1');
    this.applySearch(qb, t);
    const rows = await qb.orderBy('u.DisplayName', 'ASC').take(Math.min(limit, 50)).getMany();
    return rows.map(toLookup);
  }

  async get(id: number): Promise<UserSummaryDto> {
    const u = await this.repo.findOneBy({ userId: id });
    if (!u) throw new ResourceNotFoundException('UserAccount', id);
    return toSummary(u);
  }

  async positionsByDepartment(departmentCode: string): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('u')
      .select('DISTINCT u.PositionName', 'positionName')
      .where('u.DepartmentCode = :d AND u.PositionName IS NOT NULL AND u.IsActive = 1', {
        d: departmentCode,
      })
      .orderBy('u.PositionName', 'ASC')
      .getRawMany<{ positionName: string }>();
    return rows.map((r) => r.positionName);
  }

  create(dto: CreateUserDto, actor: UserContext): Promise<UserSummaryDto> {
    return this.logged(
      { action: 'CREATE', meta: { adUserName: dto.adUserName } },
      async () => {
        const name = dto.adUserName.trim();
        if (await this.repo.existsBy({ adUserName: name })) {
          throw new ConflictBusinessException(
            `ชื่อผู้ใช้ ${name} มีอยู่ในระบบแล้ว`,
            'USER_DUPLICATE',
          );
        }
        const id = await this.sp.call(Sp.ems.insertUserAccount).scalar<number>({
          ADUserName: name,
          DisplayName: dto.displayName,
          Email: dto.email ?? '',
          AppRole: dto.appRole ?? 1,
          OrgUnitID: dto.orgUnitId,
          CreatedBy: actor.userId,
        });
        return this.get(Number(id));
      },
      (r) => ({ recordId: r.userId, after: r }),
    );
  }

  update(id: number, dto: UpdateUserDto, actor: UserContext): Promise<UserSummaryDto> {
    return this.logged(
      { action: 'UPDATE', recordId: id, captureBefore: () => this.get(id) },
      async () => {
        const current = await this.repo.findOneBy({ userId: id });
        if (!current) throw new ResourceNotFoundException('UserAccount', id);
        if (id === actor.userId && dto.isActive === false) {
          throw new BusinessException(
            'ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้',
            'CANNOT_DEACTIVATE_SELF',
          );
        }
        const patch: Partial<UserAccount> = {};
        if (dto.displayName !== undefined) patch.displayName = dto.displayName;
        if (dto.email !== undefined) patch.email = dto.email;
        if (dto.appRole !== undefined) patch.appRole = dto.appRole;
        if (dto.orgUnitId !== undefined) patch.orgUnitId = dto.orgUnitId;
        if (dto.levelCode !== undefined) patch.levelCode = dto.levelCode;
        if (dto.isActive !== undefined) patch.isActive = dto.isActive;
        if (Object.keys(patch).length > 0) await this.repo.update({ userId: id }, patch);
        await this.userCtx.invalidate(id);
        return this.get(id);
      },
      (r) => ({ after: r }),
    );
  }

  deactivate(id: number, actor: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DEACTIVATE_USER',
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        if (id === actor.userId)
          throw new BusinessException(
            'ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้',
            'CANNOT_DEACTIVATE_SELF',
          );
        await this.get(id);
        await this.sp.call(Sp.ems.deactivateUserAccount).exec({ UserID: id });
        await this.userCtx.invalidate(id);
      },
    );
  }

  private applySearch(
    qb: ReturnType<Repository<UserAccount>['createQueryBuilder']>,
    term?: string,
  ): void {
    const t = term?.trim();
    if (!t) return;
    qb.andWhere(
      new Brackets((w) => {
        const like = likeContains(t);
        w.where(`u.DisplayName LIKE :like ${LIKE_ESCAPE}`, { like })
          .orWhere(`u.ADUserName LIKE :like ${LIKE_ESCAPE}`)
          .orWhere(`u.EmployeeCode LIKE :like ${LIKE_ESCAPE}`)
          .orWhere(`u.EmployeeFirstNameTh LIKE :like ${LIKE_ESCAPE}`)
          .orWhere(`u.EmployeeLastNameTh LIKE :like ${LIKE_ESCAPE}`);
      }),
    );
  }
}

function toLookup(u: UserAccount): UserLookupDto {
  return {
    userId: u.userId,
    displayName: u.displayName,
    adUserName: u.adUserName,
    employeeCode: u.employeeCode,
    departmentName: u.departmentName,
    positionName: u.positionName,
  };
}

function toSummary(u: UserAccount): UserSummaryDto {
  return {
    ...toLookup(u),
    email: u.email,
    appRole: u.appRole,
    orgUnitId: u.orgUnitId,
    isActive: Boolean(u.isActive),
    consentGiven: Boolean(u.consentGiven),
    levelCode: u.levelCode,
    divisionName: u.divisionName,
    lastLoginDate: u.lastLoginDate,
  };
}
