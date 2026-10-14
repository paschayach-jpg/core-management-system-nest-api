# Cross-cutting: สิ่งที่ API ต้องมีนอกเหนือจาก CRUD

> ที่มา: `Program.cs`, `MDI_Container.cs`, `CMS.Services/*`, `CMS.Infrastructure/*`, `CMS.Data/Repositories/*` · ตรวจแล้วเฉพาะส่วนที่ถูกเรียกจริง

## 1. Authentication (ตัวตน)

| ขั้นตอน | รายละเอียด |
|---|---|
| ผู้ให้บริการตัวตน | **AD Auth API ภายนอก** (ไม่ใช่ DB ของระบบนี้): `AdAuthApiBaseUrl` + `AdAuthLoginPath` (default `/api/auth/login`) + `AdAuthValidatePath` (default `/api/auth/validate`) |
| วิธีเข้าระบบ | 3 แบบ: (1) กรอก username/password ที่ LoginForm, (2) command-line `/u:… /p:…`, (3) command-line `/token:<access-token>` จากโปรแกรมอื่น |
| ผลลัพธ์จาก AD API | `AdAuthResult { Success, AccessToken, AdUserName, EmployeeInfo, ErrorMessage }` |
| เมนูตามสิทธิ์ | `MenuApiService` เรียก `MenuApiUrl` + `MenuApiProgramId` ด้วย access token → `GlobalData.UserMenuModel` (ระบบ Menu API ภายนอก) **คู่กับ** ตาราง `EMS.MenuItem` ที่ Admin จัดการ (สองระบบทำงานคู่กัน) |
| ข้อมูลพนักงาน | `EmployeeApiService` (`EmployeeApiBaseUrl`, `EmployeeApiToken` เป็น Bearer) และ `LdapUserSearchService` (`LdapPath`, `LdapUsername`, `LdapPassword`) สำหรับค้นหาผู้ใช้ตอนมอบหมาย/แชร์ |
| บัญชีในระบบ | `EMS.UserAccount` (สร้างอัตโนมัติครั้งแรก: Officer, OrgUnitID=1) ดูขั้นตอนเต็มที่ `04-business-rules.md` §1.2 |

**สิ่งที่ API ต้องทำ:** รับ token ของ AD API (หรือ proxy login) → แลกเป็น JWT ของ API ที่มี `userId`, `adUserName`, `appRole`, `departmentId`, `divisionId`, `levelCode`, `positionName`, `departmentCode`, `orgUnitId` (ตรงกับ `UserContext`) → ทุก endpoint เติม `UserContext` เดียวกันให้ service

## 2. Authorization (สิทธิ์)

1. **AppRole guard** (1–4) — ดูตารางใน `04-business-rules.md` §1.1
2. **Folder/File ACL** — `PermissionService` (ดูอัลกอริทึม §2.3) · ตาราง `security.FolderPermission`, `security.FilePermission`
3. **FolderAuthorityConfig** (`UserContext.Authority`) — สิทธิ์ตามระดับความลับ: View/Add/Edit/Approve/Download
4. **Org visibility** — `security.UserOrgVisibility` (OrgUnit ที่ผู้ใช้เห็น)
5. **Menu RequiredAppRole** — `EMS.MenuItem.RequiredAppRole`

> เสนอให้ทำเป็น Nest `AuthModule` + `AppRoleGuard` + `FolderAccessGuard` (ใช้ `PermissionEvaluator` ตัวเดียว) และตั้ง `UserContext` ใน `AsyncLocalStorage`/request-scoped provider

## 3. Audit log (`audit.AuditLog`)

- เขียนผ่าน `audit.sp_InsertAuditLog` (พารามิเตอร์: UserID, UserName, UserRole, Module, Action, TableName, RecordID, OldValue, NewValue, IPAddress, MachineName, SessionID, Result, ErrorMessage, AuditDate) · **retry 3 ครั้ง** แล้วค่อย log error (ไม่ throw ใส่ผู้ใช้)
- `Result`: `1` = สำเร็จ, `2` = ล้มเหลว · ค้นหาด้วย `audit.sp_QueryAuditLog` (กรองช่วงวันที่ + user + module + action + result + paging; **Manager/Admin เท่านั้น**)
- ตารางมี **251,485 แถว** — index: `AuditDate DESC`, `(UserID,AuditDate DESC)`, `(Module,Action,AuditDate DESC)` · CHECK: `Action` ต้องไม่ว่าง
- RGP มีตาราง audit แยก `RGP.t_project_audit_log` (Result 1/2, Module=`Project`)
- API ต้องใส่ `IPAddress`/`MachineName`/`SessionID` ที่ได้จาก request (ปัจจุบันมาจาก client WinForms)

