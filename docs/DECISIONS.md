# บันทึกการตัดสินใจ (Architecture Decision Records)

รูปแบบ: **บริบท → ตัดสินใจ → ผลที่ตามมา/ทางกลับ** · การตัดสินใจเฉพาะ module อยู่ใน `docs/modules/<module>.md` หัวข้อ "ส่วนที่ต่างจากระบบเดิม"

## A. เทคโนโลยี

### D-01 NestJS 11 (CJS) + TypeORM 0.3 + TypeScript 5.9 (ไม่ใช้รุ่นใหม่สุด)
- **บริบท:** ตอนเริ่มโครงการ registry มีรุ่นใหม่กว่า (Nest 12 ที่เป็น ESM-only, TypeORM 1.x, TypeScript 6/7) แต่ระบบนิเวศ (nestjs-cls, nestjs-pino, @nestjs/typeorm, ts-jest, swagger plugin) ยังไม่รองรับครบ และการเชื่อม SQL Server (tedious) ผ่าน TypeORM 0.3 เป็นเส้นทางที่ใช้งานจริงมากที่สุด
- **ตัดสินใจ:** ตรึง Nest 11 / TypeORM 0.3.x / TS ~5.9 / Node ≥ 20.19 (พัฒนาด้วย 22 LTS)
- **ผลที่ตามมา:** ลดความเสี่ยงช่วงแรก · ทางอัปเกรด: Nest 12 เมื่อ plugin หลักรองรับ ESM (ต้องเปลี่ยน `module` ใน tsconfig และ import ที่ใช้ `require`) → TypeORM 1.x → TS 6/7 · Dependabot เปิดไว้แล้ว (จัดกลุ่ม `@nestjs/*`)

### D-02 ผสม Stored Procedure + TypeORM Repository + SQL ตรง (ไม่ใช้ ORM อย่างเดียว)
- **บริบท:** ตรรกะสำคัญของ DMS/EMS/WFE อยู่ใน SP (recursive CTE, locking, การสร้าง instance) และ KMS/RGP เป็น CRUD/รายงานปกติ (OPEN_QUESTIONS D1)
- **ตัดสินใจ:** SP ที่มีอยู่ → เรียกผ่าน `SpExecutor` แบบมีชนิด (สร้างจากนิยามจริง) · CRUD/ค้น/แบ่งหน้า → TypeORM · query ซับซ้อน → SQL ตรงแบบ parameterize
- **ผลที่ตามมา:** ไม่ต้องเขียนตรรกะซ้ำของ SP แล้วเสี่ยงไม่ตรงกับ WinForms ที่ยังใช้ SP เดิมควบคู่ (OPEN_QUESTIONS B3 strangler) · ข้อเสีย: ตรรกะกระจายสองที่ → ใช้ test + เอกสารต่อ SP

### D-03 Entity ไม่มี relation/navigation property
- **ตัดสินใจ:** `tools/codegen` สร้าง entity เฉพาะคอลัมน์ ไม่สร้าง `@ManyToOne`/`@OneToMany` — join ทำในจุดใช้งาน
- **เหตุผล:** DB มี FK ข้าม schema/ฐาน (BUI_RG) และตารางที่ไม่มี PK ใน export; relation ทำให้ circular import และ lazy-load ที่ซ่อน query · query ที่เห็นชัดกว่าเหมาะกับทีมที่คุ้น ADO.NET

### D-04 `synchronize` ปิดเสมอ และ schema เป็นของทีม DBA
- สคริปต์ที่ API แนะนำอยู่ที่ `docs/db/` เป็น **ข้อเสนอ** (idempotent, ยังไม่เคยรัน) — ห้ามรันเองบน production

