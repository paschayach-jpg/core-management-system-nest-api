import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config';
import { RequestContextService } from '../cls/request-context.service';
import { CrudLogRegistry } from './crud-log.registry';
import { sanitizeForLog } from './crud-log.sanitizer';
import type { CrudLogEvent, CrudLogInput, CrudLogLevel } from './crud-log.types';

/**
 * จุดศูนย์กลางของ CRUD-log: รับ event จาก service → เติม context (ผู้ใช้/ip/requestId) → redact → ส่งให้ทุก sink
 *
 *  - ไม่ block request: ส่งให้ sink แบบ fire-and-forget (มีตัวนับงานค้างเพื่อ flush ตอน shutdown)
 *  - ไม่ทำให้ request ล้ม: error ของ sink ถูกจับและเขียนลง application log
 *  - เลือกระดับด้วย CRUD_LOG_LEVEL: off | write (ค่าเริ่มต้น) | all (รวม READ)
 */
@Injectable()
export class CrudLogService implements OnApplicationShutdown {
  private readonly logger = new Logger(CrudLogService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly registry: CrudLogRegistry,
    private readonly ctx: RequestContextService,
    private readonly config: AppConfigService,
  ) {}

  get level(): CrudLogLevel {
    return this.config.get('CRUD_LOG_LEVEL');
  }

  /** เปิดเก็บ action นี้หรือไม่ (service ใช้เช็คก่อนเตรียม before/after ที่แพง) */
  isEnabled(action: CrudLogEvent['action']): boolean {
    const level = this.level;
    if (level === 'off') return false;
    if (action === 'READ') return level === 'all';
    return true;
  }

  record(input: CrudLogInput): void {
    if (!this.isEnabled(input.action)) return;

    const user = this.ctx.user;
    const max = this.config.get('CRUD_LOG_MAX_PAYLOAD_CHARS');
    const event: CrudLogEvent = {
      ...input,
      timestamp: new Date(),
      requestId: this.ctx.requestId,
      success: input.success ?? true,
      before: input.before === undefined ? undefined : sanitizeForLog(input.before, max),
      after: input.after === undefined ? undefined : sanitizeForLog(input.after, max),
      meta:
        input.meta === undefined
          ? undefined
          : (sanitizeForLog(input.meta, max) as Record<string, unknown>),
      actor: {
        userId: user?.userId,
        userName: user?.adUserName,
        appRole: user?.appRole,
        ip: this.ctx.ip,
        sessionId: this.ctx.sessionId,
        userAgent: this.ctx.userAgent,
        ...input.actor,
      },
    };

    for (const sink of this.registry.sinks) {
      const task: Promise<void> = Promise.resolve()
        .then(() => sink.write(event))
        .catch((err: unknown) => {
          this.logger.error(
            `CRUD-log sink "${sink.name}" เขียนไม่สำเร็จ: ${(err as Error)?.message ?? err}`,
          );
        })
        .finally(() => this.pending.delete(task));
      this.pending.add(task);
    }
  }

  /** รอให้ event ที่ค้างอยู่เขียนเสร็จ (ใช้ในเทสต์และตอน shutdown) */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
    await Promise.allSettled(this.registry.sinks.map((s) => Promise.resolve(s.flush?.())));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }
}
