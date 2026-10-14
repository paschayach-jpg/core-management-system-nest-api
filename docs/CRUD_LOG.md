# CRUD-log

**ข้อกำหนดของโครงการ:** ทุก service ต้องรองรับ CRUD-log และต้องต่อระบบเก็บ log ใหม่ได้ในอนาคตโดยไม่แก้ service
สิ่งที่ทำไว้ตอนนี้คือ "สัญญา + ท่อ" ครบ — ส่วน "ที่เก็บถาวร" ตัวใหม่ (ถ้ามี) เพียงเสียบ sink เพิ่ม

```
service ──logged()──▶ CrudLogService ──(เติม actor/requestId, redact, ตัดขนาด)──▶ CrudLogRegistry.sinks[]
                                                                                    ├─ ConsoleCrudLogSink   (pino JSON → stdout)         เปิดเป็นค่าเริ่มต้น
                                                                                    ├─ AuditDbCrudLogSink   (audit.sp_InsertAuditLog)    ปิดเป็นค่าเริ่มต้น
                                                                                    └─ <sink ใหม่ของคุณ>    (ตาราง/ES/Kafka/…)           register ตอน onModuleInit
```

## 1. สัญญาของ event (`CrudLogEvent`)

| field | ความหมาย |
|---|---|
| `timestamp`, `requestId` | เวลาเกิดเหตุ, id คำขอ (ตรงกับ header `x-request-id` และบรรทัด application log) |
| `module` | `AUTH` `SHARED` `DMS` `KMS` `RGP` `WFE` `SYSTEM` |
| `entity` | ทรัพยากร เช่น `Folder`, `KbArticle` (workflow ใช้ `WorkflowInstance`/`WorkflowStepInstance` ให้ตรงกับ audit เดิม) |
| `action` | `CREATE` `READ` `UPDATE` `DELETE` `EXECUTE` |
| `operation` | ชื่อการกระทำเชิงธุรกิจ เช่น `MOVE_FOLDER`, `APPROVE_STEP`, `LOGIN` (ใช้ชื่อ audit เดิมของ WinForms เมื่อมี) |
| `recordId` | id ของระเบียน (ถ้าหลายระเบียนใส่ใน `meta.recordIds`) |
| `before` / `after` | ค่าก่อน/หลังแก้ไข (redact + ตัดขนาดแล้ว) |
| `success`, `errorCode`, `errorMessage`, `durationMs` | ผลลัพธ์ — ล้มเหลวก็ถูกบันทึก (`errorCode` เช่น `HTTP_409`, `SQL_50000`) |
| `actor` | `userId`, `userName`, `appRole`, `ip`, `sessionId`, `userAgent` (ดึงจาก JWT/CLS อัตโนมัติ) |
| `meta` | ข้อมูลประกอบอิสระ |

โครงสร้างนี้คือ **สัญญา** ที่ที่เก็บ log ในอนาคตต้องรองรับ — เพิ่ม field ได้ ห้ามเปลี่ยนความหมาย field เดิม

## 2. การเปิด/ปิด

| ตัวแปร | ค่า | ผล |
|---|---|---|
| `CRUD_LOG_LEVEL` | `off` / `write` (ค่าเริ่มต้น) / `all` | ไม่เก็บ / เก็บเฉพาะ CREATE·UPDATE·DELETE·EXECUTE / รวม READ |
| `CRUD_LOG_CONSOLE` | `true` (ค่าเริ่มต้น) | เขียนเป็น JSON ผ่าน pino |
| `CRUD_LOG_AUDIT_DB` | `false` (ค่าเริ่มต้น) | เขียนลง `audit.AuditLog` ผ่าน SP เดิม (Result 1=สำเร็จ, 2=ล้มเหลว) |
| `CRUD_LOG_MAX_PAYLOAD_CHARS` | 8000 | ตัด `before/after/meta` ที่ใหญ่เกินกำหนด |

