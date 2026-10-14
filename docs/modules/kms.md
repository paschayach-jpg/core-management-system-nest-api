# KMS — สรุปการพัฒนา

> **หมายเหตุที่มา:** ส่วนโค้ดของ KMS เขียนโดย agent ผู้พัฒนาแต่ไม่ได้ส่งเอกสารหรือรายงานสรุปมาด้วย — เอกสารนี้เขียนโดยผู้รวมงานจาก **โค้ด, OpenAPI, ค่าคงที่ในโค้ด และชื่อเทสต์** เท่านั้น
> ส่วนที่ระบุว่า "ยังไม่ได้ตรวจ" คือยังไม่ได้ทบทวนทีละบรรทัดเทียบกับกฎใน `AGENTS.md` (หัวข้อ KMS Import ของ repo `core-management-system`) · ยังไม่มีสิ่งใดรันกับ SQL Server จริง

## 1. Endpoint ที่ให้บริการ (65 operation ใต้ `/api/v1/kms/...`)

| กลุ่ม | จำนวน | สิทธิ์ | รายละเอียดหลัก |
|---|--:|---|---|
| หมวดหมู่ `/categories` | 9 | อ่าน: ทุกคนที่ login · เขียน: Manager+ | ต้นไม้หมวดไม่จำกัดความลึก (พร้อม depth/path), summary จำนวนบทความต่อหมวด (รวมหมวดย่อย), titles ของหมวดสำหรับ KB tree, ผูก/ยกเลิก Display Profile, ค่าแสดงผลที่มีผลจริง (สืบจากหมวดแม่), ปิดใช้งาน |
| บทความ `/articles` | 13 | อ่าน/สร้าง/แก้/ส่ง Review: ทุกคนที่ login · publish/archive/ลบ: Manager+ | ค้น+แบ่งหน้า (กรองหมวด+ลูก/สถานะ/ประเภท/ข้อความ), by-code, **`code-analysis`** (ตรวจ Code รวม 29 ตัวก่อนสร้าง), สร้าง (Draft + version 1), แก้ (whitelist), submit-review / publish / archive, ลบแบบ soft delete (ลบ link สองทาง), ตั้งวันหมดอายุ, นับ view / like |
| เวอร์ชัน | 2 | login | ประวัติ version และเนื้อหาของ version ที่ระบุ |
| บทความที่เกี่ยวข้อง/links | 5 | login | ผูก/ยกเลิก/ตั้งทั้งชุด (สองทาง, ชนิด Law=4) และดู link ทั้งหมดกรองตามชนิด |
| ไฟล์แนบบทความ | 5 | login (ไฟล์ตรวจสิทธิ์ที่ DMS) | อัปโหลดเข้า DMS แล้วผูก (สูงสุด 20 ไฟล์/คำขอ), แทนที่ทั้งชุด (ระวัง), ถอด 1 ไฟล์ (ไฟล์ใน DMS คงอยู่), ดาวน์โหลด |
| ย้ายบทความ `/article-moves` | 3 | Manager+ | preview (คำเตือน) → candidates → ย้าย (เปลี่ยนเฉพาะ `CategoryID`, ไม่สร้าง version; มีคำเตือนต้องส่ง `confirmWarnings=true` ไม่งั้น 409) |
| Display Profile | 8 | อ่าน: login · เขียน: Manager+ | slot คงที่, CRUD (แทนที่ค่า slot ทั้งชุด), activate/deactivate, หมวดที่ผูกอยู่ |
| Import Template | 8 | อ่าน: login · เขียน: Manager+ | grid mapping, options (LayoutType/ArticleType), ตรวจความครบ (`problems`), activate/deactivate |
| งานนำเข้า Excel `/imports` | 9 | Manager+ | อัปโหลด+ตรวจ (ไม่เขียน DB) → ดูผลรายแถว → เติมไฟล์แนบทยอยได้ → `execute` (202, รันเบื้องหลังทีละงาน) → ติดตามสถานะ → cancel/delete |
| Dashboard | 3 | login | stats ตามสถานะ/ประเภท/ใกล้หมดอายุ/เลยกำหนดทบทวน, รายเดือน (12 เดือน เติม 0), top บทความที่เปิดอ่านมากสุด (ระบบเดิมเป็น mock — นี่คือ query จริงจาก `KMS.t_KBArticle`) |

รายละเอียด request/response ทุกตัว: `/docs` (Swagger) หรือ `npm run openapi:export`

