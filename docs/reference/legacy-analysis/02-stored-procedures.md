# Stored Procedure Catalog

> ที่มา: `db-export/CMS_DB_2.1_SP_definitions.csv`, `CMS_DB_2.2_SP_dependencies.csv`, `db-export/sp-by-schema/*.md` (80 ตัวที่ระบบใช้ มี definition ครบพร้อมบรรทัด) เทียบกับ call graph ของโค้ด

| สถานะ | จำนวน | ความหมาย |
|---|--:|---|
| ใช้งานจริง | 80 | ถูกเรียกจาก repository/ConfigManager ที่เข้าถึงได้จากหน้าจอ — **ต้องพอร์ตหรือเรียกจาก API** |
| มีใน DB แต่โค้ดไม่เรียก | 26 | มีใน DB ไม่มีโค้ด C# อ้าง (อาจใช้โดยระบบอื่น/งาน sync) — ยืนยันกับเจ้าของ DB ก่อนตัด |
| dead (มี method แต่ไม่ถูกเรียก) | 11 | โค้ดอ้างถึงแต่ไม่มีหน้าจอเรียก — ไม่ต้องทำ |
| ไม่ถูก compile | 8 | อยู่ในไฟล์ที่ไม่อยู่ใน .csproj |

**ในโค้ดแต่ไม่พบใน DB:** `dbo.sp_WF_GetPendingSteps` (ทั้งหมดเป็น dead)

**อ่านตาราง:** `Params` = พารามิเตอร์ (`OUT` = OUTPUT) · `ตาราง` = จาก definition: R=อ่าน, C=INSERT, U=UPDATE, D=DELETE, d=soft delete · `พฤติกรรมที่ต้องรักษา` = ธง/ข้อสังเกตจาก body

## EMS — ใช้งานจริง (24)

