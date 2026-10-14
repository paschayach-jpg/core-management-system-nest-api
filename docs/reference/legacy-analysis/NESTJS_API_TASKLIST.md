# NestJS API Migration — Tasklist แยกตาม Module (DMS / KMS / RGP / WFE)

> วิเคราะห์จาก source ของ `core-management-system` (branch `popnahaff`) + ผล export DDL/SP จาก DB จริง · อัปเดต 2026-10-14 · WinForms .NET 4.5 + ADO.NET + SQL Server
> เป้าหมาย: ระบุว่าแต่ละ module **CRUD ตารางอะไรบ้าง** เพื่อออกแบบ API ใน NestJS — นับเฉพาะโค้ดที่ถูกเรียกใช้จริง (ตัด dead code ออก)
> หมายเหตุ: ในโค้ดสะกดโมดูลว่า **RGP** (Project) ไม่ใช่ RPG — เอกสารนี้ใช้ RGP ตามโค้ด

## เอกสารประกอบ (อ่านคู่กับไฟล์นี้)

| ไฟล์ | เนื้อหา |
|---|---|
| [`docs/nestjs-api/README.md`](docs/nestjs-api/README.md) | ดัชนี วิธีใช้ Type mapping สำหรับ Node |
| [`docs/nestjs-api/data-dictionary/`](docs/nestjs-api/data-dictionary/) | **Data dictionary ต่อตาราง** (คอลัมน์/ชนิด/PK/FK/Index/CHECK/แถว) แยก SHARED, DMS, KMS, RGP, WFE |
| [`docs/nestjs-api/02-stored-procedures.md`](docs/nestjs-api/02-stored-procedures.md) | แคตตาล็อก Stored Procedure (พารามิเตอร์/ตารางที่แตะ/ผู้เรียก) |
| [`docs/nestjs-api/03-enums-lookups.md`](docs/nestjs-api/03-enums-lookups.md) | Enum/ค่า lookup และจุดที่โค้ดกับ DB ไม่ตรงกัน |
| [`docs/nestjs-api/04-business-rules.md`](docs/nestjs-api/04-business-rules.md) | **กฎธุรกิจที่ต้องรักษา** (สิทธิ์ อนุมัติ แชร์ โควตา import ฯลฯ) |
| [`docs/nestjs-api/05-cross-cutting.md`](docs/nestjs-api/05-cross-cutting.md) | Auth, audit, notification, ไฟล์, config, jobs, transaction, cache, integration |
| [`docs/nestjs-api/06-service-use-cases.md`](docs/nestjs-api/06-service-use-cases.md) | Service method → ตาราง (ใช้ออกแบบ endpoint ระดับ use case) |
| [`docs/nestjs-api/OPEN_QUESTIONS.md`](docs/nestjs-api/OPEN_QUESTIONS.md) | คำถามค้าง ข้อบกพร่องในโค้ดเดิม และการตัดสินใจด้านสถาปัตยกรรม |
| `db-export/` | ไฟล์ export ดิบจาก DB (DDL, SP, dependency) ที่ใช้เป็นแหล่งอ้างอิง |

## 0. วิธีอ่านเอกสาร / วิธีวิเคราะห์

- [x] อ่านเฉพาะไฟล์ที่ **อยู่ใน `.csproj` (Compile Include)** — ไฟล์ที่ไม่ถูก compile (30 ไฟล์) ไม่นับ (ภาคผนวก A)
- [x] สร้าง call graph เริ่มจาก `Program.Main` → `MDI_Container` → Form/Controller/Service → Repository แล้วนับเฉพาะ **Repository method ที่ถูกเรียกถึงจริง** (ที่เหลือ = dead code)
- [x] แยก module จากตำแหน่งต้นทางของการเรียก: `CMS.Presentation/Modules/<M>` + `CMS.Controllers/<M>` — ตารางที่ module เดียวใช้ = ของ module นั้น; ใช้ ≥2 module = ของ schema เจ้าของ หรือ **Shared** (EMS.* / audit.*)
- [x] **ยืนยันชื่อตารางและ CRUD ของ Stored Procedure จาก definition จริง** (80 SP ที่ใช้งาน) ไม่ใช่การเดาจากชื่อ — ทำให้แก้ `QuickAccess` → `QuickAccessFolder` และเพิ่ม `dbo.SystemConfig`
- [x] เทียบกับ DDL จริง: คอลัมน์ PK FK index CHECK และจำนวนแถว อยู่ใน data dictionary
- ⚠ call graph เป็น static analysis (ชื่อ method + ชนิดตัวแปร) ไม่ได้รันโปรแกรม — ควรไล่ตรวจกับเมนูจริงอีกรอบ

**สัญลักษณ์:** `C`=INSERT · `R`=SELECT · `U`=UPDATE · `D`=DELETE จริง · `d`/`soft`=soft delete · **verb ที่แนะนำ:** GET/POST/PUT/DELETE (ชื่อ route/DTO ให้ทีมกำหนดเอง) · **ระดับความละเอียด:** รายการ method ด้านล่างเป็นระดับ *repository* เพื่อหา CRUD — การออกแบบ endpoint ให้ยึดตาม `06-service-use-cases.md` + `04-business-rules.md`

## 1. สรุปภาพรวม

| Module | ตารางที่เป็นเจ้าของ | Repository ที่ใช้จริง | Public repo method ที่ใช้จริง |
|---|---:|---:|---:|
| DMS | 20 | 18 | 114 |
| KMS | 9 | 8 | 56 |
| RGP | 20 | 15 | 89 |
| WFE | 6 | 6 | 30 |
| Shared (ใช้ร่วมหลาย module) | 8 | 9 | 46 |
| **รวม** | **63** | **53** | **335** |

- Repository method (public) ทั้งหมดในโค้ด 412 → **ใช้จริง 338** · dead 74 (ตัดออก, ภาคผนวก A)
- ตารางที่ใช้งานจริง: **63** ตาราง (รวม `dbo.SystemConfig` ที่เข้าถึงผ่าน `ConfigManager`) · Stored Procedure ที่ใช้งานจริง **80** ตัว (จาก 124 ตัวใน DB)
- หลาย DataSource: `ConnectionString` (CMS_DB) เป็นหลัก; RGP เพิ่ม `ProjectDb`, `BisDb`, `CmsLinkDb` และอ้างข้ามฐาน `BUI_RG.dbo.*` (ภาคผนวก C)
- ตารางใหญ่ที่ต้องมี paging: `EMS.Notification` 525,748 · `audit.AuditLog` 251,485 · `workflow.ApprovalStep` 222,519 · `KMS.t_KBArticle` 19,080 · `KMS.t_KBVersion` 18,240 · `KMS.t_KBArticleAttachment` 17,804

### 1.1 ลำดับงานที่แนะนำ

- [ ] **Phase 0** — ปิดคำถามค้างใน [`OPEN_QUESTIONS.md`](docs/nestjs-api/OPEN_QUESTIONS.md) (A1–A5 DDL ที่ขาด, B1–B10) · โครง Nest: multi-DataSource, `ConfigModule` (+`dbo.SystemConfig`), `AuthModule` (AD Auth API → JWT/`UserContext`), `AuditModule`, error format, paging
- [ ] **Phase 1 — Shared** (§6): `EMS.UserAccount`, `EMS.OrgUnit`, `EMS.m_*`, `audit.AuditLog`, `EMS.Notification`
- [ ] **Phase 2 — DMS** (§2): Folder/File/Permission (`PermissionEvaluator`) ก่อน → Approval/Share/Quota → Admin (User, Org master, Menu, Template)
- [ ] **Phase 3 — KMS** (§3): Category → Article/Version/Link/Attachment → Import Template/Display Profile → Import (job) → Dashboard (ทำ query จริง)
- [ ] **Phase 4 — RGP** (§4): Template → Project/State/Task/Progress → Doc workflow/Member/Attachment
- [ ] **Phase 5 — WFE** (§5): Definition/Step/Connection → Instance/StepInstance (ผ่าน SP) → Delegation → SLA report

## 2. DMS — Document Management System

- Document Management — Folder/File/Permission/Approval/Share/Quota + งาน admin (User, Org, HR master, Menu, Audit)
- ไฟล์จริงเก็บบน network share (`NetworkDriveHelper`) — ตารางเก็บเฉพาะ metadata; API ต้องรับ-ส่ง stream และเขียน share เดียวกัน
- ⚠ ชื่อ repo กับตารางสลับกัน: `HrPositionRepository` → `EMS.m_Role`, `HrPositionLevelRepository` → `EMS.m_Position` (ตามโค้ดจริง)
- ส่วนใหญ่เรียกผ่าน Stored Procedure (`storage.sp_*`, `security.sp_*`, `workflow.sp_*`, `EMS.sp_*`) — รายละเอียดใน [`02-stored-procedures.md`](docs/nestjs-api/02-stored-procedures.md)

**สิ่งที่ API ต้องรักษา** (สรุป — รายละเอียด/ที่มาใน [`04-business-rules.md`](docs/nestjs-api/04-business-rules.md))

- [ ] โครง Root Folder 4 อัน (`1HC/2SC/3NC/4PC`) ต่อ OrgUnit, depth ≤ 10, 1HC ต้องผ่าน approval `CREATE_HC` (04 §2.1)
- [ ] อัลกอริทึมประเมินสิทธิ์: Deny ชนะ → Allow → สืบทอดจาก parent (หยุดที่ `InheritanceBroken`) → default deny; Manager/Admin bypass ยกเว้น Deny (04 §2.3)
- [ ] Approval: 8 `RequestType`, side-effect หลังอนุมัติตามชนิด, escalation เมื่อเกิน `ExpiryDate`, `Remark` เป็น payload (04 §2.5)
- [ ] ไฟล์: นามสกุล/100MB/SHA-256/rename เมื่อซ้ำ/versioning แบบ replace/propagate สิทธิ์จาก folder (04 §2.4)
- [ ] Share: internal ≤ 1 ปี, external ≤ 90 วัน + ห้าม HC + ต้องอนุมัติ (04 §2.6) · Quota เก็บเป็น `quota_size` บน `m_SubCommittee/m_Division/m_Department` (04 §2.7)
- [ ] ถังขยะ 30 วัน (`RecycleBinExpiry`), ลบ folder ที่มีไฟล์ต้องขออนุมัติ, `FileCount` คำนวณสด (04 §2.2)
- [ ] OrgUnit/Menu/User management เป็น Admin-only แต่ `UserAdminController` เดิมไม่มี guard — API ต้องบังคับเอง (04 §2.8, OPEN_QUESTIONS C15)

**สรุป CRUD ต่อตาราง** (รายละเอียดคอลัมน์ → data dictionary)

