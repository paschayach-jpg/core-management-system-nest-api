import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config';

async function bootstrap(): Promise<void> {
  // เวลาใน DB เป็นเวลาท้องถิ่น (GETDATE) และ driver ตั้ง useUTC:false → process ต้องใช้เขตเวลาเดียวกับ SQL Server
  process.env.TZ ??= 'Asia/Bangkok';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const cfg = app.get(AppConfigService);
  configureApp(app, cfg);
  await app.listen(cfg.get('PORT'));
}

void bootstrap();