### D-05 `useUTC:false` + `TZ=Asia/Bangkok`
- **บริบท:** DB เก็บเวลาท้องถิ่น (`GETDATE()`) เกือบทั้งหมด ยกเว้นบางคอลัมน์ `GETUTCDATE()` (OPEN_QUESTIONS B10)
- **ตัดสินใจ:** อ่าน/เขียน datetime เป็นเวลาท้องถิ่นของโปรเซส และ JSON ส่งออกเป็น ISO 8601 · คอลัมน์ที่เป็น UTC (`FolderAuthorityConfig.UpdatedDate`, `WFInstance.InitiatedDate`) จะคลาดเคลื่อน 7 ชม. เมื่อแสดง → ระบุในเอกสาร module ที่เกี่ยวข้อง · คอลัมน์ใหม่ในอนาคตควรเป็น `datetimeoffset`

### D-06 Request context ด้วย `nestjs-cls` (AsyncLocalStorage)
- ให้ CRUD-log ดึง ผู้ใช้/ip/requestId ได้ทุกชั้นโดยไม่ต้องส่ง parameter ต่อ · service ยังรับ `UserContext` เป็น parameter ในเมธอดที่ต้องใช้ในกฎธุรกิจ (เทสต์ง่าย) — CLS ใช้เฉพาะงาน cross-cutting

### D-07 ตรวจ env ด้วย zod ที่ boot, ไม่ใช้ `process.env` ใน service
- ผิดพลาด → แอปไม่ขึ้นพร้อมรายการตัวแปรที่ผิด (fail fast) · ห้ามเปิด `DB_SYNCHRONIZE` ใน production

## B. API

### D-08 URL: `/api/v1/<module>/…` (URI versioning), error/รายการรูปแบบเดียว
- error: `{ statusCode, code, message, details?, requestId, path, timestamp }` — `code` เป็นรหัสคงที่ให้ client แยกกรณี, `message` เป็นไทย (OPEN_QUESTIONS B9)
- รายการ: `{ items, total, page, pageSize }` (ขนาดหน้าสูงสุด 200) · bigint เป็นสตริง · camelCase

### D-09 ทุก endpoint ต้อง login โดยค่าเริ่มต้น (deny-by-default)
- `JwtAuthGuard` เป็น `APP_GUARD` · `@Public()` ต้องมีเหตุผลและถูกบังคับด้วยเทสต์ e2e (ทุก operation ที่ไม่อยู่ในรายการ public ต้องมี security ใน OpenAPI)

### D-10 JWT ของ API ครอบ AD Auth API เดิม (ไม่เก็บรหัสผ่าน)
- AD Auth API ยังเป็นผู้ตรวจ credential · API ออก JWT สั้น (ค่าเริ่มต้น 1 ชม.) ที่เก็บแค่ id/role/session แล้วโหลดสิทธิ์สดทุกคำขอ → เพิกถอนทำได้โดยปิดบัญชี (ภายใน TTL ของ cache) · **ยังไม่มี refresh token / revocation list** (ดู RECOMMENDATIONS S-02)

### D-11 Module DMS แยก 3 ส่วนและคุยกันผ่าน "port"
- `permissions/` (ตัวประเมินสิทธิ์) · `core/` (โฟลเดอร์/ไฟล์/ACL) · `approvals/` (approval/แชร์/โควตา) — core ต้องยื่นคำขออนุมัติและเรียกบังคับโควตา ส่วน approvals ต้องสั่ง core ทำผลหลังอนุมัติ → ใช้ token + interface (`src/modules/dms/ports/`) และ handler registry เพื่อไม่ให้ module พึ่งกันเป็นวง · KMS/RGP ฝากไฟล์เข้า DMS ผ่าน `DMS_FILE_PORT` เท่านั้น

## C. CRUD-log

### D-12 "ท่อ" เสร็จแล้ว "ที่เก็บถาวร" ปล่อยให้เสียบทีหลัง
- ดู [CRUD_LOG.md](CRUD_LOG.md) · ค่าเริ่มต้นเก็บเฉพาะการเขียน (READ ปิด) · บังคับด้วยเทสต์สถาปัตยกรรมว่าทุก service extend `CrudLoggedService`

## D. ส่วนที่ต่างจากระบบเดิมในแกนกลาง (core / Shared / Auth)

