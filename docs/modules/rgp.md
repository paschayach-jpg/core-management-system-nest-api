# RGP (โครงการ / Project) — สรุปการพัฒนา

> module `src/modules/rgp/**` · prefix `/rgp/...` · **77 endpoint** · เทสต์ `test/unit/rgp/**` (15 ไฟล์ ไม่ต้องมี DB)
> อ้างอิงระบบเดิม: `docs/reference/legacy-analysis/` (06-service-use-cases.md หัวข้อ `Project*Service`, 04-business-rules.md)

โครงสร้างโฟลเดอร์: `common/` (กฎล้วน, SQL helper, mapper) · `running-number/` · `audit/` · `projects/` · `states/` · `progress/` · `tasks/` · `documents/` · `members/` · `templates/` · `lookups/` · `attachments/`
ทุก service `extends CrudLoggedService` (`logModule = 'RGP'`) และทุกการเปลี่ยนแปลงผ่าน `this.logged(...)` ด้วยชื่อ operation แบบเดียวกับระบบเดิม (เช่น `CREATE_PROJECT`, `UPDATE_PROJECT_TASK_STATUS`, `GENERATE_RUNNING_NUMBER`)

## 1. Endpoint ที่ให้บริการ

สิทธิ์: `login` = ผู้ใช้ที่ login แล้วทุกคน (JwtAuthGuard global) · `Manager+` = `@MinRole(AppRole.Manager)` ขึ้นไป · **ไม่มี `@Public()` ใน module นี้**

