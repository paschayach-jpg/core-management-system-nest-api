import { WFE_CONFIG_KEY } from '../../../src/modules/wfe/common/wfe.constants';
import {
  noticeText,
  WFE_NOTIFY_EVENT,
  WorkflowNotificationsService,
  type WfeNotice,
} from '../../../src/modules/wfe/common/wfe-notifications.service';
import { FakeConfig, FakeDb, FakeDirectory, USERS } from './fakes';
import { makeCrudLog } from '../../helpers/stubs';

function make(config: Record<string, number | boolean> = {}) {
  const db = new FakeDb();
  db.users = USERS.map((u) => ({ ...u }));
  db.config = config;
  const sent: unknown[][] = [];
  const notifications = {
    sendMany: jest.fn(async (inputs: unknown[]) => void sent.push(inputs)),
  };
  const { service: crud } = makeCrudLog();
  const svc = new WorkflowNotificationsService(
    crud,
    new FakeConfig(db) as never,
    new FakeDirectory(db) as never,
    notifications as never,
  );
  return { svc, notifications, sent };
}

const notice = (over: Partial<WfeNotice> = {}): WfeNotice => ({
  kind: 'TASK_ASSIGNED',
  recipient: 'DOM\\bob',
  instanceId: 7,
  messageText: noticeText.taskAssigned('อนุมัติ', 'ขอซื้อ', 7),
  ...over,
});

describe('WorkflowNotificationsService.dispatch', () => {
  it('ส่งผ่าน NotificationsService ด้วย UserID, EventType และ RelatedEntityId = รหัส instance', async () => {
    const { svc, sent } = make();
    await svc.dispatch([notice()], 'DOM\\alice');
    expect(sent[0]).toEqual([
      {
        recipientUserId: 12,
        eventType: WFE_NOTIFY_EVENT.TASK_ASSIGNED,
        relatedEntityId: 7,
        messageText: expect.stringContaining('อนุมัติ'),
      },
    ]);
  });

  it('ปิดด้วย WorkflowNotificationEnabled=false หรือ WorkflowNotificationInAppEnabled=false → ไม่ส่ง', async () => {
    for (const key of [
      WFE_CONFIG_KEY.notificationEnabled,
      WFE_CONFIG_KEY.notificationInAppEnabled,
    ]) {
      const { svc, notifications } = make({ [key]: false });
      await svc.dispatch([notice()]);
      expect(notifications.sendMany).not.toHaveBeenCalled();
    }
  });

  it('ไม่ส่งถึงผู้ที่ทำรายการเอง, ผู้ใช้ที่ถูกปิด/ไม่มีในระบบ; ตัดรายการซ้ำ', async () => {
    const { svc, sent } = make();
    await svc.dispatch(
      [
        notice({ recipient: 'DOM\\alice' }), // ตัวเอง
        notice({ recipient: 'DOM\\gone' }), // ถูกปิดใช้งาน
        notice({ recipient: 'DOM\\nobody' }), // ไม่มี
        notice({ recipient: 'DOM\\bob' }),
        notice({ recipient: 'dom\\BOB' }), // ซ้ำ (ไม่สนตัวพิมพ์)
      ],
      'dom\\Alice',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({ recipientUserId: 12 });
  });

  it('ข้อผิดพลาดของการส่งไม่ทำให้งานหลักล้ม', async () => {
    const { svc, notifications } = make();
    notifications.sendMany.mockRejectedValueOnce(new Error('db'));
    await expect(svc.dispatch([notice()])).resolves.toBeUndefined();
  });

  it('รายการว่างไม่แตะอะไร', async () => {
    const { svc, notifications } = make();
    await svc.dispatch([]);
    expect(notifications.sendMany).not.toHaveBeenCalled();
  });

  it('ข้อความแจ้งเตือนเป็นภาษาไทยและมีชื่อ workflow/รหัส', () => {
    expect(noticeText.slaEscalated('ตรวจ', 'ขอซื้อ', 9)).toBe(
      "งาน 'ตรวจ' ของ workflow 'ขอซื้อ' (#9) เลยกำหนด SLA แล้ว",
    );
    expect(noticeText.taskRejected('ตรวจ', 'ขอซื้อ', 9, 'ไม่ครบ')).toContain('ไม่ครบ');
  });
});
