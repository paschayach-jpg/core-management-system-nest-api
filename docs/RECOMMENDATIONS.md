# ข้อเสนอแนะ: สิ่งที่ควรเพิ่มนอกเหนือจาก 4 ข้อที่กำหนด

ผู้ว่าจ้างกำหนด 4 ข้อ (แนวทางสมัยใหม่ · แยก service ตาม module · เชื่อม SQL Server · ทุก service รองรับ CRUD-log) และขอให้วิเคราะห์ว่า **ควรมีอะไรเพิ่ม**
เอกสารนี้แยกเป็น (ก) สิ่งที่ **ใส่ให้แล้ว** โดยไม่ได้ถูกขอ (ข) สิ่งที่ **แนะนำให้ทำต่อ** พร้อมหลักฐาน/ความสำคัญ/แรงงาน

ความสำคัญ: **P0** = ก่อนขึ้น production · **P1** = ภายใน 1–2 รอบพัฒนาหลังขึ้น · **P2** = เมื่อมีความต้องการ · แรงงาน: S ≤ 2 วัน · M ≤ 2 สัปดาห์ · L > 2 สัปดาห์ (ประมาณการคร่าว)

## (ก) ใส่ให้แล้ว

| หัวข้อ | รายละเอียด |
|---|---|
| ตรวจ config ตอน boot | zod — ตัวแปรผิดแอปไม่ขึ้น, ห้ามเปิด `synchronize` ใน production |
| Request ID ตลอดสาย | `x-request-id` → ทุกบรรทัด log, ทุก error response, ทุก CRUD-log event |
| รูปแบบ error เดียว + ไม่รั่วรายละเอียด 5xx | `AllExceptionsFilter` แปลง SQL error (unique/FK/deadlock/timeout) เป็น 409/503/504 |
| Deny-by-default auth + role guard + ตรวจสิทธิ์ทรัพยากร | เทสต์ e2e บังคับว่า endpoint ที่ไม่ public ต้องมี security |
| Validation แบบ whitelist | กัน mass-assignment (`forbidNonWhitelisted`) |
| Rate limit | global + เข้มกว่าที่ login/exchange (กัน brute force) |
| Security headers / gzip / CORS | helmet, compression, CORS ตาม env |
| Structured logging + redact | pino · ไม่มี Authorization/password/token ใน log |
| Health | `/health/live`, `/health/ready` (ping ทั้ง 2 ฐาน) |
| Graceful shutdown | `enableShutdownHooks` + CRUD-log รอเขียนให้เสร็จ |
| OpenAPI | `/docs`, `/docs/openapi.json`, `npm run openapi:export` (ไม่ต้องมี DB) |
| Deadlock retry | `SpExecutor` ลองใหม่เมื่อชน 1205 นอก transaction |
| Typed SP + codegen | ชนิดพารามิเตอร์จากนิยามจริง · เปลี่ยน DB → `npm run codegen` แล้ว compiler ชี้ที่ต้องแก้ |
| เทสต์ที่บังคับกติกา | ทุก service ต้องมี CRUD-log · controller ห้ามแตะ DB ตรง · service ห้ามใช้ `process.env` |
| Docker (multi-stage, non-root, tini, healthcheck) + compose + CI + Dependabot | |

## (ข) แนะนำให้ทำต่อ

### ความปลอดภัย

