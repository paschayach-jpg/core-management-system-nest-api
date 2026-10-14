import { Injectable, Logger } from '@nestjs/common';
import type { ApprovalRequestType } from '../../../../common/constants/enums';
import type {
  ApprovalHandlerRegistry,
  ApprovalOutcomeHandler,
} from '../../ports/dms-approval.port';

/**
 * ทะเบียน handler ผลข้างเคียงหลังอนุมัติ (DMS_APPROVAL_HANDLERS)
 * DmsCoreModule ลงทะเบียน CREATE_HC / DELETE_FOLDER / CHANGE_PERMISSION เข้ามาตอน init —
 * ApprovalsService เรียกกลับตามชนิดคำขอ (กลับด้านการพึ่งพาเพื่อไม่ให้ module วนกัน)
 */
@Injectable()
export class InMemoryApprovalHandlerRegistry implements ApprovalHandlerRegistry {
  private readonly logger = new Logger(InMemoryApprovalHandlerRegistry.name);
  private readonly handlers = new Map<ApprovalRequestType, ApprovalOutcomeHandler>();

  register(handler: ApprovalOutcomeHandler): void {
    const existing = this.handlers.get(handler.requestType);
    if (existing && existing !== handler) {
      this.logger.warn(`handler ของ ${handler.requestType} ถูกลงทะเบียนซ้ำ — ใช้ตัวใหม่แทนตัวเดิม`);
    }
    this.handlers.set(handler.requestType, handler);
  }

  get(type: ApprovalRequestType): ApprovalOutcomeHandler | undefined {
    return this.handlers.get(type);
  }

  /** ชนิดที่ลงทะเบียนแล้ว (ใช้ตรวจ/แสดงสถานะ) */
  registeredTypes(): ApprovalRequestType[] {
    return [...this.handlers.keys()];
  }
}
