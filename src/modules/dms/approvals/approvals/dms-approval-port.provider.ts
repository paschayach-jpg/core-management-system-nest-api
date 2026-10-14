import { Injectable } from '@nestjs/common';
import type { UserContext } from '../../../../common/interfaces/user-context';
import type {
  ApprovalRef,
  DmsApprovalPort,
  SubmitApprovalInput,
} from '../../ports/dms-approval.port';
import { ApprovalsService } from './approvals.service';

/**
 * ตัว implement DMS_APPROVAL_PORT ให้ DmsCoreModule — ทำหน้าที่แปลงสัญญา (port) เป็นการเรียก ApprovalsService
 * (CRUD-log และ transaction อยู่ที่ ApprovalsService; ไฟล์นี้ไม่มี logic ของตัวเอง)
 */
@Injectable()
export class DmsApprovalPortProvider implements DmsApprovalPort {
  constructor(private readonly approvals: ApprovalsService) {}

  submit(user: UserContext, input: SubmitApprovalInput): Promise<ApprovalRef> {
    return this.approvals.submit(user, input);
  }

  findApprovedDownload(user: UserContext, fileId: number): Promise<ApprovalRef | null> {
    return this.approvals.findApprovedDownload(user, fileId);
  }

  consumeDownload(user: UserContext, requestId: number): Promise<void> {
    return this.approvals.consumeDownload(user, requestId);
  }
}
