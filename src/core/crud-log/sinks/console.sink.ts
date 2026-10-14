import { Injectable } from '@nestjs/common';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import type { CrudLogEvent, CrudLogSink } from '../crud-log.types';

/** เขียน event เป็น JSON ผ่าน pino (ไปกับ application log → ELK/Loki/CloudWatch ได้ทันที) */
@Injectable()
export class ConsoleCrudLogSink implements CrudLogSink {
  readonly name = 'console';

  constructor(@InjectPinoLogger('CrudLog') private readonly logger: PinoLogger) {}

  write(event: CrudLogEvent): void {
    const msg = `${event.module}.${event.entity} ${event.operation ?? event.action}${
      event.recordId !== undefined ? ` #${event.recordId}` : ''
    } ${event.success ? 'OK' : 'FAIL'}`;
    if (event.success) this.logger.info({ crud: event }, msg);
    else this.logger.warn({ crud: event }, msg);
  }
}