| SP | Params | ตาราง | เรียกจาก | พฤติกรรมที่ต้องรักษา |
|---|---|---|---|---|
| `EMS.sp_CreateMenuItem` | @ParentMenuItemID INT=NULL, @MenuName NVARCHAR(255), @MenuKey NVARCHAR(100), @FormClassName NVARCHAR(500)=NULL, @IconKey NVARCHAR(100)=NULL, @DisplayOrder INT=0, @IsActive BIT=1, @RequiredAppRole INT=NULL, @Description NVARCHAR(500)=NULL, @ModuleCode NVARCHAR(50)=NULL, @Url NVARCHAR(500)=NULL, @CreatedByUserID INT | `EMS.MenuItem` CR | MenuItem.CreateMenuItem | THROW, @@IDENTITY |
| `EMS.sp_DeactivateUserAccount` | @UserID INT | `EMS.UserAccount` d | UserAccount.Deactivate |  |
| `EMS.sp_DeleteFolderAuthorityConfig` | @ConfigLabel NVARCHAR(200), @DeletedBy INT | `EMS.FolderAuthorityConfig` d | FolderAuthority.Delete |  |
| `EMS.sp_DeleteMenuItem` | @MenuItemID INT | `EMS.MenuItem` DR | MenuItem.DeleteMenuItem | THROW |
| `EMS.sp_GetAllFolderAuthorityConfigs` |  | `EMS.FolderAuthorityConfig` R | FolderAuthority.GetAll | SELECT * |
| `EMS.sp_GetAllUserAccounts` |  | `EMS.UserAccount` R | UserAccount.GetAll |  |
| `EMS.sp_GetOrgUnitByConfidentialityLevel` | @ConfidentialityLevel TINYINT | `EMS.OrgUnit` R, `storage.Folder` R | OrgUnit.GetByConfidentialityLevel |  |
| `EMS.sp_GetOrgUnitByID` | @OrgUnitID INT | `EMS.OrgUnit` R | OrgUnit.GetById |  |
| `EMS.sp_GetOrgUnitHierarchy` |  | `EMS.OrgUnit` R | OrgUnit.GetHierarchy |  |
| `EMS.sp_GetUserAccountByADUserName` | @ADUserName NVARCHAR(100) | `EMS.UserAccount` R | UserAccount.GetByADUserName |  |
| `EMS.sp_GetUserAccountByID` | @UserID INT | `EMS.UserAccount` R | UserAccount.GetById |  |
| `EMS.sp_GetUserAccountsByRole` | @AppRole TINYINT | `EMS.UserAccount` R | UserAccount.GetByRole |  |
| `EMS.sp_HasActiveDependents` | @OrgUnitID INT | `storage.Folder` R, `EMS.UserAccount` R | OrgUnit.HasActiveDependents |  |
| `EMS.sp_InsertFolderAuthorityConfig` | @ConfigLabel NVARCHAR(200), @PositionName NVARCHAR(200)=NULL, @DepartmentCode NVARCHAR(50)=NULL, @DivisionCode NVARCHAR(50)=NULL, @LevelCode NVARCHAR(10)=NULL, @ConfidentialityLevel TINYINT=0, @CanView BIT=0, @CanAdd BIT=0, @CanEdit BIT=0, @CanApprove BIT=0, @CreatedBy INT=NULL | `EMS.FolderAuthorityConfig` C | FolderAuthority.Insert | SCOPE_IDENTITY |
| `EMS.sp_InsertNotification` | @RecipientUserId INT, @EventType NVARCHAR(100), @RelatedEntityId NVARCHAR(100)=NULL, @MessageText NVARCHAR(MAX) | `EMS.Notification` C | Notification.Insert | SCOPE_IDENTITY |
| `EMS.sp_InsertOrgUnit` | @OrgUnitCode NVARCHAR(20), @OrgUnitNameTH NVARCHAR(200), @OrgUnitNameEN NVARCHAR(200), @OrgUnitType TINYINT, @ParentOrgUnitID INT, @SortOrder INT, @CreatedBy INT | `EMS.OrgUnit` CR | OrgUnit.Insert | RAISERROR, SCOPE_IDENTITY |
| `EMS.sp_InsertUserAccount` | @ADUserName NVARCHAR(100), @DisplayName NVARCHAR(200), @Email NVARCHAR(254), @AppRole TINYINT, @OrgUnitID INT, @CreatedBy INT | `EMS.UserAccount` C | UserAccount.Create | SCOPE_IDENTITY |
| `EMS.sp_ResolveFolderAuthority` | @LevelCode NVARCHAR(20)=NULL, @PositionName NVARCHAR(200)=NULL, @DepartmentCode NVARCHAR(50)=NULL, @DivisionCode NVARCHAR(50)=NULL | `EMS.FolderAuthorityConfig` R | FolderAuthority.Resolve |  |
| `EMS.sp_SoftDeleteOrgUnit` | @OrgUnitID INT, @DeletedBy INT | `EMS.OrgUnit` d | OrgUnit.Deactivate, OrgUnit.ForceDeleteWithDependents, OrgUnit.SoftDelete |  |
| `EMS.sp_UpdateFolderAuthorityConfig` | @ConfigID INT, @ConfigLabel NVARCHAR(200), @PositionName NVARCHAR(200)=NULL, @DepartmentCode NVARCHAR(50)=NULL, @DivisionCode NVARCHAR(50)=NULL, @LevelCode NVARCHAR(10)=NULL, @ConfidentialityLevel TINYINT=0, @CanView BIT=0, @CanAdd BIT=0, @CanEdit BIT=0, @CanApprove BIT=0, @UpdatedBy INT=NULL | `EMS.FolderAuthorityConfig` U | FolderAuthority.Update |  |
| `EMS.sp_UpdateLastLogin` | @UserID INT | `EMS.UserAccount` U | UserAccount.UpdateLastLogin |  |
| `EMS.sp_UpdateMenuItem` | @MenuItemID INT, @ParentMenuItemID INT=NULL, @MenuName NVARCHAR(255), @MenuKey NVARCHAR(100), @FormClassName NVARCHAR(500)=NULL, @IconKey NVARCHAR(100)=NULL, @DisplayOrder INT=0, @IsActive BIT=1, @RequiredAppRole INT=NULL, @Description NVARCHAR(500)=NULL, @ModuleCode NVARCHAR(50)=NULL, @Url NVARCHAR(500)=NULL, @ModifiedByUserID INT | `EMS.MenuItem` RU | MenuItem.UpdateMenuItem | THROW |
| `EMS.sp_UpdateOrgUnit` | @OrgUnitID INT, @OrgUnitNameTH NVARCHAR(200), @OrgUnitNameEN NVARCHAR(200), @SortOrder INT | `EMS.OrgUnit` U | OrgUnit.Update |  |
| `EMS.sp_UpdateUserConsent` | @UserID INT, @Email NVARCHAR(254), @ConsentGiven BIT | `EMS.UserAccount` U | UserAccount.UpdateConsent |  |

