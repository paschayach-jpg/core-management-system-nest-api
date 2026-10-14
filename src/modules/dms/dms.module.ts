import { Module } from '@nestjs/common';
import { DmsApprovalsModule } from './approvals/dms-approvals.module';
import { DmsCoreModule } from './core/dms-core.module';
import { PermissionsModule } from './permissions/permissions.module';

/** DMS = Document Management System — รวม sub-module เพื่อให้ module อื่น import ที่เดียว */
@Module({
  imports: [PermissionsModule, DmsCoreModule, DmsApprovalsModule],
  exports: [PermissionsModule, DmsCoreModule, DmsApprovalsModule],
})
export class DmsModule {}
