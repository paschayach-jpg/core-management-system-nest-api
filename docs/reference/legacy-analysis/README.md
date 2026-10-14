# เอกสารเตรียมทำ NestJS API (จาก WinForms .NET 4.5 + ADO.NET + SQL Server)

เอกสารชุดนี้รวบรวมสิ่งที่ต้องรู้ก่อนเขียน API แทนระบบ `core-management-system` โดยแยกเป็น 4 module: **DMS, KMS, RGP, WFE** (RGP = Project; ในโค้ดสะกด RGP) + ส่วน **Shared**

> ไฟล์หลักที่ใช้เป็น **tasklist** คือ [`../../NESTJS_API_TASKLIST.md`](../../NESTJS_API_TASKLIST.md) (ราย module → ราย table → ราย repository method)

## ลำดับอ่านที่แนะนำ

| # | ไฟล์ | ใช้ทำอะไร |
|--:|---|---|
| 1 | [`../../NESTJS_API_TASKLIST.md`](../../NESTJS_API_TASKLIST.md) | ภาพรวม ตารางที่ module ใช้ CRUD ลำดับงาน ภาคผนวก (dead code, connection) |
| 2 | [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) | **ปิดให้ครบก่อนเริ่มเขียนโค้ด** — DDL ที่ขาด, คำถามขอบเขต, ข้อบกพร่องในโค้ดเดิม, การตัดสินใจสถาปัตยกรรม |
| 3 | [`04-business-rules.md`](04-business-rules.md) | กฎธุรกิจที่ต้องพอร์ต (สิทธิ์, approval, share, quota, KMS import, RGP progress, WFE) |
| 4 | [`06-service-use-cases.md`](06-service-use-cases.md) | Service method → ตาราง: ใช้ออกแบบ endpoint ระดับ use case + guard/audit ที่สกัดได้ |
| 5 | [`data-dictionary/`](data-dictionary/) | Entity: คอลัมน์ ชนิด PK FK index CHECK จำนวนแถว ต่อ module |
| 6 | [`02-stored-procedures.md`](02-stored-procedures.md) | SP ที่ต้องเรียก/พอร์ต พร้อมพารามิเตอร์และพฤติกรรม |
| 7 | [`03-enums-lookups.md`](03-enums-lookups.md) | Enum และจุดที่โค้ดกับ DB ไม่ตรงกัน |
| 8 | [`05-cross-cutting.md`](05-cross-cutting.md) | Auth, audit, notification, file storage, config, jobs, transaction, cache, integration |

ข้อมูลดิบที่ใช้อ้างอิงอยู่ที่ [`../../db-export/`](../../db-export/) (ผล export จาก DB จริงที่ทีมส่งมา: DDL, FK, index, CHECK, SP definition, SP dependency)

## วิธีจัดทำ (เพื่อให้ตรวจซ้ำได้)

1. อ่านเฉพาะไฟล์ใน `.csproj` แล้วสร้าง call graph จาก `Program.Main` → Form/Controller/Service → Repository ตัด **dead code** (ไม่ถูกเรียกจากเมนู/หน้าจอ) ออก
2. สกัดตาราง/CRUD จาก SQL ใน `CMS.Data/Repositories/*` และจาก **definition จริงของ Stored Procedure** (ไม่เดาจากชื่อ)
3. เทียบกับ DDL จริง (`db-export/`) เพื่อทำ data dictionary
4. อ่าน Service/Domain เพื่อสกัดกฎธุรกิจ; ตาราง Guard/Audit ใน `06-service-use-cases.md` สกัดอัตโนมัติ → **ต้องตรวจซ้ำก่อนใช้**
5. **ข้อจำกัด:** เป็น static analysis ไม่ได้รันโปรแกรมหรือเชื่อม DB; ไม่ได้ครอบคลุมพฤติกรรมที่เกิดจาก trigger/ข้อมูลใน DB ที่ไม่เห็นในโค้ด

## Type mapping (SQL Server → Node/TypeORM)

| SQL Server | TypeScript | หมายเหตุ |
|---|---|---|
| `int`, `smallint`, `tinyint` | `number` | |
| `bigint` | `string` | `mssql`/TypeORM คืนเป็นสตริงเพื่อกัน overflow (`FileSizeBytes`, `FolderSizeBytes`, `AuditID`, `RunningNumber.current_number`) |
| `bit` | `boolean` | RGP ใช้ `char(1)` `'Y'/'N'` แทน bit |
| `varchar`/`nvarchar`/`char` | `string` | `nvarchar(max)` = เนื้อหายาว (`ContentHTML`, JSON) |
| `datetime`, `datetime2`, `date` | `Date` | เวลาที่เก็บเป็น **local time ของ SQL Server** (`GETDATE()`) ในเกือบทุกตาราง ยกเว้นบางคอลัมน์ที่ใช้ `GETUTCDATE()` — ดู OPEN_QUESTIONS B10 |
| `decimal(p,s)` | `string` หรือ decimal lib | |
| `uniqueidentifier` | `string` | `FileGUID`, `FolderGUID` |

## กติกาการใช้เอกสาร

- ถ้าเอกสารขัดกับโค้ดหรือ DB จริง ให้ยึด **โค้ด/DB จริง** แล้วแก้เอกสาร
- ตัวเลขจำนวนแถวมาจากชุด export วันที่ทำเอกสาร (ประมาณ ไม่ใช่ค่าปัจจุบัน)
- สิ่งที่ตั้งธง ⚠ คือพฤติกรรมเดิมที่น่าจะเป็นข้อบกพร่อง — ต้องตัดสินใจ "คงเดิม" หรือ "แก้" ใน `OPEN_QUESTIONS.md` ก่อน