| Method | Path | สิทธิ์ | คำอธิบาย / อ้างอิง use case เดิม |
|---|---|---|---|
| **โครงการ** (10) | | | อ้างอิง: ProjectService |
| GET | `/rgp/projects` | login | ค้นหาโครงการ (แบ่งหน้า) พร้อมสรุปความคืบหน้า |
| GET | `/rgp/projects/check-no` | login | ตรวจว่าเลขที่โครงการนี้มีผู้ใช้แล้วหรือไม่ |
| GET | `/rgp/projects/reference-candidates` | login | โครงการที่เลือกเป็นโครงการอ้างอิงของขั้นตอนได้ (ยังไม่ Completed) |
| GET | `/rgp/projects/:projectId` | login | รายละเอียดโครงการ พร้อมขั้นตอน เอกสาร และบุคคลที่เกี่ยวข้อง |
| POST | `/rgp/projects` | login | สร้างโครงการ (สถานะ Open) พร้อมขั้นตอน/เอกสาร/บุคคลใน transaction เดียว — ไม่ระบุเลขที่ = ออกเลขอัตโนมัติ |
| PATCH | `/rgp/projects/:projectId` | login | แก้ไขข้อมูลหัวโครงการ (ชื่อ/ประเภท/รายละเอียด/วันที่) |
| PUT | `/rgp/projects/:projectId/legal-dict` | login | บันทึก JSON พจนานุกรมกฎหมาย (เฉพาะโครงการประเภทพจนานุกรมกฎหมาย) |
| DELETE | `/rgp/projects/:projectId` | login | ลบโครงการ (soft delete) — บล็อกถ้ามีความคืบหน้าแล้ว · ผู้สร้างหรือ Manager ขึ้นไป |
| POST | `/rgp/projects/:projectId/close` | Manager+ | ปิดโครงการ → Completed (ต้องไม่มีขั้นตอนที่จำเป็นค้างอยู่) |
| POST | `/rgp/projects/:projectId/recalculate-status` | login | คำนวณสถานะโครงการใหม่จากสถานะขั้นตอน (Open/InProgress/Completed) |
| **ขั้นตอน (State) และผู้เกี่ยวข้องของขั้นตอน** (11) | | | อ้างอิง: ProjectStateService |
| GET | `/rgp/projects/:projectId/states` | login | ขั้นตอนของโครงการ พร้อม % ล่าสุดและโครงการอ้างอิง (เรียงตามลำดับ) |
| POST | `/rgp/projects/:projectId/states` | login | เพิ่มขั้นตอนต่อท้ายโครงการ (สถานะเริ่ม Pending) |
| PUT | `/rgp/projects/:projectId/states/order` | login | จัดลำดับขั้นตอนใหม่ (ส่งคู่ stateId/seqNo ทั้งชุด) |
| GET | `/rgp/projects/:projectId/estimated-days` | login | วันคาดการณ์ที่ใช้ไป/เหลือของโครงการ (ไม่นับขั้นตอนที่ระบุใน excludeStateId) |
| GET | `/rgp/states/:stateId` | login | รายละเอียดขั้นตอน |
| PATCH | `/rgp/states/:stateId` | login | แก้ไขขั้นตอน (ชื่อ/ลำดับ/จำเป็นหรือไม่/จำนวนวัน/โครงการอ้างอิง) |
| DELETE | `/rgp/states/:stateId` | login | ลบขั้นตอน (ลบจริง) — บล็อกถ้ามีประวัติความคืบหน้า/Task อ้างอิง |
| GET | `/rgp/states/:stateId/members` | login | ผู้เกี่ยวข้องของขั้นตอน พร้อมจำนวนครั้งที่ส่งแจ้งเตือน |
| POST | `/rgp/states/:stateId/members` | login | เพิ่มผู้เกี่ยวข้องของขั้นตอน (เลือกจากบุคคลในโครงการ ห้ามซ้ำ) |
| DELETE | `/rgp/state-members/:stateMemberId` | login | ลบผู้เกี่ยวข้องออกจากขั้นตอน (ลบไม่ได้ถ้าเคยส่งแจ้งเตือนแล้ว) |
| POST | `/rgp/state-members/:stateMemberId/notify` | login | ส่งแจ้งเตือนผู้เกี่ยวข้อง (เฉพาะประเภทพนักงาน) พร้อมสร้าง/ใช้ Task ติดตามของขั้นตอน |
| **ความคืบหน้า** (3) | | | อ้างอิง: ProjectProgressService |
| GET | `/rgp/projects/:projectId/progress` | login | ความคืบหน้าล่าสุดต่อขั้นตอน + % รวมของโครงการ |
| GET | `/rgp/states/:stateId/progress` | login | ประวัติความคืบหน้าของขั้นตอน (ใหม่สุดก่อน) |
| POST | `/rgp/states/:stateId/progress` | login | บันทึกความคืบหน้าของขั้นตอน → ตั้งสถานะขั้นตอนตาม % → คำนวณสถานะโครงการใหม่ |
| **Task และ Comment** (11) | | | อ้างอิง: ProjectTaskService |
| GET | `/rgp/projects/:projectId/tasks` | login | Task ทั้งหมดของโครงการแบบต้นไม้ (รวม sub task ทุกระดับ) สำหรับ Kanban/Dashboard |
| GET | `/rgp/states/:stateId/tasks` | login | Task หลักของขั้นตอน (ไม่รวม sub task) · includeDeleted=true รวมที่ถูกลบ |
| POST | `/rgp/states/:stateId/tasks` | login | สร้าง Task ในขั้นตอน (ส่ง parentTaskId = สร้าง sub task) — รหัส Task ออกอัตโนมัติ (TK) |
| GET | `/rgp/tasks/:taskId` | login | รายละเอียด Task |
| PATCH | `/rgp/tasks/:taskId` | login | แก้ไขรายละเอียด Task (ไม่รวมสถานะ/%) |
| PATCH | `/rgp/tasks/:taskId/status` | login | เปลี่ยนสถานะ/% ของ Task (OnHold ตรึง % เดิม) → sync % ของขั้นตอนจากค่าเฉลี่ย Task → คำนวณสถานะโครงการ |
| DELETE | `/rgp/tasks/:taskId` | login | ลบ Task (soft delete → ถังขยะ 30 วัน) |
| GET | `/rgp/tasks/:taskId/status-log` | login | ประวัติการเปลี่ยนสถานะของ Task (ใหม่สุดก่อน) |
| GET | `/rgp/tasks/:taskId/comments` | login | Comment ของ Task (เก่าสุดก่อน, ตอบกลับซ้อนได้ 3 ระดับ) |
| POST | `/rgp/tasks/:taskId/comments` | login | เพิ่ม comment หรือตอบกลับ comment เดิม |
| DELETE | `/rgp/task-comments/:commentId` | login | ลบ comment (soft delete) — เฉพาะ comment ของตัวเอง |
| **เอกสารใน workflow** (7) | | | อ้างอิง: ProjectDocumentService |
| GET | `/rgp/projects/:projectId/documents` | login | เอกสารของโครงการทุกขั้นตอน (เรียงตามลำดับขั้นตอน/เอกสาร) |
| GET | `/rgp/states/:stateId/documents` | login | เอกสารของขั้นตอน |
| POST | `/rgp/states/:stateId/documents` | login | เพิ่มเอกสารต่อท้ายขั้นตอน (สถานะเริ่ม Pending) |
| GET | `/rgp/documents/:docWfId` | login | รายละเอียดเอกสารใน workflow |
| PATCH | `/rgp/documents/:docWfId` | login | แก้ไขเอกสาร (ชื่อ/ประเภท/จำเป็น/สถานะ/หมายเหตุ/ลำดับ/ย้ายขั้นตอน) |
| PATCH | `/rgp/documents/:docWfId/status` | login | เปลี่ยนสถานะเอกสาร (Pending/Received/Verified/Rejected) |
| DELETE | `/rgp/documents/:docWfId` | login | ลบเอกสารออกจาก workflow (ลบจริง) |
| **บุคคลที่เกี่ยวข้อง และบทบาท** (7) | | | อ้างอิง: ProjectService (member/role) |
| GET | `/rgp/projects/:projectId/members` | login | บุคคลที่เกี่ยวข้องของโครงการ |
| POST | `/rgp/projects/:projectId/members` | login | เพิ่มบุคคลที่เกี่ยวข้อง (คณะกรรมการ/ฝ่าย/แผนก/พนักงาน) พร้อมบทบาท — ชื่ออ่านจากฐานข้อมูล ไม่เชื่อค่าจาก client |
| DELETE | `/rgp/project-members/:memberId` | login | ลบบุคคลที่เกี่ยวข้องออกจากโครงการ |
| GET | `/rgp/member-roles` | login | บทบาทของบุคคลที่เกี่ยวข้อง (activeOnly=true สำหรับ dropdown) |
| POST | `/rgp/member-roles` | Manager+ | เพิ่มบทบาท |
| PATCH | `/rgp/member-roles/:roleId` | Manager+ | แก้ไขชื่อ/เปิด-ปิดบทบาท |
| DELETE | `/rgp/member-roles/:roleId` | Manager+ | ลบบทบาท (ลบจริง — สมาชิกที่บันทึกไปแล้วเก็บชื่อบทบาทเป็นข้อความ จึงไม่กระทบ) |
| **Template ประเภทโครงการ** (15) | | | อ้างอิง: ProjectService.GetTemplates + template repo |
| GET | `/rgp/templates` | login | Template ประเภทโครงการ พร้อมจำนวนขั้นตอน/โครงการ (activeOnly=true สำหรับ dropdown) |
| POST | `/rgp/templates` | Manager+ | สร้าง Template |
| GET | `/rgp/templates/:templateId` | login | รายละเอียด Template พร้อมขั้นตอนและเอกสาร |
| GET | `/rgp/templates/:templateId/blueprint` | login | ขั้นตอน+เอกสารของ Template ในรูปแบบเดียวกับ body สร้างโครงการ (ดึงไปแก้ก่อนบันทึกได้) |
| GET | `/rgp/templates/:templateId/states` | login | ขั้นตอนของ Template (เรียงตามลำดับ) |
| PATCH | `/rgp/templates/:templateId` | Manager+ | แก้ไข Template (รหัสต้องไม่ซ้ำ) |
| DELETE | `/rgp/templates/:templateId` | Manager+ | ลบ Template พร้อมขั้นตอนและเอกสาร — บล็อกถ้ามีโครงการใช้อยู่ |
| POST | `/rgp/templates/:templateId/copy-states` | Manager+ | คัดลอกขั้นตอนจาก Template อื่นมาแทนที่ขั้นตอนเดิมทั้งหมด (เอกสารของ Template นี้ถูกลบ) |
| POST | `/rgp/templates/:templateId/states` | Manager+ | เพิ่มขั้นตอนใน Template |
| PATCH | `/rgp/template-states/:stateId` | Manager+ | แก้ไขขั้นตอนของ Template |
| DELETE | `/rgp/template-states/:stateId` | Manager+ | ลบขั้นตอนของ Template (ต้องไม่มีเอกสารผูกอยู่) |
| GET | `/rgp/template-states/:stateId/docs` | login | เอกสารของขั้นตอนใน Template |
| POST | `/rgp/template-states/:stateId/docs` | Manager+ | ผูกเอกสารมาสเตอร์เข้ากับขั้นตอนของ Template (ห้ามซ้ำ) |
| PATCH | `/rgp/template-docs/:templateDocId` | Manager+ | แก้ไขเอกสารของ Template |
| DELETE | `/rgp/template-docs/:templateDocId` | Manager+ | ลบเอกสารออกจากขั้นตอนของ Template |
| **ไฟล์แนบ (ผ่าน DMS_FILE_PORT)** (5) | | | อ้างอิง: ProjectAttachmentService |
| GET | `/rgp/projects/:projectId/attachments` | login | ไฟล์แนบของโครงการ (ใหม่สุดก่อน) |
| POST | `/rgp/projects/:projectId/attachments/upload` | login | อัปโหลดไฟล์ใหม่เข้า DMS แล้วแนบกับโครงการ (folderId ไม่ระบุ = โฟลเดอร์ระดับ 4 ตาม config) |
| POST | `/rgp/projects/:projectId/attachments` | login | แนบไฟล์ที่มีอยู่แล้วใน DMS เข้ากับโครงการ (ต้องมีสิทธิ์อ่านไฟล์นั้น) |
| GET | `/rgp/projects/:projectId/attachments/:fileId/download` | login | ดาวน์โหลดไฟล์แนบ (ตรวจสิทธิ์ผ่าน DMS) |
| DELETE | `/rgp/projects/:projectId/attachments/:fileId` | login | ยกเลิกการแนบไฟล์กับโครงการ (ไฟล์ยังอยู่ใน DMS) |
| **Audit** (2) | | | อ้างอิง: ProjectAuditService |
| GET | `/rgp/audit` | Manager+ | ค้นบันทึก audit ของ RGP (แบ่งหน้า ใหม่สุดก่อน) |
| GET | `/rgp/projects/:projectId/audit` | Manager+ | บันทึก audit ของโครงการ (รวมขั้นตอนและ Task ของโครงการ) |
| **Lookup (อ่านอย่างเดียว)** (6) | | | อ้างอิง: lookup ใน Frm_* (EMS/BUI_RG) |
| GET | `/rgp/lookups/employees` | login | พนักงานที่ยังทำงานอยู่ (ชื่อผู้ใช้ AD) สำหรับเลือกผู้รับผิดชอบ/บุคคลที่เกี่ยวข้อง |
| GET | `/rgp/lookups/sub-committees` | login | คณะกรรมการ (EMS.m_SubCommittee) ที่ใช้งานอยู่ |
| GET | `/rgp/lookups/divisions` | login | ฝ่าย (EMS.m_Division) ที่ใช้งานอยู่ |
| GET | `/rgp/lookups/departments` | login | แผนก (EMS.m_Department) ที่ใช้งานอยู่ |
| GET | `/rgp/lookups/master-documents` | login | เอกสารมาสเตอร์ (BUI_RG.dbo.m_document) — กรองตามประเภทได้ |
| GET | `/rgp/lookups/master-document-types` | login | ประเภทเอกสารมาสเตอร์ (BUI_RG.dbo.m_document_type) |

