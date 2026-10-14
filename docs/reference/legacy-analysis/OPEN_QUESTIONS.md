# คำถามค้างและจุดที่ต้องตัดสินใจก่อนทำ API

> ✅ = ตอบได้จากข้อมูลที่มีแล้ว · ❓ = ต้องการคำตอบจากทีม/DBA · ⚠ = พบพฤติกรรมในโค้ดเดิมที่น่าจะเป็นข้อบกพร่อง ต้องตัดสินใจว่าจะ "คงพฤติกรรมเดิม" หรือ "แก้ใน API"

## A. DDL / ข้อมูลที่ยังขาด

| # | สิ่งที่ขาด | ทำไมต้องใช้ | วิธีได้มา |
|---|---|---|---|
| A1 ❓ | DDL ของ **`storage.QuickAccessFolder`** | ชุด export รุ่นแรกใช้ชื่อ `storage.QuickAccess` (ไม่พบใน DB); ตารางจริงคือ `QuickAccessFolder` (จาก SP) | รัน Script 1 ใหม่ด้วยชื่อนี้ |
| A2 ❓ | DDL ของ **`dbo.SystemConfig`** | ใช้โดย `sp_GetSystemConfig`/`sp_UpsertSystemConfig` (config ของระบบ) — ไม่อยู่ในรายการ 62 ตารางเดิม | เหมือนข้างบน |
| A3 ❓ | ค่าที่มีอยู่ใน `dbo.SystemConfig` (เฉพาะ **ชื่อ key** ไม่ต้องส่งค่า secret) | เพื่อรู้ว่าอะไรถูกย้ายเข้า DB แล้วบ้าง | `SELECT ConfigKey FROM dbo.SystemConfig` |
| A4 ❓ | ความหมายของ `EMS.m_Employee.EmploymentType (1–4)` และ `EmploymentStatus (1–5)` | CHECK constraint มีแต่ไม่มี enum ในโค้ด | เจ้าของข้อมูล HR |
| A5 ❓ | ความหมายค่า `workflow.ApprovalRequest.RequestStatus = 5` | DB อนุญาตแต่โค้ดไม่ใช้ | DBA/ทีมเดิม |

สคริปต์สำหรับ A1–A3 (read-only):
```sql
-- เพิ่ม 2 ตารางลงใน @t แล้วรัน Script 1.1–1.5 เดิม
INSERT @t VALUES ('storage','QuickAccessFolder'),('dbo','SystemConfig');
-- รายการ key ใน SystemConfig (ไม่ดึงค่า)
SELECT ConfigKey, UpdatedDate FROM dbo.SystemConfig ORDER BY ConfigKey;
```

## B. ขอบเขตและความหมาย (ต้องถามทีม)