## 2. กฎธุรกิจที่พอร์ตมา (ไฟล์)
| กฎ | ไฟล์ |
|---|---|
| วิเคราะห์ Code รวม 29 ตัว → ชนิด Law/Decree/NonLaw, ชื่อ "มาตรา N", หมวดที่คำนวณได้, หา parent | `codes/kb-article-code-analyzer.ts`, `codes/kb-layout.ts` |
| เลือก CategoryID จากรหัส (หมวดรายปี Law/NonLaw, Decree ผ่าน LawReference) | `codes/kb-category-resolver.ts` |
| ต้นไม้หมวดไม่จำกัดความลึก | `codes/kb-category-tree.ts` |
| วงจรสถานะ Draft→Review→Published→Archived (Archived แก้/เปลี่ยนไม่ได้) | `articles/article-status.ts` |
| กฎหมวด (ImportTypeDigit unique 1–9 ห้ามอยู่ใต้ LW, ห้ามเป็นหมวดแม่ของตัวเอง, `CategoryID` ตาม IDENTITY/MAX+1) | `categories/category-rules.ts` |
| กฎ Template (ต้อง map ArticleCode; NonLaw ต้อง map Title/ContentHTML/Attachment; Decree ต้อง map LawReference) | `import-templates/kb-template-rules.ts` |
| คำเตือนการย้ายบทความ | `moves/move-warnings.ts` |
| อ่าน Excel ด้วย `exceljs`, ตีความ `{A}`, ไม่ trim ข้อความ, แปลงข้อความ→HTML, ตรวจรายแถว, เขียนต่อบทความแบบอะตอมมิก, cache ไฟล์แนบที่ใช้ร่วมกัน | `import/kb-excel-reader.ts`, `kb-text.ts`, `kb-import-validator.ts`, `kb-import-writer.ts`, `kb-shared-file-cache.ts`, `kb-import-pipeline.ts` |

ชื่อ audit เดิมใส่เป็น `operation` ตามระบบเดิม: `CREATE_KB_ARTICLE`, `UPDATE_KB_ARTICLE`, `DELETE_KB_ARTICLE`, `SUBMIT_REVIEW`, `PUBLISH`, `ARCHIVE`, `ATTACH_FILE`, `MOVE_KB_ARTICLE` ฯลฯ (`kms.constants.ts`)

## 3. ส่วนที่ต่างจากระบบเดิม / ต้องตัดสินใจ
| # | เรื่อง | ระบบเดิม | API นี้ | เหตุผล / ทางเลือก |
|---|---|---|---|---|
| K-01 | **สิทธิ์** | service ไม่ตรวจ role เลย เชื่อ UI (OPEN_QUESTIONS C13) | บังคับที่ API: แก้ master (หมวด/Template/Profile), publish/archive, ลบ, ย้าย, import = **Manager+**; อ่าน/สร้าง/แก้บทความ/ส่ง Review = ทุกคนที่ login | ปรับระดับที่เดียวใน `kms.constants.ts` (`KMS_ROLE`) · ❓ ให้เจ้าของระบบยืนยัน |
| K-02 | **import ต้องส่งไฟล์ผ่าน HTTP** | เลือกโฟลเดอร์ PDF ในเครื่องผู้ใช้ | อัปโหลด Excel + ไฟล์แนบ (เพิ่มไฟล์แนบทยอยได้หลายครั้ง ครั้งละไม่เกิน 200 ไฟล์) เป็น "งาน" ที่ตรวจก่อนแล้วค่อยสั่ง `execute` | API เปิดโฟลเดอร์ในเครื่องผู้ใช้ไม่ได้ |
| K-03 | **สถานะงาน import เก็บใน memory** | — | ทะเบียนงานในโปรเซส (ตรวจแล้วค้างได้ 2 ชม., จบแล้ว 24 ชม., สูงสุด 30 งาน, รันได้ทีละงาน) — **สูญเมื่อ restart และไม่รองรับหลาย instance** | ข้อจำกัดที่ยอมรับชั่วคราว → เก็บในตาราง/Redis ตาม RECOMMENDATIONS O-03 |
| K-04 | **โฟลเดอร์ DMS ปลายทางของไฟล์แนบ** | ฝังเลข `437` (import) และ `1` (editor) ในโค้ด | ส่ง `dmsFolderId` มากับคำขอ หรืออ่านค่าตั้งระบบ `KMS_IMPORT_ATTACHMENT_FOLDER_ID` / `KMS_ARTICLE_ATTACHMENT_FOLDER_ID` ใน `dbo.SystemConfig` | ❓ ต้องตั้งค่า key เหล่านี้ (ไม่มีตัวสร้างค่าเริ่มต้น) และกำหนดว่าสองกรณีใช้โฟลเดอร์เดียวกันหรือไม่ (เดิมยังไม่ลงรอยกัน) |
| K-05 | **ไฟล์แนบเข้า DMS** | เรียก `FileService` ตรง | ผ่าน port `DMS_FILE_PORT` เท่านั้น; ถ้า DMS ไม่พร้อม → 503 `DMS_UNAVAILABLE` | ดู `src/modules/dms/ports/dms-file.port.ts` |
| K-06 | **Dashboard** | mock | query จริง (จำนวนตามสถานะ/ประเภท, รายเดือน, top views) | ❓ นิยามตัวเลข (เช่น "ใกล้หมดอายุ" กี่วัน) ให้เจ้าของระบบยืนยัน |