## 2. กฎธุรกิจที่พอร์ตมา (พร้อมไฟล์ที่ทำ)

### เลขที่รันนิ่ง (`running-number/`)
- `PRJ` (เลขโครงการ) และ `TK` (รหัส Task) อ่านจาก `dbo.RunningNumber` บนฐาน **'project' (BUI_RG)** ด้วย `SELECT ... WITH (UPDLOCK, ROWLOCK)` แล้ว `UPDATE` ใน transaction เดียวกับงานสร้าง — สองคำขอพร้อมกันจึงไม่ได้เลขซ้ำ
- รูปแบบตาม `prefix` + `format` ของแถว (token `YY`/`YYYY`/`MM`/`NNNN...`) · เลขวิ่งต่อเนื่องและ **reset เมื่อขึ้นปีใหม่** (เทียบ `Year_UW`) · ยาวเกิน 20 ตัวอักษร (ขนาดคอลัมน์ `c_project_no`) → ปฏิเสธ
- ฟังก์ชันล้วน `formatRunningNumber`, `computeNextRunningNumber` (`running-number.util.ts`) — บริการ `RunningNumberService.next(manager, type, now)` ใช้กับ manager ที่อยู่ใน transaction ของ DataSource 'project'
- สร้างโครงการ = transaction ซ้อนข้ามฐาน: ชั้นนอกบน 'project' (ล็อกแถวเลข) ครอบชั้นในบนฐานหลัก (ข้อมูลโครงการ) — ล้มทั้งสองชั้น rollback ทั้งคู่ **ไม่เกิดช่องว่างของเลข** · มี retry 3 ครั้งกรณีเลขชนกันจากลำดับ commit (`projects.service.ts`)

