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
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { insertStateMemberFrom } from '../common/member-resolver';
import { requireActiveProject, requireState } from '../common/project-ops';
import { ACTOR_LONG, rgpActor } from '../common/rgp-actor';
import { stateMemberToDto } from '../common/rgp-mappers';
import { ProjectMember } from '../entities/project-member.entity';
import { ProjectNotifyLog } from '../entities/project-notify-log.entity';
import { ProjectState } from '../entities/project-state.entity';
import { ProjectStateMember } from '../entities/project-state-member.entity';
import type { StateMemberDto } from './dto/state.dto';

/**
 * ผู้เกี่ยวข้องของขั้นตอน (`RGP.t_project_state_member`) — พอร์ตจาก ProjectStateMemberRepository
 * เลือกได้เฉพาะบุคคลที่อยู่ในโครงการแล้ว (ตามหน้าจอ Frm_Select_StateMember) และห้ามซ้ำชื่อในขั้นตอนเดียวกัน
 */
@Injectable()
export class StateMembersService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectStateMember';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(ProjectStateMember) private readonly repo: Repository<ProjectStateMember>,
    @InjectRepository(ProjectNotifyLog) private readonly notifyLogs: Repository<ProjectNotifyLog>,
    @InjectRepository(ProjectState) private readonly states: Repository<ProjectState>,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  /** ผู้เกี่ยวข้องของขั้นตอน พร้อมจำนวนครั้งที่ส่งแจ้งเตือนแล้ว */
  async listByState(projStateId: number): Promise<StateMemberDto[]> {
    if (!(await this.states.existsBy({ projStateId }))) {
      throw new ResourceNotFoundException('ขั้นตอน (state)', projStateId);
    }
    const members = await this.repo.find({
      where: { projStateId },
      order: { stateMemberId: 'ASC' },
    });
    const logs = await this.notifyLogs.findBy({ projStateId });
    const counts = new Map<number, number>();
    for (const l of logs) counts.set(l.stateMemberId, (counts.get(l.stateMemberId) ?? 0) + 1);
    return members.map((m) => stateMemberToDto(m, counts.get(m.stateMemberId) ?? 0));
  }

  add(projStateId: number, projectMemberId: number, user: UserContext): Promise<StateMemberDto> {
    return this.logged(
      { action: 'CREATE', operation: 'ADD_STATE_MEMBER', meta: { projStateId, projectMemberId } },
      () =>
        this.tx.run(async ({ manager }) => {
          const state = await requireState(manager, projStateId);
          await requireActiveProject(manager, state.projectId);
          const member = await manager.findOneBy(ProjectMember, {
            memberId: projectMemberId,
            projectId: state.projectId,
          });
          if (!member) {
            throw new ResourceNotFoundException('บุคคลในโครงการนี้', projectMemberId);
          }
          const created = await insertStateMemberFrom(
            manager,
            state,
            member,
            rgpActor(user, ACTOR_LONG),
          );
          return stateMemberToDto(created, 0);
        }),
      (m) => ({ recordId: m.stateMemberId, after: m }),
    );
  }

  /** ลบผู้เกี่ยวข้องออกจากขั้นตอน — ถ้าเคยส่งแจ้งเตือนแล้วลบไม่ได้ (ประวัติอ้างอยู่) */
  remove(stateMemberId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'REMOVE_STATE_MEMBER',
        recordId: stateMemberId,
        captureBefore: () => this.repo.findOneBy({ stateMemberId }),
      },
      async () => {
        const member = await this.repo.findOneBy({ stateMemberId });
        if (!member) throw new ResourceNotFoundException('ผู้เกี่ยวข้องของขั้นตอน', stateMemberId);
        const sent = await this.notifyLogs.countBy({ stateMemberId });
        if (sent > 0) {
          throw new ConflictBusinessException(
            `ลบไม่ได้ เพราะเคยส่งแจ้งเตือนให้บุคคลนี้แล้ว ${sent} ครั้ง (มีประวัติอ้างอิงอยู่)`,
            'STATE_MEMBER_HAS_NOTIFY_LOG',
            { notifyCount: sent },
          );
        }
        await this.repo.delete({ stateMemberId });
      },
    );
  }
}