## audit — ใช้งานจริง (2)

| SP | Params | ตาราง | เรียกจาก | พฤติกรรมที่ต้องรักษา |
|---|---|---|---|---|
| `audit.sp_InsertAuditLog` | @UserID INT, @UserName NVARCHAR(100), @UserRole TINYINT, @Module VARCHAR(50), @Action VARCHAR(50), @TableName VARCHAR(100), @RecordID INT, @OldValue NVARCHAR(MAX), @NewValue NVARCHAR(MAX), @IPAddress VARCHAR(45), @MachineName NVARCHAR(100), @SessionID NVARCHAR(100), @Result TINYINT, @ErrorMessage NVARCHAR(500), @AuditDate DATETIME=NULL | `audit.AuditLog` C | Audit.Insert | SCOPE_IDENTITY |
| `audit.sp_QueryAuditLog` | @FromDate DATETIME, @ToDate DATETIME, @UserID INT, @UserName NVARCHAR(200), @Module NVARCHAR(100), @Action NVARCHAR(100), @Result TINYINT, @PageNumber INT, @PageSize INT | `audit.AuditLog` R | Audit.Query | paging OFFSET/FETCH |

## dbo — ใช้งานจริง (7)

| SP | Params | ตาราง | เรียกจาก | พฤติกรรมที่ต้องรักษา |
|---|---|---|---|---|
| `dbo.sp_GetSystemConfig` | @Key NVARCHAR(200) | `dbo.SystemConfig` R | ConfigManager.ReadFromDatabase |  |
| `dbo.sp_InsertSubCommittee` | @OrgUnitID INT, @SubCommitteeCode NVARCHAR(20), @SubCommitteeNameTH NVARCHAR(200), @SubCommitteeNameEN NVARCHAR(200)=NULL, @CreatedBy NVARCHAR(100) | `EMS.m_SubCommittee` CR | OrgUnit.InsertSubCommitteeRecord | RAISERROR, SCOPE_IDENTITY |
| `dbo.sp_UpsertSystemConfig` | @Key NVARCHAR(200), @Value NVARCHAR(2000), @UpdatedByUserId INT | `dbo.SystemConfig` CRU | ConfigManager.Set |  |
| `dbo.sp_WF_CreateDelegation` | @WorkflowStepInstanceId INT, @DelegatedFrom NVARCHAR(100), @DelegatedTo NVARCHAR(100), @DelegationReason NVARCHAR(500)=NULL, @MaxDelegationDepth INT=3, @StartDate DATETIME=NULL, @EndDate DATETIME=NULL, @Remarks NVARCHAR(500)=NULL, @NewWFDelegationId INT OUT | `dbo.WFDelegation` CRd | Delegation.CreateDelegation | RAISERROR, SCOPE_IDENTITY |
| `dbo.sp_WF_GetDelegationHistory` | @WorkflowStepInstanceId INT | `dbo.WFDelegation` R | Delegation.GetDelegationsByStepInstance |  |
| `dbo.sp_WF_GetSLAComplianceMetrics` | @WorkflowDefinitionId INT=NULL, @FromDate DATETIME=NULL, @ToDate DATETIME=NULL | `WFE.t_WFStepInstance` R, `WFE.t_WFInstance` R | WFReport.GetSLAComplianceMetrics |  |
| `dbo.sp_WF_GetTaskDistribution` | @WorkflowDefinitionId INT=NULL, @FromDate DATETIME=NULL, @ToDate DATETIME=NULL | `WFE.t_WFStepInstance` R, `WFE.t_WFInstance` R | WFReport.GetTaskDistribution |  |

## security — ใช้งานจริง (8)