### สถานะ / ความคืบหน้า (`common/rgp-rules.ts`, `common/project-ops.ts`)
- สถานะ State จาก %: 0 = `Pending`, 100 = `Completed`, อื่นๆ = `InProgress` (`stateStatusFromPct`)
- สถานะโครงการคำนวณจากสถานะ State (`computeProjectStatus`): ไม่มีความคืบหน้า = `Open`, ขั้นตอน **ที่จำเป็น** ครบ = `Completed`, ที่เหลือ = `InProgress` · เขียนเฉพาะเมื่อค่าเปลี่ยน · ตั้ง `close_date` เมื่อเข้า `Completed` ครั้งแรก
- % รวมของโครงการ = ค่าเฉลี่ยของ State (`overallProjectPct`) · บันทึกความคืบหน้า (`POST /states/:id/progress`) → เขียนแถว `t_project_progress` → ตั้งสถานะ State → คำนวณสถานะโครงการ ใน transaction เดียว (`progress/`)
- ผลรวม "วันคาดการณ์" ของทุกขั้นตอน ≤ จำนวนวันของโครงการ (`checkEstimatedDays`, `GET .../estimated-days` คืนวันที่ใช้/เหลือ)

### โครงการ (`projects/`)
- สร้างพร้อมลูก (ขั้นตอน + เอกสาร + บุคคล) ในคำขอเดียว/transaction เดียว — เอกสารอ้างขั้นตอนด้วย `stateIndex` ใน array เดียวกัน (`assertDocStateIndexes`), ลำดับขั้นตอน `planStateOrder`, วันรวม `assertStagedDays`, `assertDateRange`
- ลบ (soft delete → สถานะ `Cancelled`): **บล็อกถ้ามีขั้นตอนใดไม่ใช่ `Pending`** (มีความคืบหน้าแล้ว) · ผู้สร้างหรือ Manager+ เท่านั้น
- ปิดโครงการ (`/close`, Manager+): ต้องไม่มีขั้นตอนที่จำเป็นค้างอยู่ · `recalculate-status` = คำนวณสถานะใหม่ตามกฎด้านบน
- `PATCH` แก้หัวโครงการแบบ partial · `PUT .../legal-dict` เก็บ JSON พจนานุกรมกฎหมายเฉพาะโครงการที่ใช้ template ประเภทนี้ (ต้อง parse เป็น JSON ได้)

