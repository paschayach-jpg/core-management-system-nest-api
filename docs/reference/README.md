# เอกสารอ้างอิงจากระบบเดิม

โฟลเดอร์นี้คือ **สำเนาเอกสารวิเคราะห์ระบบเดิม** (WinForms .NET 4.5 + ADO.NET) ที่ใช้เป็นต้นทางของ API นี้ — อัปเดตล่าสุด 2026-10-14
ต้นฉบับอยู่ที่ repo `paschayach-jpg/core-management-system` (branch `popnahaff`: `docs/nestjs-api/`, `NESTJS_API_TASKLIST.md`, `db-export/`)

| โฟลเดอร์ | เนื้อหา |
|---|---|
| [`legacy-analysis/`](legacy-analysis/README.md) | tasklist ราย module, กฎธุรกิจ, use case ของ service, แคตตาล็อก SP, enum, คำถามค้าง (`OPEN_QUESTIONS.md`), data dictionary |
| [`db-export/`](db-export) | ผล export จาก DB จริง: DDL (คอลัมน์/PK/FK/CHECK), นิยาม Stored Procedure, dependency — **เป็นแหล่งความจริงของโครงสร้าง DB** และเป็นอินพุตของ `npm run codegen` |

> ถ้าเอกสารกับ DB จริงขัดกัน ให้ยึด DB จริง — และเมื่อ DB เปลี่ยน ให้ export ใหม่แล้วรัน `npm run codegen` (ดู [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) หัวข้อ codegen)