คุณสมบัติที่รับประกัน (มีเทสต์ใน `test/unit/crud-log*.spec.ts`):
- **ไม่ทำให้คำขอล้ม** — sink พัง/ช้า ไม่กระทบผู้ใช้ (เขียนแบบ fire-and-forget, จับ error แล้วลง application log)
- **ไม่ block** — มีตัวนับงานค้าง; `onApplicationShutdown` รอเขียนให้เสร็จก่อนปิดโปรเซส
- **ไม่รั่วความลับ** — key ที่ชื่อ password/token/secret/authorization/cookie ถูกแทนด้วย `[REDACTED]` ทุกชั้นของ object
- **ไม่เสียค่าใช้จ่ายเมื่อปิด** — `captureBefore` (query ค่าก่อนแก้) ไม่ทำงานเมื่อ level ปิด action นั้น

## 3. วิธีให้ service รองรับ CRUD-log

ดูตัวอย่างเต็มใน [CONVENTIONS §3](CONVENTIONS.md#3-crud-log-ทุก-service-ต้องรองรับ) · สรุป:

```ts
@Injectable()
export class XService extends CrudLoggedService {           // ← บังคับ (test/architecture ตรวจ)
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'Folder';
  constructor(crudLog: CrudLogService /* , … */) { super(crudLog); }

  doSomething(id: number) {
    return this.logged({ action: 'UPDATE', operation: 'RENAME_FOLDER', recordId: id, captureBefore: () => this.get(id) },
                       async () => { /* งานจริง */ });
  }
}
```
ตารางสำเร็จรูป (master/lookup) ใช้ `EntityCrudService<E>` — list/get/create/update/remove พร้อม CRUD-log (เก็บ before/after) ในตัว

## 4. เพิ่มระบบเก็บ log ใหม่ในอนาคต (ไม่ต้องแก้ service)

```ts
// 1) implement สัญญา
@Injectable()
export class ElasticCrudLogSink implements CrudLogSink {
  readonly name = 'elastic';
  async write(e: CrudLogEvent) { await this.client.index({ index: 'crud-log', document: e }); }
  async flush() { /* ล้าง buffer ถ้ามี */ }
}

// 2) ลงทะเบียนใน module ของตัวเอง (CrudLogModule เป็น @Global)
@Module({ providers: [ElasticCrudLogSink] })
export class CrudLogElasticModule implements OnModuleInit {
  constructor(private readonly registry: CrudLogRegistry, private readonly sink: ElasticCrudLogSink) {}
  onModuleInit() { this.registry.register(this.sink); }
}
// 3) เพิ่ม CrudLogElasticModule ใน AppModule.imports
```
ถ้าจะเก็บลง "ตารางใหม่ของ CRUD-log" โดยตรง: สร้างตาราง (สคริปต์ DDL ผ่านทีม DBA), เขียน sink ที่ INSERT แบบ batch (รวม event หลายรายการต่อการเขียน 1 ครั้ง เพื่อลดภาระ DB), และปิด `CRUD_LOG_AUDIT_DB`

## 5. ข้อควรรู้

- ชื่อ `Module`/`Action` ที่ API ใหม่เขียนลง `audit.AuditLog` เป็นชุดใหม่ (`DMS`, `UPDATE`, `MOVE_FOLDER` …) **ไม่ตรงกับชุดเดิมของ WinForms** (`FileSharing`, `OrgMaster`, …) — รายงาน audit เดิมที่กรองตามชื่อเดิมจะไม่เห็นรายการของ API (ใช้ `operation` ตรงกับชื่อ Action เดิมเพื่อช่วยเทียบ) · ตัดสินใจเรื่อง mapping ได้ที่ `AuditDbCrudLogSink`
- `RecordID` ใน `audit.AuditLog` เป็น `int` — id ที่ไม่ใช่ int (เช่น key ข้อความ, bigint) จะถูกใส่ใน `NewValue` (JSON) แทน
- RGP มีตาราง audit ของตัวเอง (`RGP.t_project_audit_log`) ซึ่งรายงานเดิมอ่านอยู่ — module RGP จึงเขียนทั้งสองทาง (ดู [docs/modules/rgp.md](modules/rgp.md))
- การอ่าน (`READ`) ปิดเป็นค่าเริ่มต้นเพราะปริมาณมาก — เปิด `all` เมื่อมีข้อกำหนดตรวจสอบการเข้าถึง (เช่น PDPA) และควรใช้ที่เก็บที่รองรับปริมาณ
