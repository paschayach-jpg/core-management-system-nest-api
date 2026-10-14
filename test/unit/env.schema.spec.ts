import { validateEnv } from '../../src/config/env.schema';
import { BASE_ENV } from '../helpers/stubs';

describe('env schema', () => {
  it('ใส่ค่าที่จำเป็นครบ → ได้ default ที่ถูกต้อง', () => {
    const env = validateEnv(BASE_ENV);
    expect(env.PORT).toBe(3000);
    expect(env.DB_NAME).toBe('CMS_DB');
    expect(env.PROJECT_DB_NAME).toBe('BUI_RG');
    expect(env.CRUD_LOG_LEVEL).toBe('write');
    expect(env.DB_SYNCHRONIZE).toBe(false);
  });

  it('แปลง "false"/"true" เป็น boolean จริง (ไม่ใช่ truthy string)', () => {
    const env = validateEnv({
      ...BASE_ENV,
      DB_ENCRYPT: 'false',
      SWAGGER_ENABLED: 'true',
      DB_LOGGING: '1',
    });
    expect(env.DB_ENCRYPT).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.DB_LOGGING).toBe(true);
  });

  it('ขาดค่าจำเป็น → throw พร้อมบอกชื่อตัวแปร', () => {
    const { DB_HOST: _omit, ...rest } = BASE_ENV;
    expect(() => validateEnv(rest)).toThrow(/DB_HOST/);
  });

  it('JWT_SECRET สั้นเกินไปถูกปฏิเสธ', () => {
    expect(() => validateEnv({ ...BASE_ENV, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('ห้ามเปิด DB_SYNCHRONIZE ใน production', () => {
    expect(() =>
      validateEnv({ ...BASE_ENV, NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' }),
    ).toThrow(/DB_SYNCHRONIZE/);
  });
});
