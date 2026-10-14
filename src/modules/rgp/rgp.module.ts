import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { diskStorage } from 'multer';
import { AppConfigService } from '../../config';
import { DmsModule } from '../dms/dms.module';
import { Employee } from '../shared/entities/employee.entity';
import { HrDepartment } from '../shared/entities/hr-department.entity';
import { HrDivision } from '../shared/entities/hr-division.entity';
import { SubCommittee } from '../shared/entities/sub-committee.entity';
import { UserAccount } from '../shared/entities/user-account.entity';
import { SharedModule } from '../shared/shared.module';
import { ProjectAttachmentsController } from './attachments/project-attachments.controller';
import { ProjectAttachmentsService } from './attachments/project-attachments.service';
import { ProjectAuditController } from './audit/project-audit.controller';
import { ProjectAuditService } from './audit/project-audit.service';
import { ProjectDocumentsController } from './documents/project-documents.controller';
import { ProjectDocumentsService } from './documents/project-documents.service';
import { MasterDocumentType } from './entities/master-document-type.entity';
import { MasterDocument } from './entities/master-document.entity';
import { ProjectAttachment } from './entities/project-attachment.entity';
import { ProjectAuditLog } from './entities/project-audit-log.entity';
import { ProjectDocWorkflow } from './entities/project-doc-workflow.entity';
import { ProjectMemberRole } from './entities/project-member-role.entity';
import { ProjectMember } from './entities/project-member.entity';
import { ProjectNotifyLog } from './entities/project-notify-log.entity';
import { ProjectProgress } from './entities/project-progress.entity';
import { ProjectStateMember } from './entities/project-state-member.entity';
import { ProjectState } from './entities/project-state.entity';
import { ProjectTaskComment } from './entities/project-task-comment.entity';
import { ProjectTaskStatusLog } from './entities/project-task-status-log.entity';
import { ProjectTask } from './entities/project-task.entity';
import { ProjectTemplate } from './entities/project-template.entity';
import { Project } from './entities/project.entity';
import { RunningNumber } from './entities/running-number.entity';
import { TemplateDoc } from './entities/template-doc.entity';
import { TemplateState } from './entities/template-state.entity';
import { RgpLookupsController } from './lookups/rgp-lookups.controller';
import { RgpLookupsService } from './lookups/rgp-lookups.service';
import { MemberRolesService } from './members/member-roles.service';
import {
  MemberRolesController,
  ProjectMembersController,
} from './members/project-members.controller';
import { ProjectMembersService } from './members/project-members.service';
import { ProjectProgressController } from './progress/project-progress.controller';
import { ProjectProgressService } from './progress/project-progress.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { RunningNumberService } from './running-number/running-number.service';
import { ProjectStatesController } from './states/project-states.controller';
import { ProjectStatesService } from './states/project-states.service';
import { StateMembersService } from './states/state-members.service';
import { StateNotifyService } from './states/state-notify.service';
import { ProjectTasksController } from './tasks/project-tasks.controller';
import { ProjectTasksService } from './tasks/project-tasks.service';
import {
  ProjectTemplatesController,
  TemplateDocsController,
  TemplateStatesController,
} from './templates/project-templates.controller';
import { ProjectTemplatesService } from './templates/project-templates.service';

/**
 * RGP (โครงการ / Project) — Template, โครงการ, ขั้นตอน, ความคืบหน้า, Task, เอกสาร, บุคคลที่เกี่ยวข้อง, ไฟล์แนบ, audit
 *
 * หลาย DataSource: ตาราง `RGP.*` และ `storage.t_project_attachment` อยู่ฐานหลัก (CMS_DB),
 * `RunningNumber` + `m_document(_type)` อยู่ฐานโครงการ BUI_RG (DataSource 'project')
 * ไฟล์แนบเข้า DMS ผ่าน port `DMS_FILE_PORT` เท่านั้น (inject แบบ @Optional — ยังไม่มี provider = ตอบ 503 DMS_UNAVAILABLE)
 */
@Module({
  imports: [
    SharedModule,
    DmsModule,
    TypeOrmModule.forFeature([
      // ฐานหลัก — ตาราง RGP
      Project,
      ProjectTemplate,
      TemplateState,
      TemplateDoc,
      ProjectState,
      ProjectProgress,
      ProjectTask,
      ProjectTaskComment,
      ProjectTaskStatusLog,
      ProjectDocWorkflow,
      ProjectMember,
      ProjectMemberRole,
      ProjectStateMember,
      ProjectNotifyLog,
      ProjectAuditLog,
      ProjectAttachment,
      // ฐานหลัก — ตารางของ Shared ที่ RGP อ่าน
      Employee,
      SubCommittee,
      HrDivision,
      HrDepartment,
      UserAccount,
    ]),
    TypeOrmModule.forFeature([MasterDocument, MasterDocumentType, RunningNumber], 'project'),
    // อัปโหลดไฟล์แนบ: เก็บชั่วคราวบนดิสก์ (ไม่ถือทั้งไฟล์ใน memory) จำกัดขนาดตาม STORAGE_MAX_UPLOAD_MB
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        storage: diskStorage({}),
        limits: { fileSize: cfg.get('STORAGE_MAX_UPLOAD_MB') * 1024 * 1024 },
      }),
    }),
  ],
  controllers: [
    ProjectsController,
    ProjectStatesController,
    ProjectProgressController,
    ProjectTasksController,
    ProjectDocumentsController,
    ProjectMembersController,
    MemberRolesController,
    ProjectAttachmentsController,
    ProjectTemplatesController,
    TemplateStatesController,
    TemplateDocsController,
    RgpLookupsController,
    ProjectAuditController,
  ],
  providers: [
    ProjectAuditService,
    RunningNumberService,
    ProjectsService,
    ProjectStatesService,
    StateMembersService,
    StateNotifyService,
    ProjectProgressService,
    ProjectTasksService,
    ProjectDocumentsService,
    ProjectMembersService,
    MemberRolesService,
    ProjectAttachmentsService,
    ProjectTemplatesService,
    RgpLookupsService,
  ],
})
export class RgpModule {}
