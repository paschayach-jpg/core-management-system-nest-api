import { z } from 'zod';

/** แปลง "true"/"1"/"yes" จาก env เป็น boolean (z.coerce.boolean() ให้ "false" เป็น true จึงใช้ไม่ได้) */
const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
    });

const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);

/** ค่า env ทั้งหมดที่ API ใช้ — ตรวจตอน boot ถ้าผิดจะหยุดทันทีพร้อมบอกว่าตัวไหนผิด (fail fast) */
export const envSchema = z
  .object({
    // ── App ─────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(3000, 1),
    API_PREFIX: z.string().default('api'),
    CORS_ORIGINS: z.string().default(''), // คั่นด้วย , ; ว่าง = ปิด CORS
    SWAGGER_ENABLED: bool(true),
    TRUST_PROXY: bool(false),
    THROTTLE_TTL_SEC: int(60, 1),
    THROTTLE_LIMIT: int(300, 1),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TZ: z.string().default('Asia/Bangkok'),

    // ── Database หลัก (CMS_DB) ──────────────────────────
    DB_HOST: z.string().min(1),
    DB_PORT: int(1433, 1),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().default('CMS_DB'),
    DB_ENCRYPT: bool(true),
    DB_TRUST_SERVER_CERT: bool(false),
    DB_POOL_MAX: int(20, 1),
    DB_POOL_MIN: int(2),
    DB_REQUEST_TIMEOUT_MS: int(30000, 1000),
    DB_CONNECT_TIMEOUT_MS: int(15000, 1000),
    DB_LOGGING: bool(false),
    /** TypeORM migrationsRun — ปิดไว้เสมอ ใช้สคริปต์ SQL ของทีม DBA */
    DB_SYNCHRONIZE: bool(false),

    // ── ฐานโครงการ RGP (BUI_RG) — ว่าง = ใช้ server/credential เดียวกับฐานหลัก ──
    PROJECT_DB_HOST: z.string().optional(),
    PROJECT_DB_PORT: z.coerce.number().int().optional(),
    PROJECT_DB_USER: z.string().optional(),
    PROJECT_DB_PASSWORD: z.string().optional(),
    PROJECT_DB_NAME: z.string().default('BUI_RG'),

    // ── Auth ────────────────────────────────────────────
    JWT_SECRET: z.string().min(32, 'JWT_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร'),
    JWT_EXPIRES_IN: z.string().default('1h'),
    JWT_ISSUER: z.string().default('cms-api'),
    /** บริการ AD Auth ภายนอก (เหมือน AdAuthApiBaseUrl เดิม) */
    AD_AUTH_BASE_URL: z.string().url(),
    AD_AUTH_LOGIN_PATH: z.string().default('/api/auth/login'),
    AD_AUTH_VALIDATE_PATH: z.string().default('/api/auth/validate'),
    AD_AUTH_TIMEOUT_MS: int(10000, 1000),
    /** ผู้ใช้ใหม่ที่ login ครั้งแรกจะถูกสร้างใน EMS.UserAccount (พฤติกรรมเดิมของโปรแกรม) */
    AUTH_AUTO_PROVISION: bool(true),
    AUTH_DEFAULT_ORG_UNIT_ID: int(1, 1),

    // ── CRUD log ───────────────────────────────────────
    /** off = ไม่เก็บ, write = เก็บเฉพาะ CREATE/UPDATE/DELETE/EXECUTE (ค่าเริ่มต้น), all = รวม READ */
    CRUD_LOG_LEVEL: z.enum(['off', 'write', 'all']).default('write'),
    CRUD_LOG_CONSOLE: bool(true),
    /** เขียนลงตาราง audit.AuditLog ผ่าน audit.sp_InsertAuditLog */
    CRUD_LOG_AUDIT_DB: bool(false),
    CRUD_LOG_MAX_PAYLOAD_CHARS: int(8000, 100),

    // ── ไฟล์ DMS ───────────────────────────────────────
    /** root ของที่เก็บไฟล์ (เดิม NetworkDrivePath) — API server ต้อง mount share นี้ */
    STORAGE_ROOT: z.string().default('./storage-data'),
    STORAGE_MAX_UPLOAD_MB: int(100, 1),

    // ── Cache ──────────────────────────────────────────
    CACHE_TTL_SEC: int(60),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DB_SYNCHRONIZE) {
      ctx.addIssue({
        code: 'custom',
        path: ['DB_SYNCHRONIZE'],
        message: 'ห้ามเปิด DB_SYNCHRONIZE ใน production',
      });
    }
    if (env.NODE_ENV === 'production' && env.DB_TRUST_SERVER_CERT) {
      // เตือนเท่านั้น ไม่ block — ทีมมักใช้ self-signed cert ในองค์กร
    }
  });

export type Env = z.infer<typeof envSchema>;

/** ใช้กับ ConfigModule.forRoot({ validate }) */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`ค่า environment ไม่ถูกต้อง:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
