import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { AppConfigService } from '../config';
import { MAIN_ENTITIES, PROJECT_ENTITIES } from './entities.generated';

export type DbName = 'main' | 'project';

/**
 * สร้าง option ของ TypeORM (mssql) — ฐานหลัก CMS_DB และฐานโครงการ BUI_RG ใช้ server เดียวกันได้ถ้าไม่ได้ระบุ PROJECT_DB_*
 *
 * สำคัญ: `useUTC: false` — ระบบเดิมเก็บเวลาท้องถิ่น (GETDATE()) จึงให้ driver อ่าน/เขียน datetime เป็นเวลาท้องถิ่น
 * ของ process (ต้องตั้ง TZ=Asia/Bangkok ให้ตรงกับ SQL Server) ไม่เช่นนั้นเวลาจะเพี้ยน 7 ชั่วโมง
 */
export function buildTypeOrmOptions(cfg: AppConfigService, which: DbName): TypeOrmModuleOptions {
  const isProject = which === 'project';
  const host = (isProject && cfg.get('PROJECT_DB_HOST')) || cfg.get('DB_HOST');
  const port = (isProject && cfg.get('PROJECT_DB_PORT')) || cfg.get('DB_PORT');
  const username = (isProject && cfg.get('PROJECT_DB_USER')) || cfg.get('DB_USER');
  const password = (isProject && cfg.get('PROJECT_DB_PASSWORD')) || cfg.get('DB_PASSWORD');
  const database = isProject ? cfg.get('PROJECT_DB_NAME') : cfg.get('DB_NAME');

  return {
    type: 'mssql',
    name: isProject ? 'project' : undefined,
    host,
    port,
    username,
    password,
    database,
    entities: isProject ? [...PROJECT_ENTITIES] : [...MAIN_ENTITIES],
    synchronize: cfg.get('DB_SYNCHRONIZE'), // ปิดเสมอใน production (ตรวจที่ env.schema)
    migrationsRun: false,
    logging: cfg.get('DB_LOGGING') ? ['error', 'warn', 'query'] : ['error'],
    maxQueryExecutionTime: 1000,
    connectionTimeout: cfg.get('DB_CONNECT_TIMEOUT_MS'),
    requestTimeout: cfg.get('DB_REQUEST_TIMEOUT_MS'),
    pool: {
      max: cfg.get('DB_POOL_MAX'),
      min: cfg.get('DB_POOL_MIN'),
      idleTimeoutMillis: 30_000,
    },
    options: {
      encrypt: cfg.get('DB_ENCRYPT'),
      trustServerCertificate: cfg.get('DB_TRUST_SERVER_CERT'),
      useUTC: false,
      enableArithAbort: true,
    },
    // ไม่ retry connect ตอน boot — ให้ล้มเร็วและ orchestrator restart
    retryAttempts: 3,
    retryDelay: 2000,
  };
}
