# Data Dictionary — Shared (Auth / Org / HR master / Audit / Notification / Config)

> สร้างจากผล export DDL จริง (`db-export/CMS_DB_1.x`, `BUI_RG_1.x`) รวมกับการวิเคราะห์โค้ดที่ใช้งานจริง · 🔑 = คอลัมน์ใน PK · Null ✔ = ยอมให้ NULL
> ชนิดข้อมูลสำหรับ Node/TypeORM ดู `README.md` หัวข้อ "Type mapping"

| ตาราง | แถว | CRUD | ใช้โดย |
|---|--:|:-:|---|
| [`EMS.Notification`](#emsnotification) | 525,748 | `C···` | DMS, KMS, RGP |
| [`EMS.OrgUnit`](#emsorgunit) | 242 | `CRUd` | DMS, KMS, RGP |
| [`EMS.UserAccount`](#emsuseraccount) | 315 | `CRUd` | DMS, KMS, RGP |
| [`EMS.m_Department`](#emsm_department) | 47 | `CRUD` | DMS, KMS, RGP |
| [`EMS.m_Division`](#emsm_division) | 13 | `CRUD` | DMS, KMS, RGP |
| [`EMS.m_SubCommittee`](#emsm_subcommittee) | 30 | `CRU·` | DMS, KMS, RGP |
| [`audit.AuditLog`](#auditauditlog) | 251,485 | `CR··` | DMS, KMS, RGP, WFE |
| `dbo.SystemConfig` | ? | `CRU·` | Core |

### `EMS.Notification`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `C···` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 525,748
- **Repository:** Notification
- **Stored procedure:** `EMS.sp_InsertNotification`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `NotificationId` | int |  | ✔ |  |  |  |
| 2 | `RecipientUserId` | int |  |  |  |  |  |
| 3 | `EventType` | nvarchar(100) |  |  |  |  |  |
| 4 | `RelatedEntityId` | nvarchar(100) | ✔ |  |  |  |  |
| 5 | `MessageText` | nvarchar(max) |  |  |  |  |  |
| 6 | `IsRead` | bit |  |  | ((0)) |  |  |
| 7 | `DeliveredAt` | datetime |  |  | (getdate()) |  |  |
| 8 | `ReadAt` | datetime | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: Notification.Insert

### `EMS.OrgUnit`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 242
- **Primary key:** `OrgUnitID` (clustered, `PK_core_OrgUnit`)
- **Repository:** FileDocument, FolderQuotaChangeRequest, FolderQuotaConfig, FolderTemplate, OrgUnit
- **Stored procedure:** `EMS.sp_GetOrgUnitByConfidentialityLevel`, `EMS.sp_GetOrgUnitByID`, `EMS.sp_GetOrgUnitHierarchy`, `EMS.sp_InsertOrgUnit`, `EMS.sp_SoftDeleteOrgUnit`, `EMS.sp_UpdateOrgUnit`, `storage.sp_GetAllFolderTemplates`, `storage.sp_GetFileDocumentsByOrgUnit`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `OrgUnitID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `OrgUnitCode` | nvarchar(20) |  |  |  |  |  |
| 3 | `OrgUnitNameTH` | nvarchar(200) |  |  |  |  |  |
| 4 | `OrgUnitNameEN` | nvarchar(200) | ✔ |  |  |  |  |
| 5 | `OrgUnitType` | tinyint |  |  |  |  | 1=SubCommittee, 2=Division, 3=Department |
| 6 | `ParentOrgUnitID` | int | ✔ |  |  |  |  |
| 7 | `SortOrder` | int |  |  | ((0)) |  |  |
| 8 | `IsActive` | bit |  |  | ((1)) |  |  |
| 9 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 10 | `DeletedBy` | int | ✔ |  |  |  |  |
| 11 | `CreatedBy` | int |  |  |  |  |  |
| 12 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 13 | `DeletedDate` | datetime | ✔ |  |  |  |  |

**Index / Unique:** `IX_core_OrgUnit_ParentID` (ParentOrgUnitID); `IX_core_OrgUnit_Type` (OrgUnitType,IsActive)

**ถูกอ้างโดย (FK in):** `dms.FolderQuotaChangeRequest` (OrgUnitID), `security.UserOrgVisibility` (OrgUnitID)

**Repository method ที่แตะตารางนี้**
- `C`: OrgUnit.Insert
- `R`: OrgUnit.Insert, OrgUnit.GetById, OrgUnit.ExistsByCode, OrgUnit.ExistsByNameUnderParent, OrgUnit.GetHierarchy, OrgUnit.GetByConfidentialityLevel, FileDocument.GetByOrgUnit, FileDocument.GetDeletedFiles, FolderTemplate.GetAll, FolderQuotaConfig.GetByEmsOrgUnitId, FolderQuotaConfig.GetAllFileStats, FolderQuotaChangeRequest.GetById, FolderQuotaChangeRequest.GetPending, FolderQuotaChangeRequest.GetAll
- `U`: OrgUnit.Update
- `d`: OrgUnit.SoftDelete, OrgUnit.Deactivate, OrgUnit.ForceDeleteWithDependents

### `EMS.UserAccount`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 315
- **Primary key:** `UserID` (clustered, `PK_core_UserAccount`)
- **Repository:** FileDocument, Folder, FolderQuotaChangeRequest, OrgUnit, UserAccount
- **Stored procedure:** `EMS.sp_DeactivateUserAccount`, `EMS.sp_GetAllUserAccounts`, `EMS.sp_GetUserAccountByADUserName`, `EMS.sp_GetUserAccountByID`, `EMS.sp_GetUserAccountsByRole`, `EMS.sp_HasActiveDependents`, `EMS.sp_InsertUserAccount`, `EMS.sp_UpdateLastLogin`, `EMS.sp_UpdateUserConsent`, `storage.sp_GetAllFileDocumentsGroupedByFolder`, `storage.sp_GetAllFolders`, `storage.sp_GetFileDocumentByID`, `storage.sp_GetFileDocumentsByFolder`, `storage.sp_GetFolderDescendants`, `storage.sp_GetFolderSiblings`, `storage.sp_GetFoldersByOrgUnit`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `UserID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ADUserName` | nvarchar(100) |  |  |  |  |  |
| 3 | `DisplayName` | nvarchar(200) |  |  |  |  |  |
| 4 | `Email` | nvarchar(254) | ✔ |  |  |  |  |
| 5 | `AppRole` | tinyint |  |  |  |  | 1=Officer, 2=SrOfficer, 3=Manager, 4=Admin |
| 6 | `OrgUnitID` | int |  |  |  |  |  |
| 7 | `ConsentGiven` | bit |  |  | ((0)) |  |  |
| 8 | `ConsentDate` | datetime | ✔ |  |  |  |  |
| 9 | `IsActive` | bit |  |  | ((1)) |  |  |
| 10 | `LastLoginDate` | datetime | ✔ |  |  |  |  |
| 11 | `CreatedBy` | int | ✔ |  |  |  |  |
| 12 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 13 | `EmployeeCode` | nvarchar(20) | ✔ |  |  |  |  |
| 14 | `DepartmentId` | int | ✔ |  |  |  |  |
| 15 | `DepartmentCode` | nvarchar(20) | ✔ |  |  |  |  |
| 16 | `DepartmentName` | nvarchar(200) | ✔ |  |  |  |  |
| 17 | `DivisionId` | int | ✔ |  |  |  |  |
| 18 | `DivisionCode` | nvarchar(20) | ✔ |  |  |  |  |
| 19 | `DivisionName` | nvarchar(200) | ✔ |  |  |  |  |
| 20 | `PositionName` | nvarchar(200) | ✔ |  |  |  |  |
| 21 | `UpdatedAt` | datetime2(7) | ✔ |  |  |  |  |
| 22 | `EmployeeTitleNameEn` | nvarchar(50) | ✔ |  |  |  |  |
| 23 | `EmployeeFirstNameEn` | nvarchar(100) | ✔ |  |  |  |  |
| 24 | `EmployeeLastNameEn` | nvarchar(100) | ✔ |  |  |  |  |
| 25 | `EmployeeTitleNameTh` | nvarchar(50) | ✔ |  |  |  |  |
| 26 | `EmployeeFirstNameTh` | nvarchar(100) | ✔ |  |  |  |  |
| 27 | `EmployeeLastNameTh` | nvarchar(100) | ✔ |  |  |  |  |
| 28 | `DepartmentNameEn` | nvarchar(200) | ✔ |  |  |  |  |
| 29 | `DivisionNameEn` | nvarchar(200) | ✔ |  |  |  |  |
| 30 | `LevelCode` | nvarchar(20) | ✔ |  |  |  |  |
| 31 | `LastLoginIP` | nvarchar(50) | ✔ |  |  |  |  |

**Index / Unique:** `IX_core_User_OrgUnit` (OrgUnitID,IsActive); `IX_core_User_Role` (AppRole,IsActive)

**ถูกอ้างโดย (FK in):** `dms.FolderQuotaChangeRequest` (RequestedBy), `dms.FolderQuotaChangeRequest` (ReviewedBy), `security.FolderPermission` (GrantedBy), `security.FolderPermission` (RevokedBy), `security.UserOrgVisibility` (GrantedBy), `security.UserOrgVisibility` (UserID), `storage.ExternalShare` (ApproverUserID), `storage.ExternalShare` (RevokedBy), `storage.ExternalShare` (SharerUserID), `storage.FileDocument` (ArchivedBy), `storage.FileDocument` (DeletedBy), `storage.FileDocument` (UploadedBy), `storage.FolderTemplate` (CreatedBy), `storage.Folder` (ArchivedBy), `storage.Folder` (CreatedBy), `storage.Folder` (DeletedBy), `storage.ShareToken` (DisabledByUserID), `workflow.ApprovalRequest` (RequestedBy), `workflow.ApprovalRequest` (ResolvedBy), `workflow.ApprovalStep` (ApproverID), `workflow.ApprovalStep` (DelegatedTo)

**Repository method ที่แตะตารางนี้**
- `C`: UserAccount.Create, UserAccount.RegisterOrUpdate, UserAccount.UpsertFromLdap
- `R`: UserAccount.GetByADUserName, UserAccount.GetById, UserAccount.GetByRole, UserAccount.GetAll, UserAccount.RegisterOrUpdate, UserAccount.UpsertFromLdap, UserAccount.GetPositionsByDepartmentCode, OrgUnit.HasActiveDependents, Folder.GetDescendants, Folder.GetByOrgUnit, Folder.GetAll, Folder.GetSiblings, FileDocument.GetById, FileDocument.GetByFolder … (+4)
- `U`: UserAccount.Create, UserAccount.Update, UserAccount.UpdateLevelCode, UserAccount.UpdateLastLogin, UserAccount.UpdateLastLoginWithIP, UserAccount.RegisterOrUpdate, UserAccount.UpsertFromLdap, UserAccount.UpdateConsent, UserAccount.UpdateEmployeeInfo
- `d`: UserAccount.Deactivate

### `EMS.m_Department`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 47
- **Primary key:** `DepartmentID` (clustered, `PK_HR_Department_2`)
- **Repository:** FileDocument, FolderQuotaConfig, HrDepartment, HrPositionMapping, KBArticle, ProjectMemberRole
- **Stored procedure:** `storage.sp_GetFileDocumentsByOrgUnit`
- **Connection:** `BisDbConnectionString`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `DepartmentID` 🔑 | smallint |  | ✔ |  |  |  |
| 2 | `DivisionID` | smallint |  |  |  | `EMS.m_Division.DivisionID` |  |
| 3 | `DepartmentCode` | nvarchar(20) |  |  |  |  |  |
| 4 | `DepartmentName` | nvarchar(100) |  |  |  |  |  |
| 5 | `IsActive` | bit |  |  |  |  |  |
| 6 | `CreatedDate` | datetime |  |  |  |  |  |
| 7 | `Level` | nvarchar(20) | ✔ |  |  |  |  |
| 8 | `ApiDepartmentCode` | nvarchar(50) | ✔ |  |  |  |  |
| 9 | `ApiDepartmentId` | int | ✔ |  |  |  |  |
| 10 | `DepartmentNameTh` | nvarchar(200) | ✔ |  |  |  |  |
| 11 | `DepartmentNameEn` | nvarchar(200) | ✔ |  |  |  |  |
| 12 | `ApiSyncedDate` | datetime | ✔ |  |  |  |  |
| 13 | `quota_size` | bigint |  |  | ((0)) |  |  |

**Index / Unique:** `IX_mDept_Code` (DepartmentCode,IsActive)

**ถูกอ้างโดย (FK in):** `EMS.m_Employee` (DepartmentID)

**Repository method ที่แตะตารางนี้**
- `C`: HrDepartment.Save
- `R`: FileDocument.GetByOrgUnit, HrDepartment.GetAll, HrDepartment.Save, HrPositionMapping.GetAll, HrPositionMapping.GetByDepartmentId, KBArticle.GetAll, KBArticle.GetByCategory, KBArticle.Search, FolderQuotaConfig.GetByOrgUnit, FolderQuotaConfig.GetByMasterCode, FolderQuotaConfig.GetByEmsOrgUnitId, FolderQuotaConfig.GetAll, FolderQuotaConfig.GetAllFileStats, ProjectMemberRole.GetDepartments
- `U`: HrDepartment.Save, FolderQuotaConfig.Save, FolderQuotaConfig.Delete
- `D`: HrDepartment.Delete

### `EMS.m_Division`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 13
- **Primary key:** `DivisionID` (clustered, `PK_HR_Division`)
- **Repository:** FileDocument, FolderQuotaConfig, HrDivision, HrPositionMapping, KBArticle, ProjectMemberRole
- **Stored procedure:** `storage.sp_GetFileDocumentsByOrgUnit`
- **Connection:** `BisDbConnectionString`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `DivisionID` 🔑 | smallint |  | ✔ |  |  |  |
| 2 | `DivisionCode` | nvarchar(20) |  |  |  |  |  |
| 3 | `DivisionName` | nvarchar(100) |  |  |  |  |  |
| 4 | `IsActive` | bit |  |  | ((1)) |  |  |
| 5 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 6 | `Level` | nvarchar(20) | ✔ |  |  |  |  |
| 7 | `ApiDivisionCode` | nvarchar(50) | ✔ |  |  |  |  |
| 8 | `ApiDivisionId` | int | ✔ |  |  |  |  |
| 9 | `DivisionNameTh` | nvarchar(200) | ✔ |  |  |  |  |
| 10 | `DivisionNameEn` | nvarchar(200) | ✔ |  |  |  |  |
| 11 | `ApiSyncedDate` | datetime | ✔ |  |  |  |  |
| 12 | `quota_size` | bigint |  |  | ((0)) |  |  |

**ถูกอ้างโดย (FK in):** `EMS.m_Department` (DivisionID)

**Repository method ที่แตะตารางนี้**
- `C`: HrDivision.Save
- `R`: FileDocument.GetByOrgUnit, HrDivision.GetAll, HrDivision.Save, HrPositionMapping.GetAll, HrPositionMapping.GetByDepartmentId, KBArticle.GetAll, KBArticle.GetByCategory, KBArticle.Search, FolderQuotaConfig.GetByOrgUnit, FolderQuotaConfig.GetByMasterCode, FolderQuotaConfig.GetByEmsOrgUnitId, FolderQuotaConfig.GetAll, FolderQuotaConfig.GetAllFileStats, ProjectMemberRole.GetDivisions
- `U`: HrDivision.Save, FolderQuotaConfig.Save, FolderQuotaConfig.Delete
- `D`: HrDivision.Delete

### `EMS.m_SubCommittee`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 30
- **Repository:** FileDocument, FolderQuotaConfig, KBArticle, OrgUnit, ProjectMemberRole
- **Stored procedure:** `dbo.sp_InsertSubCommittee`, `storage.sp_GetFileDocumentsByOrgUnit`
- **Connection:** `BisDbConnectionString`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `SubCommitteeID` | int |  | ✔ |  |  |  |
| 2 | `OrgUnitID` | int |  |  |  |  |  |
| 3 | `SubCommitteeCode` | nvarchar(20) |  |  |  |  |  |
| 4 | `SubCommitteeNameTH` | nvarchar(200) |  |  |  |  |  |
| 5 | `SubCommitteeNameEN` | nvarchar(200) | ✔ |  |  |  |  |
| 6 | `IsActive` | bit |  |  | ((1)) |  |  |
| 7 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 8 | `DeletedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 9 | `DeletedDate` | datetime | ✔ |  |  |  |  |
| 10 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 11 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 12 | `UpdatedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 13 | `UpdatedDate` | datetime | ✔ |  |  |  |  |
| 14 | `quota_size` | bigint |  |  | ((0)) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: OrgUnit.InsertSubCommitteeRecord
- `R`: OrgUnit.InsertSubCommitteeRecord, FileDocument.GetByOrgUnit, KBArticle.GetAll, KBArticle.GetByCategory, KBArticle.Search, FolderQuotaConfig.GetByOrgUnit, FolderQuotaConfig.GetByMasterCode, FolderQuotaConfig.GetByEmsOrgUnitId, FolderQuotaConfig.GetAll, FolderQuotaConfig.GetAllFileStats, ProjectMemberRole.GetSubCommittees
- `U`: FolderQuotaConfig.Save, FolderQuotaConfig.Delete

### `audit.AuditLog`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** DMS, KMS, RGP, WFE
- **การกระทำที่ใช้จริง:** `CR··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 251,485
- **Primary key:** `AuditID` (clustered, `PK_aud_AuditLog`)
- **Repository:** Audit
- **Stored procedure:** `audit.sp_InsertAuditLog`, `audit.sp_QueryAuditLog`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `AuditID` 🔑 | bigint |  | ✔ |  |  |  |
| 2 | `AuditDate` | datetime |  |  | (getdate()) |  |  |
| 3 | `UserID` | int |  |  |  |  |  |
| 4 | `UserName` | nvarchar(100) |  |  |  |  |  |
| 5 | `UserRole` | tinyint | ✔ |  |  |  |  |
| 6 | `Module` | varchar(50) |  |  |  |  |  |
| 7 | `Action` | varchar(50) |  |  |  |  |  |
| 8 | `TableName` | varchar(100) | ✔ |  |  |  |  |
| 9 | `RecordID` | int | ✔ |  |  |  |  |
| 10 | `OldValue` | nvarchar(max) | ✔ |  |  |  |  |
| 11 | `NewValue` | nvarchar(max) | ✔ |  |  |  |  |
| 12 | `IPAddress` | varchar(45) | ✔ |  |  |  |  |
| 13 | `MachineName` | nvarchar(100) | ✔ |  |  |  |  |
| 14 | `SessionID` | nvarchar(100) | ✔ |  |  |  |  |
| 15 | `Result` | tinyint |  |  |  |  |  |
| 16 | `ErrorMessage` | nvarchar(500) | ✔ |  |  |  |  |

**Index / Unique:** `IX_aud_Audit_Date` (AuditDate DESC); `IX_aud_Audit_User` (UserID,AuditDate DESC); `IX_aud_Audit_Module` (Module,Action,AuditDate DESC)

**CHECK constraint:**
- `CK_aud_AuditLog_Action`: `(len(ltrim(rtrim(isnull([Action],''))))>(0))`

**Repository method ที่แตะตารางนี้**
- `C`: Audit.Insert
- `R`: Audit.Query, Audit.GetAuditLogsByWorkflowInstance

### `dbo.SystemConfig`

- **เจ้าของ module:** SHARED
- **ใช้โดย:** Core (Login/MDI/Program)
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **Repository:** ConfigManager (Infrastructure)
- **Stored procedure:** `dbo.sp_GetSystemConfig`, `dbo.sp_UpsertSystemConfig`

> ⚠ **ยังไม่มี DDL ของตารางนี้** (ไม่อยู่ในชุด export ที่ได้รับ) — ดู `OPEN_QUESTIONS.md` ข้อ DDL ที่ขาด
> คอลัมน์ที่เห็นจาก SP: `ConfigKey`, `ConfigValue`, `UpdatedByUserId`, `UpdatedDate`

