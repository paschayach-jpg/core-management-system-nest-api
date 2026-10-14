# Service Use Cases → ตาราง (ระดับ Service ไม่ใช่ Repository)

> วิเคราะห์จาก call graph: public method ของ `CMS.Services` ที่ถูกเรียกจริง → repository method ที่ถูกเรียกต่อ → ตาราง (CRUD)
> **ใช้เป็นฐานออกแบบ endpoint ของ API** เพราะหนึ่ง use case = หนึ่ง Service method (มักแตะหลายตารางใน flow เดียว) · ข้อมูลในคอลัมน์ Guard/Audit สกัดอัตโนมัติจากโค้ด (ตรวจซ้ำก่อนใช้)

**อ่านคอลัมน์:** `ตาราง` = CRUD ที่ method นี้ทำโดยตรงและผ่าน service อื่น · `Guard` = เงื่อนไข `AppRole` ที่พบใน body · `Audit` = `Module/Action` ที่ log

## ดัชนี: Service ที่ module เรียกใช้

- **DMS:** `ApprovalService`, `AuditService`, `AuthorityImportService`, `FilePermissionService`, `FileService`, `FolderAuthorityService`, `FolderQuotaService`, `FolderService`, `MenuService`, `NotificationService`, `OrgMasterService`, `OrgStructureService`, `PermissionService`, `QuickAccessService`, `ShareService`, `UserOrgVisibilityService`
- **KMS:** `AuditService`, `FileService`, `FolderQuotaService`, `KBArticleDisplayProfileService`, `KBArticleMoveService`, `KBArticleService`, `KBCategoryService`, `KBImportProcessor`, `KBImportTemplateService`, `PermissionService`, `SharedFileCache`
- **RGP:** `AuditService`, `FileService`, `FolderQuotaService`, `PermissionService`, `ProjectAttachmentService`, `ProjectAuditService`, `ProjectDocumentService`, `ProjectProgressService`, `ProjectService`, `ProjectStateService`, `ProjectTaskService`
- **WFE:** `AuditService`, `SLACalculator`, `StepResolverService`, `WorkflowDelegationService`, `WorkflowService`, `WorkflowTemplateService`

> Service ที่ถูกใช้โดยหลาย module (เช่น `FileService`, `FolderService`, `PermissionService`, `AuditService`) → ควรเป็น Nest provider กลาง

