import { Global, Module, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../../config';
import { CrudLogRegistry } from './crud-log.registry';
import { CrudLogService } from './crud-log.service';
import { AuditDbCrudLogSink } from './sinks/audit-db.sink';
import { ConsoleCrudLogSink } from './sinks/console.sink';

/**
 * ระบบ CRUD-log กลาง — ทุก service ต้อง extend CrudLoggedService (บังคับด้วย test/architecture)
 * sink ในตัว: console (pino) และ audit-db (ปิดเป็นค่าเริ่มต้น) · ระบบเก็บ log ใหม่ในอนาคตเพียง
 * implement CrudLogSink แล้วเรียก CrudLogRegistry.register() ใน module ของตัวเอง
 */
@Global()
@Module({
  providers: [CrudLogRegistry, CrudLogService, ConsoleCrudLogSink, AuditDbCrudLogSink],
  exports: [CrudLogRegistry, CrudLogService],
})
export class CrudLogModule implements OnModuleInit {
  constructor(
    private readonly registry: CrudLogRegistry,
    private readonly config: AppConfigService,
    private readonly consoleSink: ConsoleCrudLogSink,
    private readonly auditSink: AuditDbCrudLogSink,
  ) {}

  onModuleInit(): void {
    if (this.config.get('CRUD_LOG_CONSOLE')) this.registry.register(this.consoleSink);
    if (this.config.get('CRUD_LOG_AUDIT_DB')) this.registry.register(this.auditSink);
  }
}