### ขั้นตอน (State) (`states/`)
- เพิ่ม/แก้/ลบ/จัดลำดับ (`PUT .../states/order`) · ลบได้เมื่อไม่มีแถวความคืบหน้า, Task (รวมที่ถูก soft delete) และไม่เคยส่งแจ้งเตือน · เอกสารและบุคคลของขั้นตอนต้องลบก่อนหรือยืนยัน `cascade=true`
- โครงการอ้างอิงของขั้นตอน (`refProjectId`): ต้องเป็นโครงการที่ยังใช้งานอยู่และไม่ใช่ตัวเอง (`assertValidRefProject`) · `GET /rgp/projects/reference-candidates` คืนเฉพาะโครงการที่ยังไม่ `Completed`
- ผู้เกี่ยวข้องของขั้นตอน (`state-members`): เลือกจากบุคคลในโครงการ ห้ามชื่อซ้ำ · ส่งแจ้งเตือนได้เฉพาะประเภทพนักงาน และบันทึก `t_project_notify_log` (สำเร็จ/ล้มเหลว) + สร้าง/ใช้ Task ติดตามของขั้นตอน

### Task (`tasks/`)
- สถานะ: `Todo`, `InProgress`, `InReview`, `OnHold`, `Done`, `Cancelled` · **OnHold ตรึง % เดิม** (ห้ามเปลี่ยน %), `Done` → 100%, `Todo` → 0% (`resolveTaskStatusChange`)
- เปลี่ยนสถานะ → เขียน `t_project_task_status_log` → **Auto-sync % ของ State** = ปัดเศษทิ้งของค่าเฉลี่ย % ของ Task หลักที่ใช้งานอยู่และไม่ `Cancelled` (หมายเหตุ "Auto-sync จาก Tasks") → คำนวณสถานะโครงการ → audit `UPDATE_PROJECT_TASK_STATUS`
- รหัส Task ออกอัตโนมัติ (`TK`, ล็อกแถวเลขเดียวกับโครงการ) · วันกำหนดเสร็จห้ามเป็นอดีตตอนสร้าง · sub task ลึกได้สูงสุด 20 ระดับ (กัน loop) · ธง `overdue`/`slaWarning` คำนวณในโค้ด (`computeTaskFlags`) · ต้นไม้ Task `buildTaskTree`, เรียง `sortStateTasks`
- Comment: ตอบกลับซ้อนได้ 3 ระดับ (`MAX_COMMENT_DEPTH = 2`), ลบ (soft) ได้เฉพาะของตัวเอง, ข้อความของ comment ที่ถูกลบไม่ถูกส่งออก
- ลบ Task = soft delete และตั้ง `recycle_expiry` = +30 วัน (ไม่ลบ sub task และไม่ sync % ของ State — พฤติกรรมเดิม)

### เอกสาร workflow / สมาชิก / template (`documents/`, `members/`, `templates/`)
- เอกสาร: สถานะ `Pending/Received/Verified/Rejected` · ลำดับต่อท้ายอัตโนมัติ · ย้ายขั้นตอนได้ในโครงการเดียวกัน
- บุคคลที่เกี่ยวข้อง: ประเภท คณะกรรมการ/ฝ่าย/แผนก/พนักงาน — **ชื่ออ่านจาก DB ไม่เชื่อค่าจาก client** (`member-resolver.ts`) · บทบาท (member-roles) ชื่อห้ามซ้ำ, ลบจริงได้เพราะสมาชิกเก็บชื่อบทบาทเป็นข้อความ
- Template: ลบไม่ได้ถ้ามีโครงการใช้อยู่ · ลบขั้นตอนของ template ไม่ได้ถ้ามีเอกสารผูก · `copy-states` แทนที่ขั้นตอนทั้งหมด · `blueprint` คืนรูปแบบเดียวกับ body สร้างโครงการ (ให้ client ดึงไปแก้ก่อนบันทึก แทนการ stage ในหน่วยความจำ)