| ตาราง | แถว | C | R | U | D | Repository | ใช้โดย |
|---|--:|:-:|:-:|:-:|:-:|---|---|
| [`EMS.FolderAuthorityConfig`](docs/nestjs-api/data-dictionary/DMS.md#emsfolderauthorityconfig) | 752 | ✅ | ✅ | ✅ | soft | FolderAuthority | DMS |
| [`EMS.MenuItem`](docs/nestjs-api/data-dictionary/DMS.md#emsmenuitem) | 54 | ✅ | ✅ | ✅ | ✅ | MenuItem | DMS |
| [`EMS.OrgUnitRelationship`](docs/nestjs-api/data-dictionary/DMS.md#emsorgunitrelationship) | 3 | — | ✅ | — | — | FolderQuotaConfig, OrgUnit | DMS |
| [`EMS.m_Position`](docs/nestjs-api/data-dictionary/DMS.md#emsm_position) | 8 | ✅ | ✅ | ✅ | ✅ | HrPositionLevel | DMS |
| [`EMS.m_PositionMapping`](docs/nestjs-api/data-dictionary/DMS.md#emsm_positionmapping) | 154 | ✅ | ✅ | ✅ | ✅ | HrPositionMapping | DMS |
| [`EMS.m_Role`](docs/nestjs-api/data-dictionary/DMS.md#emsm_role) | 132 | ✅ | ✅ | ✅ | ✅ | HrPosition, HrPositionMapping | DMS |
| [`dms.FolderQuotaChangeRequest`](docs/nestjs-api/data-dictionary/DMS.md#dmsfolderquotachangerequest) | 4 | ✅ | ✅ | ✅ | — | FolderQuotaChangeRequest | DMS |
| [`security.FilePermission`](docs/nestjs-api/data-dictionary/DMS.md#securityfilepermission) | 59 | ✅ | ✅ | ✅ | — | FilePermission | DMS, KMS, RGP |
| [`security.FolderPermission`](docs/nestjs-api/data-dictionary/DMS.md#securityfolderpermission) | 6 | ✅ | ✅ | ✅ | ✅ | Permission | DMS, KMS, RGP |
| [`security.UserOrgVisibility`](docs/nestjs-api/data-dictionary/DMS.md#securityuserorgvisibility) | 254 | ✅ | ✅ | ✅ | ✅ | UserOrgVisibility | DMS |
| [`storage.ExternalShare`](docs/nestjs-api/data-dictionary/DMS.md#storageexternalshare) | 4 | ✅ | ✅ | ✅ | — | ExternalShare | DMS |
| [`storage.FileDocument`](docs/nestjs-api/data-dictionary/DMS.md#storagefiledocument) | 2,812 | ✅ | ✅ | ✅ | ✅ | FileDocument, Folder, FolderQuotaConfig, ProjectAttachment | DMS, KMS, RGP |
| [`storage.Folder`](docs/nestjs-api/data-dictionary/DMS.md#storagefolder) | 411 | ✅ | ✅ | ✅ | ✅ (+soft) | FileDocument, Folder, FolderQuotaConfig, OrgUnit, ProjectAttachment | DMS, KMS, RGP |
| [`storage.FolderTemplate`](docs/nestjs-api/data-dictionary/DMS.md#storagefoldertemplate) | 4 | ✅ | ✅ | ✅ | ✅ | FolderTemplate | DMS |
| [`storage.FolderTemplateItem`](docs/nestjs-api/data-dictionary/DMS.md#storagefoldertemplateitem) | 8 | ✅ | ✅ | ✅ | ✅ | FolderTemplate | DMS |
| [`storage.QuickAccessFolder`](docs/nestjs-api/data-dictionary/DMS.md#storagequickaccessfolder) | ? | ✅ | ✅ | — | ✅ | QuickAccess | DMS |
| [`storage.ShareAccessLog`](docs/nestjs-api/data-dictionary/DMS.md#storageshareaccesslog) | 0 | ✅ | ✅ | — | — | ShareAccessLog | DMS |
| [`storage.ShareToken`](docs/nestjs-api/data-dictionary/DMS.md#storagesharetoken) | 4 | ✅ | ✅ | ✅ | — | ShareToken | DMS |
| [`workflow.ApprovalRequest`](docs/nestjs-api/data-dictionary/DMS.md#workflowapprovalrequest) | 40 | ✅ | ✅ | ✅ | ✅ | Approval | DMS |
| [`workflow.ApprovalStep`](docs/nestjs-api/data-dictionary/DMS.md#workflowapprovalstep) | 222,519 | ✅ | ✅ | ✅ | ✅ | Approval | DMS |

**Tasklist ต่อตาราง**

- [ ] **`EMS.FolderAuthorityConfig`** — `CRUd` · ใช้โดย: DMS · 752 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#emsfolderauthorityconfig)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<FolderAuthorityConfig>` · op `R` — SP: `EMS.sp_GetAllFolderAuthorityConfigs`
  - [ ] **GET** `Resolve(string positionName, string departmentCode, string divisionCode, string levelCode = null)` → `IEnumerable<FolderAuthorityConfig>` · op `R` — SP: `EMS.sp_ResolveFolderAuthority`
  - [ ] **POST** `Insert(FolderAuthorityConfig c, int createdBy)` → `int` · op `C` — SP: `EMS.sp_InsertFolderAuthorityConfig`
  - [ ] **PUT** `Update(FolderAuthorityConfig c, int updatedBy)` · op `U` — SP: `EMS.sp_UpdateFolderAuthorityConfig`
  - [ ] **DELETE** `Delete(string configLabel, int deletedBy)` · op `d` — SP: `EMS.sp_DeleteFolderAuthorityConfig`
- [ ] **`EMS.MenuItem`** — `CRUD` · ใช้โดย: DMS · 54 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#emsmenuitem)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAllMenuItems()` → `List<MenuItem>` · op `R`
  - [ ] **GET** `GetRootMenuItems()` → `List<MenuItem>` · op `R`
  - [ ] **GET** `GetChildMenuItems(int parentMenuItemID)` → `List<MenuItem>` · op `R`
  - [ ] **GET** `GetMenuItemByID(int menuItemID)` → `MenuItem` · op `R`
  - [ ] **GET** `GetMenuItemByKey(string menuKey)` → `MenuItem` · op `R`
  - [ ] **POST** `CreateMenuItem(MenuItem menuItem)` → `int` · op `C` — SP: `EMS.sp_CreateMenuItem`
  - [ ] **PUT** `UpdateMenuItem(MenuItem menuItem)` · op `U` — SP: `EMS.sp_UpdateMenuItem`
  - [ ] **DELETE** `DeleteMenuItem(int menuItemID)` · op `D` — SP: `EMS.sp_DeleteMenuItem`
  - [ ] **GET** `GetMenuHierarchy()` → `List<MenuItem>` · op `R`
- [ ] **`EMS.OrgUnitRelationship`** — `·R··` · ใช้โดย: DMS · 3 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#emsorgunitrelationship)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAllActiveRelationships()` → `IEnumerable<OrgUnitRelationship>` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FolderQuotaConfig.GetAllFileStats`
- [ ] **`EMS.m_Position`** — `CRUD` · ใช้โดย: DMS · 8 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#emsm_position)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<HrPositionLevel>` · op `R`
  - [ ] **POST** `Save(HrPositionLevel level)` → `bool` · op `C`
  - [ ] **DELETE** `Delete(string levelCode)` → `bool` · op `D`
- [ ] **`EMS.m_PositionMapping`** — `CRUD` · ใช้โดย: DMS · 154 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#emsm_positionmapping)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<HrPositionMapping>` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`, `EMS.m_Role`
  - [ ] **GET** `GetByDepartmentId(int departmentId)` → `IEnumerable<HrPositionMapping>` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`, `EMS.m_Role`
  - [ ] **POST** `Save(HrPositionMapping mapping)` → `int` · op `C`
  - [ ] **DELETE** `Delete(int mappingId)` → `bool` · op `D`
- [ ] **`EMS.m_Role`** — `CRUD` · ใช้โดย: DMS · 132 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#emsm_role)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<HrPosition>` · op `R`
  - [ ] **POST** `Save(HrPosition position)` → `int` · op `C`
  - [ ] **DELETE** `Delete(int positionId)` → `bool` · op `D`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `HrPositionMapping.GetAll`, `HrPositionMapping.GetByDepartmentId`
- [ ] **`dms.FolderQuotaChangeRequest`** — `CRU·` · ใช้โดย: DMS · 4 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#dmsfolderquotachangerequest)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(FolderQuotaChangeRequest req)` → `int` · op `C`
  - [ ] **GET** `GetById(int requestId)` → `FolderQuotaChangeRequest` · op `R` — join/อ่าน: `EMS.OrgUnit`, `EMS.UserAccount`
  - [ ] **GET** `GetPending()` → `IEnumerable<FolderQuotaChangeRequest>` · op `R` — join/อ่าน: `EMS.OrgUnit`, `EMS.UserAccount`
  - [ ] **GET** `GetAll()` → `IEnumerable<FolderQuotaChangeRequest>` · op `R` — join/อ่าน: `EMS.OrgUnit`, `EMS.UserAccount`
  - [ ] **PUT** `UpdateStatus(int requestId, QuotaRequestStatus status, int reviewedBy, string remark)` · op `U`
- [ ] **`security.FilePermission`** — `CRU·` · ใช้โดย: DMS, KMS, RGP · 59 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#securityfilepermission)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(FilePermission permission)` → `int` · op `C` — SP: `security.sp_InsertFilePermission`
  - [ ] **GET** `GetById(int filePermissionId)` → `FilePermission` · op `R`
  - [ ] **GET** `GetByFile(int fileId)` → `IEnumerable<FilePermission>` · op `R` — SP: `security.sp_GetFilePermissionsByFile`
  - [ ] **GET** `GetByGrantedBy(int userId)` → `IEnumerable<FilePermission>` · op `R`
  - [ ] **GET** `GetAll()` → `IEnumerable<FilePermission>` · op `R`
  - [ ] **GET** `GetByPrincipal(int principalType, int principalId)` → `IEnumerable<FilePermission>` · op `R`
  - [ ] **PUT** `Revoke(int filePermissionId, int revokedBy, string revokeReason)` · op `U` — SP: `security.sp_RevokeFilePermission`
- [ ] **`security.FolderPermission`** — `CRUD` · ใช้โดย: DMS, KMS, RGP · 6 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#securityfolderpermission)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(FolderPermission permission)` → `int` · op `C` — SP: `security.sp_InsertFolderPermission`
  - [ ] **GET** `GetByFolder(int folderId)` → `IEnumerable<FolderPermission>` · op `R` — SP: `security.sp_GetPermissionsByFolder`
  - [ ] **GET** `GetAllByFolder(int folderId)` → `IEnumerable<FolderPermission>` · op `R` — SP: `security.sp_GetAllPermissionsByFolder`
  - [ ] **GET** `GetByPrincipal(int principalType, int principalId)` → `IEnumerable<FolderPermission>` · op `R` — SP: `security.sp_GetPermissionsByPrincipal`
  - [ ] **PUT** `Revoke(int permissionId, int revokedBy, string revokeReason)` · op `U` — SP: `security.sp_RevokePermission`
  - [ ] **DELETE** `DeleteByFolder(int folderId)` · op `D`
  - [ ] **GET** `GetAclEntries(int folderId)` → `IEnumerable<FolderPermission>` · op `R` — SP: `security.sp_GetPermissionsByFolder`
  - [ ] **GET** `GetAllForUser(int userId, int roleId, int? deptId, int? divId)` → `IEnumerable<FolderPermission>` · op `R`
- [ ] **`security.UserOrgVisibility`** — `CRUD` · ใช้โดย: DMS · 254 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#securityuserorgvisibility)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByUser(int userId)` → `IEnumerable<UserOrgVisibility>` · op `R`
  - [ ] **POST** `Grant(UserOrgVisibility record)` · op `C`
  - [ ] **DELETE** `Revoke(int userId, int orgUnitId)` · op `D`
- [ ] **`storage.ExternalShare`** — `CRU·` · ใช้โดย: DMS · 4 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storageexternalshare)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(ExternalShare externalShare)` → `int` · op `C`
  - [ ] **GET** `GetById(int externalShareId)` → `ExternalShare` · op `R`
  - [ ] **GET** `GetBySharer(int sharerUserId)` → `IEnumerable<ExternalShare>` · op `R`
  - [ ] **PUT** `Update(ExternalShare externalShare)` · op `U`
  - [ ] **GET** `GetAll()` → `IEnumerable<ExternalShare>` · op `R`
- [ ] **`storage.FileDocument`** — `CRUD` · ใช้โดย: DMS, KMS, RGP · 2,812 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storagefiledocument)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetById(int folderId)` → `Folder` · op `R` — SP: `storage.sp_GetFolderByID`; join/อ่าน: `storage.Folder`
  - [ ] **GET** `GetChildren(int parentFolderId)` → `IEnumerable<Folder>` · op `R` — SP: `storage.sp_GetFolderChildren`; join/อ่าน: `storage.Folder`
  - [ ] **GET** `GetRootFoldersByOrgUnit(int orgUnitId)` → `IEnumerable<Folder>` · op `R` — SP: `storage.sp_GetRootFoldersByOrgUnit`; join/อ่าน: `storage.Folder`
  - [ ] **GET** `GetByOrgUnit(int orgUnitId)` → `IEnumerable<Folder>` · op `R` — SP: `storage.sp_GetFoldersByOrgUnit`; join/อ่าน: `EMS.UserAccount`, `storage.Folder`
  - [ ] **GET** `GetAll()` → `IEnumerable<Folder>` · op `R` — SP: `storage.sp_GetAllFolders`; join/อ่าน: `EMS.UserAccount`, `storage.Folder`
  - [ ] **GET** `GetSiblings(int? parentFolderId, int orgUnitId)` → `IEnumerable<Folder>` · op `R` — SP: `storage.sp_GetFolderSiblings`; join/อ่าน: `EMS.UserAccount`, `storage.Folder`
  - [ ] **POST** `Insert(FileDocument document)` → `int` · op `C` — SP: `storage.sp_InsertFileDocument`
  - [ ] **GET** `GetById(int fileId)` → `FileDocument` · op `R` — SP: `storage.sp_GetFileDocumentByID`; join/อ่าน: `EMS.UserAccount`
  - [ ] **GET** `GetByFolder(int folderId)` → `IEnumerable<FileDocument>` · op `R` — SP: `storage.sp_GetFileDocumentsByFolder`; join/อ่าน: `EMS.UserAccount`, `storage.Folder`
  - [ ] **PUT** `Update(FileDocument document)` · op `U` — SP: `storage.sp_UpdateFileDocument`
  - [ ] **PUT** `SoftDelete(int fileId, int deletedBy)` · op `U` — SP: `storage.sp_SoftDeleteFileDocument`
  - [ ] **DELETE** `PermanentDelete(int fileId)` · op `D`
  - [ ] **GET** `GetAllGroupedByFolder()` → `IEnumerable<FileDocument>` · op `R` — SP: `storage.sp_GetAllFileDocumentsGroupedByFolder`; join/อ่าน: `EMS.UserAccount`, `storage.Folder`
  - [ ] **DELETE** `DeleteAllByFolder(int folderId)` · op `D`
  - [ ] **GET** `ExistsWithName(string fileName, int folderId)` → `bool` · op `R`
  - [ ] **GET** `GetByOriginalName(string fileName, int folderId)` → `FileDocument` · op `R`
  - [ ] **GET** `CountByNamePrefix(string namePrefix, int folderId)` → `int` · op `R`
  - [ ] **PUT** `RenameFile(int fileId, string newName)` · op `U` — SP: `storage.sp_RenameFileDocument`
  - [ ] **GET** `GetDeletedFiles(int? orgUnitId)` → `IEnumerable<FileDocument>` · op `R` — join/อ่าน: `EMS.OrgUnit`, `storage.Folder`
  - [ ] **POST** `RestoreFile(int fileId)` · op `U`
  - [ ] **PUT** `UpdateVersion(int fileId, int version)` · op `U`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FileDocument.GetByOrgUnit`, `Folder.GetDescendants`, `Folder.UpdateFileCount`, `FolderQuotaConfig.GetAllFileStats`, `ProjectAttachment.GetByProject`
- [ ] **`storage.Folder`** — `CRUD` · ใช้โดย: DMS, KMS, RGP · 411 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storagefolder)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `HasActiveDependents(int orgUnitId)` → `bool` · op `R` — SP: `EMS.sp_HasActiveDependents`; join/อ่าน: `EMS.UserAccount`
  - [ ] **DELETE** `ForceDeleteWithDependents(int orgUnitId, int deletedBy)` · op `d` — SP: `EMS.sp_SoftDeleteOrgUnit`; เขียนตารางอื่น: `d:EMS.OrgUnit`
  - [ ] **POST** `Insert(Folder folder)` → `int` · op `C` — SP: `storage.sp_InsertFolder`
  - [ ] **PUT** `Update(Folder folder)` · op `U` — SP: `storage.sp_UpdateFolder`
  - [ ] **PUT** `UpdateFileCount(int folderId)` · op `U` — SP: `storage.sp_UpdateFolderFileCount`; join/อ่าน: `storage.FileDocument`
  - [ ] **GET** `GetDescendants(int folderId)` → `IEnumerable<Folder>` · op `R` — SP: `storage.sp_GetFolderDescendants`; join/อ่าน: `EMS.UserAccount`, `storage.FileDocument`
  - [ ] **GET** `GetAllRootFolders()` → `IEnumerable<Folder>` · op `R`
  - [ ] **GET** `GetAllDeletedFolders()` → `IEnumerable<Folder>` · op `R`
  - [ ] **GET** `GetDeletedByOrgUnit(int orgUnitId)` → `IEnumerable<Folder>` · op `R` — SP: `storage.sp_GetDeletedFoldersByOrgUnit`
  - [ ] **DELETE** `SoftDelete(int folderId, int deletedBy)` · op `d` — SP: `storage.sp_SoftDeleteFolder`
  - [ ] **POST** `Restore(int folderId)` · op `U` — SP: `storage.sp_RestoreFolder`
  - [ ] **DELETE** `PermanentDelete(int folderId)` · op `D`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FileDocument.GetAllGroupedByFolder`, `FileDocument.GetByFolder`, `FileDocument.GetByOrgUnit`, `FileDocument.GetDeletedFiles`, `Folder.GetAll`, `Folder.GetById`, `Folder.GetByOrgUnit`, `Folder.GetChildren`, `Folder.GetRootFoldersByOrgUnit`, `Folder.GetSiblings`, `FolderQuotaConfig.GetAllFileStats`, `OrgUnit.GetByConfidentialityLevel`, `ProjectAttachment.GetByProject`
- [ ] **`storage.FolderTemplate`** — `CRUD` · ใช้โดย: DMS · 4 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storagefoldertemplate)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(FolderTemplate template)` → `int` · op `C` — SP: `storage.sp_InsertFolderTemplate`
  - [ ] **GET** `GetAll()` → `IEnumerable<FolderTemplate>` · op `R` — SP: `storage.sp_GetAllFolderTemplates`; join/อ่าน: `EMS.OrgUnit`
  - [ ] **PUT** `Update(FolderTemplate template)` · op `U` — SP: `storage.sp_UpdateFolderTemplate`
  - [ ] **DELETE** `Delete(int templateId)` · op `D` — SP: `storage.sp_DeleteFolderTemplate`; เขียนตารางอื่น: `D:storage.FolderTemplateItem`
- [ ] **`storage.FolderTemplateItem`** — `CRUD` · ใช้โดย: DMS · 8 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storagefoldertemplateitem)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetItems(int templateId)` → `IEnumerable<FolderTemplateItem>` · op `R` — SP: `storage.sp_GetFolderTemplateItems`
  - [ ] **POST** `InsertItem(FolderTemplateItem item)` → `int` · op `C` — SP: `storage.sp_InsertFolderTemplateItem`
  - [ ] **PUT** `UpdateItem(FolderTemplateItem item)` · op `U` — SP: `storage.sp_UpdateFolderTemplateItem`
  - [ ] **DELETE** `DeleteItem(int itemId)` · op `D` — SP: `storage.sp_DeleteFolderTemplateItem`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FolderTemplate.Delete`
- [ ] **`storage.QuickAccessFolder`** — `CR·D` · ใช้โดย: DMS · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storagequickaccessfolder)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByUser(int userId)` → `IEnumerable<QuickAccessFolder>` · op `R` — SP: `storage.sp_GetQuickAccessByUser`
  - [ ] **POST** `Add(int userId, int folderId)` · op `C` — SP: `storage.sp_AddQuickAccess`
  - [ ] **DELETE** `Remove(int userId, int folderId)` · op `D` — SP: `storage.sp_RemoveQuickAccess`
- [ ] **`storage.ShareAccessLog`** — `CR··` · ใช้โดย: DMS · 0 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storageshareaccesslog)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(ShareAccessLog accessLog)` → `long` · op `C`
  - [ ] **GET** `GetByExternalShare(int externalShareId)` → `IEnumerable<ShareAccessLog>` · op `R`
- [ ] **`storage.ShareToken`** — `CRU·` · ใช้โดย: DMS · 4 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#storagesharetoken)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(ShareToken shareToken)` → `int` · op `C`
  - [ ] **PUT** `Update(ShareToken shareToken)` · op `U`
  - [ ] **GET** `GetByExternalShare(int externalShareId)` → `IEnumerable<ShareToken>` · op `R`
- [ ] **`workflow.ApprovalRequest`** — `CRUD` · ใช้โดย: DMS · 40 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#workflowapprovalrequest)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `InsertRequest(ApprovalRequest request)` → `int` · op `C`
  - [ ] **GET** `GetRequest(int requestId)` → `ApprovalRequest` · op `R` — SP: `workflow.sp_GetApprovalRequestByID`
  - [ ] **GET** `GetAllRequestsByFolder(int folderId)` → `IEnumerable<ApprovalRequest>` · op `R`
  - [ ] **GET** `GetPendingRequests()` → `IEnumerable<ApprovalRequest>` · op `R`
  - [ ] **GET** `GetExpiredPendingRequests()` → `IEnumerable<ApprovalRequest>` · op `R` — SP: `workflow.sp_GetExpiredPendingRequests`
  - [ ] **PUT** `UpdateRequestStatus(int requestId, int requestStatus, int resolvedBy, string resolveRemark)` · op `U` — SP: `workflow.sp_UpdateApprovalRequestStatus`
  - [ ] **GET** `GetApprovedDownloadRequest(int fileId, int userId)` → `ApprovalRequest` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `Approval.DeleteByFolder`
- [ ] **`workflow.ApprovalStep`** — `CRUD` · ใช้โดย: DMS · 222,519 แถว · [data dictionary](docs/nestjs-api/data-dictionary/DMS.md#workflowapprovalstep)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `InsertStep(ApprovalStep step)` → `int` · op `C`
  - [ ] **GET** `GetPendingSteps(int requestId)` → `IEnumerable<ApprovalStep>` · op `R`
  - [ ] **GET** `GetAllSteps(int requestId)` → `IEnumerable<ApprovalStep>` · op `R` — SP: `workflow.sp_GetAllApprovalSteps`
  - [ ] **PUT** `UpdateStepStatus(int stepId, int stepStatus, string actionRemark)` · op `U` — SP: `workflow.sp_UpdateApprovalStepStatus`
  - [ ] **DELETE** `DeleteByFolder(int folderId)` · op `D` — เขียนตารางอื่น: `D:workflow.ApprovalRequest`; join/อ่าน: `workflow.ApprovalRequest`

**ตารางของ module อื่น/Shared ที่ DMS เรียกใช้**

| ตาราง | เจ้าของ | การกระทำที่ DMS ใช้ | Repository.Method ที่ถูกเรียก |
|---|---|---|---|
| `EMS.Notification` | SHARED | `C···` | `Notification.Insert` |
| `EMS.OrgUnit` | SHARED | `CRUd` | `OrgUnit.Insert`, `OrgUnit.Update`, `OrgUnit.GetById`, `OrgUnit.ExistsByCode`, `OrgUnit.ExistsByNameUnderParent`, `OrgUnit.GetHierarchy`, `OrgUnit.GetByConfidentialityLevel`, `OrgUnit.SoftDelete`, `OrgUnit.Deactivate`, `OrgUnit.ForceDeleteWithDependents` … (+8) |
| `EMS.UserAccount` | SHARED | `CRUd` | `UserAccount.GetByADUserName`, `UserAccount.GetById`, `UserAccount.GetByRole`, `UserAccount.GetAll`, `UserAccount.Create`, `UserAccount.Update`, `UserAccount.UpdateLevelCode`, `UserAccount.UpdateLastLoginWithIP`, `UserAccount.RegisterOrUpdate`, `UserAccount.UpsertFromLdap` … (+14) |
| `EMS.m_Department` | SHARED | `CRUD` | `FileDocument.GetByOrgUnit`, `HrDepartment.GetAll`, `HrDepartment.Save`, `HrDepartment.Delete`, `HrPositionMapping.GetAll`, `HrPositionMapping.GetByDepartmentId`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `FolderQuotaConfig.GetAll` … (+3) |
| `EMS.m_Division` | SHARED | `CRUD` | `FileDocument.GetByOrgUnit`, `HrDivision.GetAll`, `HrDivision.Save`, `HrDivision.Delete`, `HrPositionMapping.GetAll`, `HrPositionMapping.GetByDepartmentId`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `FolderQuotaConfig.GetAll` … (+3) |
| `EMS.m_SubCommittee` | SHARED | `CRU·` | `OrgUnit.InsertSubCommitteeRecord`, `FileDocument.GetByOrgUnit`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `FolderQuotaConfig.GetAll`, `FolderQuotaConfig.Save`, `FolderQuotaConfig.Delete`, `FolderQuotaConfig.GetAllFileStats` |
| `audit.AuditLog` | SHARED | `CR··` | `Audit.Insert`, `Audit.Query` |

## 3. KMS — Knowledge Management System

- Knowledge Management — Category / Article / Version / Link / Attachment / Import Template / Display Profile
- DDL ใน `MOD-006/*.sql` ครอบคลุมเกือบทั้งหมด แต่ **ไม่มี `KMS.t_KBArticleAttachment`** — ใช้ DDL ใน data dictionary
- **KB Dashboard เป็น mock** — `KBDashboardRepository` ทั้ง 3 method คืนค่าคงที่ ไม่แตะ DB → ต้องออกแบบ query จริงใหม่
- Attachment อัปโหลดผ่าน DMS (`storage.FileDocument`) — KMS พึ่งตารางของ DMS

**สิ่งที่ API ต้องรักษา** (สรุป — รายละเอียด/ที่มาใน [`04-business-rules.md`](docs/nestjs-api/04-business-rules.md))

- [ ] วงจรบทความ Draft→Review→Published→Archived (Archived แล้วแก้ไม่ได้) — service เดิมไม่บังคับ role (04 §3.1)
- [ ] Code รวม 29 ตัวอักษร, ชนิด Law/Decree/NonLaw, หมวดรายปี, re-upload = update ไม่แตะ `ArticleCode`/`CategoryID` (04 §3.3 + `AGENTS.md`)
- [ ] ย้ายบทความเปลี่ยนแค่ `CategoryID` (ไม่สร้าง version); แก้ไขเพิ่ม version เฉพาะเมื่อ ContentHTML เปลี่ยน (04 §3.1)
- [ ] Category ไม่จำกัดความลึก; `CategoryID` อาจไม่ใช่ IDENTITY (ใช้ MAX+1 แบบ Serializable) (04 §3.2)
- [ ] Import เป็นงานหนัก (อ่าน Excel + อัปโหลดไฟล์เข้า DMS โฟลเดอร์ 437) — ออกแบบเป็น job/streaming

**สรุป CRUD ต่อตาราง** (รายละเอียดคอลัมน์ → data dictionary)

| ตาราง | แถว | C | R | U | D | Repository | ใช้โดย |
|---|--:|:-:|:-:|:-:|:-:|---|---|
| [`KMS.m_KBArticleDisplayProfile`](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbarticledisplayprofile) | 5 | ✅ | ✅ | ✅ | soft | KBArticleDisplayProfile | KMS |
| [`KMS.m_KBArticleDisplayProfileColumn`](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbarticledisplayprofilecolumn) | 35 | ✅ | ✅ | — | ✅ | KBArticleDisplayProfile | KMS |
| [`KMS.m_KBCategory`](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbcategory) | 94 | ✅ | ✅ | ✅ | soft | KBArticle, KBCategory, Kms | KMS, RGP |
| [`KMS.m_KBImportTemplate`](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbimporttemplate) | 4 | ✅ | ✅ | ✅ | soft | KBImportTemplate | KMS |
| [`KMS.m_KBImportTemplateColumn`](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbimporttemplatecolumn) | 40 | ✅ | ✅ | — | ✅ | KBImportTemplate | KMS |
| [`KMS.t_KBArticle`](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbarticle) | 19,080 | ✅ | ✅ | ✅ | soft | KBArticle | KMS |
| [`KMS.t_KBArticleAttachment`](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbarticleattachment) | 17,804 | ✅ | ✅ | — | ✅ | KBArticleAttachment | KMS |
| [`KMS.t_KBArticleLink`](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbarticlelink) | 24,616 | ✅ | ✅ | — | ✅ | KBArticle, KBArticleLink | KMS |
| [`KMS.t_KBVersion`](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbversion) | 18,240 | ✅ | ✅ | — | — | KBArticle, KBVersion | KMS |

**Tasklist ต่อตาราง**

- [ ] **`KMS.m_KBArticleDisplayProfile`** — `CRUd` · ใช้โดย: KMS · 5 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbarticledisplayprofile)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<KBArticleDisplayProfile>` · op `R`
  - [ ] **GET** `GetById(int profileId)` → `KBArticleDisplayProfile` · op `R`
  - [ ] **GET** `ExistsByName(string profileName, int excludeProfileId = 0)` → `bool` · op `R`
  - [ ] **POST** `SaveProfileWithColumns(KBArticleDisplayProfile profile, IList<KBArticleDisplayProfileColumn> columns)` → `int` · op `C` — เขียนตารางอื่น: `C:KMS.m_KBArticleDisplayProfileColumn`, `D:KMS.m_KBArticleDisplayProfileColumn`
  - [ ] **DELETE** `Deactivate(int profileId)` · op `d`
  - [ ] **POST** `Activate(int profileId)` · op `U`
- [ ] **`KMS.m_KBArticleDisplayProfileColumn`** — `CR·D` · ใช้โดย: KMS · 35 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbarticledisplayprofilecolumn)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetColumnsByProfileId(int profileId)` → `IList<KBArticleDisplayProfileColumn>` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `KBArticleDisplayProfile.SaveProfileWithColumns`
- [ ] **`KMS.m_KBCategory`** — `CRUd` · ใช้โดย: KMS, RGP · 94 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbcategory)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<KBCategory>` · op `R`
  - [ ] **GET** `GetAllActive()` → `IEnumerable<KBCategory>` · op `R`
  - [ ] **GET** `GetById(int categoryId)` → `KBCategory` · op `R`
  - [ ] **POST** `Insert(KBCategory category)` → `int` · op `C`
  - [ ] **PUT** `Update(KBCategory category)` · op `U`
  - [ ] **DELETE** `SoftDelete(int categoryId)` · op `d`
  - [ ] **GET** `GetLawTypes()` → `DataTable` · op `R` — conn: `CmsLinkDbConnectionString`
  - [ ] **GET** `GetCategoriesByParent(int parentCategoryId)` → `DataTable` · op `R` — conn: `CmsLinkDbConnectionString`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.GetById`, `KBArticle.GetMoveCandidates`, `KBArticle.GetMoveCandidatesByIds`, `KBArticle.Search`
- [ ] **`KMS.m_KBImportTemplate`** — `CRUd` · ใช้โดย: KMS · 4 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbimporttemplate)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<KBImportTemplate>` · op `R`
  - [ ] **GET** `GetById(int templateId)` → `KBImportTemplate` · op `R`
  - [ ] **GET** `ExistsByName(string templateName, int excludeTemplateId = 0)` → `bool` · op `R`
  - [ ] **POST** `SaveTemplateWithMappings(KBImportTemplate template, IList<KBImportTemplateColumnMapping> mappings)` → `int` · op `C` — เขียนตารางอื่น: `C:KMS.m_KBImportTemplateColumn`, `D:KMS.m_KBImportTemplateColumn`
  - [ ] **DELETE** `Deactivate(int templateId, string updatedBy)` · op `d`
  - [ ] **POST** `Activate(int templateId, string updatedBy)` · op `U`
- [ ] **`KMS.m_KBImportTemplateColumn`** — `CR·D` · ใช้โดย: KMS · 40 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmsm_kbimporttemplatecolumn)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetMappingsByTemplateId(int templateId)` → `IList<KBImportTemplateColumnMapping>` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `KBImportTemplate.SaveTemplateWithMappings`
- [ ] **`KMS.t_KBArticle`** — `CRUd` · ใช้โดย: KMS · 19,080 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbarticle)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetById(int articleId)` → `KBArticle` · op `R` — join/อ่าน: `KMS.m_KBCategory`
  - [ ] **POST** `Insert(KBArticle article)` → `int` · op `C`
  - [ ] **POST** `InsertWithVersion(KBArticle article, KBVersion version)` → `int` · op `C` — เขียนตารางอื่น: `C:KMS.t_KBVersion`
  - [ ] **PUT** `Update(KBArticle article, KBVersion newVersion, string updatedBy)` · op `U` — เขียนตารางอื่น: `C:KMS.t_KBVersion`; join/อ่าน: `KMS.t_KBVersion`
  - [ ] **PUT** `UpdateFromImport(int articleId, KBArticle values, IEnumerable<string> columns, string updatedBy, KBVersion newVersion)` · op `U` — เขียนตารางอื่น: `C:KMS.t_KBVersion`; join/อ่าน: `KMS.t_KBVersion`
  - [ ] **PUT** `UpdateStatus(int articleId, byte status, string reviewedBy)` · op `U`
  - [ ] **PUT** `IncrementViewCount(int articleId)` · op `U`
  - [ ] **PUT** `IncrementLikeCount(int articleId)` · op `U`
  - [ ] **GET** `GetNextCodeSequence(int year)` → `int` · op `R`
  - [ ] **GET** `GetImportableTargetColumns()` → `IList<string>` · op `R`
  - [ ] **GET** `ExistsByCode(string articleCode)` → `bool` · op `R`
  - [ ] **GET** `GetByCode(string articleCode)` → `KBArticle` · op `R`
  - [ ] **GET** `GetMoveCandidates(IEnumerable<int> categoryIds)` → `IList<KBArticle>` · op `R` — join/อ่าน: `KMS.m_KBCategory`
  - [ ] **GET** `GetMoveCandidatesByIds(IEnumerable<int> articleIds)` → `IList<KBArticle>` · op `R` — join/อ่าน: `KMS.m_KBCategory`
  - [ ] **PUT** `MoveToCategory(IEnumerable<int> articleIds, int toCategoryId, string updatedBy)` → `IList<KeyValuePair<int, int>>` · op `U`
  - [ ] **DELETE** `SoftDelete(int articleId)` · op `d`
  - [ ] **PUT** `UpdateExpiryDate(int articleId, DateTime? expiryDate)` · op `U`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.Search`
- [ ] **`KMS.t_KBArticleAttachment`** — `CR·D` · ใช้โดย: KMS · 17,804 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbarticleattachment)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAttachmentsForArticle(int articleId)` → `IEnumerable<KBArticleAttachment>` · op `R`
  - [ ] **POST** `Insert(KBArticleAttachment attachment)` → `int` · op `C`
  - [ ] **DELETE** `Delete(int attachmentId)` · op `D`
  - [ ] **DELETE** `DeleteAllForArticle(int articleId)` · op `D`
  - [ ] **DELETE** `DeleteByArticleAndFile(int articleId, int fileId)` · op `D`
- [ ] **`KMS.t_KBArticleLink`** — `CR·D` · ใช้โดย: KMS · 24,616 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbarticlelink)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<KBArticle>` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`, `EMS.m_SubCommittee`, `KMS.m_KBCategory`, `KMS.t_KBArticle`
  - [ ] **GET** `GetByCategory(int categoryId)` → `IEnumerable<KBArticle>` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`, `EMS.m_SubCommittee`, `KMS.m_KBCategory`, `KMS.t_KBArticle`
  - [ ] **GET** `Search(int? categoryId, byte? status, byte? articleType)` → `IEnumerable<KBArticle>` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`, `EMS.m_SubCommittee`, `KMS.m_KBCategory`, `KMS.t_KBArticle`
  - [ ] **GET** `GetLinksForArticle(int articleId, byte? entityType = null)` → `IEnumerable<KBArticleLink>` · op `R`
  - [ ] **GET** `GetAllByEntityType(byte entityType)` → `IEnumerable<KBArticleLink>` · op `R`
  - [ ] **POST** `Insert(KBArticleLink link)` → `int` · op `C`
  - [ ] **GET** `Exists(int articleId, byte entityType, string entityId)` → `bool` · op `R`
  - [ ] **DELETE** `Delete(int linkId)` · op `D`
  - [ ] **DELETE** `DeleteAllForArticle(int articleId, byte? entityType = null)` · op `D`
- [ ] **`KMS.t_KBVersion`** — `CR··` · ใช้โดย: KMS · 18,240 แถว · [data dictionary](docs/nestjs-api/data-dictionary/KMS.md#kmst_kbversion)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByArticle(int articleId)` → `IEnumerable<KBVersion>` · op `R`
  - [ ] **GET** `GetLatestByArticle(int articleId)` → `KBVersion` · op `R`
  - [ ] **POST** `Insert(KBVersion version)` → `int` · op `C`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `KBArticle.InsertWithVersion`, `KBArticle.Update`, `KBArticle.UpdateFromImport`

**ตารางของ module อื่น/Shared ที่ KMS เรียกใช้**

| ตาราง | เจ้าของ | การกระทำที่ KMS ใช้ | Repository.Method ที่ถูกเรียก |
|---|---|---|---|
| `security.FilePermission` | DMS | `CRU·` | `FilePermission.Insert`, `FilePermission.GetByFile`, `FilePermission.Revoke` |
| `security.FolderPermission` | DMS | `·R··` | `Permission.GetByFolder`, `Permission.GetAclEntries` |
| `storage.FileDocument` | DMS | `CRU·` | `Folder.UpdateFileCount`, `Folder.GetById`, `Folder.GetDescendants`, `Folder.GetRootFoldersByOrgUnit`, `Folder.GetByOrgUnit`, `FileDocument.Insert`, `FileDocument.GetById`, `FileDocument.GetByFolder`, `FileDocument.SoftDelete`, `FileDocument.ExistsWithName` … (+3) |
| `storage.Folder` | DMS | `·RU·` | `Folder.Update`, `Folder.UpdateFileCount`, `Folder.GetById`, `Folder.GetDescendants`, `Folder.GetRootFoldersByOrgUnit`, `Folder.GetByOrgUnit`, `FileDocument.GetByFolder` |
| `EMS.Notification` | SHARED | `C···` | `Notification.Insert` |
| `EMS.OrgUnit` | SHARED | `·R··` | `OrgUnit.GetById`, `FolderQuotaConfig.GetByEmsOrgUnitId` |
| `EMS.UserAccount` | SHARED | `·R··` | `UserAccount.GetById`, `Folder.GetDescendants`, `Folder.GetByOrgUnit`, `FileDocument.GetById`, `FileDocument.GetByFolder` |
| `EMS.m_Department` | SHARED | `·R··` | `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.Search`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId` |
| `EMS.m_Division` | SHARED | `·R··` | `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.Search`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId` |
| `EMS.m_SubCommittee` | SHARED | `·R··` | `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.Search`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId` |
| `audit.AuditLog` | SHARED | `C···` | `Audit.Insert` |

## 4. RGP — Project (ในโค้ดเรียก RGP)

- Project tracking — Project / State / Task / Progress / Template / Member / Doc workflow
- ใช้ **หลาย connection string** (Project / Bis / CmsLink) + ตาราง cross-db `BUI_RG.dbo.*` และ `RunningNumber`; ผู้ใช้เก็บเป็น `varchar` (ชื่อผู้ใช้)
- **E-Filing** (`EFilingRepository`, `RGP.t_project_efiling_request`) ไม่ถูกเรียกจากหน้าจอใด = dead; `RgpComposition` ไม่ถูกเรียก
- `CloseProject`, `GetSubtasks*`, `EditComment`, `HasActiveTasks`, `GetProgressHistory` มีใน service แต่ไม่มีหน้าจอเรียก (dead)

**สิ่งที่ API ต้องรักษา** (สรุป — รายละเอียด/ที่มาใน [`04-business-rules.md`](docs/nestjs-api/04-business-rules.md))

- [ ] เลขที่โครงการ/Task จาก `RunningNumber` (`PRJ`, `TK`) ภายใต้ `UPDLOCK` + รีเซ็ตรายปี (04 §4)
- [ ] สถานะ state จาก % (0/100/อื่น) → สถานะโครงการ (Open/InProgress/Completed) คำนวณใหม่ทุกครั้งที่บันทึกความคืบหน้า (04 §4)
- [ ] Task `OnHold` ตรึง %; เปลี่ยนสถานะ → sync % state = ค่าเฉลี่ย task + บันทึก `t_project_task_status_log` (04 §4)
- [ ] ลบโครงการ/ขั้นตอนถูกบล็อกถ้ามี progress; ลบ template ถูกบล็อกถ้ามีโครงการใช้ (04 §4)
- [ ] audit ลง `RGP.t_project_audit_log` (ไม่ใช่ `audit.AuditLog`)

**สรุป CRUD ต่อตาราง** (รายละเอียดคอลัมน์ → data dictionary)

| ตาราง | แถว | C | R | U | D | Repository | ใช้โดย |
|---|--:|:-:|:-:|:-:|:-:|---|---|
| [`BUI_RG.dbo.m_document`](docs/nestjs-api/data-dictionary/RGP.md#bui_rgdbom_document) | 132 | — | ✅ | — | — | TemplateDoc | RGP |
| [`BUI_RG.dbo.m_document_type`](docs/nestjs-api/data-dictionary/RGP.md#bui_rgdbom_document_type) | 6 | — | ✅ | — | — | TemplateDoc | RGP |
| [`EMS.m_Employee`](docs/nestjs-api/data-dictionary/RGP.md#emsm_employee) | 225 | — | ✅ | — | — | Employee | RGP |
| [`RGP.m_project_member_role`](docs/nestjs-api/data-dictionary/RGP.md#rgpm_project_member_role) | 19 | ✅ | ✅ | ✅ | ✅ | ProjectMemberRole | RGP |
| [`RGP.m_project_template`](docs/nestjs-api/data-dictionary/RGP.md#rgpm_project_template) | 7 | ✅ | ✅ | ✅ | ✅ | Project, ProjectTemplate, TemplateDoc | RGP |
| [`RGP.m_template_doc`](docs/nestjs-api/data-dictionary/RGP.md#rgpm_template_doc) | 10 | ✅ | ✅ | ✅ | ✅ | ProjectTemplate, TemplateDoc | RGP |
| [`RGP.m_template_state`](docs/nestjs-api/data-dictionary/RGP.md#rgpm_template_state) | 42 | ✅ | ✅ | ✅ | ✅ | ProjectState, ProjectTemplate, TemplateDoc | RGP |
| [`RGP.t_project`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project) | 29 | ✅ | ✅ | ✅ | — | Project, ProjectProgress, ProjectState, ProjectTemplate | RGP |
| [`RGP.t_project_audit_log`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_audit_log) | 111 | ✅ | — | — | — | ProjectAudit | RGP |
| [`RGP.t_project_doc_workflow`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_doc_workflow) | 52 | ✅ | ✅ | ✅ | ✅ | ProjectDocument | RGP |
| [`RGP.t_project_member`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_member) | 62 | ✅ | ✅ | — | ✅ | ProjectMember | RGP |
| [`RGP.t_project_notify_log`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_notify_log) | 10 | ✅ | ✅ | — | — | ProjectNotifyLog, ProjectStateMember | RGP |
| [`RGP.t_project_progress`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_progress) | 218 | ✅ | ✅ | — | — | Project, ProjectProgress, ProjectState | RGP |
| [`RGP.t_project_state`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_state) | 183 | ✅ | ✅ | ✅ | ✅ | Project, ProjectDocument, ProjectProgress, ProjectState, ProjectTask | RGP |
| [`RGP.t_project_state_member`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_state_member) | 39 | ✅ | ✅ | — | ✅ | ProjectStateMember | RGP |
| [`RGP.t_project_task`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_task) | 33 | ✅ | ✅ | ✅ | — | ProjectTask | RGP |
| [`RGP.t_project_task_comment`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_task_comment) | 21 | ✅ | ✅ | ✅ | — | ProjectTask | RGP |
| [`RGP.t_project_task_status_log`](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_task_status_log) | 8 | ✅ | — | — | — | ProjectTaskStatusLog | RGP |
| [`RunningNumber`](docs/nestjs-api/data-dictionary/RGP.md#runningnumber) | 22 | ✅ | ✅ | ✅ | — | Project, ProjectTask | RGP |
| [`storage.t_project_attachment`](docs/nestjs-api/data-dictionary/RGP.md#storaget_project_attachment) | 7 | ✅ | ✅ | — | ✅ | ProjectAttachment | RGP |

**Tasklist ต่อตาราง**

- [ ] **`BUI_RG.dbo.m_document`** — `·R··` · ใช้โดย: RGP · 132 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#bui_rgdbom_document)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetMasterDocuments()` → `DataTable` · op `R`
- [ ] **`BUI_RG.dbo.m_document_type`** — `·R··` · ใช้โดย: RGP · 6 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#bui_rgdbom_document_type)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetDocumentTypes()` → `DataTable` · op `R`
- [ ] **`EMS.m_Employee`** — `·R··` · ใช้โดย: RGP · 225 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#emsm_employee)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetActiveADUsers()` → `DataTable` · op `R`
- [ ] **`RGP.m_project_member_role`** — `CRUD` · ใช้โดย: RGP · 19 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpm_project_member_role)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `DataTable` · op `R`
  - [ ] **GET** `GetActive()` → `DataTable` · op `R`
  - [ ] **POST** `Insert(string roleName, string userName)` → `bool` · op `C`
  - [ ] **PUT** `Update(int roleId, string roleName, string fActive, string userName)` → `bool` · op `U`
  - [ ] **DELETE** `Delete(int roleId)` → `bool` · op `D`
- [ ] **`RGP.m_project_template`** — `CRUD` · ใช้โดย: RGP · 7 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpm_project_template)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetActiveTemplates()` → `DataTable` · op `R`
  - [ ] **POST** `Insert(string code, string name, string desc, string user, bool isLegalDict = false)` → `int` · op `C`
  - [ ] **PUT** `Update(int id, string code, string name, string desc, string active, string user, bool isLegalDict = false)` → `bool` · op `U`
  - [ ] **GET** `IsLegalDict(int templateId)` → `bool` · op `R`
  - [ ] **GET** `GetAllActive()` → `DataTable` · op `R`
  - [ ] **GET** `IsCodeDuplicate(string code, int excludeId = -1)` → `bool` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `Project.GetProjectById`, `Project.SearchProjects`, `ProjectTemplate.Delete`, `ProjectTemplate.GetAll`, `TemplateDoc.GetDocsByState`
- [ ] **`RGP.m_template_doc`** — `CRUD` · ใช้โดย: RGP · 10 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpm_template_doc)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **DELETE** `Delete(int id, out string error)` → `bool` · op `D` — เขียนตารางอื่น: `D:RGP.m_template_state`, `D:RGP.m_project_template`; join/อ่าน: `RGP.t_project`
  - [ ] **GET** `GetStates(int templateId)` → `DataTable` · op `R` — join/อ่าน: `RGP.m_template_state`
  - [ ] **GET** `GetDocsByState(int i_state_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.m_project_template`, `RGP.m_template_state`
  - [ ] **GET** `GetDocsByTemplate(int i_template_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.m_template_state`
  - [ ] **POST** `InsertTemplateDoc(TemplateDocModel model)` → `int` · op `C`
  - [ ] **PUT** `UpdateTemplateDoc(TemplateDocModel model)` → `bool` · op `U`
  - [ ] **DELETE** `DeleteTemplateDoc(int i_template_doc_id)` → `bool` · op `D`
  - [ ] **GET** `IsDuplicate(int i_state_id, int i_doc_id, int excludeId = -1)` → `bool` · op `R`
  - [ ] **GET** `GetNextSeqNo(int i_state_id)` → `int` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `ProjectTemplate.CopyStatesFrom`, `ProjectTemplate.DeleteState`
- [ ] **`RGP.m_template_state`** — `CRUD` · ใช้โดย: RGP · 42 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpm_template_state)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetTemplateStates(int i_template_id)` → `DataTable` · op `R`
  - [ ] **GET** `GetAll()` → `DataTable` · op `R` — join/อ่าน: `RGP.m_project_template`, `RGP.t_project`
  - [ ] **POST** `CopyStatesFrom(int sourceTemplateId, int targetTemplateId, string user)` → `int` · op `C` — เขียนตารางอื่น: `D:RGP.m_template_doc`
  - [ ] **POST** `InsertState(int templateId, string name, string desc, bool required, int seqNo, int? estimatedDays, string user)` → `int` · op `C`
  - [ ] **PUT** `UpdateState(int stateId, string name, string desc, bool required, int seqNo, int? estimatedDays, string user)` → `bool` · op `U`
  - [ ] **DELETE** `DeleteState(int stateId, out string error)` → `bool` · op `D` — join/อ่าน: `RGP.m_template_doc`
  - [ ] **GET** `GetNextStateSeqNo(int templateId)` → `int` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `ProjectTemplate.Delete`, `ProjectTemplate.GetStates`, `TemplateDoc.GetDocsByState`, `TemplateDoc.GetDocsByTemplate`
- [ ] **`RGP.t_project`** — `CRU·` · ใช้โดย: RGP · 29 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `SearchProjects(string c_project_no, string n_project_name, string c_status, string i_template_id, string d_from, string d_to)` → `DataTable` · op `R` — join/อ่าน: `RGP.m_project_template`, `RGP.t_project_progress`, `RGP.t_project_state`
  - [ ] **GET** `GetProjectById(int i_project_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.m_project_template`
  - [ ] **POST** `InsertProject(ProjectModel model)` → `int` · op `C`
  - [ ] **PUT** `UpdateProject(ProjectModel model)` → `bool` · op `U`
  - [ ] **PUT** `UpdateLegalDictJson(int i_project_id, string json, string i_user)` → `bool` · op `U`
  - [ ] **PUT** `DeleteProject(int i_project_id, string i_user)` → `bool` · op `U`
  - [ ] **PUT** `UpdateProjectStatus(int i_project_id, string c_status, string i_user)` → `bool` · op `U`
  - [ ] **GET** `IsProjectNoExists(string c_project_no)` → `bool` · op `R`
  - [ ] **GET** `GetActiveProjectsForRef(int i_exclude_project_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project_progress`, `RGP.t_project_state`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `ProjectProgress.GetLatestProgressByProject`, `ProjectState.GetStatesByProject`, `ProjectTemplate.Delete`, `ProjectTemplate.GetAll`
- [ ] **`RGP.t_project_audit_log`** — `C···` · ใช้โดย: RGP · 111 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_audit_log)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(ProjectAuditEntry entry)` · op `C`
- [ ] **`RGP.t_project_doc_workflow`** — `CRUD` · ใช้โดย: RGP · 52 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_doc_workflow)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetDocsByState(int i_proj_state_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project_state`
  - [ ] **GET** `GetDocsByProject(int i_project_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project_state`
  - [ ] **POST** `InsertDocWorkflow(ProjectDocumentWorkflowModel model)` → `int` · op `C`
  - [ ] **PUT** `UpdateDocWorkflow(ProjectDocumentWorkflowModel model)` → `bool` · op `U`
  - [ ] **DELETE** `DeleteDocWorkflow(int i_doc_wf_id)` → `bool` · op `D`
  - [ ] **PUT** `UpdateDocStatus(int i_doc_wf_id, string c_doc_status, string i_user)` → `bool` · op `U`
  - [ ] **GET** `GetNextSeqNo(int i_proj_state_id)` → `int` · op `R`
- [ ] **`RGP.t_project_member`** — `CR·D` · ใช้โดย: RGP · 62 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_member)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByProject(int i_project_id)` → `DataTable` · op `R`
  - [ ] **POST** `Insert(ProjectMemberModel m)` → `bool` · op `C`
  - [ ] **DELETE** `Delete(int i_member_id)` → `bool` · op `D`
- [ ] **`RGP.t_project_notify_log`** — `CR··` · ใช้โดย: RGP · 10 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_notify_log)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetExistingTaskId(int i_proj_state_id, int i_state_member_id)` → `int?` · op `R`
  - [ ] **POST** `Insert(ProjectNotifyLogModel m)` → `bool` · op `C`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `ProjectStateMember.GetByState`
- [ ] **`RGP.t_project_progress`** — `CR··` · ใช้โดย: RGP · 218 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_progress)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `HasProgressRecords(int i_proj_state_id)` → `bool` · op `R`
  - [ ] **POST** `InsertProgress(ProjectProgressModel model)` → `int` · op `C`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `Project.SearchProjects`, `ProjectProgress.CalculateOverallProgress`, `ProjectProgress.GetLatestProgressByProject`, `ProjectState.GetActiveProjectsForRef`, `ProjectState.GetStatesByProject`
- [ ] **`RGP.t_project_state`** — `CRUD` · ใช้โดย: RGP · 183 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_state)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `HasActiveProgress(int i_project_id)` → `bool` · op `R`
  - [ ] **GET** `AllRequiredStatesCompleted(int i_project_id)` → `bool` · op `R`
  - [ ] **GET** `GetStatesByProject(int i_project_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project`, `RGP.t_project_progress`
  - [ ] **POST** `InsertState(ProjectStateModel model)` → `int` · op `C`
  - [ ] **PUT** `UpdateState(ProjectStateModel model)` → `bool` · op `U`
  - [ ] **DELETE** `DeleteState(int i_proj_state_id)` → `bool` · op `D`
  - [ ] **PUT** `UpdateStateStatus(int i_proj_state_id, string c_status, string i_user)` → `bool` · op `U`
  - [ ] **PUT** `ReorderStates(List<Tuple<int, int>> orderList)` → `bool` · op `U`
  - [ ] **GET** `GetNextSeqNo(int i_project_id)` → `int` · op `R`
  - [ ] **GET** `GetTotalEstimatedDays(int i_project_id, int excludeStateId = 0)` → `int` · op `R`
  - [ ] **GET** `GetStatesForCombo(int i_project_id)` → `DataTable` · op `R`
  - [ ] **GET** `GetLatestProgressByProject(int i_project_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project`, `RGP.t_project_progress`
  - [ ] **GET** `CalculateOverallProgress(int i_project_id)` → `int` · op `R` — join/อ่าน: `RGP.t_project_progress`
  - [ ] **GET** `HasAnyProgress(int i_project_id)` → `bool` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `Project.SearchProjects`, `ProjectDocument.GetDocsByProject`, `ProjectDocument.GetDocsByState`, `ProjectState.GetActiveProjectsForRef`, `ProjectTask.GetAllTasksForProject`, `ProjectTask.GetByProject`, `ProjectTask.GetByState`
- [ ] **`RGP.t_project_state_member`** — `CR·D` · ใช้โดย: RGP · 39 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_state_member)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByState(int i_proj_state_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project_notify_log`
  - [ ] **POST** `Insert(ProjectStateMemberModel m)` → `bool` · op `C`
  - [ ] **DELETE** `Delete(int i_state_member_id)` → `bool` · op `D`
- [ ] **`RGP.t_project_task`** — `CRU·` · ใช้โดย: RGP · 33 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_task)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByState(int i_proj_state_id, bool includeDeleted = false)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project_state`
  - [ ] **GET** `GetByProject(int i_project_id)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project_state`
  - [ ] **GET** `GetAllTasksForProject(int projectId)` → `DataTable` · op `R` — join/อ่าน: `RGP.t_project_state`
  - [ ] **GET** `GetById(int i_task_id)` → `ProjectTaskModel` · op `R`
  - [ ] **POST** `InsertTask(ProjectTaskModel m)` → `int` · op `C`
  - [ ] **PUT** `UpdateTask(ProjectTaskModel m)` → `bool` · op `U`
  - [ ] **PUT** `UpdateStatus(int i_task_id, string c_status, int i_pct_complete, string i_user)` → `bool` · op `U`
  - [ ] **PUT** `SoftDelete(int i_task_id, string i_user)` → `bool` · op `U`
  - [ ] **GET** `CalcStatePctFromTasks(int i_proj_state_id)` → `int` · op `R`
- [ ] **`RGP.t_project_task_comment`** — `CRU·` · ใช้โดย: RGP · 21 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_task_comment)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetComments(int i_task_id)` → `DataTable` · op `R`
  - [ ] **POST** `InsertComment(ProjectTaskCommentModel m)` → `int` · op `C`
  - [ ] **PUT** `SoftDeleteComment(int i_comment_id)` → `bool` · op `U`
- [ ] **`RGP.t_project_task_status_log`** — `C···` · ใช้โดย: RGP · 8 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#rgpt_project_task_status_log)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(ProjectTaskStatusLogModel m)` → `bool` · op `C`
- [ ] **`RunningNumber`** — `CRU·` · ใช้โดย: RGP · 22 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#runningnumber)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **PUT** `GenerateProjectNo()` → `string` · op `U` — conn: `ProjectDbConnectionString`
  - [ ] **POST** `GenerateTaskCode()` → `string` · op `C` — conn: `ProjectDbConnectionString`
- [ ] **`storage.t_project_attachment`** — `CR·D` · ใช้โดย: RGP · 7 แถว · [data dictionary](docs/nestjs-api/data-dictionary/RGP.md#storaget_project_attachment)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByProject(int projectId)` → `IList<ProjectAttachmentModel>` · op `R` — join/อ่าน: `storage.FileDocument`, `storage.Folder`
  - [ ] **POST** `Insert(int projectId, int fileId, string user)` → `int` · op `C`
  - [ ] **DELETE** `DeleteByProjectAndFile(int projectId, int fileId)` → `bool` · op `D`

**ตารางของ module อื่น/Shared ที่ RGP เรียกใช้**

| ตาราง | เจ้าของ | การกระทำที่ RGP ใช้ | Repository.Method ที่ถูกเรียก |
|---|---|---|---|
| `security.FilePermission` | DMS | `CRU·` | `FilePermission.Insert`, `FilePermission.GetByFile`, `FilePermission.Revoke` |
| `security.FolderPermission` | DMS | `·R··` | `Permission.GetByFolder`, `Permission.GetAclEntries` |
| `storage.FileDocument` | DMS | `CRU·` | `Folder.UpdateFileCount`, `Folder.GetById`, `Folder.GetDescendants`, `Folder.GetRootFoldersByOrgUnit`, `Folder.GetByOrgUnit`, `FileDocument.Insert`, `FileDocument.GetById`, `FileDocument.SoftDelete`, `FileDocument.ExistsWithName`, `FileDocument.GetByOriginalName` … (+3) |
| `storage.Folder` | DMS | `·RU·` | `Folder.Update`, `Folder.UpdateFileCount`, `Folder.GetById`, `Folder.GetDescendants`, `Folder.GetRootFoldersByOrgUnit`, `Folder.GetByOrgUnit`, `ProjectAttachment.GetByProject` |
| `KMS.m_KBCategory` | KMS | `·R··` | `Kms.GetLawTypes`, `Kms.GetCategoriesByParent` |
| `EMS.Notification` | SHARED | `C···` | `Notification.Insert` |
| `EMS.OrgUnit` | SHARED | `·R··` | `OrgUnit.GetById`, `FolderQuotaConfig.GetByEmsOrgUnitId` |
| `EMS.UserAccount` | SHARED | `·R··` | `UserAccount.GetById`, `Folder.GetDescendants`, `Folder.GetByOrgUnit`, `FileDocument.GetById` |
| `EMS.m_Department` | SHARED | `·R··` | `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `ProjectMemberRole.GetDepartments` |
| `EMS.m_Division` | SHARED | `·R··` | `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `ProjectMemberRole.GetDivisions` |
| `EMS.m_SubCommittee` | SHARED | `·R··` | `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `ProjectMemberRole.GetSubCommittees` |
| `audit.AuditLog` | SHARED | `C···` | `Audit.Insert` |

## 5. WFE — Workflow Engine

- Workflow Engine — Template (Definition/Step/Connection), Instance, Step Instance, Delegation, SLA report
- ตารางหลักอยู่ schema `WFE.*` + `dbo.WFDelegation`; รายงาน SLA เรียก SP `dbo.sp_WF_*`
- `WorkflowCreateTemplateForm.LoadStepsAndApproversFromCopiedTemplate` เขียน SQL ตรงในฟอร์ม (อ่าน `WFE.s_WFStep`, `WFE.s_WFConnection`) เป็น fallback ตอน copy template → รวมเข้า endpoint อ่าน step/connection ของ template
- ค้นหาพนักงาน/ผู้รับมอบหมายใช้ `EmployeeApiService` (HTTP) + `LdapUserSearchService` (LDAP) ไม่ผ่านตาราง DB
- Workflow Engine V2, `WFESLABackgroundJob`, compliance/PDPA service ไม่ถูกเรียก = dead

**สิ่งที่ API ต้องรักษา** (สรุป — รายละเอียด/ที่มาใน [`04-business-rules.md`](docs/nestjs-api/04-business-rules.md))

- [ ] Template: Draft→PendingApproval→Active (Reject กลับ Draft), `IsActive` คู่กับสถานะ (04 §5.1)
- [ ] สร้าง instance ต้องมี step `Start`; ต้องสร้างผ่าน `WFE.sp_CreateWFInstance` และ `sp_CreateWFStepInstance` (TABLOCKX คำนวณ ID) — ห้าม INSERT ตรง (04 §5.2)
- [ ] Delegation: ปิดอันเดิมก่อน, depth ≤ 3 (04 §5.3) · SLA: OnTime/AtRisk/Overdue จาก threshold% (04 §5.4)
- [ ] audit ของ WFE ไม่ระบุ `Module` ในโค้ดเดิม — ควรกำหนด `Module='Workflow'`

**สรุป CRUD ต่อตาราง** (รายละเอียดคอลัมน์ → data dictionary)

| ตาราง | แถว | C | R | U | D | Repository | ใช้โดย |
|---|--:|:-:|:-:|:-:|:-:|---|---|
| [`WFE.s_WFConnection`](docs/nestjs-api/data-dictionary/WFE.md#wfes_wfconnection) | 22 | ✅ | ✅ | — | — | WorkflowStep | WFE |
| [`WFE.s_WFDefinition`](docs/nestjs-api/data-dictionary/WFE.md#wfes_wfdefinition) | 17 | ✅ | ✅ | ✅ | soft | WFReport, WorkflowTemplate | WFE |
| [`WFE.s_WFStep`](docs/nestjs-api/data-dictionary/WFE.md#wfes_wfstep) | 26 | ✅ | ✅ | — | — | WorkflowStep, WorkflowStepInstance, WorkflowTemplate | WFE |
| [`WFE.t_WFInstance`](docs/nestjs-api/data-dictionary/WFE.md#wfet_wfinstance) | 96 | ✅ | ✅ | ✅ | — | WFReport, Workflow, WorkflowStepInstance, WorkflowTemplate | WFE |
| [`WFE.t_WFStepInstance`](docs/nestjs-api/data-dictionary/WFE.md#wfet_wfstepinstance) | 168 | ✅ | ✅ | ✅ | — | Audit, WFReport, WorkflowStepInstance | WFE |
| [`dbo.WFDelegation`](docs/nestjs-api/data-dictionary/WFE.md#dbowfdelegation) | 0 | ✅ | ✅ | ✅ | soft | Delegation | WFE |

**Tasklist ต่อตาราง**

- [ ] **`WFE.s_WFConnection`** — `CR··` · ใช้โดย: WFE · 22 แถว · [data dictionary](docs/nestjs-api/data-dictionary/WFE.md#wfes_wfconnection)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetConnectionsByTemplate(int workflowDefinitionId)` → `IList<WorkflowConnection>` · op `R`
  - [ ] **GET** `GetConnectionsFromStep(int fromStepId)` → `IList<WorkflowConnection>` · op `R`
  - [ ] **POST** `CreateConnection(WorkflowConnection connection)` → `int` · op `C`
- [ ] **`WFE.s_WFDefinition`** — `CRUd` · ใช้โดย: WFE · 17 แถว · [data dictionary](docs/nestjs-api/data-dictionary/WFE.md#wfes_wfdefinition)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `CreateTemplate(WorkflowDefinition template)` → `int` · op `C`
  - [ ] **GET** `GetTemplate(int workflowDefinitionId)` → `WorkflowDefinition` · op `R`
  - [ ] **GET** `GetTemplateVersions(int workflowDefinitionId)` → `IList<WorkflowDefinition>` · op `R`
  - [ ] **PUT** `UpdateTemplate(WorkflowDefinition template)` · op `U`
  - [ ] **DELETE** `SoftDeleteTemplate(int workflowDefinitionId, string deletedBy)` · op `d`
  - [ ] **GET** `GetSLAByTemplate(WorkflowReportFilter filter)` → `IList<SLATemplateMetricRow>` · op `R` — join/อ่าน: `WFE.t_WFInstance`, `WFE.t_WFStepInstance`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `WorkflowTemplate.GetTemplates`
- [ ] **`WFE.s_WFStep`** — `CR··` · ใช้โดย: WFE · 26 แถว · [data dictionary](docs/nestjs-api/data-dictionary/WFE.md#wfes_wfstep)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetTemplates(WorkflowTemplateFilter filter)` → `PagedResult<WorkflowDefinition>` · op `R` — join/อ่าน: `WFE.s_WFDefinition`, `WFE.t_WFInstance`
  - [ ] **GET** `GetStep(int workflowStepId)` → `WorkflowStep` · op `R`
  - [ ] **GET** `GetStepsByTemplate(int workflowDefinitionId)` → `IList<WorkflowStep>` · op `R`
  - [ ] **POST** `CreateStep(WorkflowStep step)` → `int` · op `C`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `WorkflowStepInstance.GetStepInstancesByWorkflow`
- [ ] **`WFE.t_WFInstance`** — `CRU·` · ใช้โดย: WFE · 96 แถว · [data dictionary](docs/nestjs-api/data-dictionary/WFE.md#wfet_wfinstance)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `CreateWorkflowInstance(WorkflowInstance instance)` → `int` · op `C` — SP: `WFE.sp_CreateWFInstance`
  - [ ] **GET** `GetWorkflowInstance(int workflowInstanceId)` → `WorkflowInstance` · op `R`
  - [ ] **GET** `GetWorkflowInstances(WorkflowInstanceFilter filter)` → `PagedResult<WorkflowInstance>` · op `R`
  - [ ] **PUT** `UpdateWorkflowInstance(WorkflowInstance instance)` · op `U`
  - [ ] **GET** `GetCycleTimeDistribution(WorkflowReportFilter filter)` → `IList<CycleTimeRow>` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `WFReport.GetSLAByTemplate`, `WFReport.GetSLAComplianceMetrics`, `WFReport.GetTaskDistribution`, `WorkflowStepInstance.CreateStepInstance`, `WorkflowTemplate.GetTemplates`
- [ ] **`WFE.t_WFStepInstance`** — `CRU·` · ใช้โดย: WFE · 168 แถว · [data dictionary](docs/nestjs-api/data-dictionary/WFE.md#wfet_wfstepinstance)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `CreateStepInstance(WorkflowStepInstance instance)` → `int` · op `C` — SP: `WFE.sp_CreateWFStepInstance`; join/อ่าน: `WFE.t_WFInstance`
  - [ ] **GET** `GetStepInstance(int workflowStepInstanceId)` → `WorkflowStepInstance` · op `R`
  - [ ] **GET** `GetStepInstancesByWorkflow(int workflowInstanceId)` → `IList<WorkflowStepInstance>` · op `R` — join/อ่าน: `WFE.s_WFStep`
  - [ ] **GET** `GetStepInstancesByUser(string adUserName)` → `IList<WorkflowStepInstance>` · op `R`
  - [ ] **PUT** `UpdateStepInstance(WorkflowStepInstance instance)` · op `U`
  - [ ] **GET** `GetSLAComplianceMetrics(WorkflowReportFilter filter)` → `SLAComplianceMetrics` · op `R` — SP: `dbo.sp_WF_GetSLAComplianceMetrics`; join/อ่าน: `WFE.t_WFInstance`
  - [ ] **GET** `GetTaskDistribution(WorkflowReportFilter filter)` → `PagedResult<TaskDistributionRow>` · op `R` — SP: `dbo.sp_WF_GetTaskDistribution`; join/อ่าน: `WFE.t_WFInstance`
  - [ ] **GET** `GetSLAWeeklyTrend(int weeks)` → `IList<SLATrendRow>` · op `R`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `Audit.GetAuditLogsByWorkflowInstance`, `WFReport.GetSLAByTemplate`
- [ ] **`dbo.WFDelegation`** — `CRUd` · ใช้โดย: WFE · 0 แถว · [data dictionary](docs/nestjs-api/data-dictionary/WFE.md#dbowfdelegation)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `CreateDelegation(WFDelegation delegation, int maxDelegationDepth)` → `int` · op `C` — SP: `dbo.sp_WF_CreateDelegation`
  - [ ] **GET** `GetDelegation(int wfDelegationId)` → `WFDelegation` · op `R`
  - [ ] **GET** `GetDelegationsByStepInstance(int workflowStepInstanceId)` → `IList<WFDelegation>` · op `R` — SP: `dbo.sp_WF_GetDelegationHistory`
  - [ ] **PUT** `UpdateDelegation(WFDelegation delegation)` · op `U`

**ตารางของ module อื่น/Shared ที่ WFE เรียกใช้**

| ตาราง | เจ้าของ | การกระทำที่ WFE ใช้ | Repository.Method ที่ถูกเรียก |
|---|---|---|---|
| `audit.AuditLog` | SHARED | `CR··` | `Audit.Insert`, `Audit.GetAuditLogsByWorkflowInstance` |

## 6. Shared — ตารางที่ใช้ร่วมหลาย module (Auth / Org / HR master / Audit / Notification / Config)

ควรทำเป็น Nest module กลาง (`auth`, `org`, `audit`, `notification`, `config`) แล้วให้ DMS/KMS/RGP/WFE import ไปใช้

**สรุป CRUD ต่อตาราง** (รายละเอียดคอลัมน์ → data dictionary)

| ตาราง | แถว | C | R | U | D | Repository | ใช้โดย |
|---|--:|:-:|:-:|:-:|:-:|---|---|
| [`EMS.Notification`](docs/nestjs-api/data-dictionary/SHARED.md#emsnotification) | 525,748 | ✅ | — | — | — | Notification | DMS, KMS, RGP |
| [`EMS.OrgUnit`](docs/nestjs-api/data-dictionary/SHARED.md#emsorgunit) | 242 | ✅ | ✅ | ✅ | soft | FileDocument, FolderQuotaChangeRequest, FolderQuotaConfig, FolderTemplate, OrgUnit | DMS, KMS, RGP |
| [`EMS.UserAccount`](docs/nestjs-api/data-dictionary/SHARED.md#emsuseraccount) | 315 | ✅ | ✅ | ✅ | soft | FileDocument, Folder, FolderQuotaChangeRequest, OrgUnit, UserAccount | DMS, KMS, RGP |
| [`EMS.m_Department`](docs/nestjs-api/data-dictionary/SHARED.md#emsm_department) | 47 | ✅ | ✅ | ✅ | ✅ | FileDocument, FolderQuotaConfig, HrDepartment, HrPositionMapping, KBArticle, ProjectMemberRole | DMS, KMS, RGP |
| [`EMS.m_Division`](docs/nestjs-api/data-dictionary/SHARED.md#emsm_division) | 13 | ✅ | ✅ | ✅ | ✅ | FileDocument, FolderQuotaConfig, HrDivision, HrPositionMapping, KBArticle, ProjectMemberRole | DMS, KMS, RGP |
| [`EMS.m_SubCommittee`](docs/nestjs-api/data-dictionary/SHARED.md#emsm_subcommittee) | 30 | ✅ | ✅ | ✅ | — | FileDocument, FolderQuotaConfig, KBArticle, OrgUnit, ProjectMemberRole | DMS, KMS, RGP |
| [`audit.AuditLog`](docs/nestjs-api/data-dictionary/SHARED.md#auditauditlog) | 251,485 | ✅ | ✅ | — | — | Audit | DMS, KMS, RGP, WFE |
| [`dbo.SystemConfig`](docs/nestjs-api/data-dictionary/SHARED.md#dbosystemconfig) | ? | ✅ | ✅ | ✅ | — | ConfigManager (Infrastructure) | Core (MDI/Program) |

**Tasklist ต่อตาราง**

- [ ] **`EMS.Notification`** — `C···` · ใช้โดย: DMS, KMS, RGP · 525,748 แถว · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#emsnotification)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(Notification notification)` → `int` · op `C` — SP: `EMS.sp_InsertNotification`
- [ ] **`EMS.OrgUnit`** — `CRUd` · ใช้โดย: DMS, KMS, RGP · 242 แถว · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#emsorgunit)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(OrgUnit orgUnit)` → `int` · op `C` — SP: `EMS.sp_InsertOrgUnit`
  - [ ] **PUT** `Update(OrgUnit orgUnit)` · op `U` — SP: `EMS.sp_UpdateOrgUnit`
  - [ ] **GET** `GetById(int orgUnitId)` → `OrgUnit` · op `R` — SP: `EMS.sp_GetOrgUnitByID`
  - [ ] **GET** `ExistsByCode(string orgUnitCode)` → `bool` · op `R`
  - [ ] **GET** `ExistsByNameUnderParent(string nameTH, int? parentId, int? excludeOrgUnitId = null)` → `bool` · op `R`
  - [ ] **GET** `GetHierarchy()` → `IEnumerable<OrgUnit>` · op `R` — SP: `EMS.sp_GetOrgUnitHierarchy`
  - [ ] **GET** `GetByConfidentialityLevel(ConfidentialityLevel level)` → `IEnumerable<OrgUnit>` · op `R` — SP: `EMS.sp_GetOrgUnitByConfidentialityLevel`; join/อ่าน: `storage.Folder`
  - [ ] **DELETE** `SoftDelete(int orgUnitId, int deletedBy)` · op `d` — SP: `EMS.sp_SoftDeleteOrgUnit`
  - [ ] **DELETE** `Deactivate(int orgUnitId)` · op `d` — SP: `EMS.sp_SoftDeleteOrgUnit`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FileDocument.GetByOrgUnit`, `FileDocument.GetDeletedFiles`, `FolderQuotaChangeRequest.GetAll`, `FolderQuotaChangeRequest.GetById`, `FolderQuotaChangeRequest.GetPending`, `FolderQuotaConfig.GetAllFileStats`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `FolderTemplate.GetAll`, `OrgUnit.ForceDeleteWithDependents`
- [ ] **`EMS.UserAccount`** — `CRUd` · ใช้โดย: DMS, KMS, RGP · 315 แถว · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#emsuseraccount)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetByADUserName(string adUserName)` → `UserAccount` · op `R` — SP: `EMS.sp_GetUserAccountByADUserName`
  - [ ] **GET** `GetById(int userId)` → `UserAccount` · op `R` — SP: `EMS.sp_GetUserAccountByID`
  - [ ] **GET** `GetByRole(int appRole)` → `IEnumerable<UserAccount>` · op `R` — SP: `EMS.sp_GetUserAccountsByRole`
  - [ ] **GET** `GetAll()` → `IEnumerable<UserAccount>` · op `R` — SP: `EMS.sp_GetAllUserAccounts`
  - [ ] **POST** `Create(UserAccount account)` → `int` · op `C` — SP: `EMS.sp_InsertUserAccount`
  - [ ] **PUT** `Update(UserAccount account)` · op `U`
  - [ ] **PUT** `UpdateLevelCode(int userId, string levelCode)` · op `U`
  - [ ] **PUT** `UpdateLastLogin(int userId)` · op `U` — SP: `EMS.sp_UpdateLastLogin`
  - [ ] **PUT** `UpdateLastLoginWithIP(int userId, string ipAddress)` · op `U`
  - [ ] **POST** `RegisterOrUpdate(UserAccount account, string ipAddress, out bool isNew)` → `int` · op `C`
  - [ ] **POST** `UpsertFromLdap(string adUserName, string displayName, string email, bool isActive, string positionName, string departmentName, int? createdBy, out bool isNew)` → `int` · op `C`
  - [ ] **PUT** `UpdateConsent(int userId, string email, bool consentGiven)` · op `U` — SP: `EMS.sp_UpdateUserConsent`
  - [ ] **DELETE** `Deactivate(int userId)` · op `d` — SP: `EMS.sp_DeactivateUserAccount`
  - [ ] **GET** `GetPositionsByDepartmentCode(string departmentCode)` → `IEnumerable<string>` · op `R`
  - [ ] **PUT** `UpdateEmployeeInfo(int userId, string employeeCode, string titleNameEn, string firstNameEn, string lastNameEn, string titleNameTh, string firstNameTh, string lastNameTh, int? departmentId, string departmentCode, string departmentNameEn, string departmentNameTh, int? divisionId, string divisionCode, string divisionNameEn, string divisionNameTh, string positionName)` · op `U`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FileDocument.GetAllGroupedByFolder`, `FileDocument.GetByFolder`, `FileDocument.GetById`, `Folder.GetAll`, `Folder.GetByOrgUnit`, `Folder.GetDescendants`, `Folder.GetSiblings`, `FolderQuotaChangeRequest.GetAll`, `FolderQuotaChangeRequest.GetById`, `FolderQuotaChangeRequest.GetPending`, `OrgUnit.HasActiveDependents`
- [ ] **`EMS.m_Department`** — `CRUD` · ใช้โดย: DMS, KMS, RGP · 47 แถว · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#emsm_department)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<HrDepartment>` · op `R`
  - [ ] **POST** `Save(HrDepartment department)` → `int` · op `C`
  - [ ] **DELETE** `Delete(int departmentId)` → `bool` · op `D`
  - [ ] **GET** `GetDepartments()` → `DataTable` · op `R` — conn: `BisDbConnectionString`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FileDocument.GetByOrgUnit`, `FolderQuotaConfig.Delete`, `FolderQuotaConfig.GetAll`, `FolderQuotaConfig.GetAllFileStats`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.Save`, `HrPositionMapping.GetAll`, `HrPositionMapping.GetByDepartmentId`, `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.Search`
- [ ] **`EMS.m_Division`** — `CRUD` · ใช้โดย: DMS, KMS, RGP · 13 แถว · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#emsm_division)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetAll()` → `IEnumerable<HrDivision>` · op `R`
  - [ ] **POST** `Save(HrDivision division)` → `int` · op `C`
  - [ ] **DELETE** `Delete(int divisionId)` → `bool` · op `D`
  - [ ] **GET** `GetDivisions()` → `DataTable` · op `R` — conn: `BisDbConnectionString`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `FileDocument.GetByOrgUnit`, `FolderQuotaConfig.Delete`, `FolderQuotaConfig.GetAll`, `FolderQuotaConfig.GetAllFileStats`, `FolderQuotaConfig.GetByEmsOrgUnitId`, `FolderQuotaConfig.GetByMasterCode`, `FolderQuotaConfig.GetByOrgUnit`, `FolderQuotaConfig.Save`, `HrPositionMapping.GetAll`, `HrPositionMapping.GetByDepartmentId`, `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.Search`
- [ ] **`EMS.m_SubCommittee`** — `CRU·` · ใช้โดย: DMS, KMS, RGP · 30 แถว · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#emsm_subcommittee)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - ℹ️ `FolderQuotaConfig.*` ทำงานกับ **3 ตารางพร้อมกัน** (UNION `m_SubCommittee` / `m_Division` / `m_Department`) โดยอ่าน/แก้คอลัมน์ `quota_size` — ควรทำเป็น endpoint `quota` เดียว
  - [ ] **POST** `InsertSubCommitteeRecord(int orgUnitId, string code, string nameTH, string nameEN, string createdByADUser)` · op `C` — SP: `dbo.sp_InsertSubCommittee`
  - [ ] **GET** `GetByOrgUnit(int orgUnitId)` → `IEnumerable<FileDocument>` · op `R` — SP: `storage.sp_GetFileDocumentsByOrgUnit`; join/อ่าน: `EMS.OrgUnit`, `EMS.m_Department`, `EMS.m_Division`, `storage.FileDocument`, `storage.Folder`
  - [ ] **GET** `GetByOrgUnit(int orgUnitId, int? parentOrgUnitId = null)` → `FolderQuotaConfig` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`
  - [ ] **GET** `GetByMasterCode(int orgUnitType, string orgUnitCode)` → `FolderQuotaConfig` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`
  - [ ] **GET** `GetByEmsOrgUnitId(int emsOrgUnitId, int orgUnitType)` → `FolderQuotaConfig` · op `R` — join/อ่าน: `EMS.OrgUnit`, `EMS.m_Department`, `EMS.m_Division`
  - [ ] **GET** `GetAll()` → `IEnumerable<FolderQuotaConfig>` · op `R` — join/อ่าน: `EMS.m_Department`, `EMS.m_Division`
  - [ ] **PUT** `Save(FolderQuotaConfig config)` · op `U` — เขียนตารางอื่น: `U:EMS.m_Division`, `U:EMS.m_Department`
  - [ ] **PUT** `Delete(int quotaConfigId, string orgUnitTypeName)` · op `U` — เขียนตารางอื่น: `U:EMS.m_Division`, `U:EMS.m_Department`
  - [ ] **GET** `GetAllFileStats()` → `Dictionary<int, OrgUnitFileStat>` · op `R` — join/อ่าน: `EMS.OrgUnit`, `EMS.OrgUnitRelationship`, `EMS.m_Department`, `EMS.m_Division`, `storage.FileDocument`, `storage.Folder`
  - [ ] **GET** `GetSubCommittees()` → `DataTable` · op `R` — conn: `BisDbConnectionString`
  - ↳ ถูกเข้าถึงทางอ้อมจาก: `KBArticle.GetAll`, `KBArticle.GetByCategory`, `KBArticle.Search`
- [ ] **`audit.AuditLog`** — `CR··` · ใช้โดย: DMS, KMS, RGP, WFE · 251,485 แถว · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#auditauditlog)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **POST** `Insert(AuditLog entry)` → `long` · op `C` — SP: `audit.sp_InsertAuditLog`
  - [ ] **GET** `Query(AuditQuery query)` → `PagedResult<AuditLog>` · op `R` — SP: `audit.sp_QueryAuditLog`
  - [ ] **GET** `GetAuditLogsByWorkflowInstance(int workflowInstanceId)` → `List<AuditLog>` · op `R` — join/อ่าน: `WFE.t_WFStepInstance`
- [ ] **`dbo.SystemConfig`** — `CRU·` · ใช้โดย: Core (MDI/Program) · [data dictionary](docs/nestjs-api/data-dictionary/SHARED.md#dbosystemconfig)
  - [ ] สร้าง Nest module / entity (หรือ query) / DTO / controller / service
  - [ ] **GET** `GetSystemConfig(key)` · op `R` — SP: `dbo.sp_GetSystemConfig` (ผ่าน `ConfigManager`)
  - [ ] **PUT** `UpsertSystemConfig(key, value, updatedByUserId)` · op `U`/`C` — SP: `dbo.sp_UpsertSystemConfig` (Admin; invalidate cache)
  - ⚠ ยังไม่มี DDL ของตารางนี้ — ดู `OPEN_QUESTIONS.md` A2

**Module ที่เรียกใช้ตาราง Shared**

| ตาราง Shared | DMS | KMS | RGP | WFE |
|---|---|---|---|---|
| `EMS.Notification` | `C···` | `C···` | `C···` | — |
| `EMS.OrgUnit` | `CRUd` | `·R··` | `·R··` | — |
| `EMS.UserAccount` | `CRUd` | `·R··` | `·R··` | — |
| `EMS.m_Department` | `CRUD` | `·R··` | `·R··` | — |
| `EMS.m_Division` | `CRUD` | `·R··` | `·R··` | — |
| `EMS.m_SubCommittee` | `CRU·` | `·R··` | `·R··` | — |
| `audit.AuditLog` | `CR··` | `C···` | `C···` | `CR··` |
| `dbo.SystemConfig` | — | — | — | — |

### 6.1 การเข้าถึง DB นอก Repository

- [ ] **System config** — `CMS.Infrastructure/ConfigManager` เรียก `dbo.sp_GetSystemConfig(@Key)` / `dbo.sp_UpsertSystemConfig(@Key,@Value,@UpdatedByUserId)` (ตาราง `dbo.SystemConfig`: ConfigKey, ConfigValue, UpdatedByUserId, UpdatedDate) → `config` module
- [ ] **WFE template copy** — SQL ตรงใน `WorkflowCreateTemplateForm` (§5) → ย้ายเข้า API
- [ ] **KB Dashboard (mock)** — ยังไม่มี query จริง → นิยาม endpoint stats/monthly/top-articles เอง (คอมเมนต์ TODO ในโค้ดบอกว่าจะ query `KMS.t_KBArticle`)
- [ ] **audit ที่เขียนจาก UI** (UserManagementForm, UserAccessForm, PermissionForm ฯลฯ) → ต้องย้ายเข้า service ฝั่ง API ([`05-cross-cutting.md`](docs/nestjs-api/05-cross-cutting.md) §3)

## ภาคผนวก A — Dead code ที่ตัดออก (ไม่ต้องทำ API)

### A.1 ไฟล์ `.cs` ที่ไม่อยู่ใน `.csproj` (ไม่ถูก compile)

- `CMS.Controllers/WFE/WorkflowPluginController.cs`
- `CMS.Data/Repositories/PermissionGroupRepository.cs`
- `CMS.Infrastructure/DatabaseConnectionTester.cs`
- `CMS.Presentation/MenuManagementForm.Designer.cs`
- `CMS.Presentation/MenuManagementForm.cs`
- `CMS.Presentation/Modules/WFE/PluginRegistryForm.Designer.cs`
- `CMS.Presentation/Modules/WFE/PluginRegistryForm.cs`
- `CMS.Presentation/Modules/WFE/Presenters/Interfaces/IPluginRegistryView.cs`
- `CMS.Presentation/Modules/WFE/Presenters/PluginRegistryPresenter.cs`
- `CMS.Presentation/Modules/WFE/WorkflowCreateTemplateFormTest.cs`
- `CMS.Services/BackgroundJobs/OptimizedWFESLABackgroundJob.cs`
- `CMS.Services/Caching/IWorkflowTemplateCache.cs`
- `CMS.Services/Caching/WorkflowTemplateCacheImpl.cs`
- `CMS.Services/DTOs/MenuDto.cs`
- `CMS.Services/Interfaces/IWorkflowComplianceService.cs`
- `CMS.Services/Interfaces/IWorkflowDataEncryptionService.cs`
- `CMS.Services/Interfaces/IWorkflowDataRetentionService.cs`
- `CMS.Services/Interfaces/IWorkflowPDPAComplianceService.cs`
- `CMS.Services/Interfaces/IWorkflowPermissionService.cs`
- `CMS.Services/Notifications/AsyncNotificationQueueImpl.cs`
- `CMS.Services/Notifications/IAsyncNotificationQueue.cs`
- `CMS.Services/Performance/PerformanceMetrics.cs`
- `CMS.Services/SLA/IOptimizedSLACalculator.cs`
- `CMS.Services/SLA/OptimizedSLACalculatorImpl.cs`
- `CMS.Services/WorkflowComplianceService.cs`
- `CMS.Services/WorkflowConfiguration.cs`
- `CMS.Services/WorkflowDataEncryptionService.cs`
- `CMS.Services/WorkflowDataRetentionService.cs`
- `CMS.Services/WorkflowPDPAComplianceService.cs`
- `CMS.Services/WorkflowPermissionService.cs`

> รวม `PermissionGroupRepository` (SP `security.sp_*PermissionGroup`, `sp_AddUserToGroup` ฯลฯ — มีใน DB แต่ไม่ถูก compile) และ `PluginRegistry*`

### A.2 Class ที่ compile แต่ไม่ถูกเรียกจาก entry point ใด

- **CMS.Controllers/DMS**: `KBController`, `OrgStructureLookupController`, `ProjectPresenter`
- **CMS.Controllers/RGP**: `RgpComposition`
- **CMS.Presentation/**: `MenuTreeViewManager`
- **CMS.Presentation/Modules**: `AccessShareForm`, `FolderDetailForm`, `TextBoxPlaceholderCompat`, `ListViewColumnSorter`, `CalendarCell`, `CalendarEditingControl`
- **CMS.Services/**: `SessionContext`, `WorkflowIntegrationService`
- **CMS.Services/BackgroundJobs**: `WFESLABackgroundJob`
- **CMS.Services/Integrations**: `ApprovalWorkflowAdapter`, `AuditAdapter`, `NotificationAdapter`, `OrgStructureAdapter`, `PermissionAdapter`
- **CMS.Services/Validators**: `ConditionExpressionValidator`, `CreateTemplateValidator`, `CreateWorkflowInstanceValidator`, `DelegationValidator`, `WorkflowStepValidator`
- **CMS.Services/Workflow**: `ServiceResult`, `DefinitionValidator`, `DefinitionService`, `ConcurrencyGuard`, `WorkflowOrchestrator`, `CalcPremiumPlugin`, `CallRiscServerPlugin`, `SendNotificationPlugin`, `SendOicReportPlugin`, `PluginContext`, `PluginResult`, `PluginRegistry`, `ConditionEvaluator`, `WorkflowServiceV2`

### A.3 Repository method ที่ไม่มีใครเรียก (dead)

| Repository | Method (dead) | ตารางที่เกี่ยวข้อง |
|---|---|---|
| SubCommitteeRepository | `GetAll` | EMS.m_SubCommittee |
| UserAccountRepository | `GetByDepartmentId`, `GetByDivisionId` | EMS.UserAccount |
| OrgUnitRepository | `GetByCode`, `LinkDivisionToSubCommittee`, `IsDivisionLinkedToSubCommittee`, `SoftDeleteSubCommitteeRecord` | EMS.OrgUnit, EMS.OrgUnitRelationship |
| FolderRepository | `GetActiveFolders`, `GetByIdAsync`, `GetByOrgUnitAsync`, `GetAllAsync`, `GetActiveFoldersAsync` | EMS.UserAccount, storage.FileDocument, storage.Folder |
| FileDocumentRepository | `UpdateVirusScanStatus`, `GetByChecksum` |  |
| ApprovalRepository | `DeletePendingHCRequestsForOrgUnit` | workflow.ApprovalRequest, workflow.ApprovalStep |
| NotificationRepository | `GetUnreadByUser`, `MarkRead` |  |
| FilePermissionRepository | `GetAllByFile`, `DeleteByFile` | security.FilePermission |
| FolderTemplateRepository | `GetById`, `DeleteItemsByTemplate` | storage.FolderTemplateItem |
| UserOrgVisibilityRepository | `GetByOrgUnit` | security.UserOrgVisibility |
| HrDepartmentRepository | `GetByDivisionID` | EMS.m_Department |
| HrPositionMappingRepository | `GetByDivisionId` | EMS.m_Department, EMS.m_Division, EMS.m_PositionMapping, EMS.m_Role |
| ExternalShareRepository | `GetByToken`, `GetByStatus` | storage.ExternalShare |
| ShareAccessLogRepository | `GetByToken`, `GetByDateRange` | storage.ShareAccessLog |
| ShareTokenRepository | `GetById`, `GetByTokenValue` | storage.ShareToken |
| KBCategoryRepository | `GetByCode` | KMS.m_KBCategory |
| KBArticleRepository | `FindByNormalizedTitleCategory` | KMS.t_KBArticle |
| KBVersionRepository | `GetById`, `GetNextVersionNumber` | KMS.t_KBVersion |
| MenuItemRepository | `GetMenuItemsByRole`, `UpdateMenuItemOrder`, `MenuKeyExists` | EMS.MenuItem |
| WorkflowRepository | `GetActiveWorkflowInstances`, `SoftDeleteWorkflowInstance` | WFE.t_WFInstance |
| WorkflowTemplateRepository | `GetTemplateVersion`, `HasActiveInstances` | WFE.s_WFDefinition, WFE.t_WFInstance |
| WorkflowStepRepository | `UpdateStep`, `SoftDeleteStep`, `UpdateConnection`, `SoftDeleteConnection` | WFE.s_WFConnection, WFE.s_WFStep |
| WorkflowStepInstanceRepository | `GetPendingStepInstances`, `GetByExternalReference`, `SoftDeleteStepInstance` | WFE.t_WFStepInstance |
| DelegationRepository | `GetActiveDelegation`, `GetDelegationDepth`, `DeactivateDelegations` | dbo.WFDelegation |
| WFReportRepository | `GetBottleneckAnalysis`, `GetEscalationStatistics` | WFE.t_WFInstance, WFE.t_WFStepInstance, dbo.WFSLARule |
| FolderQuotaChangeRequestRepository | `GetByOrgUnit` | EMS.OrgUnit, EMS.UserAccount, dms.FolderQuotaChangeRequest |
| ProjectRepository | `CloseProject` | RGP.t_project |
| ProjectStateRepository | `InsertStatesFromTemplate` | RGP.m_template_state, RGP.t_project_state |
| ProjectTaskRepository | `GetSubtasks`, `GetSubtasksForDashboard`, `Restore`, `HasActiveTasks`, `EditComment` | RGP.t_project_state, RGP.t_project_task, RGP.t_project_task_comment |
| ProjectProgressRepository | `GetProgressHistory` | RGP.t_project_progress, RGP.t_project_state |
| ProjectDocumentRepository | `InsertDocWorkflowFromTemplate` | RGP.m_template_doc, RGP.t_project_doc_workflow, RGP.t_project_state |
| ProjectAttachmentRepository | `DeleteByProject` | storage.t_project_attachment |
| EFilingRepository | `SearchEFilingDoc`, `CheckEFilingRefExists`, `InsertEFilingRequest`, `UpdateEFilingRequestStatus`, `GetEFilingRequestsByProject`, `GetEFilingRequestsByState` | RGP.t_project_efiling_request, RGP.t_project_state |
| EmployeeRepository | `GetActiveEmployees` | dbo.Employees |
| KmsRepository | `GetCategories`, `SearchArticles`, `GetArticleById` | KMS.m_KBCategory, KMS.t_KBArticle |

**ตารางที่ปรากฏเฉพาะใน dead code (ไม่ต้องทำ):** `RGP.t_project_efiling_request`, `dbo.Employees`, `dbo.WFSLARule`

## ภาคผนวก B — Stored Procedure

รายการ Stored Procedure ทั้งหมด (พารามิเตอร์ ตาราง ผู้เรียก พฤติกรรมที่ต้องรักษา) อยู่ที่ [`docs/nestjs-api/02-stored-procedures.md`](docs/nestjs-api/02-stored-procedures.md) — ใช้งานจริง 80 · dead 11 · ไม่ถูก compile 8 · มีใน DB แต่โค้ดไม่เรียก 26 · อ้างในโค้ดแต่ไม่มีใน DB 1 (`dbo.sp_WF_GetPendingSteps`, dead)

## ภาคผนวก C — Connection string / ฐานข้อมูลที่ต้องตั้ง DataSource

| Key | ใช้ใน Repository | หมายเหตุ |
|---|---|---|
| `ConnectionString` | Approval, Audit, Delegation, Employee, ExternalShare, FileDocument, Fi | CMS_DB (หลัก — DMS/KMS/WFE/RGP ส่วนใหญ่) |
| `ProjectDbConnectionString` | Project, ProjectTask | `RunningNumber` (สร้างเลข Project/Task) — ฐาน BUI_RG เดิม |
| `CmsLinkDbConnectionString` | Kms | RGP อ่านหมวด KMS (`KMS.m_KBCategory`) |
| `BisDbConnectionString` | ProjectMemberRole | ดึง SubCommittee/Division/Department สำหรับ Project member role |
| `CommonDbConnectionString` | EmployeeRepository (dead) | ใช้เฉพาะใน method dead (`dbo.Employees`) — ไม่ต้องทำ |

- `TemplateDocRepository` อ่าน `BUI_RG.dbo.m_document` (132 แถว) และ `BUI_RG.dbo.m_document_type` (6 แถว) — cross-database บน server เดียวกับ `ConnectionString`
- `WorkflowCreateTemplateForm` ใช้ `ConnectionStrings["CmsDb"]` จาก app.config
- `ProjectRepository.GenerateProjectNo` และ `ProjectTaskRepository.GenerateTaskCode` เข้า `RunningNumber` ด้วย `ProjectDbConnectionString` (ตาราง `dbo.RunningNumber`, 22 แถว, ใน `BUI_RG`)
- `ProjectMemberRoleRepository.GetSubCommittees/GetDivisions/GetDepartments` อ่านจาก `BisDbConnectionString` — ยืนยันกับทีมว่าเป็นฐานเดียวกับ CMS_DB หรือไม่ (OPEN_QUESTIONS B8)

## ภาคผนวก D — ที่ไม่ใช่ตารางแต่ API ต้องดูแล

ดูรายละเอียดที่ [`05-cross-cutting.md`](docs/nestjs-api/05-cross-cutting.md):
- [ ] ไฟล์ DMS บน network share + SHA-256 + (virus scan ถูกข้ามอยู่) + PDF security
- [ ] Auth: AD Auth API/LDAP/Employee API/Menu API · แปลง token → `UserContext`
- [ ] Notification: ตาราง `EMS.Notification` + notification server (long polling)
- [ ] งานตามเวลา: approval escalation (ปัจจุบันเป็น timer ในแอป), share expiry, purge ถังขยะ
- [ ] Excel import ของ KMS (`KBExcelReader`, `KBImportProcessor`), Authority/OrgMaster import
- [ ] Transaction/locking ที่ต้องรักษา (`RunningNumber`, `sp_CreateWFStepInstance`, `KBCategory` Serializable)

