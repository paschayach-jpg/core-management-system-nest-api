import { Global, Inject, Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigService } from '../../../config';
import { SharedModule } from '../../shared/shared.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { type ApprovalHandlerRegistry, DMS_APPROVAL_HANDLERS } from '../ports/dms-approval.port';
import { DMS_FILE_PORT, DMS_FILE_UNCHECKED_PORT } from '../ports/dms-file.port';
import { FolderAccess } from './access/folder-access';
import { AclRepository } from './acl/acl.repository';
import { FilePermissionsService } from './acl/file-permissions.service';
import { FolderPermissionsService } from './acl/folder-permissions.service';
import { PermissionsController } from './acl/permissions.controller';
import { buildDmsCoreApprovalHandlers } from './approval-handlers/approval-handlers';
import { DmsFilePortAdapter, DmsFileUncheckedAdapter } from './files/dms-file-port.adapter';
import { FileRepository } from './files/file.repository';
import { FilesController, MAX_FILES_PER_UPLOAD } from './files/files.controller';
import { FilesService } from './files/files.service';
import { FolderRepository } from './folders/folder.repository';
import { FoldersController } from './folders/folders.controller';
import { FoldersService } from './folders/folders.service';
import { QuickAccessController } from './quick-access/quick-access.controller';
import { QuickAccessService } from './quick-access/quick-access.service';
import { RecycleBinPurgeJob } from './recycle-bin/recycle-bin-purge.job';
import { RecycleBinController } from './recycle-bin/recycle-bin.controller';
import { RecycleBinService } from './recycle-bin/recycle-bin.service';
import { MAX_FILE_SIZE_BYTES } from './rules/file.rules';
import { FileStorageService } from './storage/file-storage.service';
import { FolderTemplateRepository } from './templates/folder-template.repository';
import { FolderTemplatesController } from './templates/folder-templates.controller';
import { FolderTemplatesService } from './templates/folder-templates.service';
import { UserOrgVisibilityController } from './visibility/user-org-visibility.controller';
import { UserOrgVisibilityService } from './visibility/user-org-visibility.service';

/**
 * DMS แกนหลัก: โฟลเดอร์ / ไฟล์ / การเก็บไฟล์ / สิทธิ์ (ACL) / เทมเพลตโฟลเดอร์ / ทางลัด / การมองเห็นหน่วยงาน / ถังขยะ
 *
 * - export `DMS_FILE_PORT` และ `DMS_FILE_UNCHECKED_PORT` ให้ KMS / RGP / approvals ฝากและอ่านไฟล์
 * - ฉีด `DMS_QUOTA_PORT` / `DMS_APPROVAL_PORT` แบบ @Optional (module อนุมัติเป็นผู้ provide; ไม่มี = ข้ามการตรวจโควตา / แจ้ง 503 เมื่อต้องใช้การอนุมัติ)
 * - ลงทะเบียน handler ของ CREATE_HC / DELETE_FOLDER / CHANGE_PERMISSION กับ `DMS_APPROVAL_HANDLERS` ตอนเริ่มระบบ
 * - อัปโหลดแบบ multipart ผ่าน multer diskStorage (ไฟล์ชั่วคราวใน tmp ไม่เก็บทั้งไฟล์ใน memory) ขนาดตาม STORAGE_MAX_UPLOAD_MB (สูงสุด 100 MB)
 */
// @Global เพราะ DmsApprovalsModule (ลิงก์แชร์สาธารณะ) ต้องฉีด DMS_FILE_UNCHECKED_PORT โดยไม่ import module นี้ (กัน module วนกัน)
// ปลอดภัย: module นี้ export เฉพาะ token ของ port สองตัว ไม่ได้เปิด service ภายในออกสู่ทั้งแอป
@Global()
@Module({
  imports: [
    PermissionsModule,
    SharedModule,
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) =>
        ({
          storage: diskStorage({
            destination: join(tmpdir(), 'cms-dms-uploads'),
            filename: (_req, _file, cb) => cb(null, randomUUID()),
          }),
          limits: {
            fileSize: Math.min(MAX_FILE_SIZE_BYTES, cfg.get('STORAGE_MAX_UPLOAD_MB') * 1024 * 1024),
            files: MAX_FILES_PER_UPLOAD,
          },
          // ชื่อไฟล์ใน Content-Disposition เป็น UTF-8 (ค่าเริ่มต้น latin1 ทำให้ชื่อไฟล์ภาษาไทยเพี้ยน)
          defParamCharset: 'utf8',
        }) as never,
    }),
  ],
  controllers: [
    FoldersController,
    FilesController,
    PermissionsController,
    RecycleBinController,
    FolderTemplatesController,
    QuickAccessController,
    UserOrgVisibilityController,
  ],
  providers: [
    // เครื่องมือ / การเข้าถึงข้อมูล
    FileStorageService,
    FolderAccess,
    FolderRepository,
    FileRepository,
    AclRepository,
    FolderTemplateRepository,
    // service
    UserOrgVisibilityService,
    FoldersService,
    FilesService,
    FolderPermissionsService,
    FilePermissionsService,
    RecycleBinService,
    FolderTemplatesService,
    QuickAccessService,
    // งานเบื้องหลัง (ปิดเป็นค่าเริ่มต้น — เปิดด้วย Dms.RecycleBin.AutoPurge)
    RecycleBinPurgeJob,
    // port สำหรับ module อื่น
    { provide: DMS_FILE_PORT, useClass: DmsFilePortAdapter },
    { provide: DMS_FILE_UNCHECKED_PORT, useClass: DmsFileUncheckedAdapter },
  ],
  exports: [DMS_FILE_PORT, DMS_FILE_UNCHECKED_PORT],
})
export class DmsCoreModule implements OnModuleInit {
  private readonly logger = new Logger(DmsCoreModule.name);

  constructor(
    private readonly folders: FoldersService,
    private readonly permissions: FolderPermissionsService,
    @Optional()
    @Inject(DMS_APPROVAL_HANDLERS)
    private readonly handlers?: ApprovalHandlerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.handlers) {
      this.logger.warn(
        'ไม่พบ DMS_APPROVAL_HANDLERS — ไม่ได้ลงทะเบียน handler ของ CREATE_HC / DELETE_FOLDER / CHANGE_PERMISSION (module อนุมัติยังไม่พร้อม)',
      );
      return;
    }
    for (const h of buildDmsCoreApprovalHandlers(this.folders, this.permissions)) {
      this.handlers.register(h);
    }
  }
}
