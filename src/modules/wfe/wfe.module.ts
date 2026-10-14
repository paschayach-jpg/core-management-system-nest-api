import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from '../shared/shared.module';
import { WorkflowNotificationsService } from './common/wfe-notifications.service';
import { WfeUserDirectory } from './common/wfe-user-directory';
import { WfConnection } from './entities/wf-connection.entity';
import { WfDefinition } from './entities/wf-definition.entity';
import { WfDelegation } from './entities/wf-delegation.entity';
import { WfInstance } from './entities/wf-instance.entity';
import { WfStepInstance } from './entities/wf-step-instance.entity';
import { WfStep } from './entities/wf-step.entity';
import { WorkflowTemplatesController } from './template/template.controller';
import { WorkflowTemplatesService } from './template/template.service';
import { TemplateStore } from './template/template.store';
import { TemplateStructureService } from './template/template-structure.service';

/**
 * WFE = Workflow Engine — template, instance/step instance, delegation, SLA
 * ใช้ SharedModule: NotificationsService, AuditLogsService, UsersService, SystemConfigService
 */
@Module({
  imports: [
    SharedModule,
    TypeOrmModule.forFeature([
      WfDefinition,
      WfStep,
      WfConnection,
      WfInstance,
      WfStepInstance,
      WfDelegation,
    ]),
  ],
  controllers: [WorkflowTemplatesController],
  providers: [
    TemplateStore,
    WfeUserDirectory,
    WorkflowNotificationsService,
    TemplateStructureService,
    WorkflowTemplatesService,
  ],
  exports: [WorkflowTemplatesService],
})
export class WfeModule {}