| SP | Params | ตาราง | เรียกจาก | พฤติกรรมที่ต้องรักษา |
|---|---|---|---|---|
| `security.sp_GetAllPermissionsByFolder` | @FolderID INT | `security.FolderPermission` R | Permission.GetAllByFolder |  |
| `security.sp_GetFilePermissionsByFile` | @FileID INT | `security.FilePermission` R | FilePermission.GetByFile |  |
| `security.sp_GetPermissionsByFolder` | @FolderID INT | `security.FolderPermission` R | Permission.GetAclEntries, Permission.GetByFolder |  |
| `security.sp_GetPermissionsByPrincipal` | @PrincipalType TINYINT, @PrincipalID INT | `security.FolderPermission` R | Permission.GetByPrincipal |  |
| `security.sp_InsertFilePermission` | @FileID INT, @PrincipalType TINYINT, @PrincipalID INT, @CanRead BIT=1, @CanWrite BIT=0, @CanDelete BIT=0, @CanModify BIT=0, @CanFullControl BIT=0, @IsDeny BIT=0, @ExpiryDate DATETIME, @GrantedBy INT, @CanDownload BIT=0 | `security.FilePermission` C | FilePermission.Insert | SCOPE_IDENTITY |
| `security.sp_InsertFolderPermission` | @FolderID INT, @PrincipalType TINYINT, @PrincipalID INT, @CanRead BIT, @CanWrite BIT, @CanDelete BIT, @CanModify BIT, @CanFullControl BIT, @IsDeny BIT, @ExpiryDate DATETIME, @GrantedBy INT | `security.FolderPermission` C | Permission.Insert | SCOPE_IDENTITY |
| `security.sp_RevokeFilePermission` | @FilePermissionID INT, @RevokedBy INT, @RevokeReason NVARCHAR(500)=NULL | `security.FilePermission` U | FilePermission.Revoke |  |
| `security.sp_RevokePermission` | @PermissionID INT, @RevokedBy INT, @RevokeReason NVARCHAR(500) | `security.FolderPermission` U | Permission.Revoke |  |

## storage — ใช้งานจริง (32)

