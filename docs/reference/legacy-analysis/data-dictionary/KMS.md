# Data Dictionary — KMS — Knowledge Management

> สร้างจากผล export DDL จริง (`db-export/CMS_DB_1.x`, `BUI_RG_1.x`) รวมกับการวิเคราะห์โค้ดที่ใช้งานจริง · 🔑 = คอลัมน์ใน PK · Null ✔ = ยอมให้ NULL
> ชนิดข้อมูลสำหรับ Node/TypeORM ดู `README.md` หัวข้อ "Type mapping"

| ตาราง | แถว | CRUD | ใช้โดย |
|---|--:|:-:|---|
| [`KMS.m_KBArticleDisplayProfile`](#kmsm_kbarticledisplayprofile) | 5 | `CRUd` | KMS |
| [`KMS.m_KBArticleDisplayProfileColumn`](#kmsm_kbarticledisplayprofilecolumn) | 35 | `CR·D` | KMS |
| [`KMS.m_KBCategory`](#kmsm_kbcategory) | 94 | `CRUd` | KMS, RGP |
| [`KMS.m_KBImportTemplate`](#kmsm_kbimporttemplate) | 4 | `CRUd` | KMS |
| [`KMS.m_KBImportTemplateColumn`](#kmsm_kbimporttemplatecolumn) | 40 | `CR·D` | KMS |
| [`KMS.t_KBArticle`](#kmst_kbarticle) | 19,080 | `CRUd` | KMS |
| [`KMS.t_KBArticleAttachment`](#kmst_kbarticleattachment) | 17,804 | `CR·D` | KMS |
| [`KMS.t_KBArticleLink`](#kmst_kbarticlelink) | 24,616 | `CR·D` | KMS |
| [`KMS.t_KBVersion`](#kmst_kbversion) | 18,240 | `CR··` | KMS |

### `KMS.m_KBArticleDisplayProfile`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 5
- **Primary key:** `ProfileID` (clustered, `PK__m_KBArti__290C88840FA6AE98`)
- **Repository:** KBArticleDisplayProfile

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `ProfileID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ProfileName` | nvarchar(200) |  |  |  |  |  |
| 3 | `Description` | nvarchar(500) | ✔ |  |  |  |  |
| 4 | `IsActive` | bit |  |  | ((1)) |  |  |
| 5 | `CreatedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 6 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |

**Index / Unique:** `UQ_KMS_ArtDispProfile_Name` (UNIQUE ProfileName)

**ถูกอ้างโดย (FK in):** `KMS.m_KBArticleDisplayProfileColumn` (ProfileID), `KMS.m_KBCategory` (DisplayProfileID)

**Repository method ที่แตะตารางนี้**
- `C`: KBArticleDisplayProfile.SaveProfileWithColumns
- `R`: KBArticleDisplayProfile.GetAll, KBArticleDisplayProfile.GetById, KBArticleDisplayProfile.ExistsByName
- `U`: KBArticleDisplayProfile.SaveProfileWithColumns, KBArticleDisplayProfile.Activate
- `d`: KBArticleDisplayProfile.Deactivate

### `KMS.m_KBArticleDisplayProfileColumn`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 35
- **Primary key:** `ProfileColumnID` (clustered, `PK__m_KBArti__C7BA9453C85729FB`)
- **Repository:** KBArticleDisplayProfile

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `ProfileColumnID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ProfileID` | int |  |  |  | `KMS.m_KBArticleDisplayProfile.ProfileID` |  |
| 3 | `SlotKey` | nvarchar(50) |  |  |  |  |  |
| 4 | `DisplayLabel` | nvarchar(200) |  |  |  |  |  |
| 5 | `IsVisible` | bit |  |  | ((1)) |  |  |
| 6 | `SlotDescription` | nvarchar(500) | ✔ |  |  |  |  |

**Index / Unique:** `UQ_KMS_ArtDispProfCol_Slot` (UNIQUE ProfileID,SlotKey)

**Repository method ที่แตะตารางนี้**
- `C`: KBArticleDisplayProfile.SaveProfileWithColumns
- `R`: KBArticleDisplayProfile.GetColumnsByProfileId
- `D`: KBArticleDisplayProfile.SaveProfileWithColumns

### `KMS.m_KBCategory`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS, RGP
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 94
- **Primary key:** `CategoryID` (clustered, `PK_KMS_KBCategory`)
- **Repository:** KBArticle, KBCategory, Kms
- **Connection:** `CmsLinkDbConnectionString`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `CategoryID` 🔑 | int |  |  |  |  |  |
| 2 | `ParentCategoryID` | int | ✔ |  |  | `KMS.m_KBCategory.CategoryID` |  |
| 3 | `CategoryCode` | varchar(20) |  |  |  |  |  |
| 4 | `CategoryName` | nvarchar(300) |  |  |  |  |  |
| 5 | `Icon` | varchar(50) | ✔ |  |  |  |  |
| 6 | `Description` | nvarchar(300) | ✔ |  |  |  |  |
| 7 | `SortOrder` | int |  |  | ((0)) |  |  |
| 8 | `IsActive` | bit |  |  | ((1)) |  |  |
| 9 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 10 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 11 | `DisplayProfileID` | int | ✔ |  |  | `KMS.m_KBArticleDisplayProfile.ProfileID` |  |
| 12 | `ImportTypeDigit` | char(1) | ✔ |  |  |  | NULL หรือ '1'–'9' และ unique — ตัวเลขตำแหน่งที่ 25 ของ Code รวมตอน import NonLaw |

**Index / Unique:** `UQ_KMS_KBCat_Code` (UNIQUE CategoryCode); `UX_KMS_KBCat_ImportTypeDigit` (UNIQUE ImportTypeDigit)

**CHECK constraint:**
- `CK_KMS_KBCat_ImportTypeDigit`: `([ImportTypeDigit] IS NULL OR [ImportTypeDigit] like '[1-9]')`

**ถูกอ้างโดย (FK in):** `KMS.m_KBCategory` (ParentCategoryID)

**Repository method ที่แตะตารางนี้**
- `C`: KBCategory.Insert
- `R`: KBCategory.GetAll, KBCategory.GetAllActive, KBCategory.GetById, KBCategory.Insert, KBArticle.GetAll, KBArticle.GetByCategory, KBArticle.Search, KBArticle.GetById, KBArticle.GetMoveCandidates, KBArticle.GetMoveCandidatesByIds, Kms.GetLawTypes, Kms.GetCategoriesByParent
- `U`: KBCategory.Update
- `d`: KBCategory.SoftDelete

### `KMS.m_KBImportTemplate`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 4
- **Primary key:** `TemplateID` (clustered, `PK_KMS_ImpTpl`)
- **Repository:** KBImportTemplate

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `TemplateID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `TemplateName` | nvarchar(200) |  |  |  |  |  |
| 3 | `Description` | nvarchar(500) | ✔ |  |  |  |  |
| 4 | `SortOrder` | int |  |  | ((0)) |  |  |
| 5 | `IsActive` | bit |  |  | ((1)) |  |  |
| 6 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 7 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 8 | `UpdatedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 9 | `UpdatedDate` | datetime | ✔ |  |  |  |  |

**Index / Unique:** `UQ_KMS_ImpTpl_Name` (UNIQUE TemplateName)

**ถูกอ้างโดย (FK in):** `KMS.m_KBImportTemplateColumn` (TemplateID)

**Repository method ที่แตะตารางนี้**
- `C`: KBImportTemplate.SaveTemplateWithMappings
- `R`: KBImportTemplate.GetAll, KBImportTemplate.GetById, KBImportTemplate.ExistsByName
- `U`: KBImportTemplate.SaveTemplateWithMappings, KBImportTemplate.Activate
- `d`: KBImportTemplate.Deactivate

### `KMS.m_KBImportTemplateColumn`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 40
- **Primary key:** `TemplateColumnID` (clustered, `PK_KMS_ImpTplCol`)
- **Repository:** KBImportTemplate

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `TemplateColumnID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `TemplateID` | int |  |  |  | `KMS.m_KBImportTemplate.TemplateID` |  |
| 3 | `TargetColumnName` | nvarchar(128) |  |  |  |  |  |
| 4 | `ExcelColumnRef` | nvarchar(200) | ✔ |  |  |  |  |
| 5 | `DisplayOrder` | int |  |  | ((0)) |  |  |

**Index / Unique:** `UQ_KMS_ImpTplCol_Target` (UNIQUE TemplateID,TargetColumnName); `IX_KMS_ImpTplCol_Tpl` (TemplateID,DisplayOrder)

**Repository method ที่แตะตารางนี้**
- `C`: KBImportTemplate.SaveTemplateWithMappings
- `R`: KBImportTemplate.GetMappingsByTemplateId
- `D`: KBImportTemplate.SaveTemplateWithMappings

### `KMS.t_KBArticle`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 19,080
- **Primary key:** `ArticleID` (clustered, `PK_KMS_KBArticle`)
- **Repository:** KBArticle

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `ArticleID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ArticleCode` | varchar(50) |  |  |  |  |  |
| 3 | `Title` | nvarchar(500) |  |  |  |  |  |
| 4 | `TitleCategory` | nvarchar(500) | ✔ |  |  |  |  |
| 5 | `ContentHTML` | nvarchar(max) |  |  |  |  |  |
| 6 | `Summary` | nvarchar(max) | ✔ |  |  |  |  |
| 7 | `CategoryID` | int |  |  |  |  |  |
| 8 | `ArticleType` | tinyint |  |  |  |  | 1=ขั้นตอนงาน, 2=FAQ, 3=แนวทางปฏิบัติ, 4=แม่แบบ, 5=กฎ/นโยบาย (CHECK) |
| 9 | `Status` | tinyint |  |  | ((1)) |  | 1=Draft, 2=Review, 3=Published, 4=Archived (CHECK) |
| 10 | `ConfidentialityLevel` | tinyint |  |  |  |  | 1=HC, 2=SC, 3=NC, 4=PC |
| 11 | `CurrentVersion` | int |  |  | ((1)) |  |  |
| 12 | `EffectiveDate` | datetime | ✔ |  |  |  |  |
| 13 | `PublishedDate` | datetime | ✔ |  |  |  |  |
| 14 | `ExpiryDate` | datetime | ✔ |  |  |  |  |
| 15 | `ReviewDueDate` | datetime | ✔ |  |  |  |  |
| 16 | `ViewCount` | int |  |  | ((0)) |  |  |
| 17 | `LikeCount` | int |  |  | ((0)) |  |  |
| 18 | `IsOfficialPolicy` | bit |  |  | ((0)) |  |  |
| 19 | `Tags` | nvarchar(500) | ✔ |  |  |  |  |
| 20 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 21 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |
| 22 | `ReviewedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 23 | `ReviewedDate` | datetime | ✔ |  |  |  |  |
| 24 | `UpdatedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 25 | `UpdatedDate` | datetime | ✔ |  |  |  |  |
| 26 | `IsDelete` | bit |  |  | ((0)) |  |  |

**Index / Unique:** `UQ_KMS_Art_Code` (UNIQUE ArticleCode)

**CHECK constraint:**
- `CK_KMS_Art_Status`: `([Status]=(4) OR [Status]=(3) OR [Status]=(2) OR [Status]=(1))`
- `CK_KMS_Art_Type`: `([ArticleType]=(5) OR [ArticleType]=(4) OR [ArticleType]=(3) OR [ArticleType]=(2) OR [ArticleType]=(1))`

**ถูกอ้างโดย (FK in):** `KMS.t_KBArticleAttachment` (ArticleID), `KMS.t_KBArticleLink` (ArticleID), `KMS.t_KBVersion` (ArticleID)

**Repository method ที่แตะตารางนี้**
- `C`: KBArticle.Insert, KBArticle.InsertWithVersion
- `R`: KBArticle.GetAll, KBArticle.GetByCategory, KBArticle.Search, KBArticle.GetById, KBArticle.GetNextCodeSequence, KBArticle.GetImportableTargetColumns, KBArticle.ExistsByCode, KBArticle.GetByCode, KBArticle.GetMoveCandidates, KBArticle.GetMoveCandidatesByIds, KBArticle.MoveToCategory
- `U`: KBArticle.Update, KBArticle.UpdateFromImport, KBArticle.UpdateStatus, KBArticle.IncrementViewCount, KBArticle.IncrementLikeCount, KBArticle.MoveToCategory, KBArticle.UpdateExpiryDate
- `d`: KBArticle.SoftDelete

### `KMS.t_KBArticleAttachment`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 17,804
- **Primary key:** `AttachmentID` (clustered, `PK__t_KBArti__442C64DEF55B5ED0`)
- **Repository:** KBArticleAttachment

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `AttachmentID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ArticleID` | int |  |  |  | `KMS.t_KBArticle.ArticleID` |  |
| 3 | `FileID` | int |  |  |  | `storage.FileDocument.FileID` |  |
| 4 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 5 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |

**Index / Unique:** `IX_KBArticleAttachment_ArticleID` (ArticleID)

**Repository method ที่แตะตารางนี้**
- `C`: KBArticleAttachment.Insert
- `R`: KBArticleAttachment.GetAttachmentsForArticle
- `D`: KBArticleAttachment.Delete, KBArticleAttachment.DeleteAllForArticle, KBArticleAttachment.DeleteByArticleAndFile

### `KMS.t_KBArticleLink`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 24,616
- **Primary key:** `LinkID` (clustered, `PK_KMS_ArtLink`)
- **Repository:** KBArticle, KBArticleLink

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `LinkID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ArticleID` | int |  |  |  | `KMS.t_KBArticle.ArticleID` |  |
| 3 | `EntityType` | tinyint |  |  |  |  | 1=Folder, 2=Task, 3=Program, 4=Law, 5=Project, 6=Department (CHECK) |
| 4 | `EntityID` | nvarchar(50) |  |  |  |  |  |
| 5 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 6 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |

**Index / Unique:** `UQ_KMS_ArtLink_Unique` (UNIQUE ArticleID,EntityType,EntityID)

**CHECK constraint:**
- `CK_KMS_ArtLink_EType`: `([EntityType]=(6) OR [EntityType]=(5) OR [EntityType]=(4) OR [EntityType]=(3) OR [EntityType]=(2) OR [EntityType]=(1))`

**Repository method ที่แตะตารางนี้**
- `C`: KBArticleLink.Insert
- `R`: KBArticle.GetAll, KBArticle.GetByCategory, KBArticle.Search, KBArticleLink.GetLinksForArticle, KBArticleLink.GetAllByEntityType, KBArticleLink.Exists
- `D`: KBArticleLink.Delete, KBArticleLink.DeleteAllForArticle

### `KMS.t_KBVersion`

- **เจ้าของ module:** KMS
- **ใช้โดย:** KMS
- **การกระทำที่ใช้จริง:** `CR··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 18,240
- **Primary key:** `VersionID` (clustered, `PK_KMS_KBVersion`)
- **Repository:** KBArticle, KBVersion

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `VersionID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `ArticleID` | int |  |  |  | `KMS.t_KBArticle.ArticleID` |  |
| 3 | `VersionNumber` | int |  |  |  |  |  |
| 4 | `ContentSnapshot` | nvarchar(max) |  |  |  |  |  |
| 5 | `ChangeDescription` | nvarchar(max) | ✔ |  |  |  |  |
| 6 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 7 | `CreatedDate` | datetime |  |  | (getdate()) |  |  |

**Index / Unique:** `UQ_KMS_KBVer_Unique` (UNIQUE ArticleID,VersionNumber)

**Repository method ที่แตะตารางนี้**
- `C`: KBArticle.InsertWithVersion, KBArticle.Update, KBArticle.UpdateFromImport, KBVersion.Insert
- `R`: KBArticle.Update, KBArticle.UpdateFromImport, KBVersion.GetByArticle, KBVersion.GetLatestByArticle