### 3.1 รายการ Module/Action ที่ระบบเขียนจริง (สกัดอัตโนมัติจากโค้ด)

| Module | Action (ค่าจริงในโค้ด) | ที่มา (class) |
|---|---|---|
| (ไม่ระบุ/ตัวแปร) | `WorkflowInstanceCreated`, `WorkflowStepCompleted`, `WorkflowStepRejected`, `WorkflowInstanceSuspended`, `WorkflowInstanceResumed`, `WorkflowInstanceCancelled`, `WorkflowTemplateCreated`, `WorkflowTemplateUpdated`, `WorkflowTemplateDeleted`, `WorkflowTemplateSubmittedForApproval`, `WorkflowTemplateApproved`, `WorkflowTemplateRejected`, `WorkflowTemplatePublished`, `WorkflowTemplateDeactivated`, `SLAEscalated`, `TaskDelegated`, `DelegationDeactivated`, ``, `UserChangePassword`, `WorkflowTaskDelegated_OOF`, `WorkflowTaskDelegated`, `WorkflowInstanceSuspendedFromUI`, `WorkflowInstanceResumedFromUI`, `WorkflowInstanceCancelledFromUI`, `WorkflowTemplateDeletedFromUI`, `WorkflowTemplateDuplicatedFromUI`, `WorkflowTemplateSubmittedFromList`, `WorkflowTemplatePublishedFromList`, `WorkflowTemplateDeactivatedFromList`, `WorkflowTemplateExported`, `WorkflowTemplateImported`, `WorkflowHistoryExporte | HistorySearchPresenter, MDI_Container, SLACalculator, UserProfileForm, WorkflowDashboardForm, WorkflowDelegationForm, WorkflowDelegationService, WorkflowInstanceDetailPresenter, WorkflowService, Workf |
| Approval | `DELETE_ERROR` | FolderService |
| Auth | `LOGIN`, `LOGOUT` | MDI_Container, Program |
| Config | `UPDATE` | ConfigAdminPresenter |
| DMS | `action` | AuthorityImportService |
| Download | `CREATE`, `UPDATE` | ApprovalService |
| File | `MoveFile`, `auditAction`, `DOWNLOAD`, `DELETE`, `HIDE`, `UNHIDE`, `RENAME`, `UPLOAD`, `DELETE_PHYSICAL_ERROR`, `action`, `UPLOAD_FILE_LIMIT_EXCEEDED` | FileService, FileUploadForm, FolderService, VirusScanService |
| FilePermission | `request.IsDeny ? "DENY" : "GRANT`, `SET_FILE_PERMISSION`, `REVOKE_FILE_PERMISSION`, `SYNC_FILE_PERMISSION` | FilePermissionCommandController, FilePermissionService |
| FileSharing | `APPROVE_EXTERNAL_SHARE`, `APPROVE_INTERNAL_SHARE`, `RequestFolderShare`, `CreateInternalShare`, `RequestInternalShare`, `RevokeInternalShare`, `CreateExternalShare`, `ApproveExternalShare`, `RejectExternalShare`, `RevokeExternalShare`, `isDisabling ? "DisableExternalShare" : "EnableExternalShare`, `ModifyExternalShare`, `AccessGranted`, `ShareDisabled`, `ShareExpired` | ApprovalService, ShareAccessService, ShareService |
| Folder | `APPROVE`, `DELETE`, `MoveFolder`, `CREATE`, `GRANT_READ_FAILED`, `UPDATE`, `DELETE_CONTENT_ERROR`, `DELETE_ERROR`, `COPY_STRUCTURE` | ApprovalService, FolderService |
| KnowledgeBase | `CREATE_KB_CATEGORY`, `UPDATE_KB_CATEGORY`, `DEACTIVATE_KB_CATEGORY`, `isNew ? "CREATE_KB_IMPORT_TEMPLATE" : "UPDATE_KB_IMPORT_TEMPLATE`, `DEACTIVATE_KB_IMPORT_TEMPLATE`, `ACTIVATE_KB_IMPORT_TEMPLATE`, `MOVE_KB_ARTICLE`, `isNew ? "CREATE_KB_ARTICLE_DISPLAY_PROFILE" : "UPDATE_KB_ARTICLE_DISPLAY_PROFILE`, `DEACTIVATE_KB_ARTICLE_DISPLAY_PROFILE`, `ACTIVATE_KB_ARTICLE_DISPLAY_PROFILE`, `ASSIGN_KB_ARTICLE_DISPLAY_PROFILE`, `CREATE_KB_ARTICLE`, `UPDATE_KB_ARTICLE`, `actionName`, `ATTACH_FILE`, `DELETE_KB_ARTICLE` | KBArticleDisplayProfileService, KBArticleMoveService, KBArticleService, KBCategoryService, KBImportTemplateService |
| MenuManagement | `CREATE_MENU`, `UPDATE_MENU`, `DELETE_MENU`, `REORDER_MENUS`, `isActive ? "ACTIVATE_MENU" : "DEACTIVATE_MENU` | MenuService |
| OrgMaster | `SAVE_DIVISION`, `DELETE_DIVISION`, `SAVE_DEPARTMENT`, `DELETE_DEPARTMENT`, `SAVE_POSITION`, `DELETE_POSITION`, `SAVE_LEVEL`, `DELETE_LEVEL`, `SAVE_MAPPING`, `DELETE_MAPPING`, `IMPORT_ORG_MASTER` | OrgMasterService |
| OrgStructure | `CREATE`, `UPDATE`, `MOVE`, `DELETE`, `FORCE_DELETE`, `LINK` | OrgStructureService |
| Permission | `DELETE_ERROR`, `request.IsDeny ? "DENY" : "GRANT`, `PROPAGATE_TO_FILES`, `SET_FOLDER_PERMISSION`, `REMOVE_FOLDER_PERMISSION`, `CHANGE_CONF_LEVEL`, `SAVE_FOLDER_SETTINGS` | FolderService, PermissionForm, PermissionPresenter, PermissionService |
| Project | `newId > 0 ? "CREATE_PROJECT" : "CREATE_PROJECT_FAILED`, `CREATE_PROJECT_FAILED`, `ok ? "UPDATE_PROJECT" : "UPDATE_PROJECT_FAILED`, `ok ? "DELETE_PROJECT" : "DELETE_PROJECT_FAILED`, `ok ? "CLOSE_PROJECT" : "CLOSE_PROJECT_FAILED`, `newId > 0 ? "CREATE_PROJECT_STATE" : "CREATE_PROJECT_STATE_FAILED`, `ok ? "DELETE_PROJECT_STATE" : "DELETE_PROJECT_STATE_FAILED`, `newId > 0 ? "CREATE_PROJECT_TASK" : "CREATE_PROJECT_TASK_FAILED`, `UPDATE_PROJECT_TASK_STATUS` | ProjectService, ProjectStateService, ProjectTaskService |
| UserAccess | `GRANT_VISIBILITY`, `REVOKE_VISIBILITY`, `CHANGE_ROLE`, `DEACTIVATE_USER`, `ASSIGN_ORG`, `ADD_USER_TO_ORG`, `CHANGE_ORG` | UserAccessForm |
| UserManagement | `wasActive ? "DEACTIVATE_USER" : "ACTIVATE_USER`, `isNew ? "CREATE_USER" : "EDIT_USER` | UserManagementForm |
| UserOrgVisibility | `action` | UserOrgVisibilityService |
| Workflow | `CREATE`, `APPROVE`, `APPLY_PERMISSION`, `REJECT`, `DELETE`, `UPDATE` | ApprovalService |
| module | `action` | ApprovalService, FileService, FolderService, OrgStructureService |