| # | คำถาม | เหตุผล |
|---|---|---|
| B1 ❓ | **ลิงก์แชร์ภายนอก (external share) ใครเป็นผู้เปิด?** `AccessShareForm` ไม่ถูกเรียกจากที่ใด (dead) แต่ `ShareAccessService.ValidateAndGrantAccess` มี logic ตรวจ token/รหัสผ่าน/จำนวนดาวน์โหลด | ต้องรู้ว่า API ต้องมี endpoint สาธารณะ (ไม่ต้อง login) สำหรับดาวน์โหลดผ่านลิงก์หรือไม่ |
| B2 ❓ | Notification server ภายนอกอ่าน/เขียนตาราง `EMS.Notification` หรือไม่? ใครอ่านตาราง (525,748 แถว)? | ตัดสินใจว่า API จะเป็นผู้ส่งแจ้งเตือนทางไหน (INSERT ตาราง / เรียก server) และต้อง purge หรือไม่ |
| B3 ❓ | WinForms จะ **เปลี่ยนมาเรียก API** (strangler) หรือใช้ ADO.NET ตรงต่อไปควบคู่? | มีผลต่อการคง SP เดิม, ความเข้ากันได้ย้อนหลัง, และ versioning |
| B4 ❓ | เมนู: ใช้ **Menu API ภายนอก** (`MenuApiUrl`) หรือตาราง `EMS.MenuItem` (`FormClassName` เป็นชื่อคลาส WinForms) เป็นแหล่งจริงของเมนู/สิทธิ์เมนู? | ฝั่ง web/ใหม่ต้องมี route แทน `FormClassName` |
| B5 ❓ | ต้องการ endpoint ของส่วนที่ปัจจุบันเป็น dead (E-Filing, Project close, Task subtasks/edit comment, Notification mark-read, Share expiry job, WFE SLA job) หรือไม่? | เอกสารนี้ตัดออกทั้งหมด — ถ้าจะเปิดใช้ต้องออกแบบใหม่ |
| B6 ❓ | `EMS.UserAuthority`, `EMS.UserOrgUnitHiddenView`, `dbo.WFDelegationRule`, `security.PermissionGroup/UserGroupMember` มีใน DB (มี SP) แต่โค้ดที่ compile ไม่ใช้ — เป็นของรุ่นถัดไปหรือรุ่นเก่า? | ถ้าเป็นแผนอนาคต ควรรวมใน API; ถ้าเป็นของเก่า ควรตัด |
| B7 ❓ | ใครรัน SP sync HR (`EMS.sp_SyncApiDepartments/Divisions`, `sp_SeedFolderAuthorityFromPositionMapping`) และอ้างฐาน `SCS` | ถ้าเป็นงานนอกระบบ ไม่ต้องทำใน API |
| B8 ❓ | `BisDbConnectionString` ชี้ฐานเดียวกับ CMS_DB หรือไม่ (ตาราง `EMS.m_SubCommittee/m_Division/m_Department` ซ้ำชื่อ)? | ถ้าคนละฐานต้องขอ DDL และวางเป็น DataSource แยก |
| B9 ❓ | ความต้องการเรื่อง **ภาษาของข้อความผิดพลาด**: ปัจจุบันผสมไทย/อังกฤษและส่งผ่าน `Exception.Message` ให้ UI แสดง | ออกแบบรูปแบบ error ของ API (code + message) |
| B10 ❓ | **วัน/เวลา:** ใช้ทั้ง `GETDATE()` (เวลาท้องถิ่นของ SQL Server) และ `GETUTCDATE()` (`EMS.FolderAuthorityConfig.UpdatedDate`, `WFE.t_WFInstance.InitiatedDate`) | กำหนด timezone ที่ API ส่งออก |

## C. ข้อบกพร่อง/พฤติกรรมน่าสงสัยในโค้ดเดิม (ตัดสินใจ: คงเดิม หรือ แก้)

