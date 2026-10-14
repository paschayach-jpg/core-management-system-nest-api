import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { insertProjectMember } from '../common/member-resolver';
import { requireActiveProject } from '../common/project-ops';
import { ACTOR_LONG, rgpActor } from '../common/rgp-actor';
import { memberToDto } from '../common/rgp-mappers';
import { Project } from '../entities/project.entity';
import { ProjectMember } from '../entities/project-member.entity';
import type { AddMemberDto, ProjectMemberDto } from './dto/member.dto';

/**
 * บุคคลที่เกี่ยวข้องของโครงการ (`RGP.t_project_member`) — พอร์ตจาก ProjectMemberRepository (GetByProject / Insert / Delete)
 * ชนิด: คณะกรรมการ / ฝ่าย / แผนก (จาก EMS.m_SubCommittee / m_Division / m_Department) หรือพนักงาน (ชื่อผู้ใช้ AD จาก EMS.m_Employee)
 */
@Injectable()
export class ProjectMembersService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectMember';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(ProjectMember) private readonly repo: Repository<ProjectMember>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  async listByProject(projectId: number): Promise<ProjectMemberDto[]> {
    if (!(await this.projects.existsBy({ projectId, active: 'Y' }))) {
      throw new ResourceNotFoundException('โครงการ', projectId);
    }
    return this.loadByProject(projectId);
  }

  /** ไม่ตรวจว่ามีโครงการ (ผู้เรียกตรวจแล้ว) */
  async loadByProject(projectId: number): Promise<ProjectMemberDto[]> {
    const rows = await this.repo.find({ where: { projectId }, order: { memberId: 'ASC' } });
    return rows.map(memberToDto);
  }

  add(projectId: number, dto: AddMemberDto, user: UserContext): Promise<ProjectMemberDto> {
    return this.logged(
      { action: 'CREATE', operation: 'ADD_PROJECT_MEMBER', meta: { projectId } },
      () =>
        this.tx.run(async ({ manager }) => {
          await requireActiveProject(manager, projectId);
          const member = await insertProjectMember(
            manager,
            projectId,
            dto,
            dto.role,
            rgpActor(user, ACTOR_LONG),
          );
          return memberToDto(member);
        }),
      (m) => ({ recordId: m.memberId, after: m }),
    );
  }

  remove(memberId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'REMOVE_PROJECT_MEMBER',
        recordId: memberId,
        captureBefore: () => this.repo.findOneBy({ memberId }),
      },
      async () => {
        const member = await this.repo.findOneBy({ memberId });
        if (!member) throw new ResourceNotFoundException('บุคคลที่เกี่ยวข้อง', memberId);
        await this.repo.delete({ memberId });
      },
    );
  }
}
