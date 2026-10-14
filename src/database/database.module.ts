import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config';
import { SpExecutor } from './sp/sp-executor.service';
import { TransactionRunner } from './transaction-runner.service';
import { buildTypeOrmOptions } from './typeorm.options';

/**
 * การเชื่อมต่อ SQL Server:
 *  - DataSource ค่าเริ่มต้น  = CMS_DB   → `@InjectDataSource()` / `@InjectRepository(Entity)`
 *  - DataSource 'project'    = BUI_RG   → `@InjectDataSource('project')` / `@InjectRepository(Entity, 'project')`
 *  - SpExecutor              = เรียก Stored Procedure แบบมีชนิด
 *  - TransactionRunner       = transaction ข้าม entity + SP
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => buildTypeOrmOptions(cfg, 'main'),
    }),
    TypeOrmModule.forRootAsync({
      name: 'project',
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => buildTypeOrmOptions(cfg, 'project'),
    }),
  ],
  providers: [SpExecutor, TransactionRunner],
  exports: [SpExecutor, TransactionRunner],
})
export class DatabaseModule {}