| # | เรื่อง | ระบบเดิม | API นี้ | อ้างอิง |
|---|---|---|---|---|
| X-01 | **ย้ายหน่วยงาน** | `MoveOrgUnit` เรียก `sp_UpdateOrgUnit` ซึ่งไม่แก้ `ParentOrgUnitID` → ย้ายไม่เกิดผลใน DB | `PUT /org-units/:id/parent` อัปเดต `ParentOrgUnitID` จริง (ตรวจกฎระดับ+ชื่อซ้ำเหมือนเดิม) | `shared/org-units` |
| X-02 | **ลบหน่วยงาน** | Deactivate กับ Delete เป็น SP ตัวเดียวกัน (soft delete), force ลบโฟลเดอร์ | `DELETE /org-units/:id` (soft) · มี dependents ต้อง `?force=true` · SubCommittee ลบ `m_SubCommittee` คู่กัน | C10 |
| X-03 | **ACL: InheritanceBroken** | โค้ดอ่านคอลัมน์ `FolderPermission.InheritanceBroken` แต่ DB จริงไม่มี → ในทางปฏิบัติสืบทอดจาก parent เสมอ | คงพฤติกรรม "สืบทอดเสมอ" และไม่อ้างคอลัมน์นี้ · ถ้าต้องการตัดการสืบทอด ต้องให้ DBA เพิ่มคอลัมน์ก่อน | `dms/permissions/acl.evaluator.ts` |
| X-04 | **แคชสิทธิ์** | แคช ACL/ผู้ใช้ใน memory ต่อ session (สิทธิ์เก่าค้างจนปิดโปรแกรม) | ไม่แคช ACL (2 query/การตรวจ); UserContext แคช `CACHE_TTL_SEC` วินาที | 04-business-rules §2.3 |
| X-05 | **Login ล้มเหลว** | `CheckLoginAsync` รวม "รหัสผิด" กับ "ติดต่อ AD ไม่ได้" เป็น false | แยก: ผิด → 401 ข้อความทั่วไป · AD ล่ม → 503 | `auth/clients/ad-auth.client.ts` |
| X-06 | **ผู้ใช้ใหม่** | สร้างเองเป็น Officer / OrgUnit 1 (ฮาร์ดโค้ด) | ยังสร้างอัตโนมัติ (`AUTH_AUTO_PROVISION`, `AUTH_DEFAULT_ORG_UNIT_ID` ตั้งได้) | C19 |
| X-07 | **แจ้งเตือน** | โค้ดเดิมมีแต่ INSERT (SP อ่าน/mark-read ไม่มีผู้เรียก) | เพิ่ม inbox: list/unread-count/mark-read (ตรวจเจ้าของ) · **ตารางไม่มี index** ดู RECOMMENDATIONS D-01 | B2 |
| X-08 | **ค่าตั้งระบบ** | `ConfigManager` อ่านทั้ง app.config และ `dbo.SystemConfig` | อ่าน `dbo.SystemConfig` (cache) · env ใช้กับ infra เท่านั้น · endpoint list ปกปิดค่าของ key ที่ดูเป็นความลับ | 05-cross-cutting §6 |
| X-10 | **audit ตาม workflow instance** | `GetWorkflowAuditLogs` ไม่ตรวจสิทธิ์ (เชื่อว่า UI กรองแล้ว) | จำกัดเป็น Manager+; ผู้ใช้ทั่วไปอ่านผ่าน `GET /wfe/instances/:id/history` ซึ่งตรวจสิทธิ์ดู instance | `shared/audit`, `wfe` |
| X-09 | **แกนผู้ใช้** | `UserAdminController` ไม่เช็ก role (C15) | ทุก endpoint เขียนผู้ใช้ = Admin · ปิดบัญชีตัวเองไม่ได้ | C15 |

> การตัดสินใจ/ข้อแตกต่างของ DMS, KMS, RGP, WFE ดูในเอกสาร module ของแต่ละส่วน
