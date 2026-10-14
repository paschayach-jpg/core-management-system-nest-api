import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { paginated, Paginated, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { Notification } from '../entities/notification.entity';

export interface SendNotificationInput {
  recipientUserId: number;
  /** เช่น ApprovalRequestPending, ExternalShareCreated */
  eventType: string;
  relatedEntityId?: string | number | null;
  messageText: string;
}

/**
 * แจ้งเตือนในระบบ (EMS.Notification) — module อื่นเรียก `send()` / `sendMany()` ได้
 * การส่งไม่ทำให้งานหลักล้ม: ถ้าเขียนไม่สำเร็จจะ log แล้วไปต่อ (พฤติกรรมเดิมของ NotificationService)
 */
@Injectable()
export class NotificationsService extends CrudLoggedService {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'Notification';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    private readonly sp: SpExecutor,
  ) {
    super(crudLog);
  }

  async send(input: SendNotificationInput): Promise<void> {
    try {
      await this.logged(
        {
          action: 'CREATE',
          operation: 'SEND_NOTIFICATION',
          meta: { recipient: input.recipientUserId, eventType: input.eventType },
        },
        () =>
          this.sp.call(Sp.ems.insertNotification).exec({
            RecipientUserId: input.recipientUserId,
            EventType: input.eventType,
            RelatedEntityId:
              input.relatedEntityId === undefined || input.relatedEntityId === null
                ? null
                : String(input.relatedEntityId),
            MessageText: input.messageText,
          }),
      );
    } catch {
      // logged() บันทึกความล้มเหลวไว้แล้ว — การแจ้งเตือนเป็นผลข้างเคียง ไม่ให้ทำให้ธุรกรรมหลักล้ม
    }
  }

  async sendMany(inputs: SendNotificationInput[]): Promise<void> {
    await Promise.all(inputs.map((i) => this.send(i)));
  }

  /** กล่องข้อความของฉัน (ใหม่สุดก่อน) */
  async listMine(
    userId: number,
    query: PaginationQueryDto,
    unreadOnly: boolean,
  ): Promise<Paginated<Notification>> {
    const [items, total] = await this.repo.findAndCount({
      where: { recipientUserId: userId, ...(unreadOnly ? { isRead: false } : {}) },
      order: { notificationId: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return paginated(items, total, query);
  }

  unreadCount(userId: number): Promise<number> {
    return this.repo.count({ where: { recipientUserId: userId, isRead: false, readAt: IsNull() } });
  }

  /** ทำเครื่องหมายอ่านแล้ว — ตรวจว่าเป็นของผู้ใช้เอง (SP เดิมไม่ตรวจเจ้าของ) */
  markRead(userId: number, notificationId: number): Promise<void> {
    return this.logged(
      { action: 'UPDATE', operation: 'MARK_READ', recordId: notificationId },
      async () => {
        const n = await this.repo.findOneBy({ notificationId, recipientUserId: userId });
        if (!n) throw new ResourceNotFoundException('Notification', notificationId);
        await this.sp.call(Sp.ems.markNotificationRead).exec({ NotificationId: notificationId });
      },
    );
  }

  markAllRead(userId: number): Promise<number> {
    return this.logged(
      { action: 'UPDATE', operation: 'MARK_ALL_READ', recordId: userId },
      async () => {
        const res = await this.repo.update(
          { recipientUserId: userId, isRead: false },
          { isRead: true, readAt: new Date() },
        );
        return res.affected ?? 0;
      },
    );
  }
}