### ไฟล์แนบ (`attachments/`)
- ทำผ่าน `DMS_FILE_PORT` เท่านั้น (`@Optional() @Inject`) — **ไม่มี DMS = ตอบ 503 `DMS_UNAVAILABLE`** (ไม่แตะ DMS repository โดยตรง)
- อัปโหลดใหม่ (multipart `files`, ชื่อไฟล์ไทยแก้ encoding, ลบไฟล์ชั่วคราวทุกกรณี รวมกรณี validation ล้ม — `UploadCleanupInterceptor`) · แนบไฟล์เดิมใน DMS (ตรวจสิทธิ์อ่านด้วย `openRead`; ล้มหลังแนบ → `remove` ชดเชย) · ดาวน์โหลดตรวจสิทธิ์ผ่าน DMS · ยกเลิกการแนบไม่ลบไฟล์ใน DMS

### Audit (`audit/`)
- เขียน **สองที่**: (1) `RGP.t_project_audit_log` (Result 1 สำเร็จ / 2 ล้มเหลว — รายงานเดิมยังอ่านตารางนี้) และ (2) CRUD-log กลางผ่าน `logged()`
- แถวสำเร็จเขียน **ใน transaction เดียวกับงาน** (กลับ = ไม่เหลือ audit ผี) · ล้มเหลวเขียน `<ACTION>_FAILED` + ข้อความ บน connection แยก (เขียนไม่ได้ = log เตือน ไม่กลบ error จริง)
- action ที่เขียนตาราง RGP (ตรงกับระบบเดิม): `CREATE_PROJECT`, `UPDATE_PROJECT`, `DELETE_PROJECT`, `CLOSE_PROJECT`, `CREATE_PROJECT_STATE`, `DELETE_PROJECT_STATE`, `CREATE_PROJECT_TASK`, `UPDATE_PROJECT_TASK_STATUS`
- อ่าน: `GET /rgp/audit`, `GET /rgp/projects/:projectId/audit` (Manager+ — มีชื่อเครื่อง/ผู้กระทำ)

### ความปลอดภัยของข้อมูล
- SQL ทุกจุด parameterize (`@0..`) · `ORDER BY` ผ่าน whitelist (`applySort`) · `LIKE` escape ตัวพิเศษ · ฟิลด์ผู้ใช้ varchar(20) ตัดด้วย `rgpActor` (ชื่อ AD ยาวกว่า 20 ถูกตัด — ดูข้อ 5)

## 3. ส่วนที่ต่างจากระบบเดิม / ต้องตัดสินใจ

