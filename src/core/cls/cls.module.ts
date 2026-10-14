import { Global, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { ClsModule } from 'nestjs-cls';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => {
          const incoming = req.headers['x-request-id'];
          const id = Array.isArray(incoming) ? incoming[0] : incoming;
          return id && /^[\w.-]{8,64}$/.test(id) ? id : randomUUID();
        },
        setup: (cls, req: Request) => {
          cls.set('ip', req.ip);
          cls.set('userAgent', req.headers['user-agent']);
        },
      },
    }),
  ],
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