| SP | Params | ตาราง | เรียกจาก | พฤติกรรมที่ต้องรักษา |
|---|---|---|---|---|
| `storage.sp_AddQuickAccess` | @UserID INT, @FolderID INT | `storage.QuickAccessFolder` CR | QuickAccess.Add |  |
| `storage.sp_DeleteFolderTemplate` | @TemplateID INT | `storage.FolderTemplateItem` D, `storage.FolderTemplate` D | FolderTemplate.Delete |  |
| `storage.sp_DeleteFolderTemplateItem` | @ItemID INT | `storage.FolderTemplateItem` DR | FolderTemplate.DeleteItem |  |
| `storage.sp_GetAllFileDocumentsGroupedByFolder` |  | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | FileDocument.GetAllGroupedByFolder |  |
| `storage.sp_GetAllFolderTemplates` |  | `storage.FolderTemplate` R, `EMS.OrgUnit` R | FolderTemplate.GetAll |  |
| `storage.sp_GetAllFolders` |  | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | Folder.GetAll |  |
| `storage.sp_GetDeletedFoldersByOrgUnit` | @OrgUnitID INT | `storage.Folder` R | Folder.GetDeletedByOrgUnit |  |
| `storage.sp_GetFileDocumentByID` | @FileID INT | `storage.FileDocument` R, `EMS.UserAccount` R | FileDocument.GetById |  |
| `storage.sp_GetFileDocumentsByFolder` | @FolderID INT | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | FileDocument.GetByFolder |  |
| `storage.sp_GetFileDocumentsByOrgUnit` | @OrgUnitID INT | `EMS.m_SubCommittee` R, `EMS.m_Division` R, `EMS.OrgUnit` R, `EMS.m_Department` R, `storage.FileDocument` R, `storage.Folder` R | FileDocument.GetByOrgUnit |  |
| `storage.sp_GetFolderByID` | @FolderID INT | `storage.FileDocument` R, `storage.Folder` R | Folder.GetById |  |
| `storage.sp_GetFolderChildren` | @ParentFolderID INT | `storage.FileDocument` R, `storage.Folder` R | Folder.GetChildren |  |
| `storage.sp_GetFolderDescendants` | @FolderID INT | `storage.Folder` R, `storage.FileDocument` R, `EMS.UserAccount` R | Folder.GetDescendants | CTE |
| `storage.sp_GetFolderSiblings` | @ParentFolderID INT=NULL, @OrgUnitID INT | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | Folder.GetSiblings |  |
| `storage.sp_GetFolderTemplateItems` | @TemplateID INT | `storage.FolderTemplateItem` R | FolderTemplate.GetItems |  |
| `storage.sp_GetFoldersByOrgUnit` | @OrgUnitID INT | `storage.FileDocument` R, `storage.Folder` R, `EMS.UserAccount` R | Folder.GetByOrgUnit |  |
| `storage.sp_GetQuickAccessByUser` | @UserID INT | `storage.QuickAccessFolder` R | QuickAccess.GetByUser |  |
| `storage.sp_GetRootFoldersByOrgUnit` | @OrgUnitID INT | `storage.FileDocument` R, `storage.Folder` R | Folder.GetRootFoldersByOrgUnit |  |
| `storage.sp_InsertFileDocument` | @FolderID INT, @OriginalFileName NVARCHAR(260), @StoredFileName NVARCHAR(360), @FileExtension VARCHAR(20), @MimeType VARCHAR(100), @FileSizeBytes BIGINT, @PhysicalPath NVARCHAR(500), @Checksum VARCHAR(64), @UploadedBy INT | `storage.FileDocument` C | FileDocument.Insert | SCOPE_IDENTITY |
| `storage.sp_InsertFolder` | @FolderName NVARCHAR(255), @ParentFolderID INT, @OrgUnitID INT, @TemplateID INT, @ConfidentialityLevel TINYINT, @FolderDepth TINYINT, @PhysicalPath NVARCHAR(500), @InheritPermission BIT, @CreatedBy INT | `storage.Folder` C | Folder.Insert | SCOPE_IDENTITY |
| `storage.sp_InsertFolderTemplate` | @TemplateCode NVARCHAR(50), @TemplateName NVARCHAR(200), @TargetType NVARCHAR(50), @Description NVARCHAR(500)=NULL, @OrgUnitID INT=NULL, @CreatedBy INT | `storage.FolderTemplate` C | FolderTemplate.Insert | SCOPE_IDENTITY |
| `storage.sp_InsertFolderTemplateItem` | @TemplateID INT, @ParentItemID INT, @FolderName NVARCHAR(255), @ConfidentialityLevel TINYINT, @SortOrder INT, @InheritPermission BIT | `storage.FolderTemplateItem` C | FolderTemplate.InsertItem | SCOPE_IDENTITY |
| `storage.sp_RemoveQuickAccess` | @UserID INT, @FolderID INT | `storage.QuickAccessFolder` D | QuickAccess.Remove |  |
| `storage.sp_RenameFileDocument` | @FileID INT, @OriginalFileName NVARCHAR(500) | `storage.FileDocument` U | FileDocument.RenameFile |  |
| `storage.sp_RestoreFolder` | @FolderID INT | `storage.Folder` RU | Folder.Restore | CTE |
| `storage.sp_SoftDeleteFileDocument` | @FileID INT, @DeletedBy INT | `storage.FileDocument` U | FileDocument.SoftDelete |  |
| `storage.sp_SoftDeleteFolder` | @FolderID INT, @DeletedBy INT | `storage.Folder` Rd | Folder.SoftDelete | CTE |
| `storage.sp_UpdateFileDocument` | @FileID INT, @FolderID INT, @PhysicalPath NVARCHAR(500), @FileStatus TINYINT, @ArchivedBy INT, @ArchivedDate DATETIME, @DeletedBy INT, @DeletedDate DATETIME | `storage.FileDocument` U | FileDocument.Update |  |
| `storage.sp_UpdateFolder` | @FolderID INT, @FolderName NVARCHAR(255), @ParentFolderID INT=NULL, @FolderDepth INT=NULL, @PhysicalPath NVARCHAR(500)=NULL, @ConfidentialityLevel TINYINT, @InheritPermission BIT, @UpdatedBy INT | `storage.Folder` U | Folder.Update |  |
| `storage.sp_UpdateFolderFileCount` | @FolderID INT | `storage.Folder` U, `storage.FileDocument` R | Folder.UpdateFileCount | PRINT |
| `storage.sp_UpdateFolderTemplate` | @TemplateID INT, @TemplateCode NVARCHAR(50), @TemplateName NVARCHAR(200), @TargetType NVARCHAR(50), @Description NVARCHAR(500)=NULL, @OrgUnitID INT=NULL, @IsActive BIT | `storage.FolderTemplate` U | FolderTemplate.Update |  |
| `storage.sp_UpdateFolderTemplateItem` | @ItemID INT, @FolderName NVARCHAR(200), @ConfidentialityLevel TINYINT, @SortOrder INT, @InheritPermission BIT | `storage.FolderTemplateItem` U | FolderTemplate.UpdateItem |  |