| # | พบอะไร | ที่ไหน | ผลกระทบ | ข้อเสนอ |
|---|---|---|---|---|
| C1 ⚠ | **Escalation ใส่เลข Role (3/4) ลงใน `ApprovalStep.ApproverID`** ซึ่งเป็น FK → `EMS.UserAccount.UserID` | `ApprovalService.EscalateRequest` | ถ้าไม่มี user ที่ `UserID` = 3 หรือ 4 จะ INSERT ล้มเหลว (ถูกกลืนด้วย try/catch) หรือผูกกับผู้ใช้ผิดคน | ใน API ให้ส่ง step ให้ **ผู้ใช้ตาม role** (ทีละคนหรือกลุ่ม) |
| C2 ⚠ | `FileDocument.ConfidentialityLevel` มีใน Domain แต่ **ไม่มีคอลัมน์ใน DB และ repository ไม่ map** → ค่า 0 เสมอ | `ShareService.CreateExternalShare` | การบล็อก "แชร์ไฟล์ HC ภายนอก" ไม่ทำงานระดับไฟล์ (บล็อกได้เฉพาะระดับ folder ที่เช็กจาก `Folder.ConfidentialityLevel`) | คำนวณจาก folder ของไฟล์ |
| C3 ⚠ | `Folder.QuotaBytes` ไม่ถูก map จาก DB | `FileService.UploadSingleFile` | การเช็ก quota รายโฟลเดอร์ไม่ทำงาน; ทำงานเฉพาะ quota ระดับ OrgUnit (`ValidateBatchAgainstOrgQuota`) | ตัดสินใจว่าต้องมี quota รายโฟลเดอร์หรือไม่ |
| C4 ⚠ | `CheckPermission(userId, targetId, "Read")` เมื่อแชร์ภายนอกแบบ **ไฟล์** ส่ง `FileID` เข้าเป็น `folderId` | `ShareService.CreateExternalShare` | ตรวจสิทธิ์ผิด folder | ส่ง `FolderID` ของไฟล์ |
| C5 ⚠ | Withdraw คำขอใช้สถานะ **4 = Expired** เหมือนหมดอายุ | `ApprovalService.WithdrawRequest` | แยกไม่ออกระหว่างถอนกับหมดอายุ | เพิ่มสถานะ (`5`=Cancelled ซึ่ง CHECK อนุญาตอยู่แล้ว) |
| C6 ⚠ | ผลข้างเคียงหลังอนุมัติ (ตั้งสิทธิ์/ลบ folder/เปิดแชร์) **ไม่อยู่ใน transaction และกลืน exception** — คำขอถูก mark Approved แม้ผลข้างเคียงล้มเหลว | `ApprovalService.ApproveStep` | ข้อมูลไม่สอดคล้อง | ใช้ transaction เดียว; ล้ม = rollback + แจ้งผู้ใช้ |
| C7 ⚠ | ข้อมูลที่ต้องใช้ตอนอนุมัติถูกเก็บเป็นข้อความใน `ApprovalRequest.Remark` (`ExternalShareID:<n>`, `InternalShareFile…`, ข้อความสิทธิ์) | `ParsePermissionRemark`, `ParseInternalShareRemark`, `ParseExternalShareId` | เปราะบาง/แยกวิเคราะห์ยาก | กำหนดรูปแบบ JSON ใหม่ แต่ต้องอ่านรูปแบบเก่าได้ (มี 40 คำขอในฐาน) |
| C8 ⚠ | `ApprovalService.FindStep` ค้นหา step โดย **วนดึง step ของทุก request ที่ Pending** | `ApprovalService` | ช้าเมื่อข้อมูลเยอะ (`ApprovalStep` 222,519 แถว) | ค้นด้วย `StepID` ตรง |
| C9 ⚠ | `storage.sp_DeleteFolderTemplateItem` ลบลูกแค่ **2 ระดับ** (คอมเมนต์ในโค้ดบอกเอง) | SP | ลูกชั้นลึกกว่าค้างเป็นกำพร้า | ลบแบบ recursive ใน API |
| C10 ⚠ | `EMS.sp_HasActiveDependents` ตรวจเฉพาะ `storage.Folder`, `EMS.UserAccount` | SP | ลบ OrgUnit อาจชน FK จาก `dms.FolderQuotaChangeRequest`, `security.UserOrgVisibility` | ตรวจครบ FK |
| C11 ⚠ | `EMS.sp_CreateMenuItem` ใช้ `@@IDENTITY` และ `sp_DeleteMenuItem` อ้าง cascade แต่ไม่มี FK ของ `MenuItem` | SP | ลูกเมนูอาจค้างเมื่อลบแม่ | ใช้ `SCOPE_IDENTITY()`/ลบลูกชัดเจน |
| C12 ⚠ | `WFE.sp_CreateWFInstance` ใส่ `Status=0` ซึ่งไม่ตรง enum (เริ่มที่ 1) | SP | ถ้า query ด้วย enum จะไม่เจอสถานะนี้ชั่วขณะ | ใช้ `Created=1` |
| C13 ⚠ | `KBArticleService.ChangeStatus` **ไม่บังคับ role/ผู้ตรวจ** ตามที่คอมเมนต์ระบุ และใช้ `string actionBy` แทน `UserID` | KMS | ใครก็เปลี่ยนสถานะได้ถ้าเรียกตรง | บังคับใน API |
| C14 ⚠ | **Virus scan ถูกข้าม** ตอนอัปโหลด (บันทึก Clean เสมอ) | `FileService.UploadSingleFile` | ความเสี่ยงด้านความปลอดภัย | ตัดสินใจเปิด ClamAV หรือไม่ |
| C15 ⚠ | `UserAdminController` (สร้างผู้ใช้/เปลี่ยน role/ปิดบัญชี) **ไม่มีการเช็ก role** — เชื่อ UI | DMS | API ต้องบังคับ Admin เอง | Guard Admin |
| C16 ⚠ | `PrincipalType` ใน enum มี 5=Group, 6=OrgUnit แต่ CHECK ของ `FolderPermission` อนุญาตแค่ 1–4 | Domain vs DB | ตั้งสิทธิ์ Group/OrgUnit ไม่ได้ | จำกัด DTO เป็น 1–4 |
| C17 ⚠ | `NotificationApiKey` มีค่า default ฝังในซอร์ส `MDI_Container` | Presentation | key รั่วใน repo | rotate + ย้ายเป็น secret |
| C18 ⚠ | RGP เก็บ user เป็น `varchar` (ชื่อผู้ใช้) ขณะที่ส่วนอื่นเก็บ `UserID` int | RGP | ต้อง map สองแบบ | ตัดสินใจรูปแบบใน API |
| C19 ⚠ | `AppRole` default ผู้ใช้ใหม่ = Officer และ `OrgUnitID = 1` (ฮาร์ดโค้ด) | `Program.Main` | ผู้ใช้ใหม่สังกัด OrgUnit 1 เสมอ | ยืนยันค่าที่ต้องการ |

