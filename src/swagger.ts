import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Core Management System API')
    .setDescription(
      [
        'REST API ของระบบ Core Management System (แทนโปรแกรม WinForms เดิม) แยกเป็น module: **Auth, Shared, DMS, KMS, RGP, WFE**',
        '',
        '- ทุก endpoint ต้องส่ง `Authorization: Bearer <JWT>` (ได้จาก `POST /api/v1/auth/login`) ยกเว้นที่ระบุ',
        '- error ทุกชนิดตอบรูปแบบเดียวกัน `{ statusCode, code, message, details?, requestId, path, timestamp }`',
        '- รายการ (list) ตอบ `{ items, total, page, pageSize }`',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('Auth')
    .addTag('Shared')
    .addTag('DMS')
    .addTag('KMS')
    .addTag('RGP')
    .addTag('WFE')
    .addTag('Health')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs/openapi.json',
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
  });
}
