import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AppRole } from '../../src/common/constants/enums';
import { BASE_ENV, fakeUser } from '../helpers/stubs';
import { fakeDataSource } from '../helpers/fake-datasource';

// ตั้งค่า env ก่อน import AppModule (ConfigModule ตรวจ env ตอน import)
Object.assign(process.env, BASE_ENV, {
  LOG_LEVEL: 'silent',
  CRUD_LOG_CONSOLE: 'false',
  SWAGGER_ENABLED: 'true',
});

/* eslint-disable @typescript-eslint/no-require-imports */
describe('App wiring (ไม่ต้องมี SQL Server)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  const user = fakeUser({ userId: 5, appRole: AppRole.Officer });

  beforeAll(async () => {
    const { AppModule } = require('../../src/app.module');
    const { configureApp } = require('../../src/app.setup');
    const { AppConfigService } = require('../../src/config');
    const { UserContextService } = require('../../src/modules/auth/services/user-context.service');
    const { AdAuthClient } = require('../../src/modules/auth/clients/ad-auth.client');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource())
      .overrideProvider(getDataSourceToken('project'))
      .useValue(fakeDataSource())
      .overrideProvider(UserContextService)
      .useValue({
        load: async (id: number) => (id === user.userId ? user : null),
        invalidate: async () => undefined,
      })
      .overrideProvider(AdAuthClient)
      .useValue({
        login: async () => ({ success: false }),
        validate: async () => ({ success: false }),
      })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get(AppConfigService));
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health/live เป็น public และไม่แตะ DB', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('endpoint ทั่วไปไม่มี token → 401 ในรูปแบบ error มาตรฐาน', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/lookup?q=ab').expect(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      path: '/api/v1/users/lookup?q=ab',
    });
    expect(res.body.requestId).toBeTruthy();
  });

  it('token ปลอม/ผิด secret → 401', async () => {
    const bad = new JwtService({ secret: 'x'.repeat(40) }).sign({
      sub: 5,
      username: 'u',
      role: 1,
      sid: 's',
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${bad}`)
      .expect(401);
  });

  it('token ถูกต้อง + user มีอยู่ → เข้าถึง /auth/me ได้', async () => {
    const token = jwt.sign({
      sub: user.userId,
      username: user.adUserName,
      role: user.appRole,
      sid: 'sid-1',
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ userId: 5, adUserName: user.adUserName });
  });

  it('token ถูกต้องแต่ไม่พบผู้ใช้ (ถูกปิด/ลบ) → 401', async () => {
    const token = jwt.sign({ sub: 999, username: 'ghost', role: 1, sid: 's' });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('@MinRole: Officer เรียก endpoint Admin → 403', async () => {
    const token = jwt.sign({ sub: user.userId, username: user.adUserName, role: 1, sid: 's' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/system-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('ValidationPipe: body มี field แปลกปลอม/ผิดชนิด → 400 พร้อมรายละเอียด', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 1, password: '', admin: true })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('login ที่ AD ปฏิเสธ → 401 ข้อความทั่วไป (ไม่บอกว่า user หรือ password ผิด)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'a', password: 'b' })
      .expect(401);
    expect(res.body.message).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  });

  it('OpenAPI: ทุก operation ต้องระบุ security ยกเว้น endpoint public', async () => {
    const { buildOpenApiDocument } = require('../../src/swagger');
    const doc = buildOpenApiDocument(app);
    const publicPaths = new Set([
      '/health/live',
      '/health/ready',
      '/api/v1/auth/login',
      '/api/v1/auth/exchange',
    ]);
    const missing: string[] = [];
    for (const [path, item] of Object.entries(
      doc.paths as Record<string, Record<string, { security?: unknown }>>,
    )) {
      if (publicPaths.has(path)) continue;
      for (const [method, op] of Object.entries(item)) {
        if (!op.security) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(missing).toEqual([]);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(40);
  });
});