## D. การตัดสินใจด้านสถาปัตยกรรม API

| # | หัวข้อ | ตัวเลือก | คำแนะนำเบื้องต้น |
|---|---|---|---|
| D1 | วิธีเข้าถึงข้อมูล | (ก) TypeORM/Prisma entity + query; (ข) `mssql` ดิบ + เรียก SP เดิม | **ผสม:** ใช้ SP เดิมสำหรับ DMS/EMS/WFE (ตรรกะซ่อนใน SP และมี locking) และ entity/query สำหรับ KMS/RGP ที่ใช้ SQL ตรง |
| D2 | หลาย DataSource | CMS_DB (หลัก), ProjectDb, BisDb, CmsLinkDb + ข้ามฐาน `BUI_RG` | ตั้งชื่อ DataSource แยก ตามภาคผนวก C ของ `NESTJS_API_TASKLIST.md` |
| D3 | รูปแบบ endpoint | REST ตาม resource + action endpoints (`POST /approvals/:id/steps/:stepId/approve`) | ทำตาม use case ใน `06-service-use-cases.md` |
| D4 | Paging | ปัจจุบันหลาย list ไม่มี paging (`KBArticle.GetAll` 19,080 แถว, `Notification` 525K, `AuditLog` 251K, `ApprovalStep` 222K) | บังคับ paging/ตัวกรองทุก endpoint ของตารางใหญ่ |
| D5 | ชนิดข้อมูล | `bigint` (`FolderSizeBytes`, `FileSizeBytes`, `AuditID`) | ส่งเป็นสตริงหรือ BigInt-safe |
| D6 | การอัปโหลดไฟล์ | multipart ผ่าน API เทียบกับเขียนลง share โดยตรง | API เป็นผู้เขียน share และบันทึก metadata |
| D7 | การควบคุมสิทธิ์ | Guard กลาง + `PermissionEvaluator` | พอร์ตอัลกอริทึม §2.3 ของ `04-business-rules.md` ให้ตรง |
| D8 | ชุดทดสอบเทียบผล | repo ไม่มี automated test | เก็บ request/response ตัวอย่างจากระบบเดิมต่อ use case เพื่อทำ parity test |
