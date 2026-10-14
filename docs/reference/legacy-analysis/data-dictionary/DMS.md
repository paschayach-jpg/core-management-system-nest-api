# Data Dictionary — DMS — Document Management

> สร้างจากผล export DDL จริง (`db-export/CMS_DB_1.x`, `BUI_RG_1.x`) รวมกับการวิเคราะห์โค้ดที่ใช้งานจริง · 🔑 = คอลัมน์ใน PK · Null ✔ = ยอมให้ NULL
> ชนิดข้อมูลสำหรับ Node/TypeORM ดู `README.md` หัวข้อ "Type mapping"

| ตาราง | แถว | CRUD | ใช้โดย |
|---|--:|:-:|---|
| [`EMS.FolderAuthorityConfig`](#emsfolderauthorityconfig) | 752 | `CRUd` | DMS |
| [`EMS.MenuItem`](#emsmenuitem) | 54 | `CRUD` | DMS |
| [`EMS.OrgUnitRelationship`](#emsorgunitrelationship) | 3 | `·R··` | DMS |
| [`EMS.m_Position`](#emsm_position) | 8 | `CRUD` | DMS |
| [`EMS.m_PositionMapping`](#emsm_positionmapping) | 154 | `CRUD` | DMS |
| [`EMS.m_Role`](#emsm_role) | 132 | `CRUD` | DMS |
| [`dms.FolderQuotaChangeRequest`](#dmsfolderquotachangerequest) | 4 | `CRU·` | DMS |
| [`security.FilePermission`](#securityfilepermission) | 59 | `CRU·` | DMS, KMS, RGP |
| [`security.FolderPermission`](#securityfolderpermission) | 6 | `CRUD` | DMS, KMS, RGP |
| [`security.UserOrgVisibility`](#securityuserorgvisibility) | 254 | `CRUD` | DMS |
| [`storage.ExternalShare`](#storageexternalshare) | 4 | `CRU·` | DMS |
| [`storage.FileDocument`](#storagefiledocument) | 2,812 | `CRUD` | DMS, KMS, RGP |
| [`storage.Folder`](#storagefolder) | 411 | `CRUD` | DMS, KMS, RGP |
| [`storage.FolderTemplate`](#storagefoldertemplate) | 4 | `CRUD` | DMS |
| [`storage.FolderTemplateItem`](#storagefoldertemplateitem) | 8 | `CRUD` | DMS |
| `storage.QuickAccessFolder` | ? | `CR·D` | DMS |
| [`storage.ShareAccessLog`](#storageshareaccesslog) | 0 | `CR··` | DMS |
| [`storage.ShareToken`](#storagesharetoken) | 4 | `CRU·` | DMS |
| [`workflow.ApprovalRequest`](#workflowapprovalrequest) | 40 | `CRUD` | DMS |
| [`workflow.ApprovalStep`](#workflowapprovalstep) | 222,519 | `CRUD` | DMS |

### `EMS.FolderAuthorityConfig`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 752
- **Repository:** FolderAuthority
- **Stored procedure:** `EMS.sp_DeleteFolderAuthorityConfig`, `EMS.sp_GetAllFolderAuthorityConfigs`, `EMS.sp_InsertFolderAuthorityConfig`, `EMS.sp_ResolveFolderAuthority`, `EMS.sp_UpdateFolderAuthorityConfig`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `ConfigID` | int |  | ✔ |  |  |  |
| 2 | `PositionName` | nvarchar(200) | ✔ |  |  |  |  |
| 3 | `DepartmentCode` | nvarchar(50) | ✔ |  |  |  |  |
| 4 | `DivisionCode` | nvarchar(50) | ✔ |  |  |  |  |
| 5 | `ConfidentialityLevel` | tinyint |  |  |  |  | 1=HC, 2=SC, 3=NC, 4=PC |
| 6 | `CanView` | bit |  |  | ((0)) |  |  |
| 7 | `CanAdd` | bit |  |  | ((0)) |  |  |
| 8 | `CanEdit` | bit |  |  | ((0)) |  |  |
| 9 | `CanApprove` | bit |  |  | ((0)) |  |  |
| 10 | `ConfigLabel` | nvarchar(200) | ✔ |  |  |  |  |
| 11 | `IsActive` | bit |  |  | ((1)) |  |  |
| 12 | `CreatedBy` | int | ✔ |  |  |  |  |
| 13 | `CreatedDate` | datetime |  |  | (getutcdate()) |  |  |
| 14 | `UpdatedBy` | int | ✔ |  |  |  |  |
| 15 | `UpdatedDate` | datetime | ✔ |  |  |  |  |
| 16 | `LevelCode` | nchar(10) | ✔ |  |  |  | '1HC'\|'2SC'\|'3NC'\|'4PC' (คู่กับ ConfidentialityLevel 1–4) |
| 17 | `CanDownload` | bit |  |  | ((0)) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: FolderAuthority.Insert
- `R`: FolderAuthority.GetAll, FolderAuthority.Resolve
- `U`: FolderAuthority.Update
- `d`: FolderAuthority.Delete

### `EMS.MenuItem`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 54
- **Primary key:** `MenuItemID` (clustered, `PK__MenuItem__8943F7028DED9561`)
- **Repository:** MenuItem
- **Stored procedure:** `EMS.sp_CreateMenuItem`, `EMS.sp_DeleteMenuItem`, `EMS.sp_UpdateMenuItem`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `MenuItemID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ParentMenuItemID` | int | ✔ |  |  |  |  |
| 3 | `MenuName` | nvarchar(255) |  |  |  |  |  |
| 4 | `MenuKey` | nvarchar(100) |  |  |  |  |  |
| 5 | `FormClassName` | nvarchar(500) | ✔ |  |  |  |  |
| 6 | `IconKey` | nvarchar(100) | ✔ |  |  |  |  |
| 7 | `DisplayOrder` | int |  |  | ((0)) |  |  |
| 8 | `IsActive` | bit |  |  | ((1)) |  |  |
| 9 | `RequiredAppRole` | int | ✔ |  |  |  |  |
| 10 | `Description` | nvarchar(500) | ✔ |  |  |  |  |
| 11 | `ModuleCode` | nvarchar(50) | ✔ |  |  |  |  |
| 12 | `Url` | nvarchar(500) | ✔ |  |  |  |  |
| 13 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 14 | `CreatedByUserID` | int |  |  |  |  |  |
| 15 | `ModifiedDate` | datetime | ✔ |  |  |  |  |
| 16 | `ModifiedByUserID` | int | ✔ |  |  |  |  |
| 17 | `Remark` | nvarchar(500) | ✔ |  |  |  |  |
| 18 | `Limitation` | nvarchar(500) | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: MenuItem.CreateMenuItem
- `R`: MenuItem.GetAllMenuItems, MenuItem.GetRootMenuItems, MenuItem.GetChildMenuItems, MenuItem.GetMenuItemByID, MenuItem.GetMenuItemByKey, MenuItem.CreateMenuItem, MenuItem.UpdateMenuItem, MenuItem.DeleteMenuItem, MenuItem.GetMenuHierarchy
- `U`: MenuItem.UpdateMenuItem
- `D`: MenuItem.DeleteMenuItem

### `EMS.OrgUnitRelationship`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `·R··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 3
- **Repository:** FolderQuotaConfig, OrgUnit

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `RelationshipID` | int |  | ✔ |  |  |  |
| 2 | `SubCommitteeID` | int |  |  |  |  |  |
| 3 | `DivisionID` | int |  |  |  |  |  |
| 4 | `IsActive` | bit |  |  |  |  |  |
| 5 | `CreatedBy` | int |  |  |  |  |  |
| 6 | `CreatedDate` | datetime |  |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `R`: OrgUnit.GetAllActiveRelationships, FolderQuotaConfig.GetAllFileStats

### `EMS.m_Position`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 8
- **Primary key:** `LevelCode` (clustered, `PK_HR_PositionLevel`)
- **Repository:** HrPositionLevel

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `LevelCode` 🔑 | nvarchar(4) |  |  |  |  |  |
| 2 | `LevelGroup` | tinyint |  |  |  |  |  |
| 3 | `LevelVariant` | char(1) |  |  |  |  |  |
| 4 | `LevelName` | nvarchar(100) |  |  |  |  |  |
| 5 | `LevelCategory` | nvarchar(50) |  |  |  |  |  |
| 6 | `SortOrder` | tinyint |  |  |  |  |  |
| 7 | `IsActive` | bit |  |  | ((1)) |  |  |

**ถูกอ้างโดย (FK in):** `EMS.m_Employee` (LevelCode)

**Repository method ที่แตะตารางนี้**
- `C`: HrPositionLevel.Save
- `R`: HrPositionLevel.GetAll, HrPositionLevel.Save
- `U`: HrPositionLevel.Save
- `D`: HrPositionLevel.Delete

### `EMS.m_PositionMapping`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 154
- **Primary key:** `MappingID` (clustered, `PK_HR_PositionMapping`)
- **Repository:** HrPositionMapping

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `MappingID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `PositionID` | smallint |  |  |  |  |  |
| 3 | `DepartmentID` | smallint | ✔ |  |  |  |  |
| 4 | `DivisionID` | smallint |  |  |  |  |  |
| 5 | `HeadCount` | tinyint |  |  | ((1)) |  |  |
| 6 | `IsActive` | bit |  |  | ((1)) |  |  |
| 7 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: HrPositionMapping.Save
- `R`: HrPositionMapping.GetAll, HrPositionMapping.GetByDepartmentId, HrPositionMapping.Save
- `U`: HrPositionMapping.Save
- `D`: HrPositionMapping.Delete

### `EMS.m_Role`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 132
- **Primary key:** `PositionID` (clustered, `PK_HR_Position`)
- **Repository:** HrPosition, HrPositionMapping

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `PositionID` 🔑 | smallint |  | ✔ |  |  |  |
| 2 | `PositionCode` | nvarchar(20) |  |  |  |  |  |
| 3 | `PositionName` | nvarchar(200) |  |  |  |  |  |
| 4 | `PositionLevel` | tinyint |  |  | ((6)) |  |  |
| 5 | `IsActive` | bit |  |  | ((1)) |  |  |
| 6 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 7 | `LevelCode` | nvarchar(4) | ✔ |  |  |  |  |
| 8 | `Level` | nvarchar(20) | ✔ |  |  |  |  |

**ถูกอ้างโดย (FK in):** `EMS.m_Employee` (PositionID)

**Repository method ที่แตะตารางนี้**
- `C`: HrPosition.Save
- `R`: HrPosition.GetAll, HrPosition.Save, HrPositionMapping.GetAll, HrPositionMapping.GetByDepartmentId
- `U`: HrPosition.Save
- `D`: HrPosition.Delete

### `dms.FolderQuotaChangeRequest`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 4
- **Primary key:** `RequestID` (clustered, `PK_FolderQuotaChangeRequest`)
- **Repository:** FolderQuotaChangeRequest

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `RequestID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `OrgUnitID` | int |  |  |  | `EMS.OrgUnit.OrgUnitID` |  |
| 3 | `CurrentQuotaBytes` | bigint |  |  | ((0)) |  |  |
| 4 | `RequestedQuotaBytes` | bigint |  |  |  |  |  |
| 5 | `Reason` | nvarchar(500) | ✔ |  |  |  |  |
| 6 | `Status` | tinyint |  |  | ((1)) |  | 1=Pending, 2=Approved, 3=Rejected, 4=Cancelled (CHECK) |
| 7 | `RequestedBy` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 8 | `RequestedDate` | datetime |  |  | (getdate()) |  |  |
| 9 | `ReviewedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 10 | `ReviewedDate` | datetime | ✔ |  |  |  |  |
| 11 | `ReviewRemark` | nvarchar(500) | ✔ |  |  |  |  |

**Index / Unique:** `IX_FolderQuotaChangeRequest_OrgUnit` (OrgUnitID,Status); `IX_FolderQuotaChangeRequest_RequestedBy` (RequestedBy,RequestedDate DESC)

**CHECK constraint:**
- `CHK_FolderQuotaChangeRequest_Status`: `([Status]=(4) OR [Status]=(3) OR [Status]=(2) OR [Status]=(1))`

**Repository method ที่แตะตารางนี้**
- `C`: FolderQuotaChangeRequest.Insert
- `R`: FolderQuotaChangeRequest.GetById, FolderQuotaChangeRequest.GetPending, FolderQuotaChangeRequest.GetAll
- `U`: FolderQuotaChangeRequest.UpdateStatus

### `security.FilePermission`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 59
- **Primary key:** `FilePermissionID` (clustered, `PK__FilePerm__63DF70C439C45570`)
- **Repository:** FilePermission
- **Stored procedure:** `security.sp_GetFilePermissionsByFile`, `security.sp_InsertFilePermission`, `security.sp_RevokeFilePermission`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `FilePermissionID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `FileID` | int |  |  |  |  |  |
| 3 | `PrincipalType` | tinyint |  |  |  |  | เหมือน FolderPermission (ไม่มี CHECK) |
| 4 | `PrincipalID` | int |  |  |  |  |  |
| 5 | `CanRead` | bit |  |  | ((0)) |  |  |
| 6 | `CanWrite` | bit |  |  | ((0)) |  |  |
| 7 | `CanDelete` | bit |  |  | ((0)) |  |  |
| 8 | `CanModify` | bit |  |  | ((0)) |  |  |
| 9 | `CanFullControl` | bit |  |  | ((0)) |  |  |
| 10 | `IsDeny` | bit |  |  | ((0)) |  |  |
| 11 | `ExpiryDate` | datetime | ✔ |  |  |  |  |
| 12 | `GrantedBy` | int |  |  |  |  |  |
| 13 | `GrantedDate` | datetime |  |  | (getdate()) |  |  |
| 14 | `RevokedBy` | int | ✔ |  |  |  |  |
| 15 | `RevokedDate` | datetime | ✔ |  |  |  |  |
| 16 | `RevokeReason` | nvarchar(500) | ✔ |  |  |  |  |
| 17 | `CanDownload` | bit |  |  | ((0)) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: FilePermission.Insert
- `R`: FilePermission.GetById, FilePermission.GetByFile, FilePermission.GetByGrantedBy, FilePermission.GetAll, FilePermission.GetByPrincipal
- `U`: FilePermission.Revoke

### `security.FolderPermission`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 6
- **Primary key:** `PermissionID` (clustered, `PK_sec_FolderPermission`)
- **Repository:** Permission
- **Stored procedure:** `security.sp_GetAllPermissionsByFolder`, `security.sp_GetPermissionsByFolder`, `security.sp_GetPermissionsByPrincipal`, `security.sp_InsertFolderPermission`, `security.sp_RevokePermission`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `PermissionID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `FolderID` | int |  |  |  | `storage.Folder.FolderID` |  |
| 3 | `PrincipalType` | tinyint |  |  |  |  | 1=User, 2=Role, 3=Department, 4=Division (CHECK 1–4; enum ในโค้ดมี 5=Group, 6=OrgUnit แต่ DB ไม่อนุญาต) |
| 4 | `PrincipalID` | int |  |  |  |  |  |
| 5 | `CanRead` | bit |  |  | ((0)) |  |  |
| 6 | `CanWrite` | bit |  |  | ((0)) |  |  |
| 7 | `CanDelete` | bit |  |  | ((0)) |  |  |
| 8 | `CanModify` | bit |  |  | ((0)) |  |  |
| 9 | `CanFullControl` | bit |  |  | ((0)) |  |  |
| 10 | `IsDeny` | bit |  |  | ((0)) |  |  |
| 11 | `ExpiryDate` | datetime | ✔ |  |  |  |  |
| 12 | `GrantedBy` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 13 | `GrantedDate` | datetime |  |  | (getdate()) |  |  |
| 14 | `RevokedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 15 | `RevokedDate` | datetime | ✔ |  |  |  |  |
| 16 | `RevokeReason` | nvarchar(500) | ✔ |  |  |  |  |

**Index / Unique:** `IX_sec_Perm_Folder` (FolderID,PrincipalType,IsDeny); `IX_sec_Perm_Expiry` (ExpiryDate); `IX_sec_Perm_Principal` (PrincipalType,PrincipalID)

**CHECK constraint:**
- `CK_sec_FolderPerm_PrincipalType`: `([PrincipalType]=(4) OR [PrincipalType]=(3) OR [PrincipalType]=(2) OR [PrincipalType]=(1))`

**ถูกอ้างโดย (FK in):** `workflow.ApprovalRequest` (PermissionID)

**Repository method ที่แตะตารางนี้**
- `C`: Permission.Insert
- `R`: Permission.GetByFolder, Permission.GetAllByFolder, Permission.GetByPrincipal, Permission.GetAclEntries, Permission.GetAllForUser
- `U`: Permission.Revoke
- `D`: Permission.DeleteByFolder

### `security.UserOrgVisibility`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 254
- **Primary key:** `UserID,OrgUnitID` (clustered, `PK_sec_UserOrgVisibility`)
- **Repository:** UserOrgVisibility

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `UserID` 🔑 | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 2 | `OrgUnitID` 🔑 | int |  |  |  | `EMS.OrgUnit.OrgUnitID` |  |
| 3 | `GrantedBy` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 4 | `GrantedDate` | datetime |  |  | (getdate()) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: UserOrgVisibility.Grant
- `R`: UserOrgVisibility.GetByUser, UserOrgVisibility.Grant
- `U`: UserOrgVisibility.Grant
- `D`: UserOrgVisibility.Revoke

### `storage.ExternalShare`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 4
- **Primary key:** `ExternalShareID` (clustered, `PK__External__4BFA2CA90DC45A42`)
- **Repository:** ExternalShare

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `ExternalShareID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ShareToken` | uniqueidentifier |  |  |  |  |  |
| 3 | `FileID` | int | ✔ |  |  | `storage.FileDocument.FileID` |  |
| 4 | `FolderID` | int | ✔ |  |  | `storage.Folder.FolderID` |  |
| 5 | `SharerUserID` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 6 | `ApproverUserID` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 7 | `PasswordHash` | nvarchar(255) | ✔ |  |  |  |  |
| 8 | `ExpiryDate` | datetime | ✔ |  |  |  |  |
| 9 | `DownloadLimit` | int | ✔ |  |  |  |  |
| 10 | `CurrentDownloadCount` | int |  |  | ((0)) |  |  |
| 11 | `ShareTokenStatus` | nvarchar(20) |  |  | ('Pending') |  | Pending \| Active \| Disabled \| Expired \| Revoked (CHECK) |
| 12 | `CreatedDate` | datetime |  |  | (getutcdate()) |  |  |
| 13 | `ApprovedDate` | datetime | ✔ |  |  |  |  |
| 14 | `DisabledDate` | datetime | ✔ |  |  |  |  |
| 15 | `DisabledReason` | nvarchar(500) | ✔ |  |  |  |  |
| 16 | `RevokedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 17 | `RevokedDate` | datetime | ✔ |  |  |  |  |
| 18 | `RevocationReason` | nvarchar(500) | ✔ |  |  |  |  |
| 19 | `SharePurpose` | nvarchar(1000) | ✔ |  |  |  |  |
| 20 | `NotifyOnAccess` | bit |  |  | ((1)) |  |  |

**Index / Unique:** `UQ__External__9F895CDC14C5903F` (UNIQUE ShareToken)

**CHECK constraint:**
- `CK_ExternalShare_FileOrFolder`: `([FileID] IS NOT NULL AND [FolderID] IS NULL OR [FileID] IS NULL AND [FolderID] IS NOT NULL)`
- `CK_ExternalShare_Status`: `([ShareTokenStatus]='Revoked' OR [ShareTokenStatus]='Disabled' OR [ShareTokenStatus]='Expired' OR [ShareTokenStatus]='Active' OR [ShareTokenStatus]='Pending')`

**ถูกอ้างโดย (FK in):** `storage.ShareAccessLog` (ExternalShareID), `storage.ShareToken` (ExternalShareID)

**Repository method ที่แตะตารางนี้**
- `C`: ExternalShare.Insert
- `R`: ExternalShare.GetById, ExternalShare.GetBySharer, ExternalShare.GetAll
- `U`: ExternalShare.Update

### `storage.FileDocument`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 2,812
- **Primary key:** `FileID` (clustered, `PK_sto_FileDocument`)
- **Repository:** FileDocument, Folder, FolderQuotaConfig, ProjectAttachment
- **Stored procedure:** `storage.sp_GetAllFileDocumentsGroupedByFolder`, `storage.sp_GetAllFolders`, `storage.sp_GetFileDocumentByID`, `storage.sp_GetFileDocumentsByFolder`, `storage.sp_GetFileDocumentsByOrgUnit`, `storage.sp_GetFolderByID`, `storage.sp_GetFolderChildren`, `storage.sp_GetFolderDescendants`, `storage.sp_GetFolderSiblings`, `storage.sp_GetFoldersByOrgUnit`, `storage.sp_GetRootFoldersByOrgUnit`, `storage.sp_InsertFileDocument`, `storage.sp_RenameFileDocument`, `storage.sp_SoftDeleteFileDocument`, `storage.sp_UpdateFileDocument`, `storage.sp_UpdateFolderFileCount`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `FileID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `FileGUID` | uniqueidentifier |  |  | (newid()) |  |  |
| 3 | `FolderID` | int |  |  |  | `storage.Folder.FolderID` |  |
| 4 | `OriginalFileName` | nvarchar(260) |  |  |  |  |  |
| 5 | `StoredFileName` | nvarchar(360) |  |  |  |  |  |
| 6 | `FileExtension` | varchar(20) |  |  |  |  |  |
| 7 | `MimeType` | varchar(100) |  |  |  |  |  |
| 8 | `FileSizeBytes` | bigint |  |  |  |  |  |
| 9 | `PhysicalPath` | nvarchar(500) |  |  |  |  |  |
| 10 | `Checksum` | varchar(64) |  |  |  |  |  |
| 11 | `VirusScanStatus` | tinyint |  |  | ((0)) |  | 0=Pending, 1=Clean, 2=Infected, 3=Error — CHECK 0–3 (โค้ดปัจจุบันข้าม virus scan: บันทึก 1) |
| 12 | `VirusScanDate` | datetime | ✔ |  |  |  |  |
| 13 | `FileStatus` | tinyint |  |  | ((1)) |  | 1=Active, 2=Archived, 3=Deleted (soft) — CHECK 1–3 |
| 14 | `UploadedBy` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 15 | `UploadedDate` | datetime |  |  | (getdate()) |  |  |
| 16 | `ArchivedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 17 | `ArchivedDate` | datetime | ✔ |  |  |  |  |
| 18 | `DeletedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 19 | `DeletedDate` | datetime | ✔ |  |  |  |  |
| 20 | `Version` | int |  |  | ((1)) |  |  |
| 21 | `IsDeleted` | int | ✔ |  |  |  |  |

**Index / Unique:** `UQ_sto_FileDocument_GUID` (UNIQUE FileGUID); `IX_sto_File_FolderID` (FolderID,FileStatus); `IX_sto_File_VirusScan` (VirusScanStatus); `IX_sto_File_Checksum` (Checksum,FolderID)

**CHECK constraint:**
- `CK_sto_FileDocument_Status`: `([FileStatus]=(3) OR [FileStatus]=(2) OR [FileStatus]=(1))`
- `CK_sto_FileDocument_VirusScan`: `([VirusScanStatus]=(3) OR [VirusScanStatus]=(2) OR [VirusScanStatus]=(1) OR [VirusScanStatus]=(0))`

**ถูกอ้างโดย (FK in):** `KMS.t_KBArticleAttachment` (FileID), `storage.ExternalShare` (FileID), `workflow.ApprovalRequest` (FileID)

**Repository method ที่แตะตารางนี้**
- `C`: FileDocument.Insert
- `R`: Folder.UpdateFileCount, Folder.GetById, Folder.GetChildren, Folder.GetDescendants, Folder.GetRootFoldersByOrgUnit, Folder.GetByOrgUnit, Folder.GetAll, Folder.GetSiblings, FileDocument.GetById, FileDocument.GetByFolder, FileDocument.GetAllGroupedByFolder, FileDocument.GetByOrgUnit, FileDocument.ExistsWithName, FileDocument.GetByOriginalName … (+4)
- `U`: FileDocument.Update, FileDocument.SoftDelete, FileDocument.RenameFile, FileDocument.RestoreFile, FileDocument.UpdateVersion
- `D`: FileDocument.PermanentDelete, FileDocument.DeleteAllByFolder

### `storage.Folder`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS, KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 411
- **Primary key:** `FolderID` (clustered, `PK_sto_Folder`)
- **Repository:** FileDocument, Folder, FolderQuotaConfig, OrgUnit, ProjectAttachment
- **Stored procedure:** `EMS.sp_GetOrgUnitByConfidentialityLevel`, `EMS.sp_HasActiveDependents`, `EMS.sp_SoftDeleteOrgUnit`, `storage.sp_GetAllFileDocumentsGroupedByFolder`, `storage.sp_GetAllFolders`, `storage.sp_GetDeletedFoldersByOrgUnit`, `storage.sp_GetFileDocumentsByFolder`, `storage.sp_GetFileDocumentsByOrgUnit`, `storage.sp_GetFolderByID`, `storage.sp_GetFolderChildren`, `storage.sp_GetFolderDescendants`, `storage.sp_GetFolderSiblings`, `storage.sp_GetFoldersByOrgUnit`, `storage.sp_GetRootFoldersByOrgUnit`, `storage.sp_InsertFolder`, `storage.sp_RestoreFolder`, `storage.sp_SoftDeleteFolder`, `storage.sp_UpdateFolder`, `storage.sp_UpdateFolderFileCount`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `FolderID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `FolderGUID` | uniqueidentifier |  |  | (newid()) |  |  |
| 3 | `FolderName` | nvarchar(255) |  |  |  |  |  |
| 4 | `ParentFolderID` | int | ✔ |  |  | `storage.Folder.FolderID` |  |
| 5 | `OrgUnitID` | int |  |  |  |  |  |
| 6 | `TemplateID` | int | ✔ |  |  | `storage.FolderTemplate.TemplateID` |  |
| 7 | `ConfidentialityLevel` | tinyint |  |  | ((4)) |  | 1=HC, 2=SC, 3=NC, 4=PC (CHECK 1–4) |
| 8 | `FolderDepth` | tinyint |  |  | ((0)) |  | 0–10 (CHECK) |
| 9 | `PhysicalPath` | nvarchar(500) |  |  |  |  |  |
| 10 | `FolderSizeBytes` | bigint |  |  | ((0)) |  |  |
| 11 | `FileCount` | int |  |  | ((0)) |  |  |
| 12 | `IsArchived` | bit |  |  | ((0)) |  |  |
| 13 | `ArchivedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 14 | `ArchivedDate` | datetime | ✔ |  |  |  |  |
| 15 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 16 | `DeletedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 17 | `DeletedDate` | datetime | ✔ |  |  |  |  |
| 18 | `RecycleBinExpiry` | datetime | ✔ |  |  |  |  |
| 19 | `InheritPermission` | bit |  |  | ((1)) |  |  |
| 20 | `CreatedBy` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 21 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 22 | `UpdatedBy` | int | ✔ |  |  |  |  |
| 23 | `UpdatedDate` | datetime | ✔ |  |  |  |  |

**Index / Unique:** `UQ_sto_Folder_GUID` (UNIQUE FolderGUID); `IX_sto_Folder_ParentID` (ParentFolderID); `IX_sto_Folder_OrgUnit` (OrgUnitID,IsDeleted); `IX_sto_Folder_ConfLevel` (ConfidentialityLevel,IsDeleted); `IX_sto_Folder_Recycle` (IsDeleted,RecycleBinExpiry); `IX_sto_Folder_Archived` (IsArchived,OrgUnitID); `IX_Folder_OrgUnitID_IsDeleted_IsArchived` (OrgUnitID,IsDeleted,IsArchived); `IX_Folder_IsDeleted_DeletedDate` (IsDeleted,DeletedDate DESC)

**CHECK constraint:**
- `CK_sto_Folder_ConfLevel`: `([ConfidentialityLevel]=(4) OR [ConfidentialityLevel]=(3) OR [ConfidentialityLevel]=(2) OR [ConfidentialityLevel]=(1))`
- `CK_sto_Folder_Depth`: `([FolderDepth]>=(0) AND [FolderDepth]<=(10))`

**ถูกอ้างโดย (FK in):** `security.FolderPermission` (FolderID), `storage.ExternalShare` (FolderID), `storage.FileDocument` (FolderID), `storage.Folder` (ParentFolderID), `workflow.ApprovalRequest` (FolderID)

**Repository method ที่แตะตารางนี้**
- `C`: Folder.Insert
- `R`: OrgUnit.GetByConfidentialityLevel, OrgUnit.HasActiveDependents, Folder.GetById, Folder.GetChildren, Folder.GetDescendants, Folder.GetAllRootFolders, Folder.GetAllDeletedFolders, Folder.GetRootFoldersByOrgUnit, Folder.GetDeletedByOrgUnit, Folder.GetByOrgUnit, Folder.GetAll, Folder.GetSiblings, Folder.SoftDelete, Folder.Restore … (+6)
- `U`: Folder.Update, Folder.UpdateFileCount, Folder.Restore
- `D`: Folder.PermanentDelete
- `d`: OrgUnit.ForceDeleteWithDependents, Folder.SoftDelete

### `storage.FolderTemplate`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 4
- **Primary key:** `TemplateID` (clustered, `PK_sto_FolderTemplate`)
- **Repository:** FolderTemplate
- **Stored procedure:** `storage.sp_DeleteFolderTemplate`, `storage.sp_GetAllFolderTemplates`, `storage.sp_InsertFolderTemplate`, `storage.sp_UpdateFolderTemplate`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `TemplateID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `TemplateCode` | nvarchar(50) |  |  |  |  |  |
| 3 | `TemplateName` | nvarchar(200) |  |  |  |  |  |
| 4 | `TargetType` | varchar(20) |  |  |  |  | Any \| SubCommittee \| Division \| Department (CHECK) |
| 5 | `Description` | nvarchar(500) | ✔ |  |  |  |  |
| 6 | `IsActive` | bit |  |  | ((1)) |  |  |
| 7 | `CreatedBy` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 8 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 9 | `OrgUnitID` | int | ✔ |  |  |  |  |

**Index / Unique:** `UQ_sto_FolderTemplate_Code` (UNIQUE TemplateCode)

**CHECK constraint:**
- `CK_sto_FolderTemplate_Type`: `([TargetType]='Any' OR [TargetType]='Department' OR [TargetType]='Division' OR [TargetType]='SubCommittee')`

**ถูกอ้างโดย (FK in):** `storage.FolderTemplateItem` (TemplateID), `storage.Folder` (TemplateID)

**Repository method ที่แตะตารางนี้**
- `C`: FolderTemplate.Insert
- `R`: FolderTemplate.GetAll
- `U`: FolderTemplate.Update
- `D`: FolderTemplate.Delete

### `storage.FolderTemplateItem`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 8
- **Primary key:** `ItemID` (clustered, `PK_sto_FolderTemplateItem`)
- **Repository:** FolderTemplate
- **Stored procedure:** `storage.sp_DeleteFolderTemplate`, `storage.sp_DeleteFolderTemplateItem`, `storage.sp_GetFolderTemplateItems`, `storage.sp_InsertFolderTemplateItem`, `storage.sp_UpdateFolderTemplateItem`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `ItemID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `TemplateID` | int |  |  |  | `storage.FolderTemplate.TemplateID` |  |
| 3 | `ParentItemID` | int | ✔ |  |  | `storage.FolderTemplateItem.ItemID` |  |
| 4 | `FolderName` | nvarchar(255) |  |  |  |  |  |
| 5 | `ConfidentialityLevel` | tinyint |  |  | ((4)) |  | 1=HC, 2=SC, 3=NC, 4=PC (CHECK 1–4) |
| 6 | `SortOrder` | int |  |  | ((0)) |  |  |
| 7 | `InheritPermission` | bit |  |  | ((1)) |  |  |

**CHECK constraint:**
- `CK_sto_FTplItem_ConfLevel`: `([ConfidentialityLevel]=(4) OR [ConfidentialityLevel]=(3) OR [ConfidentialityLevel]=(2) OR [ConfidentialityLevel]=(1))`

**ถูกอ้างโดย (FK in):** `storage.FolderTemplateItem` (ParentItemID)

**Repository method ที่แตะตารางนี้**
- `C`: FolderTemplate.InsertItem
- `R`: FolderTemplate.GetItems, FolderTemplate.DeleteItem
- `U`: FolderTemplate.UpdateItem
- `D`: FolderTemplate.Delete, FolderTemplate.DeleteItem

### `storage.QuickAccessFolder`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **Repository:** QuickAccess
- **Stored procedure:** `storage.sp_AddQuickAccess`, `storage.sp_GetQuickAccessByUser`, `storage.sp_RemoveQuickAccess`

> ⚠ **ยังไม่มี DDL ของตารางนี้** (ไม่อยู่ในชุด export ที่ได้รับ) — ดู `OPEN_QUESTIONS.md` ข้อ DDL ที่ขาด
> คอลัมน์ที่เห็นจาก SP: `QuickAccessID`, `UserID`, `FolderID`, `AddedDate`

### `storage.ShareAccessLog`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CR··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 0
- **Primary key:** `AccessLogID` (clustered, `PK__ShareAcc__9ABDB0FF23D81620`)
- **Repository:** ShareAccessLog

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `AccessLogID` 🔑 | bigint |  | ✔ |  |  |  |
| 2 | `ShareToken` | uniqueidentifier |  |  |  |  |  |
| 3 | `ExternalShareID` | int |  |  |  | `storage.ExternalShare.ExternalShareID` |  |
| 4 | `RecipientIdentifier` | nvarchar(255) | ✔ |  |  |  |  |
| 5 | `AccessType` | nvarchar(20) |  |  |  |  | View \| Download (CHECK) |
| 6 | `IsSuccessful` | bit |  |  |  |  |  |
| 7 | `FailureReason` | nvarchar(500) | ✔ |  |  |  |  |
| 8 | `FileSizeBytes` | bigint | ✔ |  |  |  |  |
| 9 | `AccessTimestamp` | datetime |  |  | (getutcdate()) |  |  |
| 10 | `IPAddress` | nvarchar(45) | ✔ |  |  |  |  |
| 11 | `UserAgent` | nvarchar(500) | ✔ |  |  |  |  |

**Index / Unique:** `CK_ShareAccessLog_Immutable` (UNIQUE AccessLogID)

**CHECK constraint:**
- `CK_ShareAccessLog_AccessType`: `([AccessType]='Download' OR [AccessType]='View')`

**Repository method ที่แตะตารางนี้**
- `C`: ShareAccessLog.Insert
- `R`: ShareAccessLog.GetByExternalShare

### `storage.ShareToken`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 4
- **Primary key:** `ShareTokenID` (clustered, `PK__ShareTok__472DB0665019EDDA`)
- **Repository:** ShareToken

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `ShareTokenID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `TokenValue` | uniqueidentifier |  |  |  |  |  |
| 3 | `ExternalShareID` | int |  |  |  | `storage.ExternalShare.ExternalShareID` |  |
| 4 | `Status` | nvarchar(20) |  |  | ('Pending') |  | Pending \| Active \| Disabled \| Expired \| Revoked (CHECK) |
| 5 | `CreatedDate` | datetime |  |  | (getutcdate()) |  |  |
| 6 | `ActivatedDate` | datetime | ✔ |  |  |  |  |
| 7 | `ExpiryDate` | datetime | ✔ |  |  |  |  |
| 8 | `DisabledDate` | datetime | ✔ |  |  |  |  |
| 9 | `DisabledByUserID` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 10 | `DisabledReason` | nvarchar(500) | ✔ |  |  |  |  |

**Index / Unique:** `UQ__ShareTok__FE1B80ECA0DD137E` (UNIQUE TokenValue)

**CHECK constraint:**
- `CK_ShareToken_Status`: `([Status]='Revoked' OR [Status]='Disabled' OR [Status]='Expired' OR [Status]='Active' OR [Status]='Pending')`

**Repository method ที่แตะตารางนี้**
- `C`: ShareToken.Insert
- `R`: ShareToken.GetByExternalShare
- `U`: ShareToken.Update

### `workflow.ApprovalRequest`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 40
- **Primary key:** `RequestID` (clustered, `PK_wf_ApprovalRequest`)
- **Repository:** Approval
- **Stored procedure:** `workflow.sp_GetApprovalRequestByID`, `workflow.sp_GetExpiredPendingRequests`, `workflow.sp_UpdateApprovalRequestStatus`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `RequestID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `RequestType` | varchar(50) |  |  |  |  | CREATE_HC \| UPLOAD_HC \| DELETE_FOLDER \| CHANGE_PERMISSION \| DOWNLOAD_FILE \| EXTERNAL_SHARE \| INTERNAL_SHARE \| SHARE_PERMISSION_CHANGE (CHECK) |
| 3 | `FolderID` | int | ✔ |  |  | `storage.Folder.FolderID` |  |
| 4 | `FileID` | int | ✔ |  |  | `storage.FileDocument.FileID` |  |
| 5 | `PermissionID` | int | ✔ |  |  | `security.FolderPermission.PermissionID` |  |
| 6 | `RequestedBy` | int |  |  |  | `EMS.UserAccount.UserID` |  |
| 7 | `RequestedDate` | datetime |  |  | (getdate()) |  |  |
| 8 | `RequestStatus` | tinyint |  |  | ((1)) |  | 1=Pending, 2=Approved, 3=Rejected, 4=Expired (โค้ดใช้ 4 แทน Withdrawn ด้วย), 5=DB อนุญาตแต่โค้ดไม่ใช้ |
| 9 | `Subject` | nvarchar(500) | ✔ |  |  |  |  |
| 10 | `Remark` | nvarchar(max) | ✔ |  |  |  |  |
| 11 | `ExpiryDate` | datetime | ✔ |  |  |  |  |
| 12 | `ResolvedBy` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 13 | `ResolvedDate` | datetime | ✔ |  |  |  |  |
| 14 | `ResolveRemark` | nvarchar(500) | ✔ |  |  |  |  |

**Index / Unique:** `IX_wf_Approval_Status` (RequestStatus,RequestedDate); `IX_wf_Approval_ReqBy` (RequestedBy,RequestStatus)

**CHECK constraint:**
- `CK_wf_ApprovalRequest_Status`: `([RequestStatus]=(5) OR [RequestStatus]=(4) OR [RequestStatus]=(3) OR [RequestStatus]=(2) OR [RequestStatus]=(1))`
- `CK_wf_ApprovalRequest_Type`: `([RequestType]='SHARE_PERMISSION_CHANGE' OR [RequestType]='INTERNAL_SHARE' OR [RequestType]='DOWNLOAD_FILE' OR [RequestType]='EXTERNAL_SHARE' OR [RequestType]='UPLOAD_HC' OR [RequestType]='CHANGE_PERMISSION' OR [RequestType]='DELETE_FOLDER' OR [RequestType]='CREATE_HC')`

**ถูกอ้างโดย (FK in):** `workflow.ApprovalStep` (RequestID)

**Repository method ที่แตะตารางนี้**
- `C`: Approval.InsertRequest
- `R`: Approval.GetRequest, Approval.GetAllRequestsByFolder, Approval.GetPendingRequests, Approval.GetExpiredPendingRequests, Approval.DeleteByFolder, Approval.GetApprovedDownloadRequest
- `U`: Approval.UpdateRequestStatus
- `D`: Approval.DeleteByFolder

### `workflow.ApprovalStep`

- **เจ้าของ module:** DMS
- **ใช้โดย:** DMS
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 222,519
- **Primary key:** `StepID` (clustered, `PK_wf_ApprovalStep`)
- **Repository:** Approval
- **Stored procedure:** `workflow.sp_GetAllApprovalSteps`, `workflow.sp_UpdateApprovalStepStatus`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `StepID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `RequestID` | int |  |  |  | `workflow.ApprovalRequest.RequestID` |  |
| 3 | `StepOrder` | int |  |  |  |  |  |
| 4 | `ApproverID` | int |  |  |  | `EMS.UserAccount.UserID` | FK → EMS.UserAccount แต่ ApprovalService.EscalateRequest ใส่เลข Role (3/4) — ดู OPEN_QUESTIONS |
| 5 | `StepStatus` | tinyint |  |  | ((1)) |  | 1=Pending, 2=Approved, 3=Rejected, 4=Delegated (ใช้เป็น auto-closed/escalated ด้วย) |
| 6 | `ActionDate` | datetime | ✔ |  |  |  |  |
| 7 | `ActionRemark` | nvarchar(500) | ✔ |  |  |  |  |
| 8 | `DelegatedTo` | int | ✔ |  |  | `EMS.UserAccount.UserID` |  |
| 9 | `NotifiedDate` | datetime | ✔ |  |  |  |  |
| 10 | `EscalatedDate` | datetime | ✔ |  |  |  |  |

**Index / Unique:** `UQ_wf_ApprovalStep_Order` (UNIQUE RequestID,StepOrder); `IX_wf_Step_Request` (RequestID,StepOrder); `IX_wf_Step_Approver` (ApproverID,StepStatus)

**CHECK constraint:**
- `CK_wf_ApprovalStep_Status`: `([StepStatus]=(4) OR [StepStatus]=(3) OR [StepStatus]=(2) OR [StepStatus]=(1))`

**Repository method ที่แตะตารางนี้**
- `C`: Approval.InsertStep
- `R`: Approval.GetPendingSteps, Approval.GetAllSteps
- `U`: Approval.UpdateStepStatus
- `D`: Approval.DeleteByFolder

