import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { NOW_SQL } from '../common/project-ops';
import { ACTOR_LONG, rgpActor } from '../common/rgp-actor';
import { fromYesNo, toYesNo } from '../common/rgp-rules';
import { ProjectMemberRole } from '../entities/project-member-role.entity';
import type { CreateRoleDto, MemberRoleDto, UpdateRoleDto } from './dto/member.dto';

/**
 * บทบาทของบุคคลที่เกี่ยวข้อง (`RGP.m_project_member_role`) — ข้อมูลหลัก
 * `t_project_member.c_role` เก็บ "ชื่อบทบาท" เป็นข้อความ (ไม่ได้อ้าง id) การลบ/เปลี่ยนชื่อบทบาทจึงไม่กระทบสมาชิกที่บันทึกไว้แล้ว
 */
@Injectable()
export class MemberRolesService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectMemberRole';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(ProjectMemberRole) private readonly repo: Repository<ProjectMemberRole>,
  ) {
    super(crudLog);
  }

  async list(activeOnly = false): Promise<MemberRoleDto[]> {
    const rows = await this.repo.find({
      where: activeOnly ? { active: 'Y' } : {},
      order: { roleId: 'ASC' },
    });
    return rows.map(toDto);
  }

  async get(roleId: number): Promise<MemberRoleDto> {
    const row = await this.repo.findOneBy({ roleId });
    if (!row) throw new ResourceNotFoundException('บทบาท', roleId);
    return toDto(row);
  }

  create(dto: CreateRoleDto, user: UserContext): Promise<MemberRoleDto> {
    return this.logged(
      { action: 'CREATE', operation: 'CREATE_MEMBER_ROLE' },
      async () => {
        const name = dto.name.trim();
        await this.assertNameFree(name);
        const saved = await this.repo.save({
          roleName: name,
          active: 'Y',
          createUser: rgpActor(user, ACTOR_LONG),
        });
        return this.get(saved.roleId);
      },
      (r) => ({ recordId: r.roleId, after: r }),
    );
  }

  update(roleId: number, dto: UpdateRoleDto, user: UserContext): Promise<MemberRoleDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_MEMBER_ROLE',
        recordId: roleId,
        captureBefore: () => this.get(roleId),
      },
      async () => {
        await this.get(roleId);
        if (dto.name !== undefined) await this.assertNameFree(dto.name.trim(), roleId);
        await this.repo.update(
          { roleId },
          {
            ...(dto.name !== undefined ? { roleName: dto.name.trim() } : {}),
            ...(dto.active !== undefined ? { active: toYesNo(dto.active) } : {}),
            updateUser: rgpActor(user, ACTOR_LONG),
            updateDate: NOW_SQL,
          },
        );
        return this.get(roleId);
      },
      (r) => ({ after: r }),
    );
  }

  remove(roleId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_MEMBER_ROLE',
        recordId: roleId,
        captureBefore: () => this.get(roleId),
      },
      async () => {
        await this.get(roleId);
        await this.repo.delete({ roleId });
      },
    );
  }

  /** ชื่อบทบาทห้ามซ้ำ (ระบบเดิมไม่ตรวจ — เพิ่มเพื่อกัน dropdown ซ้ำ) */
  private async assertNameFree(name: string, excludeRoleId?: number): Promise<void> {
    const same = await this.repo.findBy({ roleName: name });
    if (same.some((r) => r.roleId !== excludeRoleId)) {
      throw new ConflictBusinessException(`มีบทบาท '${name}' อยู่แล้ว`, 'ROLE_NAME_DUPLICATE');
    }
  }
}

function toDto(r: ProjectMemberRole): MemberRoleDto {
  return {
    roleId: r.roleId,
    name: r.roleName,
    active: fromYesNo(r.active),
    createUser: r.createUser ?? null,
    createDate: r.createDate ?? null,
    updateUser: r.updateUser ?? null,
    updateDate: r.updateDate ?? null,
  };
}
