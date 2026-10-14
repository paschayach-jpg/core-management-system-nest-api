import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigService } from './config';
import { setupSwagger } from './swagger';

/** ตั้งค่า middleware/pipe/filter ของแอป — ใช้ร่วมกันระหว่าง main.ts และเทสต์ e2e เพื่อให้พฤติกรรมตรงกัน */
export function configureApp(app: NestExpressApplication, cfg: AppConfigService): void {
  app.set('trust proxy', cfg.get('TRUST_PROXY'));
  app.use(helmet());
  app.use(compression());
  const origins = cfg.corsOrigins;
  if (origins.length > 0)
    app.enableCors({ origin: origins, credentials: true, exposedHeaders: ['x-request-id'] });

  app.setGlobalPrefix(cfg.get('API_PREFIX'), { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // ตัด field ที่ DTO ไม่ได้ประกาศ
      forbidNonWhitelisted: true, // ...และปฏิเสธคำขอที่ส่งมา (กัน mass-assignment)
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (cfg.get('SWAGGER_ENABLED')) setupSwagger(app);
}
