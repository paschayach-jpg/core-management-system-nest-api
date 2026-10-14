import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigService } from './config';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  // เวลาใน DB เป็นเวลาท้องถิ่น (GETDATE) และ driver ตั้ง useUTC:false → process ต้องใช้เขตเวลาเดียวกับ SQL Server
  process.env.TZ ??= 'Asia/Bangkok';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const cfg = app.get(AppConfigService);

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

  await app.listen(cfg.get('PORT'));
}

void bootstrap();
