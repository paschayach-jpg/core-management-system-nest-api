import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { UserAccount } from '../../shared/entities/user-account.entity';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { ACTOR_LONG, clip, rgpActor } from '../common/rgp-actor';
import { MEMBER_TYPE_LABEL } from '../common/member-resolver';
import { Project } from '../entities/project.entity';
import { ProjectNotifyLog } from '../entities/project-notify-log.entity';
import { ProjectState } from '../entities/project-state.entity';
import { ProjectStateMember } from '../entities/project-state-member.entity';
import { ProjectTasksService } from '../tasks/project-tasks.service';
import type { NotifyResultDto } from './dto/state.dto';

export const NOTIFY_EVENT_TYPE = 'ProjectStateAssigned';

/**
 * ส่งแจ้งเตือนผู้เกี่ยวข้องของขั้นตอน (พอร์ตจากปุ่ม "ส่ง Notify" ใน Frm_Project_State_Edit)
 *  1) เฉพาะสมาชิกประเภท "พนักงาน" (ชื่อ = ชื่อผู้ใช้ AD)
 *  2) ใช้ Task ติดตามเดิมของคนนี้/ขั้นตอนนี้ ถ้าไม่มีสร้างใหม่ "ติดตาม - <ชื่อขั้นตอน>" มอบหมายให้คนนั้น
 *  3) ส่งแจ้งเตือนในระบบ (EMS.Notification) ให้บัญชีผู้ใช้นั้น  4) บันทึก `RGP.t_project_notify_log`
 *
 * ต่างจากเดิม: ระบบเดิมส่งผ่านบริการแจ้งเตือนภายนอก (NotificationManager/SignalR) — API นี้ใช้ NotificationsService ของ Shared
 * ซึ่งกลืน error ตามออกแบบ จึงบันทึกผลเป็น Success เมื่อมีบัญชีผู้รับ (ดู docs/modules/rgp.md)
 */
@Injectable()
export class StateNotifyService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectNotifyLog';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(ProjectStateMember) private readonly members: Repository<ProjectStateMember>,
    @InjectRepository(ProjectNotifyLog) private readonly notifyLogs: Repository<ProjectNotifyLog>,
    @InjectRepository(ProjectState) private readonly states: Repository<ProjectState>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(UserAccount) private readonly users: Repository<UserAccount>,
    private readonly tasks: ProjectTasksService,
    private readonly notifications: NotificationsService,
  ) {
    super(crudLog);
  }

  notify(stateMemberId: number, user: UserContext): Promise<NotifyResultDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'NOTIFY_STATE_MEMBER', recordId: stateMemberId },
      async () => {
        const member = await this.members.findOneBy({ stateMemberId });
        if (!member) throw new ResourceNotFoundException('ผู้เกี่ยวข้องของขั้นตอน', stateMemberId);
        if (member.memberType !== MEMBER_TYPE_LABEL.Employee) {
          throw new BusinessException(
            'ส่ง Notify ได้เฉพาะประเภท "พนักงาน" เท่านั้น (ต้องมี AD username)',
            'NOTIFY_EMPLOYEE_ONLY',
          );
        }
        const state = await this.states.findOneBy({ projStateId: member.projStateId });
        if (!state) throw new ResourceNotFoundException('ขั้นตอน (state)', member.projStateId);
        const project = await this.projects.findOneBy({ projectId: state.projectId, active: 'Y' });
        if (!project) throw new ResourceNotFoundException('โครงการ', state.projectId);

        // 1) Task ติดตาม — ใช้ของเดิมถ้าเคยสร้างจากการแจ้งเตือนคนนี้/ขั้นตอนนี้
        const previous = await this.notifyLogs.find({
          where: {
            projStateId: state.projStateId,
            stateMemberId,
            taskId: Not(IsNull()),
          },
          order: { sendDate: 'ASC' },
          take: 1,
        });
        let taskId: number | null = previous[0]?.taskId ?? null;
        let taskCreated = false;
        if (taskId === null) {
          const created = await this.tasks.create(
            state.projStateId,
            {
              title: `ติดตาม - ${state.stateName}`,
              description: state.description ?? null,
              assignee: member.memberName,
            },
            user,
          );
          taskId = created.taskId;
          taskCreated = true;
        }

        // 2) แจ้งเตือนในระบบ
        const recipient = await this.users.findOneBy({
          adUserName: member.memberName,
          isActive: true,
        });
        let sent = false;
        let message: string | null = null;
        if (!recipient) {
          message = `ไม่พบบัญชีผู้ใช้ที่ใช้งานอยู่สำหรับ '${member.memberName}' (ผู้ใช้ต้องเคยเข้าสู่ระบบ)`;
        } else {
          await this.notifications.send({
            recipientUserId: recipient.userId,
            eventType: NOTIFY_EVENT_TYPE,
            relatedEntityId: state.projStateId,
            messageText: `คุณได้รับงานสำหรับขั้นตอน '${state.stateName}' ในโครงการ '${project.projectName}' กรุณาดำเนินการ`,
          });
          sent = true;
        }

        // 3) ประวัติการส่ง
        await this.notifyLogs.insert({
          projectId: state.projectId,
          projStateId: state.projStateId,
          stateMemberId,
          recipientName: member.memberName,
          taskId,
          taskCreated: taskCreated ? 'Y' : 'N',
          apiResult: sent ? 'Success' : 'Failed',
          message: clip(message, 500),
          sendUser: rgpActor(user, ACTOR_LONG),
        });

        return { sent, taskId, taskCreated, message };
      },
      (r) => ({ after: r }),
    );
  }
}