| ID | หัวข้อ | ทำไม (หลักฐาน) | ข้อเสนอ | ระดับ | แรง |
|---|---|---|---|:-:|:-:|
| S-01 | จัดการความลับ | ระบบเดิมมีค่า secret ฝังในซอร์ส/ไฟล์ config (`NotificationApiKey` ดู OPEN_QUESTIONS C17, `LdapPassword`, `EmployeeApiToken` ใน SystemConfig) | ใช้ secret manager (Azure Key Vault / Vault / K8s Secret) ฉีดเป็น env · **rotate key ที่เคยอยู่ในซอร์ส** · อย่าเก็บ secret ใน `dbo.SystemConfig` (API ปกปิดค่าให้ แต่ยังอยู่ใน DB) | P0 | S |
| S-02 | Refresh token / เพิกถอน JWT | JWT อายุ 1 ชม. (ค่าเริ่มต้น) และเพิกถอนได้เฉพาะโดยปิดบัญชี (ผ่าน cache TTL) | refresh token แบบ rotating + ตาราง/Redis denylist ของ `sid` สำหรับ logout/ถูกบังคับออก · จำกัดจำนวน session ต่อผู้ใช้ | P1 | M |
| S-03 | กัน brute force ระดับบัญชี | Throttler จำกัดตาม IP; ผู้โจมตีกระจาย IP ได้ | นับความล้มเหลวต่อ `username` (Redis) + lockout ชั่วคราว + บันทึกเหตุการณ์ (CRUD-log `LOGIN` fail มีแล้ว) | P1 | S |
| S-04 | สแกนไวรัสไฟล์อัปโหลด | ระบบเดิม **ข้ามการสแกน** แม้มี config ClamAV (OPEN_QUESTIONS C14); `FileDocument.VirusScanStatus` พร้อมใช้ | ต่อ ClamAV (clamd) ใน pipeline อัปโหลด: บันทึก `VirusScanStatus` 0→1/2/3, กักไฟล์ที่ติดเชื้อ | P0 (ถ้าอนุญาตอัปโหลดจากภายนอก/ผู้ใช้ทั่วไป) | M |
| S-05 | ลิงก์แชร์ภายนอก | endpoint สาธารณะ (token) เป็นพื้นผิวโจมตีเดียวที่ไม่ต้อง login; ระบบเดิมไม่เปิดใช้จริง (OPEN_QUESTIONS B1) | ยืนยันกับเจ้าของระบบว่าต้องเปิดหรือไม่ · token ยาว/สุ่มดี, hash รหัสผ่านด้วย bcrypt/argon2 (ถ้าเดิมใช้ hash อ่อนต้องมีทางย้าย), จำกัดอัตราต่อ token, เปิด WAF | P0 | M |
| S-06 | CORS / CSP / trust proxy | ตั้งตาม env แต่ยังไม่มี policy ที่ตกลงกับ front-end | กำหนด origin จริง, `TRUST_PROXY=true` เมื่ออยู่หลัง reverse proxy (มิฉะนั้น rate-limit/ip ใน log เป็น ip ของ proxy), TLS ที่ proxy | P0 | S |
| S-07 | PDPA | ระบบมี consent แต่ยังไม่มีสิทธิ์ผู้ใช้ (ขอสำเนา/ลบ) | endpoint export ข้อมูลส่วนบุคคลของตน (ระบบเดิมมี action `PersonalDataExported`), นโยบายเก็บ/ลบ log (ดู D-06), เปิด `CRUD_LOG_LEVEL=all` เฉพาะที่จำเป็นและเก็บอย่างจำกัดสิทธิ์ | P1 | M |

### ฐานข้อมูล

| ID | หัวข้อ | ทำไม (หลักฐาน) | ข้อเสนอ | ระดับ | แรง |
|---|---|---|---|:-:|:-:|
| D-01 | Index ที่ขาด | `EMS.Notification` 525,748 แถว **ไม่มี PK/index เลย** ใน export → inbox ค้น `RecipientUserId` = table scan; `KMS.t_KBArticle` มีแต่ PK+UQ(Code) | ใช้ [`docs/db/001_recommended_indexes.sql`](db/001_recommended_indexes.sql) (ให้ DBA ตรวจ) | P0 | S |
| D-02 | PK/FK/constraint ที่ขาด | `EMS.Notification`, `EMS.OrgUnitRelationship`, `EMS.m_SubCommittee`, `EMS.FolderAuthorityConfig` ไม่มี PK ใน export (codegen ต้องเดา key จาก identity) | DBA เพิ่ม PK; ตรวจ FK ที่ขาดข้าม schema | P1 | S |
| D-03 | DDL ที่ยังขาด | `storage.QuickAccessFolder`, `dbo.SystemConfig` ไม่มี DDL (OPEN_QUESTIONS A1–A3) → entity สองตัวนี้กำหนดคอลัมน์จาก SP | export DDL จริงแล้ว `npm run codegen` | P0 | S |
| D-04 | กระบวนการเปลี่ยน schema | `synchronize` ปิด และ repo นี้ไม่มี migration | เลือกอย่างใดอย่างหนึ่ง: สคริปต์ SQL เลขลำดับแบบที่ทีมใช้ใน MOD-006 (แนะนำ — เข้ากับทีม DBA) หรือ TypeORM migrations; ผูกกับ CI เพื่อทดสอบบนฐานเปล่า | P1 | M |
| D-05 | เวลา/เขตเวลา | ผสม `GETDATE()` และ `GETUTCDATE()` (B10) | คอลัมน์ใหม่ใช้ `datetimeoffset`/UTC; รวบรวมรายชื่อคอลัมน์ UTC แล้วแปลงตอน map ใน DTO | P2 | M |
| D-06 | Retention | `Notification` 5e5 แถว, `AuditLog` 2.5e5 แถว โตต่อเนื่อง | นโยบายเก็บ (เช่น Notification อ่านแล้ว > 180 วัน, audit > N ปี ย้ายไป archive) + งาน purge/partition | P1 | M |
| D-07 | ค้นเนื้อหา KMS | ค้นด้วย LIKE บน `ContentHTML` (nvarchar(max), 19k แถว) ช้าและค้นภาษาไทยไม่แม่น | SQL Server Full-Text Index (ต้องมี feature) หรือ OpenSearch + ตัดคำไทย | P2 | L |
| D-08 | SP ที่มีข้อบกพร่อง | `sp_DeleteFolderTemplateItem` ลบ 2 ระดับ, `sp_HasActiveDependents` ตรวจ 2 ตาราง, `sp_CreateMenuItem` ใช้ `@@IDENTITY`, `sp_CreateWFInstance` ใส่ Status 0 (OPEN_QUESTIONS C9–C12) | แก้ SP (DBA) หรือครอบด้วยตรรกะใน API (บางข้อ API ครอบแล้ว — ดู docs/modules) | P1 | S |
| D-09 | Optimistic concurrency | มีเพียง `Employee.RowVersion`; ที่อื่นแก้ทับกันเงียบๆ (last-write-wins) | เพิ่ม `rowversion` ในตารางที่แก้บ่อย (Folder, KbArticle, Project) + `ETag`/`If-Match` | P2 | M |

