import { Injectable, Logger } from '@nestjs/common';
import type { CrudLogSink } from './crud-log.types';

/** ทะเบียน sink — module ไหนก็ลงทะเบียน sink เพิ่มได้ใน onModuleInit โดยไม่ต้องแก้ core */
@Injectable()
export class CrudLogRegistry {
  private readonly logger = new Logger(CrudLogRegistry.name);
  private readonly map = new Map<string, CrudLogSink>();

  register(sink: CrudLogSink): void {
    if (this.map.has(sink.name)) {
      this.logger.warn(`CRUD-log sink "${sink.name}" ถูกลงทะเบียนซ้ำ — ใช้ตัวล่าสุด`);
    }
    this.map.set(sink.name, sink);
    this.logger.log(`ลงทะเบียน CRUD-log sink: ${sink.name}`);
  }

  unregister(name: string): void {
    this.map.delete(name);
  }

  get sinks(): readonly CrudLogSink[] {
    return [...this.map.values()];
  }
}