## workflow — ใช้งานจริง (5)

| SP | Params | ตาราง | เรียกจาก | พฤติกรรมที่ต้องรักษา |
|---|---|---|---|---|
| `workflow.sp_GetAllApprovalSteps` | @RequestID INT | `workflow.ApprovalStep` R | Approval.GetAllSteps |  |
| `workflow.sp_GetApprovalRequestByID` | @RequestID INT | `workflow.ApprovalRequest` R | Approval.GetRequest |  |
| `workflow.sp_GetExpiredPendingRequests` |  | `workflow.ApprovalRequest` R | Approval.GetExpiredPendingRequests |  |
| `workflow.sp_UpdateApprovalRequestStatus` | @RequestID INT, @RequestStatus TINYINT, @ResolvedBy INT, @ResolveRemark NVARCHAR(500) | `workflow.ApprovalRequest` U | Approval.UpdateRequestStatus |  |
| `workflow.sp_UpdateApprovalStepStatus` | @StepID INT, @StepStatus TINYINT, @ActionRemark NVARCHAR(500) | `workflow.ApprovalStep` U | Approval.UpdateStepStatus |  |

## WFE — ใช้งานจริง (2)

| SP | Params | ตาราง | เรียกจาก | พฤติกรรมที่ต้องรักษา |
|---|---|---|---|---|
| `WFE.sp_CreateWFInstance` | @WFDefinitionId INT, @TemplateVersion INT, @InitiatedBy NVARCHAR(255), @InputParameters NVARCHAR(MAX)=NULL, @NewWFInstanceId INT OUT | `WFE.t_WFInstance` C | Workflow.CreateWorkflowInstance | SCOPE_IDENTITY |
| `WFE.sp_CreateWFStepInstance` | @WFInstanceId INT=NULL, @WFStepId INT=NULL, @WorkflowInstanceId INT=NULL, @WorkflowStepId INT=NULL, @AssignedTo NVARCHAR(255)=NULL, @SLADeadline DATETIME=NULL, @NewWFStepInstanceId INT=NULL OUT, @NewWorkflowStepInstanceId INT=NULL OUT | `WFE.t_WFStepInstance` CR, `WFE.t_WFInstance` R | WorkflowStepInstance.CreateStepInstance | RAISERROR, TABLOCK/HOLDLOCK, TRANSACTION, SCOPE_IDENTITY |

## SP ที่ไม่ใช่ 'ใช้งานจริง'