| # | เรื่อง | ระบบเดิม | API นี้ | เหตุผล / ทางเลือก |
|---|---|---|---|---|
| 1 | สิทธิ์ใช้งาน | ไม่มีการแบ่งสิทธิ์ในโปรแกรม (ใครเปิดได้ก็ทำได้) | อ่าน/แก้ทั่วไป = login ทุกคน · ลบโครงการ = ผู้สร้างหรือ Manager+ · ปิดโครงการ/template/บทบาท(เขียน)/อ่าน audit = Manager+ · **ไม่มีตรวจว่าเป็นสมาชิกโครงการ** | เลือกทางที่ปลอดภัยกว่าเฉพาะจุดอันตราย — **คำถามเปิด:** ต้องจำกัดตามสมาชิกโครงการหรือไม่ |
| 2 | สถานะ Task | `Todo/InProgress/Done/OnHold` | เพิ่ม `InReview` (หน้าจอใช้) และ `Cancelled` (ไม่นับในค่าเฉลี่ย % และไม่ติดธงเลยกำหนด) | หน้าจอเดิมมีใช้จริง |
| 3 | สถานะโครงการ `Cancelled` | ใช้เมื่อลบ | soft delete ตั้งสถานะ `Cancelled` และซ่อนจากรายการ | ตรงกับเดิม |
| 4 | โครงการ "Completed" เมื่อไม่มีขั้นตอนที่จำเป็นเลย | เงื่อนไข "ทุกขั้นที่จำเป็นเสร็จ" เป็นจริงโดยปริยาย (vacuous true) | **คงพฤติกรรมเดิม** | **คำถามเปิด:** ควรบังคับให้มีขั้นตอนที่จำเป็นอย่างน้อย 1 ขั้นก่อน Completed หรือไม่ |
| 5 | `close_date` | ตั้งเมื่อ Completed | ตั้งเมื่อ *เข้า* Completed ครั้งแรก ไม่ล้างเมื่อสถานะถอยกลับ | ไม่ทำลายประวัติ |
| 6 | RunningNumber | `maximum_number` ไม่ถูกใช้; อัปเดต **ทุกแถว** ของ type; ไม่มีแถว `TK` ก็ insert ให้เอง | ยังไม่ใช้ `maximum_number` แต่ปฏิเสธเลขยาว > 20 · อัปเดตตาม **id ของแถวที่ล็อก** · **ไม่มีแถว `TK`/`PRJ` = error** (ไม่ insert ให้) · prefix/format เป็น null → ใช้ค่าเริ่มต้น · `Year_UW` null = ถือว่าขึ้นปีใหม่ (reset) · token รองรับ `YYYY` | ป้องกันการแก้แถวผิดและเลขกระโดดเงียบๆ — ต้อง seed แถวก่อนใช้ |
| 7 | รหัส template | อาจว่างได้ใน UI | **บังคับ** ไม่ซ้ำ (DB เป็น NOT NULL) | ตรงกับ schema |
| 8 | Template state | — | ไม่มีคอลัมน์วันคาดการณ์ (ตาราง `m_template_state` ไม่มี) | โครงการที่สร้างจาก template ต้องกรอกวันเองใน body |
| 9 | แก้เอกสารของ template | `UpdateTemplateDoc` ไม่อัปเดต `i_doc_id` (บั๊ก) | อัปเดต `masterDocId` + ชื่อ/รหัสที่คัดลอกใหม่ | แก้บั๊ก |
| 10 | ลบขั้นตอนของโครงการ | ลบได้ถ้าไม่มีประวัติความคืบหน้า | บล็อกเพิ่มเมื่อมี **Task (รวมที่ soft delete)** หรือ **เคยส่งแจ้งเตือน** · เอกสาร/บุคคลต้องส่ง `cascade=true` | กัน FK ล้ม/ข้อมูลกำพร้า |
| 11 | ผู้เกี่ยวข้องของขั้นตอน | พิมพ์ชื่อเองได้ | เลือกจากบุคคลในโครงการ ห้ามชื่อซ้ำ | ให้ชื่อสะอาดและส่งแจ้งเตือนได้ |
| 12 | บทบาทบุคคล | ชื่อซ้ำได้ | ชื่อห้ามซ้ำ | ป้องกัน dropdown กำกวม |
| 13 | ชื่อ/รหัสบุคคล | client ส่งชื่อมาเอง | อ่านจาก `EMS.m_*` เฉพาะ active (ใช้ฐานหลักแทน `BisDb` เดิม) | ไม่เชื่อค่าจาก client |
| 14 | แก้โครงการ | ส่งทั้งฟอร์ม | `PATCH` แบบ partial · ส่ง `null` = ล้างค่า · `n_project_owner/developer` อ่านอย่างเดียว (ไม่แก้ผ่าน API) | คงข้อมูลเดิม |
| 15 | จัดลำดับขั้นตอน | ลากแล้วบันทึกทีละแถว | `PUT .../states/order` ส่งคู่ stateId/seqNo ทั้งชุดครั้งเดียว | atomic |
| 16 | Audit | เขียนเฉพาะสำเร็จ (บางกรณีมี `CREATE_PROJECT_FAILED`) | เพิ่ม `<ACTION>_FAILED` (Result 2) ให้ทุก action ที่ audit เมื่อถูกบล็อก/ล้มเหลว · ลบขั้นตอนบันทึก user ด้วย | ตรวจสอบย้อนหลังได้ครบ |
| 17 | แจ้งเตือนขั้นตอน | เรียก NotificationManager ภายนอก | ใช้ `NotificationsService` ของระบบ — บันทึก notify log `Success` เมื่อผู้รับมีบัญชี, `Failed` เมื่อไม่มีบัญชี (service กลืน error ภายใน) | ไม่มี NotificationManager ใน API |
| 18 | ไฟล์แนบ | เรียก DMS ตรงจากหน้า RGP | ผ่าน `DMS_FILE_PORT` เท่านั้น · โฟลเดอร์เริ่มต้น = `SystemConfig ExternalUpload.FolderId.Level4` สำรอง **437** | ตาม brief กลาง |
| 19 | JSON พจนานุกรมกฎหมาย | เก็บข้อความอะไรก็ได้ + ปุ่ม "ส่ง API" ภายนอก | ต้องเป็น JSON ที่ parse ได้ และเฉพาะ template ที่ `f_is_legal_dict='Y'` · **ไม่พอร์ตปุ่มส่ง API ภายนอก** | ปลายทางภายนอกไม่ทราบ |
| 20 | วันกำหนดเสร็จของ Task | ตรวจไม่ให้เป็นอดีตเฉพาะตอนสร้าง | เหมือนเดิม (ไม่ตรวจตอนแก้) | พฤติกรรมเดิม |
| 21 | ธง SLA/เลยกำหนด | คำนวณใน SQL | คำนวณในโค้ด (`computeTaskFlags`) ไม่นับ `Done/OnHold/Cancelled` | เทสต์ได้โดยไม่ต้องมี DB |
| 22 | ระดับ sub task | recursive CTE ไม่มีเพดานชัดเจน | จำกัด 20 ระดับตอนสร้าง | กันข้อมูลวนซ้ำ |