> ค่าใน Action ที่เป็นตัวแปร/นิพจน์ (เช่น `request.IsDeny ? "DENY" : "GRANT"`) ถูกรวมเป็นข้อความดิบ — ดูเงื่อนไขที่ `06-service-use-cases.md` · `AuditService` ไม่ตรวจชื่อ Action (ต้องไม่ว่างตาม CHECK)
> ⚠ **audit บางส่วนเขียนจากชั้น UI/Controller โดยตรง ไม่ใช่ Service**: `UserManagementForm` (`CREATE_USER/EDIT_USER/ACTIVATE_USER/DEACTIVATE_USER`), `UserAccessForm` (`GRANT/REVOKE_VISIBILITY`, `CHANGE_ROLE`, `ASSIGN_ORG`, `ADD_USER_TO_ORG`, `CHANGE_ORG`, `DEACTIVATE_USER`), `FileUploadForm` (`UPLOAD_FILE_LIMIT_EXCEEDED`), `PermissionForm`/`PermissionPresenter` (`SET_FOLDER_PERMISSION`, `REMOVE_FOLDER_PERMISSION`, `CHANGE_CONF_LEVEL`, `SAVE_FOLDER_SETTINGS`), `ConfigAdminPresenter` (`Config/UPDATE`), `FilePermissionCommandController` — เมื่อทำ API ต้องย้ายการเขียน audit เหล่านี้เข้า service ฝั่ง server เอง (ไม่มีกฎ/ตรวจสิทธิ์ในชั้นกลางให้ลอก; เช่น การเปลี่ยน `AppRole`/สร้างผู้ใช้ทำผ่าน `UserAdminController` → `UserAccountRepository` ตรง จึง **ต้องกำหนดกฎ Admin-only เอง**)