| SP | สถานะ | Params | object ที่อ้างถึง (จาก dependency) |
|---|---|---|---|
| `EMS.sp_AddOrgUnitRelationship` | dead (มี method แต่ไม่ถูกเรียก) | @SubCommitteeID, @DivisionID, @CreatedBy | EMS.OrgUnitRelationship |
| `EMS.sp_GetAllUserAuthority` | มีใน DB แต่โค้ดไม่เรียก |  | EMS.UserAuthority |
| `EMS.sp_GetDivisionsBySubCommittee` | มีใน DB แต่โค้ดไม่เรียก | @SubCommitteeID | EMS.OrgUnit, EMS.OrgUnitRelationship |
| `EMS.sp_GetFolderAuthorityConfigByID` | มีใน DB แต่โค้ดไม่เรียก | @ConfigID | EMS.FolderAuthorityConfig |
| `EMS.sp_GetHiddenOrgUnitIds` | มีใน DB แต่โค้ดไม่เรียก | @UserId | EMS.UserOrgUnitHiddenView |
| `EMS.sp_GetSubCommitteesByDivision` | มีใน DB แต่โค้ดไม่เรียก | @DivisionID | EMS.OrgUnit, EMS.OrgUnitRelationship |
| `EMS.sp_GetUnreadNotificationsByUser` | dead (มี method แต่ไม่ถูกเรียก) | @UserId | EMS.Notification |
| `EMS.sp_GetUserAuthorityByEmployee` | มีใน DB แต่โค้ดไม่เรียก | @EmployeeCode | EMS.UserAuthority |
| `EMS.sp_MarkNotificationRead` | dead (มี method แต่ไม่ถูกเรียก) | @NotificationId | EMS.Notification |
| `EMS.sp_RemoveOrgUnitRelationship` | มีใน DB แต่โค้ดไม่เรียก | @SubCommitteeID, @DivisionID | EMS.OrgUnitRelationship |
| `EMS.sp_ResolveFolderAuthorityByLevel` | มีใน DB แต่โค้ดไม่เรียก | @PositionName, @DepartmentCode, @DivisionCode, @LevelCode | EMS.FolderAuthorityConfig |
| `EMS.sp_SaveHiddenOrgUnitIds` | มีใน DB แต่โค้ดไม่เรียก | @UserId, @XmlIds | EMS.UserOrgUnitHiddenView, c.value |
| `EMS.sp_SeedFolderAuthorityFromPositionMapping` | มีใน DB แต่โค้ดไม่เรียก | @CanView, @CanAdd, @CanEdit, @CanApprove, @CreatedBy | core.FolderAuthorityConfig, core.HR_Department, core.HR_Division, core.HR_Position, core.HR_PositionMapping |
| `EMS.sp_SyncApiDepartments` | มีใน DB แต่โค้ดไม่เรียก |  | core.HR_Department, core.HR_Division, core.TVP_ApiDepartment |
| `EMS.sp_SyncApiDivisions` | มีใน DB แต่โค้ดไม่เรียก |  | core.HR_Division, core.TVP_ApiDivision |
| `EMS.sp_UpdateUserAccount` | มีใน DB แต่โค้ดไม่เรียก | @UserID, @DisplayName, @AppRole, @OrgUnitID, @EmployeeCode | EMS.UserAccount |
| `EMS.sp_UpdateUserEmployeeInfo` | มีใน DB แต่โค้ดไม่เรียก | @UserID, @EmployeeCode, @DepartmentId, @DepartmentCode, @DepartmentName, @DivisionId, @DivisionCode, @DivisionName, @PositionName | EMS.UserAccount |
| `EMS.sp_UpsertUserAuthority` | มีใน DB แต่โค้ดไม่เรียก | @EmployeeCode, @ConfidentialityLevel, @CanView, @CanAdd, @CanEdit, @CanApprove, @ImportBatchId, @UpdatedBy | EMS.UserAuthority |
| `WFE.sp_UpdateWFInstanceStatus` | มีใน DB แต่โค้ดไม่เรียก | @WFInstanceId, @WorkflowInstanceId, @Status, @CurrentStepId, @CompletedDate | WFE.t_WFInstance |
| `dbo.sp_SoftDeleteSubCommittee` | dead (มี method แต่ไม่ถูกเรียก) | @OrgUnitID, @DeletedBy | EMS.m_SubCommittee |
| `dbo.sp_WF_CreateDelegationRule` | มีใน DB แต่โค้ดไม่เรียก | @DelegatedFrom, @DelegatedTo, @ScopeType, @StartDate, @EndDate, @Reason, @SendEmail, @OutOfOffice, @RequireConfirmation, @CreatedBy, @NewRuleId | dbo.WFDelegationRule |
| `dbo.sp_WF_CreateWorkflowInstance` | มีใน DB แต่โค้ดไม่เรียก | @WorkflowDefinitionId, @TemplateVersion, @InitiatedBy, @InputParameters, @NewWorkflowInstanceId | dbo.WorkflowInstance |
| `dbo.sp_WF_GetBottleneckAnalysis` | dead (มี method แต่ไม่ถูกเรียก) | @WorkflowDefinitionId, @FromDate, @ToDate | WFE.s_WFDefinition, WFE.s_WFStep, WFE.t_WFInstance, WFE.t_WFStepInstance |
| `dbo.sp_WF_GetPendingSteps` | dead (มี method แต่ไม่ถูกเรียก) |  |  |
| `dbo.sp_WF_UpdateWorkflowInstanceStatus` | มีใน DB แต่โค้ดไม่เรียก | @WorkflowInstanceId, @Status, @CurrentStepId, @CompletedDate | dbo.WorkflowInstance |
| `security.sp_AddUserToGroup` | ไม่ถูก compile | @GroupID, @UserID, @AddedBy | security.UserGroupMember |
| `security.sp_DeactivatePermissionGroup` | ไม่ถูก compile | @GroupID | security.PermissionGroup |
| `security.sp_GetAllFilePermissionsByFile` | dead (มี method แต่ไม่ถูกเรียก) | @FileID | security.FilePermission |
| `security.sp_GetAllPermissionGroups` | ไม่ถูก compile |  | security.PermissionGroup |
| `security.sp_GetGroupsByUser` | ไม่ถูก compile | @UserID | security.PermissionGroup, security.UserGroupMember |
| `security.sp_GetPermissionGroupByID` | ไม่ถูก compile | @GroupID | security.PermissionGroup |
| `security.sp_GetUsersByGroup` | ไม่ถูก compile | @GroupID | EMS.UserAccount, security.UserGroupMember |
| `security.sp_InsertPermissionGroup` | ไม่ถูก compile | @GroupCode, @GroupName, @Description, @OrgUnitID, @CreatedBy | security.PermissionGroup |
| `security.sp_RemoveUserFromGroup` | ไม่ถูก compile | @GroupID, @UserID | security.UserGroupMember |
| `storage.sp_GetActiveFolders` | dead (มี method แต่ไม่ถูกเรียก) |  | EMS.UserAccount, storage.FileDocument, storage.Folder |
| `storage.sp_GetFileDocumentByChecksum` | dead (มี method แต่ไม่ถูกเรียก) | @Checksum, @FolderID | storage.FileDocument |
| `storage.sp_GetFolderTemplateById` | dead (มี method แต่ไม่ถูกเรียก) | @TemplateID | EMS.OrgUnit, storage.FolderTemplate |
| `storage.sp_PermanentDeleteFolder` | มีใน DB แต่โค้ดไม่เรียก | @FolderID | security.FolderPermission, storage.FileDocument, storage.Folder |
| `storage.sp_UpdateAllFolderFileCounts` | มีใน DB แต่โค้ดไม่เรียก |  | storage.FileDocument, storage.Folder |
| `storage.sp_UpdateFolderOrgUnit` | มีใน DB แต่โค้ดไม่เรียก | @FolderID, @OrgUnitID, @UpdatedBy | storage.Folder |
| `storage.sp_UpdateVirusScanStatus` | dead (มี method แต่ไม่ถูกเรียก) | @FileID, @VirusScanStatus | storage.FileDocument |
| `workflow.sp_GetPendingApprovalSteps` | มีใน DB แต่โค้ดไม่เรียก | @RequestID | workflow.ApprovalStep |
| `workflow.sp_GetPendingCreateHCRequests` | มีใน DB แต่โค้ดไม่เรียก |  | workflow.ApprovalRequest |
| `workflow.sp_InsertApprovalRequest` | มีใน DB แต่โค้ดไม่เรียก | @RequestType, @FolderID, @FileID, @PermissionID, @RequestedBy, @Subject, @Remark, @ExpiryDate | workflow.ApprovalRequest |
| `workflow.sp_InsertApprovalStep` | มีใน DB แต่โค้ดไม่เรียก | @RequestID, @StepOrder, @ApproverID | workflow.ApprovalStep |

