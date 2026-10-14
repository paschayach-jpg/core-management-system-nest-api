/**
 * ส่งออก OpenAPI (openapi.json) โดยไม่ต้องมี SQL Server: บูตแอปด้วย DataSource ปลอม
 *   npm run openapi:export            → ./openapi.json
 *   npm run openapi:export -- out.json
 * ใช้สร้าง client (เช่น openapi-typescript / NSwag สำหรับทีม .NET) และตรวจ breaking change ใน CI
 */
import { writeFileSync } from 'node:fs';

// env ขั้นต่ำให้ผ่านการตรวจ (ไม่ใช่ความลับจริง) — ต้องตั้งก่อน import AppModule
const defaults: Record<string, string> = {
  DB_HOST: 'localhost',
  DB_USER: 'openapi',
  DB_PASSWORD: 'openapi',
  JWT_SECRET: 'openapi-export-only-not-a-real-secret-0123456789',
  AD_AUTH_BASE_URL: 'http://localhost',
  LOG_LEVEL: 'silent',
  CRUD_LOG_CONSOLE: 'false',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;

async function main(): Promise<void> {
  const [{ Test }, { getDataSourceToken }] = await Promise.all([
    import('@nestjs/testing'),
    import('@nestjs/typeorm'),
  ]);
  const [{ AppModule }, { configureApp }, { AppConfigService }, { buildOpenApiDocument }] =
    await Promise.all([
      import('../src/app.module'),
      import('../src/app.setup'),
      import('../src/config'),
      import('../src/swagger'),
    ]);

  const fakeRepo = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then' || typeof p === 'symbol' || /^(on|before)[A-Z]/.test(String(p))
          ? undefined
          : () => undefined,
    },
  );
  const fakeDs = () => ({
    isInitialized: false,
    entityMetadatas: [],
    options: { type: 'mssql' },
    driver: { mssql: {}, master: {} },
    getRepository: () => fakeRepo,
    manager: {},
    destroy: async () => undefined,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getDataSourceToken())
    .useValue(fakeDs())
    .overrideProvider(getDataSourceToken('project'))
    .useValue(fakeDs())
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app as never, app.get(AppConfigService));
  await app.init();

  const doc = buildOpenApiDocument(app);
  const out = process.argv[2] ?? 'openapi.json';
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`เขียน ${out}: ${Object.keys(doc.paths).length} paths`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
