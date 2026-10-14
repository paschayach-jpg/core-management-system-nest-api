import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { SharedModule } from '../../shared/shared.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { DMS_APPROVAL_HANDLERS, DMS_APPROVAL_PORT } from '../ports/dms-approval.port';
import { DMS_QUOTA_PORT } from '../ports/dms-quota.port';
import { InMemoryApprovalHandlerRegistry } from './approvals/approval-handler.registry';
import { ApprovalEscalationJob } from './approvals/approval-escalation.job';
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { ApprovalsStore } from './approvals/approvals.store';
import { DmsApprovalPortProvider } from './approvals/dms-approval-port.provider';
import { ShareApprovalOutcomes } from './approvals/share-approval-outcomes';
import { AuthorityController } from './authority/authority.controller';
import { AuthorityImportService } from './authority/authority-import.service';
import { FolderAuthorityService } from './authority/authority.service';
import { AuthorityStore } from './authority/authority.store';
import { LookupStore } from './common/lookup.store';
import { DmsQuotaPortProvider } from './quota/dms-quota-port.provider';
import { QuotaController } from './quota/quota.controller';
import { QuotaService } from './quota/quota.service';
import { QuotaStore } from './quota/quota.store';
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
  imports: [AuthModule, SharedModule, PermissionsModule],
  controllers: [
    ApprovalsController,
    SharesController,
    PublicSharesController,
    QuotaController,
    AuthorityController,
  ],
  providers: [
    LookupStore,
    ApprovalsStore,
    SharesStore,
    InMemoryApprovalHandlerRegistry,
    ShareApprovalOutcomes,
    ApprovalsService,
    SharesService,
    PublicShareAccessService,
    QuotaStore,
    QuotaService,
    AuthorityStore,
    FolderAuthorityService,
    AuthorityImportService,
    DmsApprovalPortProvider,
    DmsQuotaPortProvider,
    ApprovalEscalationJob,
    { provide: DMS_APPROVAL_PORT, useExisting: DmsApprovalPortProvider },
    { provide: DMS_APPROVAL_HANDLERS, useExisting: InMemoryApprovalHandlerRegistry },
    { provide: DMS_QUOTA_PORT, useExisting: DmsQuotaPortProvider },
  ],
  exports: [DMS_APPROVAL_PORT, DMS_APPROVAL_HANDLERS, DMS_QUOTA_PORT],
})
export class DmsApprovalsModule {}