### ข้อสังเกตจาก SP ที่ DB มีแต่โค้ดไม่ใช้
- `EMS.sp_Sync*`, `sp_SeedFolderAuthorityFromPositionMapping` อ้าง synonym/ตารางใน schema `core` (`core.HR_*`, ฐาน `SCS`) — น่าจะเป็นงาน sync จากระบบ HR ภายนอก
- `EMS.sp_GetAllUserAuthority`, `sp_UpsertUserAuthority`, `sp_GetUserAuthorityByEmployee` ใช้ตาราง `EMS.UserAuthority` ที่โค้ดปัจจุบันไม่เรียก
- `EMS.sp_GetHiddenOrgUnitIds`/`sp_SaveHiddenOrgUnitIds` ใช้ `EMS.UserOrgUnitHiddenView` — โค้ดปัจจุบันใช้ `security.UserOrgVisibility` แทน
- `dbo.sp_WF_CreateWorkflowInstance`, `dbo.sp_WF_UpdateWorkflowInstanceStatus`, `dbo.sp_WF_CreateDelegationRule` อ้างตาราง `dbo.WorkflowInstance`/`dbo.WFDelegationRule` ที่ไม่ใช่ชุด `WFE.*` ที่ใช้อยู่ — น่าจะเป็นของรุ่นเก่า
- `workflow.sp_InsertApprovalRequest`/`sp_InsertApprovalStep` มีใน DB แต่ `ApprovalRepository` ใช้ INSERT ตรงใน C# แทน — ควรเลือกวิธีเดียวตอนทำ API