### การปฏิบัติการ (Ops)

| ID | หัวข้อ | ทำไม | ข้อเสนอ | ระดับ | แรง |
|---|---|---|---|:-:|:-:|
| O-01 | **ทดสอบกับ SQL Server จริง** | เทสต์ปัจจุบันพิสูจน์ได้แค่ตรรกะ + DI; SQL/SP ทุกตัวยังไม่เคยรัน | (1) ฐานทดสอบจาก DDL+ข้อมูลตัวอย่างที่ลบข้อมูลส่วนบุคคล (2) job CI ที่ขึ้น `mssql/server` container + สคริปต์ DDL แล้วรัน smoke/integration test (Testcontainers) (3) เดินรายการ "ต้องทดสอบกับ SQL Server จริง" ท้าย `docs/modules/*.md` | **P0** | M |
| O-02 | Observability | log อย่างเดียวยังไม่พอเมื่อมีหลาย instance | Prometheus metrics (`prom-client`: latency/RPS/error ต่อ route, pool, SP ช้า), OpenTelemetry tracing (HTTP→SQL), dashboard + alert (5xx, readiness ล้ม, SP > 1 วินาที — มี log เตือนแล้ว) | P1 | M |
| O-03 | รองรับหลาย instance | cache ใน memory; `@Cron` ไม่มี lock; job import KMS เก็บใน memory | Redis cache (เปลี่ยน store จุดเดียวที่ `AppCacheModule`), distributed lock สำหรับ cron (Redis หรือ `sp_getapplock`), เก็บสถานะ job import ในตาราง/Redis | P0 (ถ้ารัน > 1 instance) | M |
| O-04 | ที่เก็บไฟล์ | เดิมเป็น SMB share (`NetworkDrivePath`); container ต้อง mount | mount CIFS/NFS ให้ path เดียวกับ WinForms (ถ้ายังใช้ควบคู่) หรือย้ายไป object storage (S3/MinIO/Azure Blob) ผ่าน interface เดียว (`FileStorageService` ใน DMS core) + migration ไฟล์เดิม | P0 | M–L |
| O-05 | Deployment | | Helm/compose ต่อ environment, rolling update (readiness มีแล้ว), `TRUST_PROXY`, resource limit, `NODE_OPTIONS=--max-old-space-size` | P1 | S |
| O-06 | Backup / DR | | ทดสอบ restore ทั้ง DB และไฟล์ให้ตรงเวลากัน (metadata กับไฟล์กายภาพต้อง consistent) | P1 | M |
| O-07 | Performance test | ตารางใหญ่, อัปโหลด 100 MB, ต้นไม้โฟลเดอร์ | k6/Artillery: ต้นไม้โฟลเดอร์, ค้น KMS, อัปโหลดพร้อมกัน, import KMS หมื่นแถว · ตั้งเป้า p95 | P1 | M |

### ฟังก์ชันที่ควรเพิ่ม