## 4. Notification

มี **สองระบบ** ที่ต้องตัดสินใจ:

| ระบบ | รายละเอียด |
|---|---|
| ตาราง `EMS.Notification` | เขียนด้วย `EMS.sp_InsertNotification(@RecipientUserId,@EventType,@RelatedEntityId,@MessageText)` จาก `NotificationService.Send` / ApprovalService / ShareService / Workflow (≈ 525,748 แถว) · SP อ่าน/ทำเครื่องหมายอ่านมีใน DB (`sp_GetUnreadNotificationsByUser`, `sp_MarkNotificationRead`) แต่ **โค้ดปัจจุบันไม่เรียก** (ปุ่ม "อ่านแล้ว" ใน MDI ไม่ถูกสร้าง) |
| Notification server ภายนอก | `NotificationClient` ทำ **long polling** ไปที่ `NotificationServerUrl` (`/api/connections/register`, `/heartbeat`, poll) ด้วย `NotificationAppCode` + `NotificationApiKey` — แสดง toast/พาเนลใน MDI |

- EventType ที่พบ: `ApprovalRequestPending`, `ApprovalRequestApproved`, `ApprovalEscalation`, `ExternalShareCreated`, … (สตริงอิสระ)
- ⚠ `NotificationApiKey` มีค่า default ฝังใน `MDI_Container.InitializeNotificationSystemAsync` — **ห้ามนำไปใส่ใน API/ซอร์สโค้ด** ให้ย้ายเป็น secret
- ยังไม่ทราบว่า notification server อ่านตาราง `EMS.Notification` หรือไม่ (ดู OPEN_QUESTIONS)

## 5. ไฟล์ (File storage)

| เรื่อง | รายละเอียด |
|---|---|
| ที่เก็บ | network share ตามคอนฟิก `NetworkDrivePath`; path = `<NetworkDrivePath>\<OrgUnitID>\<FolderID>\<ไฟล์>` |
| การเชื่อมต่อ | `NetworkShareConnector.TryEnsureConnected` สร้าง SMB session ตอนเริ่ม (ต้องใช้ credential จากคอนฟิก) — **API server ต้องมีสิทธิ์เข้าถึง share เดียวกัน** |
| metadata | `storage.FileDocument` (PhysicalPath, StoredFileName, Checksum SHA-256, Version) |
| การเขียนแบบปลอดภัย | เขียน → ตรวจขนาด → ค่อย INSERT; ถ้าบันทึก DB ล้มเหลวต้องลบไฟล์กายภาพ (`writtenPath`) |
| สตรีม | ผู้ใช้ส่ง `FileStream` เต็มไฟล์ (≤100MB) — API ควรรองรับ multipart/stream ไม่โหลดทั้งก้อนใน memory |
| Preview/PDF | `PdfSecurityHelper` (เปิด PDF แบบ block print/save ด้วยไฟล์ชั่วคราว) — ต้องตัดสินใจว่าจะย้ายไป server-side หรือคง client |
| Virus scan | โค้ดมี `VirusScanService` (ClamAV `ClamAV.Host/Port`) แต่ **การอัปโหลดข้ามการสแกน** |
| KMS import | อ่านไฟล์ Excel/แนบจากโฟลเดอร์ในเครื่องผู้ใช้ (`LawFileDownloader`) แล้วอัปโหลดเข้า DMS — ใน API ต้องกำหนดวิธีรับไฟล์จำนวนมาก (zip/batch) |