## 4. ยังไม่ได้ทำ / ยังไม่ได้ตรวจ
| เรื่อง | สถานะ |
|---|---|
| ทบทวนกฎ import ทีละข้อเทียบ `AGENTS.md` (29 ตัวอักษร, หมวดรายปี, re-upload=update ตาม whitelist `ImportUpdatableColumns`, text fidelity, NonLaw 1 code = 1 row, ไม่แตะ `ArticleCode`/`CategoryID` ตอน update) | ❌ ยังไม่ได้ทบทวนโดยผู้รวมงาน — เทสต์ของ agent ครอบคลุมชื่อกรณีเหล่านี้ (`test/unit/kms/`) แต่ควรให้คนที่รู้กฎเดิมอ่านซ้ำ |
| ตัวสร้างค่าเริ่มต้นของ `KMS_*_FOLDER_ID` ใน `dbo.SystemConfig` | ❌ ยังไม่มี |
| สิทธิ์ระดับบทความตามชั้นความลับ (`ConfidentialityLevel`) และการกรองตาม Authority ผู้ใช้ | ❌ โค้ด KMS มีเพียงเก็บ/ส่งค่า `confidentialityLevel` ไม่มีการกรองตามชั้นความลับหรือ Authority ของผู้ใช้ตอนอ่าน — ต้องยืนยันกับเจ้าของระบบว่าระบบเดิมบังคับหรือไม่ |
| ค้นข้อความเต็ม (Full-Text) บน `ContentHTML` | ❌ ใช้ LIKE (ดู RECOMMENDATIONS D-07) |
| index `KMS.t_KBArticle(CategoryID, IsDelete, Status)` และ `t_KBArticleLink(EntityType, EntityID)` | ข้อเสนออยู่ใน `docs/db/001_recommended_indexes.sql` (ยังไม่เคยรัน) |

## 5. ต้องทดสอบกับ SQL Server จริง
1. สร้างบทความ/ค้นหา/แบ่งหน้า (`OFFSET/FETCH`, ค้นด้วย LIKE) และชื่อคอลัมน์จริงของ `KMS.t_KBArticle` (รวม `IsDelete`, ความยาว `ArticleCode` = 29 หลังสคริปต์ 12)
2. `CategoryID` ของ `KMS.m_KBCategory`: ตรวจกรณี IDENTITY และไม่ใช่ IDENTITY (MAX+1 ใน transaction Serializable) พร้อมกันหลาย request
3. import ไฟล์จริงขนาดหลายพันแถว: ความเร็ว, transaction ต่อแถว, update ตัวที่มีอยู่แล้ว (version ใหม่เฉพาะ ContentHTML ต่าง), รหัสที่ถูกลบ (soft) ต้องเป็น Error, หมวดรายปีที่ยังไม่มี → MissingCategory
4. ไฟล์แนบ: ชื่อไฟล์ไทย, ไฟล์ซ้ำชื่อหลายมาตรา (FileID เดียว), ไฟล์ที่มีใน DMS แล้ว (ห้ามสร้าง `copy(N)`), เมื่อ DMS ล่ม
5. ย้ายบทความ: คำเตือนข้ามชนิด Law↔NonLaw, หมวดที่มีลูกรายปี, `LW` root
6. ลบบทความ: link สองทางถูกลบจริง; `KMS.t_KBArticleLink` unique `(ArticleID, EntityType, EntityID)`
7. Dashboard: ตัวเลขตรงกับการนับจากตารางโดยตรง

## 6. ขอแก้ core
ไม่มี