| ID | หัวข้อ | ทำไม | ข้อเสนอ | ระดับ | แรง |
|---|---|---|---|:-:|:-:|
| F-01 | แจ้งเตือน real-time | เดิมใช้ long-polling ไป notification server ภายนอก (B2); ตอนนี้ API มีแต่ inbox แบบ pull | SSE `GET /notifications/stream` (หรือ WebSocket) + ตัดสินใจว่าจะยังใช้ notification server เดิมหรือไม่ | P2 | M |
| F-02 | Idempotency key | อัปโหลด/ยื่นคำขอ/แชร์ซ้ำเมื่อ client retry | header `Idempotency-Key` + ตารางเก็บผล 24 ชม. สำหรับ POST ที่สร้างคำขอ | P2 | M |
| F-03 | ส่งออกรายงาน | audit/SLA/รายการ KMS ต้องส่งออก Excel | endpoint stream `.xlsx` (exceljs มีแล้ว) | P2 | S–M |
| F-04 | สร้าง client อัตโนมัติ + contract test | ทีมเป็น .NET: ต้องการ client ที่ typed | NSwag สร้าง C# client / `openapi-typescript` สำหรับ web จาก `openapi.json`; ใน CI ตรวจ breaking change ด้วย `oasdiff` | P1 | S |
| F-05 | อยู่ร่วมกับ WinForms (strangler) | WinForms ยังเรียก SP เดิมตรงๆ (B3) | กำหนดชัดว่าช่วงเปลี่ยนผ่านใครเป็นเจ้าของการเขียนตารางไหน; เทียบผลเป็น parity test (D8): เก็บ request/response ต่อ use case จากระบบเดิม | P0 (ถ้าอยู่ร่วมกัน) | M |
| F-06 | นำเข้า/ส่งออกข้อมูลหลัก HR (Excel) และค้นผู้ใช้ LDAP | ระบบเดิมมี `OrgMasterService.ExecuteImport` และ `UpsertFromLdap` | ยังไม่ได้ทำ (ดู docs/modules/shared.md "deferred") — ทำเมื่อยืนยันว่ายังใช้ | P2 | M |
| F-07 | พรีวิว/ป้องกัน PDF ฝั่งเซิร์ฟเวอร์ | เดิมใช้ `PdfSecurityHelper` ฝั่ง client (บล็อกพิมพ์/บันทึก) | render/watermark ฝั่ง API หรือคงฝั่ง viewer — ตัดสินใจร่วมกับทีม UI | P2 | L |
| F-08 | ค่า locale/ข้อความ | ข้อความ error เป็นไทยตายตัว (B9) | คง `code` ให้ client แปลเอง; ถ้าต้องหลายภาษา ใช้ `nestjs-i18n` | P2 | M |

### คุณภาพและกระบวนการ

| ID | หัวข้อ | ข้อเสนอ | ระดับ | แรง |
|---|---|---|:-:|:-:|
| Q-01 | Gate ก่อน commit | Husky + lint-staged (prettier/eslint) + commitlint; branch protection ให้ CI ผ่านก่อน merge | P1 | S |
| Q-02 | CODEOWNERS / PR template | เจ้าของ module ชัดเจน (DMS/KMS/RGP/WFE) และเช็กลิสต์ "CRUD-log ครบ, เทสต์, เอกสาร module" | P1 | S |
| Q-03 | Coverage / mutation | ตั้งขั้นต่ำ coverage ของโฟลเดอร์กฎธุรกิจ; mutation test (Stryker) กับฟังก์ชันตัดสินสิทธิ์/สถานะ | P2 | M |
| Q-04 | อัปเกรด | แผน Nest 12 (ESM) / TypeORM 1.x / TS 6+ ตาม D-01 ของ DECISIONS; Dependabot เปิดแล้ว | P2 | M |
| Q-05 | เอกสารมีชีวิต | `docs/modules/*.md` คือเอกสารที่ต้องอัปเดตพร้อม PR; `npm run openapi:export` เก็บเป็น artifact ทุก release | P1 | S |

## สิ่งที่ตั้งใจ **ไม่ทำ** (และเหตุผล)

- ไม่ทำส่วนที่เอกสารวิเคราะห์ระบุว่าเป็น dead code (E-Filing, ปิดโครงการจากหน้าจอ, subtasks ฯลฯ) — ถามทีมก่อน (OPEN_QUESTIONS B5)
- ไม่รันหรือแก้ schema ใดๆ ของ DB (ข้อเสนออยู่ใน `docs/db/` เท่านั้น)
- ไม่ออกแบบ front-end — API สร้าง OpenAPI ให้ทีม UI/WinForms ใช้
- ไม่เก็บ secret จริงใน repo — `.env.example` เป็นค่าตัวอย่าง

## คำถามที่ต้องการคำตอบจากทีม (สรุปที่กระทบการใช้งานทันที)

ดูฉบับเต็มที่ [`reference/legacy-analysis/OPEN_QUESTIONS.md`](reference/legacy-analysis/OPEN_QUESTIONS.md) — ข้อที่ควรตอบก่อนเริ่มทดสอบ: **A1–A3** (DDL ที่ขาด), **B1** (เปิดลิงก์แชร์สาธารณะหรือไม่), **B3** (WinForms ใช้ API หรือใช้ SP ตรงต่อ), **B8** (BisDb คือฐานเดียวกับ CMS_DB หรือไม่ — RGP ใช้ `EMS.m_*` แทน), **C5** (สถานะ "ถอนคำขอ" ใช้ค่าใด)
