# ข้อกำหนดการเขียน module (Conventions)

เอกสารนี้คือ "สูตร" ที่ทุก module (Shared / DMS / KMS / RGP / WFE) ต้องทำตาม เพื่อให้โค้ดทั้งระบบหน้าตาเหมือนกัน
**ตัวอย่างอ้างอิงที่ครบที่สุด:** `src/modules/shared/org-units/*` (SP + กฎธุรกิจ + transaction + CRUD-log) และ `src/modules/shared/hr-masters/*` (CRUD ตารางข้อมูลหลักด้วย `EntityCrudService`)

> ผู้ใช้เอกสาร: ทีมพัฒนา (C#/.NET → NestJS) และ AI agent ที่ช่วยเขียน module · อ่านคู่กับ `docs/reference/legacy-analysis/` (กฎธุรกิจ/ตาราง/SP ของระบบเดิม)

## 1. โครงโฟลเดอร์

```
src/modules/<module>/
  entities/                 ← สร้างโดย `npm run codegen` — ห้ามแก้มือ (แก้ที่ tools/codegen/tables.config.ts)
  <feature>/
    dto/<feature>.dto.ts    ← request/response DTO (class-validator + @nestjs/swagger)
    <feature>.service.ts    ← กฎธุรกิจ  (extends CrudLoggedService / EntityCrudService)
    <feature>.controller.ts ← HTTP เท่านั้น (route, validate, เรียก service)
  <module>.module.ts        ← ประกาศ controllers/providers/imports/exports
test/unit/<module>/*.spec.ts  ← เทสต์ (ไม่ต้องมี DB)
docs/modules/<module>.md      ← สรุป endpoint, กฎที่พอร์ต, ส่วนที่ต่างจากระบบเดิม, สิ่งที่ยังไม่ทำ
```

เทียบกับ .NET: controller = ASP.NET Controller · service = Service layer · entity = EF entity (แต่ไม่มี navigation property) · module = DI registration (`services.AddXxx()`) ที่ผูกกลุ่ม class เป็นหน่วยเดียว

## 2. กฎ 10 ข้อ

1. **ทุก service ต้อง extend `CrudLoggedService` (หรือ `EntityCrudService`)** และทุกการเปลี่ยนแปลงข้อมูลต้องผ่าน `this.logged({...}, work)` — มีเทสต์ `test/architecture/conventions.spec.ts` ตรวจให้
2. **Controller บาง**: ห้ามมี `@InjectRepository` / `SpExecutor` / `from 'typeorm'` ใน controller — ทำผ่าน service เท่านั้น (มีเทสต์ตรวจ)
3. **ทุก endpoint ต้อง login** (JwtAuthGuard เป็น global) — `@Public()` ใช้เฉพาะกรณีที่จำเป็นจริงและต้องเขียนเหตุผลในคอมเมนต์ · สิทธิ์ตามบทบาทใช้ `@MinRole(AppRole.X)` · สิทธิ์ตามทรัพยากรตรวจใน service ด้วย `PermissionEvaluator`
4. **ผู้ใช้ปัจจุบัน** รับจาก controller ด้วย `@CurrentUser() user: UserContext` แล้วส่งเข้า service เป็น parameter (ไม่ให้ service ดึงจาก CLS เอง เพื่อเทสต์ง่าย) — ยกเว้นงานเบื้องหลังที่ไม่มีผู้ใช้
5. **SQL**: ใช้ได้ 3 แบบ ตามลำดับความเหมาะสม
   - Stored Procedure ที่มีอยู่แล้ว → `this.sp.call(Sp.<schema>.<name>[, scope.sp]).rows<Row>(input)` (typed จาก `src/database/sp/sp-catalog.generated.ts`; ผลลัพธ์ชื่อคอลัมน์ PascalCase → ใช้ `camelizeKeys`)
   - TypeORM `Repository`/QueryBuilder สำหรับ CRUD ปกติและ query ที่มี filter/paging
   - `dataSource.query('...@0...', [param])` สำหรับ SQL ตรงที่ซับซ้อน — **ต้อง parameterize เสมอ** (`@0,@1`) ห้าม concat ค่าจากผู้ใช้
   - ชื่อคอลัมน์สำหรับ `ORDER BY` ที่มาจาก client ต้องผ่าน whitelist (`applySort`)
6. **Transaction**: งานที่แก้หลายตาราง/หลาย SP ใช้ `this.tx.run(async ({ manager, sp }) => {...})` แล้วส่ง `sp` เป็น option ของ `call(Sp.x, sp)` — error ใน callback = rollback ทั้งหมด
7. **Error**: โยน `BusinessException(message, 'CODE', details?)` สำหรับละเมิดกฎ (422) · `ResourceNotFoundException` (404) · `ConflictBusinessException` (409) · `PermissionDeniedException` (403) — ข้อความเป็นภาษาไทยที่ผู้ใช้อ่านรู้เรื่อง, `code` เป็นภาษาอังกฤษตัวพิมพ์ใหญ่คงที่ (client ใช้แยกกรณี) · RAISERROR/THROW จาก SP ถูกแปลงเป็น 422 อัตโนมัติ
8. **DTO**: `class-validator` ครบทุก field (เปิด `whitelist + forbidNonWhitelisted` อยู่แล้ว) · JSON เป็น camelCase · รายการแบบแบ่งหน้าใช้ `PaginationQueryDto` และคืน `Paginated<T>` · `bigint` ส่งเป็นสตริง · ห้ามส่ง entity ที่มีคอลัมน์ภายใน (rowversion, path เต็มบน share) ออก API ให้ map เป็น DTO
9. **Swagger**: `@ApiTags('<MODULE>')` + `@ApiBearerAuth()` ที่ controller, `@ApiOperation({ summary })` ภาษาไทยที่ทุก handler, ระบุ `@ApiOkResponse({ type })` เมื่อชนิดคืนไม่ชัด
10. **ห้าม** `process.env` ใน service (ใช้ `AppConfigService`) · ห้ามเก็บ secret ในโค้ด · ห้าม `console.log` (ใช้ `Logger` ของ Nest)

## 3. CRUD-log (ทุก service ต้องรองรับ)

```ts
@Injectable()
export class FolderService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;   // AUTH | SHARED | DMS | KMS | RGP | WFE | SYSTEM
  protected readonly logEntity = 'Folder';
  constructor(crudLog: CrudLogService, /* …deps… */) { super(crudLog); }

  rename(id: number, name: string, user: UserContext) {
    return this.logged(
      { action: 'UPDATE', operation: 'RENAME_FOLDER', recordId: id, captureBefore: () => this.get(id) },
      async () => { /* งานจริง — โยน error ได้ ระบบบันทึกเป็น success=false ให้ */ return this.get(id); },
      (result) => ({ after: result }),                 // (ไม่บังคับ) เติม recordId/after จากผลลัพธ์
    );
  }
}
```

| action | ใช้เมื่อ | เก็บเมื่อ `CRUD_LOG_LEVEL` |
|---|---|---|
| `CREATE` `UPDATE` `DELETE` | เปลี่ยนข้อมูล (รวม soft delete, restore, revoke) | `write` (ค่าเริ่มต้น) และ `all` |
| `EXECUTE` | การกระทำเชิงธุรกิจที่ไม่ใช่ CRUD ตรงๆ: approve, reject, share, login, import, download (ที่ต้อง audit) — ใส่ชื่อใน `operation` เช่น `APPROVE_STEP` | `write` และ `all` |
| `READ` | อ่านข้อมูลสำคัญ/ดาวน์โหลดไฟล์/ค้น audit | เฉพาะ `all` |

- **อ่านข้อมูลทั่วไป (list/get) ไม่ต้องห่อ `logged`** ยกเว้นข้อมูลที่ต้องตรวจสอบย้อนหลัง (ดาวน์โหลดไฟล์ ดูเนื้อหา HC)
- งานเปลี่ยนข้อมูลอื่นๆ ที่ legacy เขียน `AuditService.Log(...)` (ดู `docs/reference/legacy-analysis/06-service-use-cases.md` คอลัมน์ Audit) → ต้องมี `logged` ที่ตรงกัน และใส่ชื่อเดิมใน `operation` (เช่น `MOVE_FILE`, `HIDE_FILE`) เพื่อให้เทียบกับรายงานเดิมได้
- `captureBefore` ใช้เมื่อต้องเก็บค่าก่อนแก้ (UPDATE/DELETE) — รันเฉพาะเมื่อเปิด log จึงไม่เสีย query
- ห้ามใส่ความลับใน `meta/before/after` (ระบบ redact key ที่ชื่อ password/token/secret ให้ แต่อย่าพึ่งพา)
- ระบบเก็บ log ใหม่ในอนาคต = implement `CrudLogSink` แล้ว `CrudLogRegistry.register()` — ไม่ต้องแก้ service ใดๆ (ดู `docs/CRUD_LOG.md`)

## 4. การตรวจสิทธิ์

| ชั้น | วิธี |
|---|---|
| บทบาท (AppRole 1–4) | `@MinRole(AppRole.Manager)` บน controller/handler — โค้ดเดิม `AppRole < 3` = ต้อง Manager ขึ้นไป |
| ทรัพยากร (โฟลเดอร์/ไฟล์) | ใน service: `await this.perm.assert(user, folderId, 'Write')` หรือ `canAdd(...)` (`PermissionEvaluator` จาก `PermissionsModule`) |
| ความเป็นเจ้าของ (เช่น เจ้าของ share หรือ Admin) | ตรวจใน service แล้วโยน `PermissionDeniedException` |
| ชั้นความลับ (Authority) | `canViewLevel / canAddToLevel / …` ใน `dms/permissions/authority.util.ts` กับ `user.authority` |

## 5. การเขียนเทสต์ (ต้องรันผ่านโดยไม่มี SQL Server)

- ตำแหน่ง: `test/unit/<module>/<ชื่อ>.spec.ts` · ตัวช่วย: `test/helpers/stubs.ts` (`makeCrudLog`, `fakeUser`, `fakeConfig`), `test/helpers/fake-datasource.ts`
- ทดสอบ service โดยสร้าง instance เองด้วย mock ของ `SpExecutor` / `Repository` / `DataSource` (ดู `test/unit/shared/org-units.service.spec.ts`) แล้วตรวจ 3 อย่าง: (1) กฎธุรกิจ/เงื่อนไขผิดพลาด (2) SP/SQL ถูกเรียกด้วยพารามิเตอร์ที่ถูก (3) CRUD-log ถูกบันทึก (`sink.events`)
- กฎธุรกิจที่เป็นฟังก์ชันล้วน (คำนวณสิทธิ์, สถานะ, ลำดับ) แยกเป็นฟังก์ชัน pure แล้วเทสต์ตรงๆ (ดู `dms/permissions/acl.evaluator.ts`)
- ความจริงที่ต้องยอมรับ: **ไม่มี SQL Server ในเครื่องพัฒนา/CI ของงานนี้** → เทสต์พิสูจน์ได้แค่ตรรกะและการต่อสาย DI, ไม่ได้พิสูจน์ว่า SQL รันถูก — ให้เขียนรายการ "ต้องทดสอบกับ DB จริง" ไว้ใน `docs/modules/<module>.md`

คำสั่ง: `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e` · `npm run build` — **ต้องผ่านทั้งหมดก่อน commit**

## 6. เมื่อเอกสารกับ DB/โค้ดเดิมไม่ตรงกัน

ยึด DDL จริง (`docs/reference/db-export/`) และ SP ที่ export มา แล้ว:
1. ทำตามที่ DB จริงเป็น (เช่น คอลัมน์ที่ไม่มีใน DB ห้ามอ้าง)
2. บันทึกในหัวข้อ "ส่วนที่ต่างจากระบบเดิม / ต้องตัดสินใจ" ของ `docs/modules/<module>.md` พร้อมเหตุผลและทางเลือก
3. ห้ามแก้ไฟล์ของ module อื่น — ถ้าจำเป็นต้องเปลี่ยน core (`src/common`, `src/core`, `src/database`, `tools/`) ให้แจ้งใน `docs/modules/<module>.md` หัวข้อ "ขอแก้ core" แทนการแก้เอง

## 7. ธรรมเนียมอื่นๆ

- ชื่อ route พหูพจน์ kebab-case: `/dms/folders`, `/kms/articles/:id/versions` (ใส่ prefix ชื่อ module ยกเว้น Shared/Auth) · version `v1` ใส่ให้อัตโนมัติ (`/api/v1/...`)
- verb: `GET` อ่าน · `POST` สร้าง/สั่งทำ action · `PATCH` แก้บางส่วน · `PUT` แทนที่ทั้งก้อนหรือ set ค่า · `DELETE` ลบ (soft delete เป็นค่าเริ่มต้น; ลบถาวรให้ใช้ route ชัดเจน เช่น `DELETE /dms/recycle-bin/folders/:id`)
- action ที่ไม่ใช่ CRUD: `POST /dms/approvals/:id/approve` (กริยาท้าย path)
- วันที่เวลา: ISO 8601 ใน JSON · DB เก็บเวลาท้องถิ่น (process ตั้ง TZ=Asia/Bangkok ไว้แล้ว) — ห้ามแปลง timezone เอง
- ไฟล์อัปโหลดใช้ `FileInterceptor` + `diskStorage` (ไม่เก็บทั้งไฟล์ใน memory) ขนาดสูงสุดตาม `STORAGE_MAX_UPLOAD_MB`
