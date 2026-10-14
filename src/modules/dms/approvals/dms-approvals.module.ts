import { Global, Module } from '@nestjs/common';
import { SharedModule } from '../../shared/shared.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { DMS_APPROVAL_HANDLERS, DMS_APPROVAL_PORT } from '../ports/dms-approval.port';
import { InMemoryApprovalHandlerRegistry } from './approvals/approval-handler.registry';
import { ApprovalEscalationJob } from './approvals/approval-escalation.job';
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { ApprovalsStore } from './approvals/approvals.store';
import { DmsApprovalPortProvider } from './approvals/dms-approval-port.provider';
import { ShareApprovalOutcomes } from './approvals/share-approval-outcomes';
import { LookupStore } from './common/lookup.store';
import { PublicShareAccessService } from './shares/public-share-access.service';
import { PublicSharesController } from './shares/public-shares.controller';
import { SharesController } from './shares/shares.controller';
import { SharesService } from './shares/shares.service';
import { SharesStore } from './shares/shares.store';

/**
 * DMS งานอนุมัติ/แชร์/โควตา/ระดับสิทธิ์: approval workflow, internal/external share (+ลิงก์สาธารณะ), quota, folder authority config
 *
 * @Global() เพื่อให้ DmsCoreModule ฉีด token ด้านล่างได้โดยไม่ต้อง import module นี้ (กัน module วนกัน):
 *  - DMS_APPROVAL_PORT      Core ยื่นคำขออนุมัติ / ขอดาวน์โหลด / ใช้สิทธิ์ดาวน์โหลด
 *  - DMS_APPROVAL_HANDLERS  Core ลงทะเบียน handler ผลหลังอนุมัติ (CREATE_HC, DELETE_FOLDER, CHANGE_PERMISSION)
 *  - DMS_QUOTA_PORT         Core ตรวจโควตาก่อนสร้างโฟลเดอร์/อัปโหลด
 */
@Global()
@Module({
  imports: [SharedModule, PermissionsModule],
  controllers: [ApprovalsController, SharesController, PublicSharesController],
  providers: [
    LookupStore,
    ApprovalsStore,
    SharesStore,
    InMemoryApprovalHandlerRegistry,
    ShareApprovalOutcomes,
    ApprovalsService,
    SharesService,
    PublicShareAccessService,
    DmsApprovalPortProvider,
    ApprovalEscalationJob,
    { provide: DMS_APPROVAL_PORT, useExisting: DmsApprovalPortProvider },
    { provide: DMS_APPROVAL_HANDLERS, useExisting: InMemoryApprovalHandlerRegistry },
  ],
  exports: [DMS_APPROVAL_PORT, DMS_APPROVAL_HANDLERS],
})
export class DmsApprovalsModule {}
