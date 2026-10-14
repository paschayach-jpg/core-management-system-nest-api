/** module ของระบบที่เป็นเจ้าของ event (ตรงกับ module ของ API) */
export type CrudModuleName = 'AUTH' | 'SHARED' | 'DMS' | 'KMS' | 'RGP' | 'WFE' | 'SYSTEM';

/**
 * ชนิดการกระทำ
 *  - READ    อ่าน/ดาวน์โหลด (เก็บเมื่อ CRUD_LOG_LEVEL=all)
 *  - CREATE / UPDATE / DELETE  เขียนข้อมูลปกติ
 *  - EXECUTE การกระทำเชิงธุรกิจที่ไม่ใช่ CRUD ตรงๆ เช่น APPROVE, MOVE, SHARE, LOGIN (ระบุชื่อใน `operation`)
 */
export type CrudAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE';

export interface CrudLogActor {
  userId?: number;
  userName?: string;
  appRole?: number;
  ip?: string;
  sessionId?: string;
  userAgent?: string;
}

/** 1 เหตุการณ์ CRUD ที่ส่งให้ทุก sink — โครงสร้างนี้คือ "สัญญา" ที่ระบบเก็บ log ในอนาคตต้องรองรับ */
export interface CrudLogEvent {
  /** เวลาเกิดเหตุการณ์ (เวลาเครื่อง API) */
  timestamp: Date;
  requestId?: string;
  module: CrudModuleName;
  /** ชื่อ entity/ทรัพยากร เช่น 'Folder', 'KbArticle' */
  entity: string;
  action: CrudAction;
  /** ชื่อการกระทำเชิงธุรกิจ เช่น 'MOVE_FOLDER', 'APPROVE_REQUEST' (ถ้าไม่ระบุ = ชื่อ action) */
  operation?: string;
  /** id ของระเบียนที่ถูกกระทำ (ถ้าหลายระเบียนให้ใส่ใน meta.recordIds) */
  recordId?: string | number;
  /** ค่าก่อน/หลังแก้ไข — ถูก redact และตัดความยาวก่อนส่งให้ sink */
  before?: unknown;
  after?: unknown;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  actor: CrudLogActor;
  meta?: Record<string, unknown>;
}

/** ข้อมูลที่ service ส่งเข้ามา (ที่เหลือ — เวลา, ผู้ใช้, ip, requestId — เติมให้อัตโนมัติ) */
export type CrudLogInput = Omit<CrudLogEvent, 'timestamp' | 'requestId' | 'actor' | 'success'> & {
  success?: boolean;
  actor?: Partial<CrudLogActor>;
};

/**
 * ปลายทางของ log — implement interface นี้เพื่อเพิ่มระบบเก็บ log ใหม่ (DB ตารางใหม่, Elasticsearch, Kafka, ...)
 * แล้วลงทะเบียนผ่าน `CrudLogRegistry.register(sink)` (ดู docs/CRUD_LOG.md)
 */
export interface CrudLogSink {
  readonly name: string;
  /** รับ event — ห้ามทำให้ request ล้ม (CrudLogService จับ error ให้แล้ว) */
  write(event: CrudLogEvent): Promise<void> | void;
  /** เรียกตอน shutdown เพื่อ flush buffer (ถ้ามี) */
  flush?(): Promise<void> | void;
}

export type CrudLogLevel = 'off' | 'write' | 'all';
