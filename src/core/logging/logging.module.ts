import { Module } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../../config';

/**
 * application log แบบ structured JSON (pino) · production → stdout เป็น JSON · development → pino-pretty
 * ปิดบัง Authorization/cookie/password อัตโนมัติ และแนบ requestId ทุกบรรทัด
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        pinoHttp: {
          level: cfg.get('LOG_LEVEL'),
          autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
          // ให้ pino-http ใช้ id เดียวกับ CLS (header x-request-id หรือ UUID ที่ middleware สร้าง)
          genReqId: (req) =>
            (ClsServiceManager.getClsService().getId() as string | undefined) ??
            String(req.headers['x-request-id'] ?? ''),
          mixin: () => ({ requestId: ClsServiceManager.getClsService().getId() }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.accessToken',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
          },
          transport: cfg.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