## 6. การตั้งค่า (Configuration)

`CMS.Infrastructure/ConfigManager` อ่านจาก **app.config** (appSettings/connectionStrings) และ **ตาราง `dbo.SystemConfig`** ผ่าน SP `sp_GetSystemConfig(@Key)` / `sp_UpsertSystemConfig(@Key,@Value,@UpdatedByUserId)` (มี cache ในหน่วยความจำ; Admin แก้ได้ → invalidate)

| Key | ใช้ที่ | หมายเหตุ |
|---|---|---|
| `ConnectionString` | ทุก repository | ฐาน CMS_DB |
| `ProjectDbConnectionString`, `BisDbConnectionString`, `CmsLinkDbConnectionString`, `CommonDbConnectionString` | RGP | `CommonDb` ใช้เฉพาะ method ที่ dead |
| `AdAuthApiBaseUrl`, `AdAuthLoginPath`, `AdAuthValidatePath` | Login | |
| `MenuApiUrl`, `MenuApiProgramId` | เมนูตามสิทธิ์ | |
| `EmployeeApiBaseUrl`, `EmployeeApiToken` | ข้อมูลพนักงาน | Bearer token — secret |
| `LdapPath`, `LdapUsername`, `LdapPassword` | ค้นหาผู้ใช้ LDAP | secret |
| `NetworkDrivePath` (+ ค่า connector) | ไฟล์ DMS | |
| `ClamAV.Host`, `ClamAV.Port` | VirusScan (ไม่ใช้จริงตอนอัปโหลด) | |
| `NotificationServerUrl`, `NotificationAppCode`, `NotificationApiKey` | notification server | ค่า default ฝังในโค้ด — secret |
| `EscalationTimerIntervalSeconds` | timer escalation ของ approval | default 60 |
| `WorkflowSLADefaultHours`, `WorkflowSLAWarningThresholdPercent`, `WorkflowSLAJobIntervalMinutes`, `WorkflowEscalationEnabled`, `WorkflowAutoRejectOnOverdue`, `WorkflowNotificationEnabled/InAppEnabled/EmailEnabled` | WFE SLA/แจ้งเตือน | job ที่ใช้ส่วนใหญ่เป็น dead; `WorkflowNotification*` อ่านโดย `WorkflowNotificationService` |
| `ConnectionStrings["CmsDb"]` | `WorkflowCreateTemplateForm` (SQL ตรง) | ชื่อ connection แยกใน app.config |

**API:** ใช้ `@nestjs/config` + secret manager; ย้ายค่าที่เป็น secret ออกจากซอร์ส; ทำ `ConfigService` อ่าน `dbo.SystemConfig` แทน `ConfigManager`

## 7. งานตามเวลา (Scheduled jobs)

| งาน | ปัจจุบัน | สำหรับ API |
|---|---|---|
| Approval escalation (`ApprovalService.ProcessEscalations`) | **timer ในแอป WinForms ทุกเครื่อง** ทุก 60 วินาที (ทำซ้ำได้พร้อมกัน ⇒ เสี่ยงทำซ้ำ) | scheduled job เดียว (cron/`@nestjs/schedule`) + กันซ้ำด้วย lock |
| ShareAccessService.ProcessExpiredShares / ProcessDisabledShares | ไม่ถูกเรียก (dead) | ต้องตัดสินใจว่าจะให้ share หมดอายุเปลี่ยนสถานะเป็น `Expired` อัตโนมัติไหม (ปัจจุบันตรวจตอนเข้าถึงเท่านั้น) |
| WFESLABackgroundJob / SimpleBackgroundJobScheduler | ไม่ถูกเรียก (dead) | ถ้าต้องการ SLA alert ต้องออกแบบใหม่ |
| `storage.sp_UpdateAllFolderFileCounts` | มีใน DB ไม่มีโค้ดเรียก | `FileCount` คำนวณสดแล้ว ไม่จำเป็น |
| Recycle bin 30 วัน | ตรวจเมื่อกู้คืน (`RecycleBinExpiry`) ไม่มี job ลบถาวรอัตโนมัติ | ตัดสินใจว่าต้องมี purge job หรือไม่ |