## ApprovalService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/ApprovalService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `ApproveStep(int stepId, string remark, UserContext user)` | `workflow.ApprovalRequest` RU, `workflow.ApprovalStep` RU, `storage.Folder` CRd, `storage.ExternalShare` RU, `storage.ShareToken` RU, `security.FilePermission` C, `storage.FileDocument` R, `security.FolderPermission` CRU, `audit.AuditLog` C, `EMS.UserAccount`  … | `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … | AppRole < 3 | FileSharing/APPROVE_EXTERNAL_SHARE, FileSharing/APPROVE_INTERNAL_SHARE, Folder/APPROVE, Folder/DELETE, Workflo… |
| `RejectStep(int stepId, string reason, UserContext user)` | `workflow.ApprovalRequest` RU, `workflow.ApprovalStep` RU, `EMS.Notification` C, `audit.AuditLog` C | `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog`, `workflow.sp_GetAllApprovalSteps` … | AppRole < 3 | Workflow/REJECT |
| `GetPendingForApprover(int approverId)` | `EMS.UserAccount` R, `workflow.ApprovalRequest` R, `workflow.ApprovalStep` R | `EMS.sp_GetUserAccountByID` | AppRole == 4, AppRole >= 3 |  |
| `GetApprovalSteps(int requestId)` | `workflow.ApprovalStep` R | `workflow.sp_GetAllApprovalSteps` |  |  |
| `RequestFolderDelete(int folderId, string reason, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R, `workflow.ApprovalRequest` C, `workflow.ApprovalStep` C, `audit.AuditLog` C, `EMS.Notification` C | `EMS.sp_GetUserAccountsByRole`, `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` … |  | Workflow/CREATE |
| `GetAllApprovalsByFolder(int folderId)` | `workflow.ApprovalRequest` R |  |  |  |
| `ProcessEscalations()` | `workflow.ApprovalRequest` R, `workflow.ApprovalStep` CRU, `EMS.UserAccount` R, `EMS.Notification` C, `audit.AuditLog` C | `EMS.sp_GetUserAccountsByRole`, `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` … |  |  |
| `SubmitDownloadRequest(int fileId, string reason, int approverId, UserContext user)` | `workflow.ApprovalRequest` C, `workflow.ApprovalStep` C, `EMS.Notification` C, `audit.AuditLog` C | `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` |  | Download/CREATE |
| `GetApprovedDownloadRequest(int fileId, int userId)` | `workflow.ApprovalRequest` R |  |  |  |
| `ConsumeDownloadApproval(int requestId, UserContext user)` | `workflow.ApprovalRequest` U, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `workflow.sp_UpdateApprovalRequestStatus` |  | Download/UPDATE |

## AuditService

ใช้โดย module: **DMS, KMS, RGP, WFE** · ไฟล์: `CMS.Services/AuditService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `Log(AuditEntry entry)` | `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  |  |
| `Query(AuditQuery query, UserContext user)` | `audit.AuditLog` R | `audit.sp_QueryAuditLog` | AppRole < 3 |  |
| `GetWorkflowAuditLogs(int workflowInstanceId, UserContext user)` | `audit.AuditLog` R, `WFE.t_WFStepInstance` R |  |  |  |

## AuthorityImportService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/AuthorityImportService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `BuildPreview(string filePath, string sheetName, bool updateUserLevel, bool importPositions, UserContext…)` | `EMS.UserAccount` R, `EMS.FolderAuthorityConfig` R | `EMS.sp_GetAllFolderAuthorityConfigs`, `EMS.sp_GetAllUserAccounts` |  |  |
| `Commit(AuthorityImportPreview preview, UserContext user)` | `EMS.UserAccount` U, `audit.AuditLog` C, `EMS.FolderAuthorityConfig` CRUd | `EMS.sp_DeleteFolderAuthorityConfig`, `EMS.sp_GetAllFolderAuthorityConfigs`, `EMS.sp_InsertFolderAuthorityConfig` … |  |  |

## FilePermissionService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/FilePermissionService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `SetFilePermission(SetFilePermissionRequest request, UserContext user)` | `security.FilePermission` CRU, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `security.sp_GetFilePermissionsByFile`, `security.sp_InsertFilePermission` … | AppRole < 3 | FilePermission |
| `RevokeFilePermission(int filePermissionId, UserContext user, string reason = null)` | `security.FilePermission` U | `security.sp_RevokeFilePermission` | AppRole < 3 |  |

## FileService

ใช้โดย module: **DMS, KMS, RGP** · ไฟล์: `CMS.Services/FileService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `UploadFiles( IEnumerable<FileUploadRequest> files, int folderId, UserContext user)` | `storage.FileDocument` CRU, `storage.Folder` RU, `security.FolderPermission` R, `security.FilePermission` CRU, `audit.AuditLog` C, `EMS.UserAccount` R, `EMS.OrgUnit` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R | `EMS.sp_GetOrgUnitByID`, `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog` … | AppRole >= 3 |  |
| `CheckUploadFolder(int folderId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `security.FolderPermission` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder`, `storage.sp_GetFolderByID` | AppRole >= 3 |  |
| `DownloadFile(int fileId, UserContext user, bool bypassPermissionCheck = false)` | `storage.FileDocument` R, `EMS.UserAccount` R, `security.FilePermission` R, `EMS.Notification` C, `audit.AuditLog` C, `storage.Folder` R, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` … |  | File/DOWNLOAD |
| `DeleteFile(int fileId, UserContext user)` | `storage.FileDocument` RU, `EMS.UserAccount` R, `storage.Folder` RU, `security.FilePermission` R, `audit.AuditLog` C, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetFilePermissionsByFile` … | AppRole >= 3 | File/DELETE |
| `HideFiles(List<int> fileIds, UserContext user)` | `storage.FileDocument` RU, `EMS.UserAccount` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFileDocumentByID`, `storage.sp_UpdateFileDocument` |  | File/HIDE |
| `UnhideFiles(List<int> fileIds, UserContext user)` | `storage.FileDocument` RU, `EMS.UserAccount` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFileDocumentByID`, `storage.sp_UpdateFileDocument` |  | File/UNHIDE |
| `GetFilesInFolder(int folderId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder`, `storage.sp_GetFileDocumentsByFolder` … | AppRole >= 3 |  |
| `GetStorageReport(int orgUnitId, UserContext user)` | `EMS.OrgUnit` R, `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | `EMS.sp_GetOrgUnitByID`, `storage.sp_GetFolderDescendants`, `storage.sp_GetRootFoldersByOrgUnit` |  |  |
| `GetAllFilesGroupedByFolder(UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | `storage.sp_GetAllFileDocumentsGroupedByFolder` | AppRole < 3 |  |
| `GetFilesByOrgUnit(int orgUnitId, UserContext user)` | `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.OrgUnit` R, `EMS.m_Department` R, `storage.FileDocument` R, `storage.Folder` R | `storage.sp_GetFileDocumentsByOrgUnit` | AppRole < 3 |  |
| `RenameFile(int fileId, string newName, UserContext user)` | `storage.FileDocument` RU, `EMS.UserAccount` R, `storage.Folder` R, `audit.AuditLog` C, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … | AppRole >= 3 | File/RENAME |
| `MoveFiles(MoveFileRequest request, UserContext user)` | `storage.FileDocument` RU, `storage.Folder` RU, `EMS.UserAccount` R, `audit.AuditLog` C, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … | AppRole < 4 | File, MoveFile |
| `CopyFile(int fileId, int destinationFolderId, UserContext user, bool overwrite = false)` | `storage.FileDocument` CRU, `EMS.UserAccount` R, `storage.Folder` RU, `audit.AuditLog` C, `EMS.OrgUnit` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R, `security.FolderPermission` R | `EMS.sp_GetOrgUnitByID`, `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog` … | AppRole < 4 | CopyFile, CopyFile_Replace, File |
| `FindDuplicateNames(IEnumerable<string> fileNames, int folderId, UserContext user)` | `storage.FileDocument` R |  |  |  |

## FolderAuthorityService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/FolderAuthorityService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetAll()` | `EMS.FolderAuthorityConfig` R | `EMS.sp_GetAllFolderAuthorityConfigs` |  |  |
| `ResolveForEmployee( string positionName, string departmentCode, string divisionCode, string levelCode = null)` | `EMS.FolderAuthorityConfig` R | `EMS.sp_ResolveFolderAuthority` |  |  |
| `ResolveForUser(UserAccount user)` | `EMS.FolderAuthorityConfig` R | `EMS.sp_ResolveFolderAuthority` |  |  |
| `Save(FolderAuthorityConfig config, int userId)` | `EMS.FolderAuthorityConfig` CU | `EMS.sp_InsertFolderAuthorityConfig`, `EMS.sp_UpdateFolderAuthorityConfig` |  |  |
| `Delete(string configLabel, int userId)` | `EMS.FolderAuthorityConfig` d | `EMS.sp_DeleteFolderAuthorityConfig` |  |  |

## FolderQuotaService

ใช้โดย module: **DMS, KMS, RGP** · ไฟล์: `CMS.Services/FolderQuotaService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetUsage(int orgUnitId, int? parentOrgUnitId = null)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R, `EMS.OrgUnit` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R | `EMS.sp_GetOrgUnitByID`, `storage.sp_GetFoldersByOrgUnit` |  |  |
| `GetAllFileStats()` | `EMS.m_SubCommittee` R, `storage.Folder` R, `storage.FileDocument` R, `EMS.OrgUnitRelationship` R, `EMS.m_Division` R, `EMS.OrgUnit` R, `EMS.m_Department` R |  |  |  |
| `GetFilesByOrgUnit(int orgUnitId)` | `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.OrgUnit` R, `EMS.m_Department` R, `storage.FileDocument` R, `storage.Folder` R | `storage.sp_GetFileDocumentsByOrgUnit` |  |  |
| `GetFileTypeStats(int orgUnitId)` | `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.OrgUnit` R, `EMS.m_Department` R, `storage.FileDocument` R, `storage.Folder` R | `storage.sp_GetFileDocumentsByOrgUnit` |  |  |
| `EnforceQuota(int orgUnitId, int? parentOrgUnitId = null)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R, `EMS.OrgUnit` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R | `EMS.sp_GetOrgUnitByID`, `storage.sp_GetFoldersByOrgUnit` |  |  |
| `SendAlertIfNeeded(int orgUnitId, int? parentOrgUnitId = null)` | `EMS.Notification` C, `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R, `EMS.OrgUnit` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R | `EMS.sp_GetOrgUnitByID`, `EMS.sp_InsertNotification`, `storage.sp_GetFoldersByOrgUnit` |  |  |
| `GetAllConfigs()` | `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R |  |  |  |
| `GetConfig(int orgUnitId, int? parentOrgUnitId = null)` | `EMS.OrgUnit` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R | `EMS.sp_GetOrgUnitByID` |  |  |
| `SaveConfig(FolderQuotaConfig config, UserContext user)` | `EMS.m_SubCommittee` U, `EMS.m_Division` U, `EMS.m_Department` U |  |  |  |
| `DeleteConfig(int quotaConfigId, string orgUnitTypeName, UserContext user)` | `EMS.m_SubCommittee` U, `EMS.m_Division` U, `EMS.m_Department` U |  |  |  |
| `SubmitChangeRequest(SubmitQuotaChangeRequest dto, UserContext user)` | `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R, `dms.FolderQuotaChangeRequest` C |  |  |  |
| `GetPendingRequests()` | `dms.FolderQuotaChangeRequest` R, `EMS.OrgUnit` R, `EMS.UserAccount` R |  |  |  |
| `GetAllRequests()` | `dms.FolderQuotaChangeRequest` R, `EMS.OrgUnit` R, `EMS.UserAccount` R |  |  |  |
| `ApproveRequest(int requestId, string remark, UserContext user)` | `dms.FolderQuotaChangeRequest` RU, `EMS.OrgUnit` R, `EMS.UserAccount` R, `EMS.m_SubCommittee` RU, `EMS.m_Division` RU, `EMS.m_Department` RU, `EMS.Notification` C | `EMS.sp_GetOrgUnitByID`, `EMS.sp_InsertNotification` |  |  |
| `RejectRequest(int requestId, string remark, UserContext user)` | `dms.FolderQuotaChangeRequest` RU, `EMS.OrgUnit` R, `EMS.UserAccount` R, `EMS.Notification` C | `EMS.sp_InsertNotification` |  |  |
| `CancelRequest(int requestId, UserContext user)` | `dms.FolderQuotaChangeRequest` RU, `EMS.OrgUnit` R, `EMS.UserAccount` R |  |  |  |

## FolderService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/FolderService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `CreateFolder(CreateFolderRequest request, UserContext user)` | `storage.FileDocument` R, `storage.Folder` CR, `EMS.UserAccount` R, `audit.AuditLog` C, `EMS.Notification` C, `EMS.OrgUnit` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R, `security.FolderPermission` R | `EMS.sp_GetOrgUnitByID`, `EMS.sp_GetUserAccountByID`, `EMS.sp_InsertNotification` … | AppRole >= 3 | Folder/CREATE |
| `CreateHCFolderAfterApproval(ApprovalRequest approvalRequest, UserContext user)` | `storage.FileDocument` R, `storage.Folder` CR, `EMS.UserAccount` R, `audit.AuditLog` C, `security.FolderPermission` CRU | `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder`, `security.sp_InsertFolderPermission` … |  | Folder/APPROVE, Folder/GRANT_READ_FAILED |
| `RenameFolder(int folderId, string newName, UserContext user)` | `storage.FileDocument` R, `storage.Folder` RU, `EMS.UserAccount` R, `audit.AuditLog` C, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … | AppRole >= 3 | Folder/UPDATE |
| `ArchiveFolder(int folderId, UserContext user)` | `storage.FileDocument` RU, `storage.Folder` RU, `EMS.UserAccount` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFileDocumentsByFolder`, `storage.sp_GetFolderByID` … |  | Folder/UPDATE |
| `DeleteFolder(int folderId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` Rd, `audit.AuditLog` C, `security.FolderPermission` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … | AppRole >= 3 | Folder/DELETE |
| `RestoreFolder(int folderId, int? newParentId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFolderByID`, `storage.sp_RestoreFolder` … |  | Folder/UPDATE |
| `PermanentlyDeleteFolder(int folderId, UserContext user)` | `storage.FileDocument` DR, `storage.Folder` DR, `EMS.UserAccount` R, `workflow.ApprovalStep` D, `workflow.ApprovalRequest` DR, `security.FolderPermission` D, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFileDocumentsByFolder`, `storage.sp_GetFolderByID` … | AppRole < 3 | Approval/DELETE_ERROR, File/DELETE_PHYSICAL_ERROR, Folder/DELETE, Folder/DELETE_CONTENT_ERROR, Folder/DELETE_E… |
| `ApplyTemplate(int parentFolderId, int templateId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` CR, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFolderByID`, `storage.sp_GetFolderChildren` … | AppRole < 3 | Folder/CREATE |
| `GetFolderContents(int folderId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `security.FolderPermission` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder`, `storage.sp_GetFolderByID` … | AppRole >= 3 |  |
| `GetFolder(int folderId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R | `storage.sp_GetFolderByID` |  |  |
| `ChangeConfidentialityLevel(int folderId, int newLevel, UserContext user)` | `storage.FileDocument` R, `storage.Folder` RU, `EMS.UserAccount` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFolderByID`, `storage.sp_GetFolderDescendants` … | AppRole < 3 | Folder/UPDATE |
| `GetRootFolders(int? orgUnitId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `security.FolderPermission` R, `EMS.UserAccount` R, `security.UserOrgVisibility` R, `EMS.OrgUnit` R | `EMS.sp_GetOrgUnitHierarchy`, `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder` … | AppRole >= 3 |  |
| `GetDeletedFolders(int? orgUnitId, UserContext user)` | `storage.Folder` R | `storage.sp_GetDeletedFoldersByOrgUnit` |  |  |
| `GetAllFolders(int? orgUnitId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | `storage.sp_GetAllFolders`, `storage.sp_GetFoldersByOrgUnit` |  |  |
| `GetFoldersByOrgUnit(int orgUnitId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | `storage.sp_GetAllFolders`, `storage.sp_GetFoldersByOrgUnit` |  |  |
| `ApplyTemplateToOrgUnit(int orgUnitId, int templateId, string rootFolderName, int confidentialityLevel, UserContex…)` | `storage.FolderTemplateItem` R, `storage.Folder` CR, `audit.AuditLog` C, `storage.FileDocument` R | `audit.sp_InsertAuditLog`, `storage.sp_GetFolderTemplateItems`, `storage.sp_GetRootFoldersByOrgUnit` … |  | Folder/CREATE |
| `ApplyTemplateToFolder(int parentFolderId, int templateId, int confidentialityLevel, UserContext user)` | `storage.FileDocument` R, `storage.Folder` CR, `storage.FolderTemplateItem` R, `audit.AuditLog` C, `security.FolderPermission` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … |  | Folder/CREATE |
| `ApplyTemplateToFolder(int parentFolderId, IList<FolderTemplateItem> items, int confidentialityLevel, UserContext…)` | `storage.FileDocument` R, `storage.Folder` CR, `audit.AuditLog` C, `security.FolderPermission` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … |  | Folder/CREATE |
| `ApplyTemplateToOrgUnit(int orgUnitId, IList<FolderTemplateItem> items, string rootFolderName, int confidentiality…)` | `storage.Folder` CR, `audit.AuditLog` C, `storage.FileDocument` R | `audit.sp_InsertAuditLog`, `storage.sp_GetRootFoldersByOrgUnit`, `storage.sp_InsertFolder` |  | Folder/CREATE |
| `MoveFolder(MoveFolderRequest request, UserContext user)` | `storage.FileDocument` RU, `storage.Folder` RU, `EMS.UserAccount` R, `audit.AuditLog` C, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder` … | AppRole < 2, AppRole < 4 | Folder, MoveFolder |
| `CopyFolderStructure(int sourceFolderId, int destinationParentFolderId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` CR, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `storage.sp_GetFolderByID`, `storage.sp_GetFolderChildren` … | AppRole < 3 | Folder/COPY_STRUCTURE |
| `GetDescendants(int folderId)` | `storage.Folder` R, `storage.FileDocument` R, `EMS.UserAccount` R | `storage.sp_GetFolderDescendants` |  |  |
| `GetAccessibleFolders(int? orgUnitId, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `security.FolderPermission` R, `EMS.UserAccount` R, `security.UserOrgVisibility` R, `EMS.OrgUnit` R | `EMS.sp_GetOrgUnitHierarchy`, `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder` … | AppRole >= 3 |  |

## KBArticleDisplayProfileService

ใช้โดย module: **KMS** · ไฟล์: `CMS.Services/KBArticleDisplayProfileService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetAllProfiles()` | `KMS.m_KBArticleDisplayProfile` R |  |  |  |
| `GetProfileColumnGrid(int? profileId)` | `KMS.m_KBArticleDisplayProfileColumn` R |  |  |  |
| `GetCategoriesUsingProfile(int profileId)` | `KMS.m_KBCategory` R |  |  |  |
| `GetEffectiveDisplaySettings(int categoryId)` | `KMS.m_KBCategory` R, `KMS.m_KBArticleDisplayProfile` R, `KMS.m_KBArticleDisplayProfileColumn` R |  |  |  |
| `SaveProfile(KBArticleDisplayProfile profile, IList<KBArticleDisplayProfileColumnRow> rows, UserContext…)` | `KMS.m_KBArticleDisplayProfile` CRU, `KMS.m_KBArticleDisplayProfileColumn` CD, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | KnowledgeBase |
| `DeleteProfile(int profileId, UserContext user)` | `KMS.m_KBArticleDisplayProfile` d, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | DEACTIVATE_KB_ARTICLE_DISPLAY_PROFILE, KnowledgeBase |
| `ActivateProfile(int profileId, UserContext user)` | `KMS.m_KBArticleDisplayProfile` U, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | ACTIVATE_KB_ARTICLE_DISPLAY_PROFILE, KnowledgeBase |
| `AssignProfileToCategory(int categoryId, int? profileId, UserContext user)` | `KMS.m_KBCategory` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | ASSIGN_KB_ARTICLE_DISPLAY_PROFILE, KnowledgeBase |

## KBArticleMoveService

ใช้โดย module: **KMS** · ไฟล์: `CMS.Services/KBArticleMoveService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetMoveCandidates(IEnumerable<int> categoryIds, bool includeSubCategories)` | `KMS.m_KBCategory` R, `KMS.t_KBArticle` R |  |  |  |
| `PreviewMove(IEnumerable<int> articleIds, int toCategoryId)` | `KMS.m_KBCategory` R, `KMS.t_KBArticle` R |  |  |  |
| `Move(IEnumerable<int> articleIds, int toCategoryId, UserContext user)` | `KMS.m_KBCategory` R, `KMS.t_KBArticle` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | KnowledgeBase, MOVE_KB_ARTICLE |

## KBArticleService

ใช้โดย module: **KMS** · ไฟล์: `CMS.Services/KBArticleService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetAll()` | `KMS.t_KBArticleLink` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R, `KMS.t_KBArticle` R, `KMS.m_KBCategory` R |  |  |  |
| `GetByCategory(int categoryId)` | `KMS.t_KBArticleLink` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R, `KMS.t_KBArticle` R, `KMS.m_KBCategory` R |  |  |  |
| `Search(string keyword, int? categoryId, byte? status, byte? articleType)` | `KMS.t_KBArticleLink` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R, `KMS.t_KBArticle` R, `KMS.m_KBCategory` R |  |  |  |
| `SearchByType(string keyword, int? categoryId, byte? status, byte? articleType, int searchFieldId)` | `KMS.t_KBArticleLink` R, `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.m_Department` R, `KMS.t_KBArticle` R, `KMS.m_KBCategory` R |  |  |  |
| `GetById(int articleId)` | `KMS.t_KBArticle` R, `KMS.m_KBCategory` R |  |  |  |
| `ArticleCodeExists(string articleCode)` | `KMS.t_KBArticle` R |  |  |  |
| `GetByCode(string articleCode)` | `KMS.t_KBArticle` R |  |  |  |
| `Create(KBArticle article)` | `KMS.t_KBArticle` CR, `KMS.t_KBVersion` C, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | CREATE_KB_ARTICLE, KnowledgeBase |
| `Update(KBArticle article, string changeDescription, string actionBy)` | `KMS.t_KBArticle` RU, `KMS.m_KBCategory` R, `KMS.t_KBVersion` CR, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | KnowledgeBase, UPDATE_KB_ARTICLE |
| `ChangeStatus(int articleId, byte newStatus, string actionBy)` | `KMS.t_KBArticle` RU, `KMS.m_KBCategory` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | KnowledgeBase |
| `GetVersionHistory(int articleId)` | `KMS.t_KBVersion` R |  |  |  |
| `GetLatestVersionNumber(int articleId)` | `KMS.t_KBVersion` R |  |  |  |
| `GetArticleAttachments(int articleId)` | `KMS.t_KBArticleAttachment` R |  |  |  |
| `GetArticleAttachmentFiles(int articleId)` | `KMS.t_KBArticleAttachment` R, `storage.FileDocument` R, `EMS.UserAccount` R | `storage.sp_GetFileDocumentByID` |  |  |
| `SaveArticleAttachments(int articleId, IEnumerable<int> fileIds, string actionBy)` | `KMS.t_KBArticleAttachment` CD, `KMS.t_KBArticleLink` CR, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | ATTACH_FILE, KnowledgeBase |
| `RemoveArticleAttachment(int articleId, int fileId)` | `KMS.t_KBArticleAttachment` D |  |  |  |
| `GetArticleLinks(int articleId, byte? entityType = null)` | `KMS.t_KBArticleLink` R |  |  |  |
| `GetAllLinksByType(byte entityType)` | `KMS.t_KBArticleLink` R |  |  |  |
| `SaveArticleLinks(int articleId, IEnumerable<KBArticleLink> links)` | `KMS.t_KBArticleLink` CDR |  |  |  |
| `LinkArticles(int articleId, int otherArticleId, string createdBy)` | `KMS.t_KBArticleLink` CR |  |  |  |
| `UnlinkArticles(int articleId, int otherArticleId)` | `KMS.t_KBArticleLink` DR |  |  |  |
| `RemoveArticleLink(int articleId, int entityId, byte entityType)` | `KMS.t_KBArticleLink` DR |  |  |  |
| `IncrementViewCount(int articleId)` | `KMS.t_KBArticle` U |  |  |  |
| `IncrementLikeCount(int articleId)` | `KMS.t_KBArticle` U |  |  |  |
| `SoftDelete(int articleId, string actionBy)` | `KMS.t_KBArticleLink` DR, `KMS.t_KBArticle` d, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | DELETE_KB_ARTICLE, KnowledgeBase |
| `UpdateExpiryDate(int articleId, DateTime? expiryDate)` | `KMS.t_KBArticle` U |  |  |  |

## KBCategoryService

ใช้โดย module: **KMS** · ไฟล์: `CMS.Services/KBCategoryService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetAll()` | `KMS.m_KBCategory` R |  |  |  |
| `GetAllActive()` | `KMS.m_KBCategory` R |  |  |  |
| `Create(KBCategory category)` | `KMS.m_KBCategory` CR, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | CREATE_KB_CATEGORY, KnowledgeBase |
| `Update(KBCategory category)` | `KMS.m_KBCategory` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | KnowledgeBase, UPDATE_KB_CATEGORY |
| `Deactivate(int categoryId)` | `KMS.m_KBCategory` d, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | DEACTIVATE_KB_CATEGORY, KnowledgeBase |

## KBImportProcessor

ใช้โดย module: **KMS** · ไฟล์: `CMS.Services/KBImportProcessor.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `ValidateRows(IList<KBImportRow> rows)` | `KMS.m_KBCategory` R, `KMS.t_KBArticle` R |  |  |  |
| `InsertArticles( IList<KBImportRow> rows, UserContext user, bool skipRowOnDownloadFailure, byte resolvedAr…)` | `KMS.t_KBArticle` CRU, `KMS.t_KBVersion` CR, `KMS.t_KBArticleLink` CR, `storage.FileDocument` CRU, `EMS.UserAccount` R, `storage.Folder` RU, `security.FilePermission` CRU, `audit.AuditLog` C, `security.FolderPermission` R, `KMS.t_KBArticleAttachment` CDR, `EMS … | `EMS.sp_GetOrgUnitByID`, `EMS.sp_GetUserAccountByID`, `audit.sp_InsertAuditLog` … |  |  |

## KBImportTemplateService

ใช้โดย module: **KMS** · ไฟล์: `CMS.Services/KBImportTemplateService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetAllTemplates()` | `KMS.m_KBImportTemplate` R |  |  |  |
| `GetTemplateById(int templateId)` | `KMS.m_KBImportTemplate` R |  |  |  |
| `GetTemplateColumnGrid(int? templateId)` | `KMS.t_KBArticle` R, `KMS.m_KBImportTemplateColumn` R, `KMS.m_KBCategory` R |  |  |  |
| `SaveTemplate(KBImportTemplate template, IList<KBImportTemplateColumnRow> rows, UserContext user)` | `KMS.m_KBImportTemplate` CRU, `KMS.m_KBImportTemplateColumn` CD, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | KnowledgeBase |
| `DeleteTemplate(int templateId, UserContext user)` | `KMS.m_KBImportTemplate` d, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | DEACTIVATE_KB_IMPORT_TEMPLATE, KnowledgeBase |
| `ActivateTemplate(int templateId, UserContext user)` | `KMS.m_KBImportTemplate` U, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | ACTIVATE_KB_IMPORT_TEMPLATE, KnowledgeBase |

## MenuService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/MenuService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetRootMenus(UserContext currentUser)` | `EMS.MenuItem` R |  |  |  |
| `GetChildMenus(int parentMenuItemID, UserContext currentUser)` | `EMS.MenuItem` R |  |  |  |
| `CreateMenu(MenuItem menuItem, UserContext admin)` | `EMS.MenuItem` CR, `audit.AuditLog` C | `EMS.sp_CreateMenuItem`, `audit.sp_InsertAuditLog` | AppRole != 4 | CREATE_MENU, MenuManagement |
| `UpdateMenu(MenuItem menuItem, UserContext admin)` | `EMS.MenuItem` RU, `audit.AuditLog` C | `EMS.sp_UpdateMenuItem`, `audit.sp_InsertAuditLog` | AppRole != 4 | MenuManagement, UPDATE_MENU |
| `DeleteMenu(int menuItemID, UserContext admin)` | `EMS.MenuItem` DR, `audit.AuditLog` C | `EMS.sp_DeleteMenuItem`, `audit.sp_InsertAuditLog` | AppRole != 4 | DELETE_MENU, MenuManagement |
| `GetAllMenusForManagement(UserContext admin)` | `EMS.MenuItem` R |  | AppRole != 4 |  |
| `IsMenuKeyUnique(string menuKey, int? excludeMenuItemID = null)` | `EMS.MenuItem` R |  |  |  |
| `GetMenuStatistics()` | `EMS.MenuItem` R |  | AppRole == 1, AppRole == 2, AppRole == 3, AppRole == 4 |  |

## NotificationService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/NotificationService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `Send(NotificationRequest request)` | `EMS.Notification` C | `EMS.sp_InsertNotification` |  |  |

## OrgMasterService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/OrgMasterService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetAllDivisions() => _divisionRepo.GetAll()` | `EMS.m_Division` R |  |  |  |
| `SaveDivision(HrDivision division, int userId)` | `EMS.m_Division` CRU |  |  | OrgMaster, SAVE_DIVISION |
| `DeleteDivision(int divisionId, int userId)` | `EMS.m_Division` D |  |  | DELETE_DIVISION, OrgMaster |
| `GetAllDepartments() => _deptRepo.GetAll()` | `EMS.m_Department` R |  |  |  |
| `SaveDepartment(HrDepartment department, int userId)` | `EMS.m_Department` CRU |  |  | OrgMaster, SAVE_DEPARTMENT |
| `DeleteDepartment(int departmentId, int userId)` | `EMS.m_Department` D |  |  | DELETE_DEPARTMENT, OrgMaster |
| `GetAllPositions() => _positionRepo.GetAll()` | `EMS.m_Role` R |  |  |  |
| `SavePosition(HrPosition position, int userId)` | `EMS.m_Role` CRU |  |  | OrgMaster, SAVE_POSITION |
| `DeletePosition(int positionId, int userId)` | `EMS.m_Role` D |  |  | DELETE_POSITION, OrgMaster |
| `GetAllLevels() => _levelRepo.GetAll()` | `EMS.m_Position` R |  |  |  |
| `SaveLevel(HrPositionLevel level, int userId)` | `EMS.m_Position` CRU |  |  | OrgMaster, SAVE_LEVEL |
| `DeleteLevel(string levelCode, int userId)` | `EMS.m_Position` D |  |  | DELETE_LEVEL, OrgMaster |
| `GetAllMappings() => _mappingRepo.GetAll()` | `EMS.m_PositionMapping` R, `EMS.m_Role` R, `EMS.m_Division` R, `EMS.m_Department` R |  |  |  |
| `SaveMapping(HrPositionMapping mapping, int userId)` | `EMS.m_PositionMapping` CRU |  |  | OrgMaster, SAVE_MAPPING |
| `DeleteMapping(int mappingId, int userId)` | `EMS.m_PositionMapping` D |  |  | DELETE_MAPPING, OrgMaster |
| `ParseAndValidateExcel(string filePath, string sheetName)` | `EMS.m_Division` R, `EMS.m_Department` R |  |  |  |
| `ExecuteImport(OrgMasterPreview preview, int userId)` | `EMS.m_Division` CRU, `EMS.m_Department` CRU, `EMS.m_Role` CRU, `EMS.m_Position` CRU, `EMS.m_PositionMapping` CRU |  |  | IMPORT_ORG_MASTER, OrgMaster |

## OrgStructureService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/OrgStructureService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `CreateOrgUnit(CreateOrgUnitRequest request, UserContext user)` | `EMS.OrgUnit` CR, `EMS.m_SubCommittee` CR, `audit.AuditLog` C | `EMS.sp_GetOrgUnitByID`, `EMS.sp_GetOrgUnitHierarchy`, `EMS.sp_InsertOrgUnit` … | AppRole != 4 | OrgStructure/CREATE |
| `UpdateOrgUnit(UpdateOrgUnitRequest request, UserContext user)` | `EMS.OrgUnit` RU, `audit.AuditLog` C | `EMS.sp_GetOrgUnitByID`, `EMS.sp_UpdateOrgUnit`, `audit.sp_InsertAuditLog` | AppRole != 4 | OrgStructure/UPDATE |
| `MoveOrgUnit(UpdateOrgUnitRequest request, UserContext user)` | `EMS.OrgUnit` RU, `audit.AuditLog` C | `EMS.sp_GetOrgUnitByID`, `EMS.sp_UpdateOrgUnit`, `audit.sp_InsertAuditLog` | AppRole != 4 | OrgStructure/MOVE |
| `DeactivateOrgUnit(int orgUnitId, UserContext user)` | `EMS.OrgUnit` Rd, `storage.Folder` R, `EMS.UserAccount` R, `audit.AuditLog` C | `EMS.sp_GetOrgUnitByID`, `EMS.sp_HasActiveDependents`, `EMS.sp_SoftDeleteOrgUnit` … | AppRole != 4 | OrgStructure/DELETE |
| `DeleteOrgUnit(int orgUnitId, UserContext user)` | `EMS.OrgUnit` Rd, `storage.Folder` R, `EMS.UserAccount` R, `audit.AuditLog` C | `EMS.sp_GetOrgUnitByID`, `EMS.sp_HasActiveDependents`, `EMS.sp_SoftDeleteOrgUnit` … | AppRole != 4 | OrgStructure/DELETE |
| `ForceDeleteOrgUnit(int orgUnitId, UserContext user)` | `EMS.OrgUnit` Rd, `storage.Folder` d, `audit.AuditLog` C | `EMS.sp_GetOrgUnitByID`, `EMS.sp_SoftDeleteOrgUnit`, `audit.sp_InsertAuditLog` | AppRole != 4 | OrgStructure/FORCE_DELETE |
| `HasActiveDependents(int orgUnitId)` | `storage.Folder` R, `EMS.UserAccount` R | `EMS.sp_HasActiveDependents` |  |  |
| `GetHierarchy()` | `EMS.OrgUnit` R | `EMS.sp_GetOrgUnitHierarchy` |  |  |
| `GetVisibleHierarchy(UserContext user)` | `EMS.OrgUnit` R, `security.UserOrgVisibility` R | `EMS.sp_GetOrgUnitHierarchy` |  |  |
| `GetByConfidentialityLevel(ConfidentialityLevel level)` | `EMS.OrgUnit` R, `storage.Folder` R | `EMS.sp_GetOrgUnitByConfidentialityLevel` |  |  |
| `GetAllActiveRelationships()` | `EMS.OrgUnitRelationship` R |  |  |  |

## PermissionService

ใช้โดย module: **DMS, KMS, RGP** · ไฟล์: `CMS.Services/PermissionService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetEffectivePermission(int userId, int folderId)` | `security.FolderPermission` R, `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder`, `storage.sp_GetFolderByID` |  |  |
| `SetFolderPermission(SetPermissionRequest request, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `security.FolderPermission` CRU, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `security.sp_GetPermissionsByFolder`, `security.sp_InsertFolderPermission` … | AppRole < 3 | Permission |
| `PropagatePermissionsToFiles(int folderId, UserContext user)` | `security.FolderPermission` R, `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R, `security.FilePermission` CRU, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `security.sp_GetFilePermissionsByFile`, `security.sp_GetPermissionsByFolder` … | AppRole < 3 | PROPAGATE_TO_FILES, Permission |
| `CheckPermission(int userId, int folderId, string permissionType)` | `storage.FileDocument` R, `storage.Folder` R, `security.FolderPermission` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder`, `storage.sp_GetFolderByID` |  |  |
| `CheckPermission(int userId, int folderId, CMS.Domain.Enums.PermissionType permissionType)` | `storage.FileDocument` R, `storage.Folder` R, `security.FolderPermission` R, `EMS.UserAccount` R | `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder`, `storage.sp_GetFolderByID` |  |  |

## ProjectAttachmentService

ใช้โดย module: **RGP** · ไฟล์: `CMS.Services/ProjectAttachmentService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetAttachments(int projectId)` | `storage.t_project_attachment` R, `storage.FileDocument` R, `storage.Folder` R |  |  |  |
| `LinkAttachments(int projectId, IEnumerable<int> fileIds, string user)` | `storage.t_project_attachment` CR |  |  |  |
| `RemoveAttachment(int projectId, int fileId, string user)` | `storage.t_project_attachment` D |  |  |  |

## ProjectAuditService

ใช้โดย module: **RGP** · ไฟล์: `CMS.Services/ProjectAuditService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `Log(ProjectAuditEntry entry)` | `RGP.t_project_audit_log` C |  |  |  |

## ProjectDocumentService

ใช้โดย module: **RGP** · ไฟล์: `CMS.Services/ProjectDocumentService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetDocWorkflow(int i_proj_state_id)` | `RGP.t_project_doc_workflow` R, `RGP.t_project_state` R |  |  |  |
| `GetDocWorkflowByProject(int i_project_id)` | `RGP.t_project_doc_workflow` R, `RGP.t_project_state` R |  |  |  |
| `AddDocWorkflow(ProjectDocumentWorkflowModel model)` | `RGP.t_project_doc_workflow` CR |  |  |  |
| `UpdateDocWorkflow(ProjectDocumentWorkflowModel model)` | `RGP.t_project_doc_workflow` U |  |  |  |
| `DeleteDocWorkflow(int i_doc_wf_id, out string errorMessage)` | `RGP.t_project_doc_workflow` D |  |  |  |
| `UpdateDocStatus(int i_doc_wf_id, string c_doc_status, string i_user)` | `RGP.t_project_doc_workflow` U |  |  |  |

## ProjectProgressService

ใช้โดย module: **RGP** · ไฟล์: `CMS.Services/ProjectProgressService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `UpdateStateProgress(ProjectProgressModel model, out string errorMessage)` | `RGP.t_project_progress` C, `RGP.t_project_state` RU, `RGP.t_project` U |  |  |  |
| `GetLatestProgressByProject(int i_project_id)` | `RGP.t_project_state` R, `RGP.t_project_progress` R, `RGP.t_project` R |  |  |  |
| `GetOverallCompletionPct(int i_project_id)` | `RGP.t_project_state` R, `RGP.t_project_progress` R |  |  |  |

## ProjectService

ใช้โดย module: **RGP** · ไฟล์: `CMS.Services/ProjectService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GenerateProjectNo()` | `RunningNumber` RU |  |  |  |
| `IsProjectNoExists(string c_project_no)` | `RGP.t_project` R |  |  |  |
| `CreateProject(ProjectModel model)` | `RGP.t_project` C, `RGP.t_project_audit_log` C, `RunningNumber` RU |  |  | CREATE_PROJECT_FAILED, Project |
| `UpdateProject(ProjectModel model)` | `RGP.t_project` U, `RGP.t_project_audit_log` C |  |  | Project |
| `UpdateLegalDictJson(int i_project_id, string json, string i_user) => _projectRepo.UpdateLegalDictJson(i_projec…)` | `RGP.t_project` U |  |  |  |
| `DeleteProject(int i_project_id, string i_user, out string errorMessage)` | `RGP.t_project_state` R, `RGP.t_project` U, `RGP.t_project_audit_log` C |  |  | Project |
| `SearchProjects(string c_project_no, string n_project_name, string c_status, string i_template_id, string …)` | `RGP.t_project` R, `RGP.m_project_template` R, `RGP.t_project_state` R, `RGP.t_project_progress` R |  |  |  |
| `GetTemplates()` | `RGP.m_project_template` R |  |  |  |
| `GetProjectById(int i_project_id)` | `RGP.t_project` R, `RGP.m_project_template` R |  |  |  |

## ProjectStateService

ใช้โดย module: **RGP** · ไฟล์: `CMS.Services/ProjectStateService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetStatesWithProgress(int i_project_id)` | `RGP.t_project_state` R, `RGP.t_project_progress` R, `RGP.t_project` R |  |  |  |
| `GetTemplateStates(int i_template_id)` | `RGP.m_template_state` R |  |  |  |
| `AddState(ProjectStateModel model)` | `RGP.t_project_state` CR, `RGP.t_project_audit_log` C |  |  | Project |
| `UpdateState(ProjectStateModel model)` | `RGP.t_project_state` U |  |  |  |
| `DeleteState(int i_proj_state_id, out string errorMessage)` | `RGP.t_project_progress` R, `RGP.t_project_state` D, `RGP.t_project_audit_log` C |  |  | Project |
| `GetStatesForCombo(int i_project_id)` | `RGP.t_project_state` R |  |  |  |
| `GetTotalEstimatedDays(int i_project_id, int excludeStateId = 0)` | `RGP.t_project_state` R |  |  |  |
| `GetActiveProjectsForRef(int i_exclude_project_id)` | `RGP.t_project` R, `RGP.t_project_state` R, `RGP.t_project_progress` R |  |  |  |
| `ReorderStates(List<Tuple<int, int>> orderList)` | `RGP.t_project_state` U |  |  |  |

## ProjectTaskService

ใช้โดย module: **RGP** · ไฟล์: `CMS.Services/ProjectTaskService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetByState(int i_proj_state_id) => _taskRepo.GetByState(i_proj_state_id)` | `RGP.t_project_task` R, `RGP.t_project_state` R |  |  |  |
| `GetByProject(int i_project_id) => _taskRepo.GetByProject(i_project_id)` | `RGP.t_project_task` R, `RGP.t_project_state` R |  |  |  |
| `GetAllTasksForProject(int projectId) => _taskRepo.GetAllTasksForProject(projectId)` | `RGP.t_project_task` R, `RGP.t_project_state` R |  |  |  |
| `CreateTask(ProjectTaskModel model)` | `RunningNumber` CRU, `RGP.t_project_task` C, `RGP.t_project_audit_log` C |  |  | Project |
| `UpdateTask(ProjectTaskModel model) => _taskRepo.UpdateTask(model)` | `RGP.t_project_task` U |  |  |  |
| `UpdateStatus(int i_task_id, int i_proj_state_id, int i_project_id, string c_status, int i_pct_complete,…)` | `RGP.t_project_task` RU, `RGP.t_project_task_status_log` C, `RGP.t_project_audit_log` C, `RGP.t_project_progress` C, `RGP.t_project_state` RU, `RGP.t_project` U |  |  | Project, UPDATE_PROJECT_TASK_STATUS |
| `SyncStatePct(int i_proj_state_id, int i_project_id, string i_user)` | `RGP.t_project_task` R, `RGP.t_project_progress` C, `RGP.t_project_state` RU, `RGP.t_project` U |  |  |  |
| `SoftDelete(int i_task_id, string i_user) => _taskRepo.SoftDelete(i_task_id, i_user)` | `RGP.t_project_task` U |  |  |  |
| `GetComments(int i_task_id) => _taskRepo.GetComments(i_task_id)` | `RGP.t_project_task_comment` R |  |  |  |
| `AddComment(ProjectTaskCommentModel model) => _taskRepo.InsertComment(model)` | `RGP.t_project_task_comment` C |  |  |  |
| `DeleteComment(int i_comment_id) => _taskRepo.SoftDeleteComment(i_comment_id)` | `RGP.t_project_task_comment` U |  |  |  |

## QuickAccessService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/QuickAccessService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetByUser(int userId)` | `storage.QuickAccessFolder` R, `storage.FileDocument` R, `storage.Folder` R | `storage.sp_GetFolderByID`, `storage.sp_GetQuickAccessByUser` |  |  |
| `Add(int userId, int folderId)` | `storage.QuickAccessFolder` CR | `storage.sp_AddQuickAccess` |  |  |
| `Remove(int userId, int folderId)` | `storage.QuickAccessFolder` D | `storage.sp_RemoveQuickAccess` |  |  |

## SLACalculator

ใช้โดย module: **WFE** · ไฟล์: `CMS.Services/SLACalculator.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetSLAComplianceMetrics(SLAMetricsFilter filter)` | `WFE.t_WFStepInstance` R, `WFE.t_WFInstance` R, `WFE.s_WFDefinition` R | `dbo.sp_WF_GetSLAComplianceMetrics`, `dbo.sp_WF_GetTaskDistribution` |  |  |

## ShareService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/ShareService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `RequestFolderShareApproval(SetPermissionRequest request, UserContext user)` | `storage.FileDocument` R, `storage.Folder` R, `workflow.ApprovalRequest` C, `EMS.UserAccount` R, `workflow.ApprovalStep` C, `EMS.Notification` C, `audit.AuditLog` C | `EMS.sp_GetUserAccountsByRole`, `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` … |  | FileSharing, RequestFolderShare |
| `CreateInternalShare(CreateInternalShareRequest request, UserContext user)` | `storage.FileDocument` R, `EMS.UserAccount` R, `security.FilePermission` CR, `storage.Folder` R, `EMS.Notification` C, `audit.AuditLog` C, `workflow.ApprovalRequest` C, `workflow.ApprovalStep` C, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `EMS.sp_GetUserAccountsByRole`, `EMS.sp_InsertNotification` … | AppRole < 3 | CreateInternalShare, FileSharing |
| `RevokeInternalShare(int filePermissionId, UserContext user)` | `security.FilePermission` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `security.sp_RevokeFilePermission` | AppRole < 4 | FileSharing, RevokeInternalShare |
| `CreateExternalShare(CreateExternalShareRequest request, UserContext user)` | `storage.FileDocument` R, `EMS.UserAccount` R, `storage.Folder` R, `storage.ExternalShare` C, `storage.ShareToken` C, `workflow.ApprovalRequest` C, `workflow.ApprovalStep` C, `EMS.Notification` C, `audit.AuditLog` C, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `EMS.sp_GetUserAccountsByRole`, `EMS.sp_InsertNotification` … |  | CreateExternalShare, FileSharing |
| `ApproveExternalShare(int externalShareId, UserContext user)` | `storage.ExternalShare` RU, `storage.ShareToken` RU, `EMS.Notification` C, `audit.AuditLog` C | `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` |  | ApproveExternalShare, FileSharing |
| `RejectExternalShare(int externalShareId, string rejectionReason, UserContext user)` | `storage.ExternalShare` RU, `storage.ShareToken` RU, `EMS.Notification` C, `audit.AuditLog` C | `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` |  | FileSharing, RejectExternalShare |
| `RevokeExternalShare(int externalShareId, string revocationReason, UserContext user)` | `storage.ExternalShare` RU, `storage.ShareToken` RU, `EMS.Notification` C, `audit.AuditLog` C | `EMS.sp_InsertNotification`, `audit.sp_InsertAuditLog` | AppRole < 4 | FileSharing, RevokeExternalShare |
| `ToggleExternalShare(int externalShareId, UserContext user)` | `storage.ExternalShare` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` | AppRole < 4 | FileSharing |
| `GetInternalSharesForUser(int userId, UserContext user)` | `security.FilePermission` R |  | AppRole < 4 |  |
| `GetExternalSharesForUser(int userId, UserContext user)` | `storage.ExternalShare` R |  | AppRole < 4 |  |
| `GetAllInternalShares(UserContext admin)` | `security.FilePermission` R |  | AppRole < 4 |  |
| `GetAllExternalShares(UserContext admin)` | `storage.ExternalShare` R |  | AppRole < 4 |  |
| `GetAccessLog(int externalShareId, UserContext user)` | `storage.ExternalShare` R, `storage.ShareAccessLog` R |  | AppRole < 4 |  |

## SharedFileCache

ใช้โดย module: **KMS** · ไฟล์: `CMS.Services/KBImportProcessor.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `For(KBImportRow row)` | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R, `security.FolderPermission` R | `EMS.sp_GetUserAccountByID`, `security.sp_GetPermissionsByFolder`, `storage.sp_GetFileDocumentsByFolder` … |  |  |

## StepResolverService

ใช้โดย module: **WFE** · ไฟล์: `CMS.Services/StepResolverService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `ResolveNextSteps(WorkflowStep currentStep, string outputData, WorkflowDefinition template)` | `WFE.s_WFStep` R, `WFE.s_WFConnection` R |  |  |  |

## UserOrgVisibilityService

ใช้โดย module: **DMS** · ไฟล์: `CMS.Services/UserOrgVisibilityService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `GetVisibleOrgUnits(int userId, UserContext caller)` | `security.UserOrgVisibility` R, `EMS.OrgUnit` R | `EMS.sp_GetOrgUnitHierarchy` |  |  |
| `GrantVisibility(int userId, int orgUnitId, UserContext caller)` | `security.UserOrgVisibility` CRU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` | AppRole < 4 |  |
| `RevokeVisibility(int userId, int orgUnitId, UserContext caller)` | `security.UserOrgVisibility` D, `audit.AuditLog` C | `audit.sp_InsertAuditLog` | AppRole < 4 |  |
| `GetExplicitGrantsForUser(int userId, UserContext caller)` | `security.UserOrgVisibility` R |  |  |  |

## WorkflowDelegationService

ใช้โดย module: **WFE** · ไฟล์: `CMS.Services/WorkflowDelegationService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `DelegateTask(DelegateTaskRequest request, UserContext userContext)` | `WFE.t_WFStepInstance` RU, `dbo.WFDelegation` CRd, `audit.AuditLog` C | `audit.sp_InsertAuditLog`, `dbo.sp_WF_CreateDelegation`, `dbo.sp_WF_GetDelegationHistory` |  | TaskDelegated |
| `GetDelegationHistory(int stepInstanceId)` | `dbo.WFDelegation` R | `dbo.sp_WF_GetDelegationHistory` |  |  |
| `ValidateDelegation(WorkflowStepInstance stepInstance, string delegateToUserName, UserContext userContext)` | `dbo.WFDelegation` R | `dbo.sp_WF_GetDelegationHistory` |  |  |
| `DeactivateDelegation(int delegationId, UserContext userContext)` | `dbo.WFDelegation` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | DelegationDeactivated |

## WorkflowService

ใช้โดย module: **WFE** · ไฟล์: `CMS.Services/WorkflowService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `CreateWorkflowInstance(CreateWorkflowInstanceRequest request, UserContext userContext)` | `WFE.s_WFDefinition` R, `WFE.t_WFInstance` CRU, `WFE.s_WFStep` CR, `WFE.t_WFStepInstance` CR, `audit.AuditLog` C, `WFE.s_WFConnection` C | `WFE.sp_CreateWFInstance`, `WFE.sp_CreateWFStepInstance`, `audit.sp_InsertAuditLog` |  | WorkflowInstanceCreated |
| `GetWorkflowInstance(int workflowInstanceId, UserContext userContext)` | `WFE.t_WFInstance` R, `WFE.s_WFDefinition` R, `WFE.s_WFStep` R, `WFE.t_WFStepInstance` R |  |  |  |
| `GetWorkflowInstances(CMS.Services.DTOs.WorkflowInstanceFilter filter, UserContext userContext)` | `WFE.t_WFInstance` R, `WFE.s_WFDefinition` R, `WFE.s_WFStep` R |  |  |  |
| `CompleteWorkflowStep(CompleteWorkflowStepRequest request, UserContext userContext)` | `WFE.t_WFStepInstance` CRU, `WFE.t_WFInstance` RU, `WFE.s_WFStep` R, `WFE.s_WFDefinition` R, `audit.AuditLog` C, `WFE.s_WFConnection` R | `WFE.sp_CreateWFStepInstance`, `audit.sp_InsertAuditLog` |  | WorkflowStepCompleted |
| `RejectWorkflowStep(RejectWorkflowStepRequest request, UserContext userContext)` | `WFE.t_WFStepInstance` RU, `WFE.t_WFInstance` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowStepRejected |
| `SuspendWorkflowInstance(int workflowInstanceId, UserContext userContext)` | `WFE.t_WFInstance` RU, `WFE.s_WFDefinition` R, `WFE.s_WFStep` R, `WFE.t_WFStepInstance` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowInstanceSuspended |
| `ResumeWorkflowInstance(int workflowInstanceId, UserContext userContext)` | `WFE.t_WFInstance` RU, `WFE.s_WFDefinition` R, `WFE.s_WFStep` R, `WFE.t_WFStepInstance` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowInstanceResumed |
| `GetMyTasks(UserContext userContext)` | `WFE.t_WFStepInstance` R, `WFE.t_WFInstance` R, `WFE.s_WFStep` R, `WFE.s_WFDefinition` R |  |  |  |
| `CancelWorkflowInstance(int workflowInstanceId, string reason, UserContext userContext)` | `WFE.t_WFInstance` RU, `WFE.t_WFStepInstance` RU, `WFE.s_WFStep` R, `WFE.s_WFDefinition` R, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowInstanceCancelled |

## WorkflowTemplateService

ใช้โดย module: **WFE** · ไฟล์: `CMS.Services/WorkflowTemplateService.cs`

| Method | ตาราง (CRUD) | SP | Guard | Audit |
|---|---|---|---|---|
| `CreateTemplate(CreateTemplateRequest request, UserContext userContext)` | `WFE.s_WFDefinition` C, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowTemplateCreated |
| `UpdateTemplate(UpdateTemplateRequest request, UserContext userContext)` | `WFE.s_WFDefinition` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowTemplateUpdated |
| `GetTemplate(int templateId, UserContext userContext)` | `WFE.s_WFDefinition` R |  |  |  |
| `GetTemplates(CMS.Services.DTOs.WorkflowTemplateFilter filter, UserContext userContext)` | `WFE.s_WFStep` R, `WFE.t_WFInstance` R, `WFE.s_WFDefinition` R |  |  |  |
| `DeleteTemplate(int templateId, UserContext userContext)` | `WFE.s_WFDefinition` Rd, `audit.AuditLog` C, `WFE.t_WFInstance` R | `audit.sp_InsertAuditLog` |  | WorkflowTemplateDeleted |
| `GetTemplateVersions(int templateId, UserContext userContext)` | `WFE.s_WFDefinition` R |  |  |  |
| `HasActiveInstances(int templateId)` | `WFE.t_WFInstance` R |  |  |  |
| `SubmitForApproval(int templateId, UserContext userContext)` | `WFE.s_WFDefinition` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowTemplateSubmittedForApproval |
| `ApproveTemplate(int templateId, UserContext userContext)` | `WFE.s_WFDefinition` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowTemplateApproved |
| `RejectTemplate(int templateId, string reason, UserContext userContext)` | `WFE.s_WFDefinition` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowTemplateRejected |
| `PublishTemplate(int templateId, UserContext userContext)` | `WFE.s_WFDefinition` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowTemplatePublished |
| `DeactivateTemplate(int templateId, UserContext userContext)` | `WFE.s_WFDefinition` RU, `audit.AuditLog` C | `audit.sp_InsertAuditLog` |  | WorkflowTemplateDeactivated |

