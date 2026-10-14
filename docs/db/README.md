# สคริปต์ DB ที่ API **เสนอ** (ยังไม่เคยรัน)

> ⚠ ห้ามรันบน production โดยไม่ผ่าน DBA · API ไม่รันสคริปต์ใดเอง (`synchronize` ปิด) · ทุกสคริปต์เขียนให้ idempotent (`IF NOT EXISTS`) และไม่ทำลายข้อมูล
> ที่มาของข้อเสนอ: วิเคราะห์ index ใน `docs/reference/db-export/CMS_DB_1.2_PK_unique_index.csv` เทียบกับ query ที่ API ใช้

| ไฟล์ | เนื้อหา | เหตุผล |
|---|---|---|
| [`001_recommended_indexes.sql`](001_recommended_indexes.sql) | index ที่ขาดในตารางใหญ่/ตารางที่ API ค้นบ่อย | `EMS.Notification` (525,748 แถว) ไม่มี PK/index เลยใน export → inbox ค้นด้วย `RecipientUserId` จะ scan ทั้งตาราง |
