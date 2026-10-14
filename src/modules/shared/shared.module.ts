import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit/audit.controller';
import { AuditLogsService } from './audit/audit.service';
import { Employee } from './entities/employee.entity';
import { HrDepartment } from './entities/hr-department.entity';
import { HrDivision } from './entities/hr-division.entity';
import { HrPositionLevel } from './entities/hr-position-level.entity';
import { HrPositionMapping } from './entities/hr-position-mapping.entity';
import { HrPosition } from './entities/hr-position.entity';
import { MenuItem } from './entities/menu-item.entity';
import { Notification } from './entities/notification.entity';
import { OrgUnitRelationship } from './entities/org-unit-relationship.entity';
import { OrgUnit } from './entities/org-unit.entity';
import { SubCommittee } from './entities/sub-committee.entity';
import { SystemConfig } from './entities/system-config.entity';
import { UserAccount } from './entities/user-account.entity';
import {
  HrDepartmentsController,
  HrDivisionsController,
  HrPositionLevelsController,
  HrPositionMappingsController,
  HrPositionsController,
} from './hr-masters/hr-masters.controllers';
import {
  HrDepartmentsService,
  HrDivisionsService,
  HrPositionLevelsService,
  HrPositionMappingsService,
  HrPositionsService,
} from './hr-masters/hr-masters.services';
import { MenusController } from './menus/menus.controller';
import { MenusService } from './menus/menus.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { OrgUnitsController } from './org-units/org-units.controller';
import { OrgUnitsService } from './org-units/org-units.service';
import { SystemConfigController } from './system-config/system-config.controller';
import { SystemConfigService } from './system-config/system-config.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * Shared — สิ่งที่ DMS/KMS/RGP/WFE ใช้ร่วมกัน: ผู้ใช้, โครงสร้างหน่วยงาน, ข้อมูลหลัก HR, เมนู, ค่าตั้งระบบ, แจ้งเตือน, อ่าน audit
 * module อื่น import SharedModule เพื่อใช้ NotificationsService / SystemConfigService / OrgUnitsService / UsersService
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      UserAccount,
      OrgUnitRelationship,
      OrgUnit,
      HrDivision,
      HrDepartment,
      HrPosition,
      HrPositionLevel,
      HrPositionMapping,
      SubCommittee,
      Employee,
      Notification,
      MenuItem,
      SystemConfig,
    ]),
  ],
  controllers: [
    UsersController,
    OrgUnitsController,
    HrDivisionsController,
    HrDepartmentsController,
    HrPositionsController,
    HrPositionLevelsController,
    HrPositionMappingsController,
    MenusController,
    SystemConfigController,
    NotificationsController,
    AuditController,
  ],
  providers: [
    UsersService,
    OrgUnitsService,
    HrDivisionsService,
    HrDepartmentsService,
    HrPositionsService,
    HrPositionLevelsService,
    HrPositionMappingsService,
    MenusService,
    SystemConfigService,
    NotificationsService,
    AuditLogsService,
  ],
  exports: [
    UsersService,
    OrgUnitsService,
    MenusService,
    SystemConfigService,
    NotificationsService,
    AuditLogsService,
    TypeOrmModule,
  ],
})
export class SharedModule {}