## 8. Transaction และ concurrency ที่ต้องรักษา

| ที่ | รายละเอียด |
|---|---|
| `KBCategoryRepository.Insert` | ถ้า `CategoryID` ไม่ใช่ IDENTITY → `MAX+1` ภายใต้ `IsolationLevel.Serializable` |
| `KBArticleRepository` (Insert/Update/UpdateFromImport/MoveToCategory ฯลฯ) | หลายคำสั่งใน transaction: article + `t_KBVersion` + `CurrentVersion` |
| `KBImportTemplateRepository.SaveTemplateWithMappings`, `KBArticleDisplayProfileRepository.SaveProfileWithColumns` | ลบ/ใส่คอลัมน์ทั้งชุดใน transaction เดียว |
| `OrgUnitRepository.ForceDeleteWithDependents` | soft delete folder + OrgUnit ใน transaction |
| `ProjectRepository.GenerateProjectNo`, `ProjectTaskRepository.GenerateTaskCode` | `UPDLOCK,ROWLOCK` บน `RunningNumber` (ฐาน ProjectDb) |
| `ProjectStateRepository` (ReorderStates) | อัปเดตลำดับหลายแถวใน transaction |
| `WFE.sp_CreateWFStepInstance` | `TABLOCKX,HOLDLOCK` + `BEGIN TRAN` เพื่อคำนวณ ID |
| **ที่ไม่มี transaction (ควรทบทวน)** | ผลข้างเคียงหลังอนุมัติ approval, การสร้าง share + approval request, upload ไฟล์ + propagate สิทธิ์ |

## 9. Cache / สถานะฝั่ง client ที่ต้องออกแบบใหม่

| ที่ | ปัจจุบัน | คำแนะนำ |
|---|---|---|
| `PermissionService` | Dictionary ต่อ instance: `_permCache`, `_aclCache`, `_folderCache`, `_userAccountCache` + `PreloadAcl` ตอน login (`SessionAcl`) | แคชต่อ request หรือ Redis/TTL สั้น + invalidate เมื่อ Set/Revoke สิทธิ์หรือแก้ผู้ใช้ |
| `FolderService` | แคชรายการ folder ต่อ OrgUnit (`InvalidateFolderCache`) | invalidate เมื่อ create/rename/move/delete |
| `ConfigManager` | แคช config + invalidate เมื่อ `Set` | `@nestjs/config` + cache-manager |
| `GlobalData` | static (เมนู/ข้อมูลผู้ใช้) | เปลี่ยนเป็นข้อมูลต่อ request |
| `UserContext.Authority`/`SessionAcl` | คำนวณตอน login | คำนวณใน guard ตอนต้น request (หรือเก็บใน JWT/Session store ที่มีอายุสั้น) |

## 10. Integration ภายนอกที่ต้องคงไว้

| ระบบ | ใช้ผ่าน | หมายเหตุ |
|---|---|---|
| AD Auth API | `AdAuthService` | login/validate token |
| Menu API | `MenuApiService` | เมนูตามสิทธิ์ |
| Employee API | `EmployeeApiService` | โครงสร้าง/พนักงาน (sync เข้า `EMS.UserAccount`) |
| LDAP | `LdapUserSearchService` | ค้นหาผู้ใช้ |
| Notification server | `NotificationClient` | long polling |
| Network share (SMB) | `NetworkDriveHelper`/`NetworkShareConnector` | ไฟล์ DMS |
| HR sync (ฐาน `SCS`, schema `core`) | SP `EMS.sp_Sync*` (โค้ดไม่เรียก) | น่าจะรันนอกระบบนี้ |

