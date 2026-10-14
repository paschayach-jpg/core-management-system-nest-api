# Core Management System — REST API

REST API (NestJS + TypeORM + **SQL Server**) แทนโปรแกรม WinForms `core-management-system` — แยก service ตาม module: **Auth · Shared · DMS · KMS · RGP · WFE** · ทุก service รองรับ **CRUD-log** (ต่อระบบเก็บ log ใหม่ได้ภายหลังโดยไม่แก้ service)

> สถานะและสิ่งที่ยังไม่ได้พิสูจน์กับ SQL Server จริง: ดู [สถานะการตรวจสอบ](#สถานะการตรวจสอบ-อ่านก่อนนำไปใช้) ด้านล่าง

## เริ่มใช้งานเร็ว

```bash
nvm use                      # Node 22 (.nvmrc)
npm ci
cp .env.example .env         # แก้ DB_*, JWT_SECRET, AD_AUTH_BASE_URL
npm run start:dev            # http://localhost:3000   · Swagger: /docs · health: /health/live, /health/ready
```

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run typecheck` / `lint` / `format:check` | ตรวจชนิด / ตรวจโค้ด / ตรวจรูปแบบ |
| `npm test` | unit test (ไม่ต้องมี DB) · `npm run test:cov` ดู coverage |
| `npm run test:e2e` | บูตทั้งแอปด้วย DataSource ปลอม ตรวจ DI + guard + error format + ทุก endpoint ต้องระบุ security |
| `npm run build` / `start:prod` | build เป็น `dist/` / รันตัวที่ build แล้ว |
| `npm run codegen` | สร้าง entity + SP catalog ใหม่จาก `docs/reference/db-export/` (รันเมื่อ DB เปลี่ยน) |
| `npm run openapi:export` | ส่งออก `openapi.json` (สร้าง client ให้ web/.NET ด้วย NSwag ได้) |
| `docker compose --profile db up --build` | API + SQL Server 2022 สำหรับพัฒนา (ฐานว่าง — ต้องสร้าง CMS_DB/BUI_RG จากสคริปต์ DDL ของทีม DBA) |

## ภาพรวมสถาปัตยกรรม

```
HTTP ─▶ helmet/compression/CORS ─▶ requestId (CLS) ─▶ Throttler ─▶ JwtAuthGuard ─▶ MinRoleGuard ─▶ ValidationPipe
     ─▶ Controller (บาง) ─▶ Service (กฎธุรกิจ + CRUD-log) ─▶ TypeORM Repository │ SpExecutor (Stored Procedure) │ TransactionRunner
     ─▶ SQL Server (CMS_DB หลัก + BUI_RG โครงการ)            ◀─ AllExceptionsFilter (รูปแบบ error เดียวทั้งระบบ)
```

| Module | หน้าที่ | เอกสารละเอียด |
|---|---|---|
| `auth` | login ผ่าน AD Auth API → JWT, UserContext, สิทธิ์ตามชั้นความลับ, PDPA consent | [ARCHITECTURE](docs/ARCHITECTURE.md#auth) |
| `shared` | ผู้ใช้, หน่วยงาน 3 ระดับ, ข้อมูลหลัก HR, เมนู, ค่าตั้งระบบ, แจ้งเตือน, อ่าน audit | [docs/modules/shared.md](docs/modules/shared.md) |
| `dms` | โฟลเดอร์/ไฟล์/ACL/ถังขยะ, approval, แชร์, โควตา, authority | [dms-core](docs/modules/dms-core.md) · [dms-approvals](docs/modules/dms-approvals.md) |
| `kms` | หมวด/บทความ/เวอร์ชัน, import template, **import Excel**, dashboard | [docs/modules/kms.md](docs/modules/kms.md) |
| `rgp` | โครงการ/state/task/progress/เอกสาร/ไฟล์แนบ/เลขที่รัน | [docs/modules/rgp.md](docs/modules/rgp.md) |
| `wfe` | workflow template/instance/step, delegation, SLA | [docs/modules/wfe.md](docs/modules/wfe.md) |

เอกสารอื่น: [ARCHITECTURE](docs/ARCHITECTURE.md) · [CONVENTIONS](docs/CONVENTIONS.md) (สูตรเขียน module) · [CRUD_LOG](docs/CRUD_LOG.md) · [DECISIONS](docs/DECISIONS.md) (ทำไมเลือกอย่างนี้ + ส่วนที่ต่างจากระบบเดิม) · [RECOMMENDATIONS](docs/RECOMMENDATIONS.md) (**สิ่งที่แนะนำให้เพิ่ม**) · [reference](docs/reference/README.md) (เอกสารวิเคราะห์ระบบเดิม + DDL/SP export)

## ถ้าคุณมาจาก C# / ASP.NET

| NestJS | เทียบกับ .NET |
|---|---|
| `@Module({ imports, controllers, providers, exports })` | การลงทะเบียน DI ของ feature (`services.AddXxx()`) + assembly boundary |
| `@Injectable()` + constructor injection | service ที่ลงทะเบียนใน DI (`AddScoped`/`AddSingleton`) |
| `@Controller` / `@Get()` / `@Body()` | `[ApiController]` / `[HttpGet]` / `[FromBody]` |
| DTO class + `class-validator` + `ValidationPipe` | model + DataAnnotations + `ModelState` |
| Guard (`JwtAuthGuard`, `MinRoleGuard`) | `[Authorize]` / policy handler |
| Pipe / Interceptor / ExceptionFilter | model binder / action filter / exception middleware |
| `nestjs-cls` (`RequestContextService`) | `HttpContext.Current` / `AsyncLocal` |
| `TypeORM Repository` + QueryBuilder | EF Core `DbSet` + LINQ (ไม่มี change tracking/navigation property) |
| `SpExecutor.call(Sp.x).rows<T>()` | `SqlCommand(StoredProcedure)` + `SqlDataReader` (แต่ตรวจชนิดพารามิเตอร์ตอน compile) |
| `TransactionRunner.run()` | `TransactionScope` / `SqlTransaction` |
| `@nestjs/config` + zod | `IOptions<T>` + validation ตอน start |
| Swagger (`/docs`) | Swashbuckle |

## ข้อกำหนดสำคัญ

- **ทุก service ต้อง extend `CrudLoggedService`** (หรือ `EntityCrudService`) — มีเทสต์บังคับ ([CRUD_LOG](docs/CRUD_LOG.md))
- **DB**: SQL Server เท่านั้น · `synchronize` ปิดเสมอ (schema เป็นของทีม DBA) · เวลาใน DB เป็นเวลาท้องถิ่น → process ใช้ `TZ=Asia/Bangkok` และ driver `useUTC:false`
- **Auth**: ทุก endpoint ต้อง `Authorization: Bearer <JWT>` ยกเว้นที่ติด `@Public()` (login, exchange, health, ลิงก์แชร์ภายนอก)
- **Error** ทุกชนิดตอบ `{ statusCode, code, message, details?, requestId, path, timestamp }` · **รายการ** ตอบ `{ items, total, page, pageSize }`

## สถานะการตรวจสอบ (อ่านก่อนนำไปใช้)

| สิ่งที่ตรวจแล้ว (อัตโนมัติ) | สิ่งที่ **ยังไม่ได้ตรวจ** |
|---|---|
| typecheck · lint · unit test · e2e แบบ DataSource ปลอม (DI ครบ, guard, validation, error format, OpenAPI) · build · Docker build ใน CI | **การรันกับ SQL Server จริง** — สภาพแวดล้อมที่พัฒนาไม่มี SQL Server จึงยังไม่ได้ยืนยันว่า SQL/SP ทุกตัวรันผ่านและให้ผลถูก (เขียนจาก DDL/SP ที่ export มา) |
| กฎธุรกิจที่เป็นฟังก์ชันล้วน (สิทธิ์ ACL, สถานะ, ลำดับชั้นหน่วยงาน, SLA, วิเคราะห์รหัสบทความ ฯลฯ) | ประสิทธิภาพกับข้อมูลจริง (Notification 5e5 แถว, AuditLog 2.5e5 แถว), การเขียนไฟล์ลง SMB share, การเชื่อม AD Auth API จริง |

ก่อนขึ้น production ให้ทำตามหัวข้อ **P0** ใน [RECOMMENDATIONS](docs/RECOMMENDATIONS.md) และรายการ "ต้องทดสอบกับ SQL Server จริง" ท้ายเอกสารของแต่ละ module