## 4. สิ่งที่ยังไม่ได้ทำ (deferred) และเหตุผล

- **E-Filing, `GetSubtasks`, `EditComment`, `Restore` Task, `HasActiveTasks`** — โค้ดเดิมมีแต่ไม่มีหน้าจอเรียกใช้ (dead feature) จึงไม่พอร์ต เพิ่มได้ทีหลังถ้าต้องการ
- **ปุ่ม "ส่ง API" ของพจนานุกรมกฎหมาย** — ไม่ทราบปลายทางภายนอก
- **ตรวจสิทธิ์ตามสมาชิกโครงการ** — ระบบเดิมไม่มี รอคำตอบจากข้อ 3.1
- **ล้างถังขยะ Task อัตโนมัติ (หลัง 30 วัน)** — API ตั้งวันหมดอายุ `recycle_expiry` ให้ แต่การลบจริงเป็นงาน scheduled job ที่ไม่อยู่ในขอบเขต endpoint (Task ที่ลบแล้วถูกซ่อนจากรายการตามปกติ)
- **เทสต์ตัวจริงกับ SQL Server / DMS / การแจ้งเตือน** — brief ห้ามเชื่อมต่อ DB; เทสต์ใช้ in-memory TypeORM fake (`test/unit/rgp/helpers/`) และ stub port ดูรายการข้อ 5

## 5. ต้องทดสอบกับ SQL Server จริง (เทสต์อัตโนมัติพิสูจน์ไม่ได้)

1. **สร้างโครงการ/Task พร้อมกันหลายคำขอ** — `UPDLOCK, ROWLOCK` บล็อกกันจริง ได้เลขไม่ซ้ำ ไม่เว้นช่อง; ข้ามปี (reset); กรณี commit ชั้นในล้มหลังชั้นนอกสำเร็จ (retry 3 ครั้ง) และชั้นนอก rollback ไม่ทำให้เลขเดินหน้า
2. **พฤติกรรม TypeORM กับ mssql** — `insert/save` ที่ใช้ `OUTPUT`, การ update ด้วยฟังก์ชัน `() => 'GETDATE()'` / `DATEADD`, QueryBuilder subselect (ค้นหาโครงการ, audit), `OFFSET/FETCH` + sort, `ESCAPE` ใน `LIKE`
3. **คอลัมน์ชนิด `date`** — อ่านเป็นสตริง `YYYY-MM-DD` ไหม และเขียนข้ามเขตเวลา (`useUTC:false`) ไม่เลื่อนวัน
4. **FK / ลำดับลบ** — ตารางลูกของ `t_project`, `t_project_state`, `t_project_task` (กฎ cascade ไม่ทราบ) · ลบ template/ขั้นตอน/เอกสารตามลำดับในโค้ดผ่านจริง
5. **Collation** — การตรวจชื่อซ้ำ (บทบาท, ผู้เกี่ยวข้อง, รหัส template, เลขที่โครงการ) ตามกรณีตัวพิมพ์/วรรณยุกต์ของ DB จริง
6. **ชนิดข้อมูล** — `bigint` คืนเป็นสตริง, `varchar(20)` ตัดชื่อ AD ยาว (อาจชนกันของผู้ใช้สองคน), `nvarchar(100)` ฟิลด์ผู้สร้าง
7. **Audit** — แถว Result 1 อยู่ใน transaction เดียวกับงาน (rollback แล้วไม่เหลือ), แถว `*_FAILED` ถูกเขียนบน connection แยกเมื่อ transaction ล้ม
8. **DMS port** — upload/`openRead`/`remove` จริง, ชื่อไฟล์ภาษาไทย, ไฟล์ใหญ่ใกล้ `STORAGE_MAX_UPLOAD_MB`, ไฟล์ชั่วคราวถูกลบหลังทุกกรณี, 503 เมื่อปิด DMS
9. **แจ้งเตือน** — ส่งถึงผู้รับจริง และ notify log Success/Failed ตามบัญชี
10. **Seed ข้อมูล** — มีแถว `RunningNumber` ทั้ง `PRJ` และ `TK` ใน BUI_RG ก่อนใช้งาน

## 6. ขอแก้ core (ถ้ามี)

ไม่มีที่จำเป็น module ทำงานได้ด้วย core ปัจจุบัน
ข้อเสนอเสริม (ไม่บังคับ): ถ้า module อื่นต้องล็อกตัวเลขข้ามฐานแบบเดียวกัน (transaction ซ้อน 'project' → main) ควรมี helper กลางใน `TransactionRunner` แทนการซ้อนเอง
