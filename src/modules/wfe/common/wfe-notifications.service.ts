import { Injectable, Logger } from '@nestjs/common';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { SystemConfigService } from '../../shared/system-config/system-config.service';
import { sameUser } from './wfe-access';
import { loadWfeSettings } from './wfe-settings';
import { WfeUserDirectory } from './wfe-user-directory';

export type WfeNotifyKind =
  | 'TASK_ASSIGNED'
  | 'WORKFLOW_COMPLETED'
  | 'TASK_REJECTED'
  | 'TASK_DELEGATED'
  | 'DELEGATION_ENDED'
  | 'SLA_WARNING'
  | 'SLA_ESCALATED';

/** EventType ที่เก็บใน EMS.Notification */
export const WFE_NOTIFY_EVENT: Record<WfeNotifyKind, string> = {
  TASK_ASSIGNED: 'WorkflowTaskAssigned',
  WORKFLOW_COMPLETED: 'WorkflowCompleted',
  TASK_REJECTED: 'WorkflowTaskRejected',
  TASK_DELEGATED: 'WorkflowTaskDelegated',
  DELEGATION_ENDED: 'WorkflowDelegationEnded',
  SLA_WARNING: 'WorkflowSLAWarning',
  SLA_ESCALATED: 'WorkflowSLAEscalated',
};

export interface WfeNotice {
  kind: WfeNotifyKind;
  /** ชื่อผู้ใช้ AD ของผู้รับ */
  recipient: string;
  instanceId: number;
  messageText: string;
}

/** ข้อความแจ้งเตือน (ภาษาไทย) — แยกเป็นฟังก์ชันล้วนเพื่อเทสต์/แก้ถ้อยคำง่าย */
export const noticeText = {
  taskAssigned: (stepName: string, workflowName: string, instanceId: number) =>
    `มีงานใหม่ถึงคุณ: ขั้นตอน '${stepName}' ของ workflow '${workflowName}' (#${instanceId})`,
  workflowCompleted: (workflowName: string, instanceId: number) =>
    `workflow '${workflowName}' (#${instanceId}) ดำเนินการเสร็จสิ้นแล้ว`,
  taskRejected: (stepName: string, workflowName: string, instanceId: number, reason: string) =>
    `ขั้นตอน '${stepName}' ของ workflow '${workflowName}' (#${instanceId}) ถูกปฏิเสธ: ${reason}`,
  taskDelegated: (from: string, stepName: string, workflowName: string, instanceId: number) =>
    `${from} มอบหมายงานให้คุณ: ขั้นตอน '${stepName}' ของ workflow '${workflowName}' (#${instanceId})`,
  delegationEnded: (stepName: string, workflowName: string, instanceId: number) =>
    `การมอบหมายงาน '${stepName}' ของ workflow '${workflowName}' (#${instanceId}) สิ้นสุดแล้ว งานกลับมาอยู่กับคุณ`,
  slaWarning: (stepName: string, workflowName: string, instanceId: number) =>
    `งาน '${stepName}' ของ workflow '${workflowName}' (#${instanceId}) ใกล้ครบกำหนด SLA`,
  slaEscalated: (stepName: string, workflowName: string, instanceId: number) =>
    `งาน '${stepName}' ของ workflow '${workflowName}' (#${instanceId}) เลยกำหนด SLA แล้ว`,
};

/**
 * ส่งแจ้งเตือน workflow ผ่าน NotificationsService ตามค่าตั้ง `WorkflowNotificationEnabled` / `WorkflowNotificationInAppEnabled`
 *
 * - เรียกหลัง transaction commit เท่านั้น (ไม่ส่งแจ้งเตือนของงานที่ rollback)
 * - ไม่ทำให้งานหลักล้ม: ทุกข้อผิดพลาดถูก log แล้วข้าม (ระบบเดิมเป็น stub ที่แค่ log — TODO ทุกเมธอด)
 * - ช่องทางอีเมล (`WorkflowNotificationEmailEnabled`) ยังไม่รองรับ: API นี้ไม่มีบริการอีเมล (ดู docs/modules/wfe.md)
 */
@Injectable()
export class WorkflowNotificationsService extends CrudLoggedService {
  protected readonly logModule = 'WFE' as const;
  protected readonly logEntity = 'WorkflowNotification';
  private readonly logger = new Logger(WorkflowNotificationsService.name);

  constructor(
    crudLog: CrudLogService,
    private readonly cfg: SystemConfigService,
    private readonly directory: WfeUserDirectory,
    private readonly notifications: NotificationsService,
  ) {
    super(crudLog);
  }

  /**
   * @param actor ผู้ที่ทำรายการ — ไม่ส่งแจ้งเตือนถึงตัวเอง
   */
  async dispatch(notices: readonly WfeNotice[], actor?: string): Promise<void> {
    if (notices.length === 0) return;
    try {
      const settings = await loadWfeSettings(this.cfg);
      if (!settings.notificationEnabled || !settings.notificationInAppEnabled) return;

      const targets = notices.filter((n) => !actor || !sameUser(n.recipient, actor));
      if (targets.length === 0) return;

      const users = await this.directory.findMany(targets.map((n) => n.recipient));
      const seen = new Set<string>();
      const inputs = [];
      for (const n of targets) {
        const user = users.get(n.recipient.trim().toLowerCase());
        if (!user?.isActive) continue;
        const dedupe = `${user.userId}|${n.kind}|${n.instanceId}|${n.messageText}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        inputs.push({
          recipientUserId: user.userId,
          eventType: WFE_NOTIFY_EVENT[n.kind],
          relatedEntityId: n.instanceId,
          messageText: n.messageText,
        });
      }
      await this.notifications.sendMany(inputs);
    } catch (err) {
      this.logger.warn(`ส่งแจ้งเตือน workflow ไม่สำเร็จ: ${(err as Error)?.message ?? err}`);
    }
  }
}
