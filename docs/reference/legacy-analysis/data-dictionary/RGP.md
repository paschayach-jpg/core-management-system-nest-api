# Data Dictionary — RGP — Project

> สร้างจากผล export DDL จริง (`db-export/CMS_DB_1.x`, `BUI_RG_1.x`) รวมกับการวิเคราะห์โค้ดที่ใช้งานจริง · 🔑 = คอลัมน์ใน PK · Null ✔ = ยอมให้ NULL
> ชนิดข้อมูลสำหรับ Node/TypeORM ดู `README.md` หัวข้อ "Type mapping"

| ตาราง | แถว | CRUD | ใช้โดย |
|---|--:|:-:|---|
| [`BUI_RG.dbo.m_document`](#bui_rgdbom_document) | 132 | `·R··` | RGP |
| [`BUI_RG.dbo.m_document_type`](#bui_rgdbom_document_type) | 6 | `·R··` | RGP |
| [`EMS.m_Employee`](#emsm_employee) | 225 | `·R··` | RGP |
| [`RGP.m_project_member_role`](#rgpm_project_member_role) | 19 | `CRUD` | RGP |
| [`RGP.m_project_template`](#rgpm_project_template) | 7 | `CRUD` | RGP |
| [`RGP.m_template_doc`](#rgpm_template_doc) | 10 | `CRUD` | RGP |
| [`RGP.m_template_state`](#rgpm_template_state) | 42 | `CRUD` | RGP |
| [`RGP.t_project`](#rgpt_project) | 29 | `CRU·` | RGP |
| [`RGP.t_project_audit_log`](#rgpt_project_audit_log) | 111 | `C···` | RGP |
| [`RGP.t_project_doc_workflow`](#rgpt_project_doc_workflow) | 52 | `CRUD` | RGP |
| [`RGP.t_project_member`](#rgpt_project_member) | 62 | `CR·D` | RGP |
| [`RGP.t_project_notify_log`](#rgpt_project_notify_log) | 10 | `CR··` | RGP |
| [`RGP.t_project_progress`](#rgpt_project_progress) | 218 | `CR··` | RGP |
| [`RGP.t_project_state`](#rgpt_project_state) | 183 | `CRUD` | RGP |
| [`RGP.t_project_state_member`](#rgpt_project_state_member) | 39 | `CR·D` | RGP |
| [`RGP.t_project_task`](#rgpt_project_task) | 33 | `CRU·` | RGP |
| [`RGP.t_project_task_comment`](#rgpt_project_task_comment) | 21 | `CRU·` | RGP |
| [`RGP.t_project_task_status_log`](#rgpt_project_task_status_log) | 8 | `C···` | RGP |
| [`RunningNumber`](#runningnumber) | 22 | `CRU·` | RGP |
| [`storage.t_project_attachment`](#storaget_project_attachment) | 7 | `CR·D` | RGP |

### `BUI_RG.dbo.m_document`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `·R··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 132
- **Primary key:** `doc_id` (clustered, `PK_m_document`)
- **Repository:** TemplateDoc

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `doc_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `doc_code` | varchar(50) | ✔ |  |  |  |  |
| 3 | `doc_name` | varchar(255) | ✔ |  |  |  |  |
| 4 | `doc_type_id` | int | ✔ |  |  |  |  |
| 5 | `active` | int | ✔ |  |  |  |  |
| 6 | `create_date` | datetime | ✔ |  |  |  |  |
| 7 | `create_by` | varchar(50) | ✔ |  |  |  |  |
| 8 | `update_date` | datetime | ✔ |  |  |  |  |
| 9 | `update_by` | varchar(50) | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `R`: TemplateDoc.GetMasterDocuments

### `BUI_RG.dbo.m_document_type`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `·R··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 6
- **Primary key:** `doc_type_id` (clustered, `PK_m_document_type`)
- **Repository:** TemplateDoc

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `doc_type_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `doc_type_name` | varchar(255) | ✔ |  |  |  |  |
| 3 | `active` | int | ✔ |  |  |  |  |
| 4 | `create_date` | datetime | ✔ |  |  |  |  |
| 5 | `create_by` | varchar(50) | ✔ |  |  |  |  |
| 6 | `update_date` | datetime | ✔ |  |  |  |  |
| 7 | `update_by` | varchar(50) | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `R`: TemplateDoc.GetDocumentTypes

### `EMS.m_Employee`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `·R··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 225
- **Primary key:** `EmployeeID` (clustered, `PK_mEmployee`)
- **Repository:** Employee

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `EmployeeID` 🔑 | int |  | ✔ |  |  |  |
| 2 | `EmployeeCode` | nvarchar(20) |  |  |  |  |  |
| 3 | `HRSystemCode` | nvarchar(20) | ✔ |  |  |  |  |
| 4 | `ADUserName` | nvarchar(100) | ✔ |  |  |  |  |
| 5 | `TitleTH` | nvarchar(20) | ✔ |  |  |  |  |
| 6 | `TitleEN` | nvarchar(10) | ✔ |  |  |  |  |
| 7 | `FirstNameTH` | nvarchar(100) |  |  |  |  |  |
| 8 | `LastNameTH` | nvarchar(100) |  |  |  |  |  |
| 9 | `FirstNameEN` | nvarchar(100) | ✔ |  |  |  |  |
| 10 | `LastNameEN` | nvarchar(100) | ✔ |  |  |  |  |
| 11 | `FullNameTH` | nvarchar(200) |  |  |  |  |  |
| 12 | `FullNameEN` | nvarchar(200) | ✔ |  |  |  |  |
| 13 | `DepartmentID` | smallint |  |  |  | `EMS.m_Department.DepartmentID` |  |
| 14 | `PositionID` | smallint | ✔ |  |  | `EMS.m_Role.PositionID` |  |
| 15 | `LevelCode` | nvarchar(4) | ✔ |  |  | `EMS.m_Position.LevelCode` |  |
| 16 | `ReportingManagerID` | int | ✔ |  |  | `EMS.m_Employee.EmployeeID` |  |
| 17 | `EmploymentType` | tinyint |  |  | ((1)) |  | CHECK 1–4 (ความหมายไม่อยู่ในโค้ด — ขอจากเจ้าของข้อมูล) |
| 18 | `EmploymentStatus` | tinyint |  |  | ((1)) |  | CHECK 1–5 (ความหมายไม่อยู่ในโค้ด) |
| 19 | `JoinDate` | date |  |  |  |  |  |
| 20 | `ResignDate` | date | ✔ |  |  |  |  |
| 21 | `WorkLocation` | nvarchar(200) | ✔ |  |  |  |  |
| 22 | `WorkEmail` | nvarchar(200) | ✔ |  |  |  |  |
| 23 | `PersonalEmail` | nvarchar(200) | ✔ |  |  |  |  |
| 24 | `MobilePhone` | nvarchar(50) | ✔ |  |  |  |  |
| 25 | `HomeAddress` | nvarchar(500) | ✔ |  |  |  |  |
| 26 | `NationalID` | nvarchar(20) | ✔ |  |  |  |  |
| 27 | `EmergencyContactName` | nvarchar(200) | ✔ |  |  |  |  |
| 28 | `EmergencyContactPhone` | nvarchar(50) | ✔ |  |  |  |  |
| 29 | `PhotoPath` | nvarchar(500) | ✔ |  |  |  |  |
| 30 | `IsActive` | bit |  |  | ((1)) |  |  |
| 31 | `IsAnonymized` | bit |  |  | ((0)) |  |  |
| 32 | `CreatedBy` | nvarchar(100) |  |  |  |  |  |
| 33 | `CreatedDate` | datetime2(7) |  |  | (getdate()) |  |  |
| 34 | `UpdatedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 35 | `UpdatedDate` | datetime2(7) | ✔ |  |  |  |  |
| 36 | `RowVersion` | timestamp |  |  |  |  |  |
| 37 | `PDPAConsentTypeID` | tinyint | ✔ |  |  | `EMS.m_PDPAConsentType.ConsentTypeID` |  |
| 38 | `AnonymizeReason` | nvarchar(500) | ✔ |  |  |  |  |
| 39 | `PhotoData` | varbinary(max) | ✔ |  |  |  |  |
| 40 | `PhotoContentType` | nvarchar(50) | ✔ |  |  |  |  |

**Index / Unique:** `UQ_mEmployee_ADUser` (UNIQUE ADUserName); `UQ_mEmployee_Code` (UNIQUE EmployeeCode); `IX_mEmp_ADUserName` (ADUserName); `IX_mEmp_Department` (DepartmentID,IsActive); `IX_mEmp_FullNameTH` (FullNameTH,IsActive); `IX_mEmp_HRSystemCode` (HRSystemCode)

**CHECK constraint:**
- `CK_mEmployee_Type`: `([EmploymentType]=(4) OR [EmploymentType]=(3) OR [EmploymentType]=(2) OR [EmploymentType]=(1))`
- `CK_mEmployee_Resign`: `([ResignDate] IS NULL OR [ResignDate]>=[JoinDate])`
- `CK_mEmployee_Status`: `([EmploymentStatus]=(5) OR [EmploymentStatus]=(4) OR [EmploymentStatus]=(3) OR [EmploymentStatus]=(2) OR [EmploymentStatus]=(1))`

**ถูกอ้างโดย (FK in):** `EMS.m_Employee` (ReportingManagerID)

**Repository method ที่แตะตารางนี้**
- `R`: Employee.GetActiveADUsers

### `RGP.m_project_member_role`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 19
- **Primary key:** `i_role_id` (clustered, `PK_RGP_m_project_member_role`)
- **Repository:** ProjectMemberRole

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_role_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `n_role_name` | nvarchar(100) |  |  |  |  |  |
| 3 | `f_active` | char(1) |  |  | ('Y') |  |  |
| 4 | `i_create_user` | nvarchar(100) | ✔ |  |  |  |  |
| 5 | `d_create_date` | datetime | ✔ |  | (getdate()) |  |  |
| 6 | `i_update_user` | nvarchar(100) | ✔ |  |  |  |  |
| 7 | `d_update_date` | datetime | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectMemberRole.Insert
- `R`: ProjectMemberRole.GetAll, ProjectMemberRole.GetActive
- `U`: ProjectMemberRole.Update
- `D`: ProjectMemberRole.Delete

### `RGP.m_project_template`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 7
- **Primary key:** `i_template_id` (clustered, `PK_RGP_m_project_template`)
- **Repository:** Project, ProjectTemplate, TemplateDoc

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_template_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `c_template_code` | varchar(20) |  |  |  |  |  |
| 3 | `n_template_name` | nvarchar(200) |  |  |  |  |  |
| 4 | `c_description` | nvarchar(500) | ✔ |  |  |  |  |
| 5 | `f_active` | char(1) |  |  | ('Y') |  |  |
| 6 | `i_create_user` | varchar(20) |  |  |  |  |  |
| 7 | `d_create_date` | datetime |  |  | (getdate()) |  |  |
| 8 | `i_update_user` | varchar(20) | ✔ |  |  |  |  |
| 9 | `d_update_date` | datetime | ✔ |  |  |  |  |
| 10 | `f_is_legal_dict` | char(1) |  |  | ('N') |  |  |

**ถูกอ้างโดย (FK in):** `RGP.m_template_doc` (i_template_id), `RGP.m_template_state` (i_template_id), `RGP.t_project` (i_template_id)

**Repository method ที่แตะตารางนี้**
- `C`: ProjectTemplate.Insert
- `R`: Project.SearchProjects, Project.GetProjectById, ProjectTemplate.GetActiveTemplates, ProjectTemplate.GetAll, ProjectTemplate.IsLegalDict, ProjectTemplate.GetAllActive, ProjectTemplate.IsCodeDuplicate, TemplateDoc.GetDocsByState
- `U`: ProjectTemplate.Update
- `D`: ProjectTemplate.Delete

### `RGP.m_template_doc`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 10
- **Primary key:** `i_template_doc_id` (clustered, `PK_RGP_m_template_doc`)
- **Repository:** ProjectTemplate, TemplateDoc

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_template_doc_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_template_id` | int |  |  |  | `RGP.m_project_template.i_template_id` |  |
| 3 | `i_state_id` | int |  |  |  | `RGP.m_template_state.i_state_id` |  |
| 4 | `i_doc_id` | int |  |  |  |  |  |
| 5 | `n_doc_name` | nvarchar(300) |  |  |  |  |  |
| 6 | `c_doc_type` | varchar(50) | ✔ |  |  |  |  |
| 7 | `f_required` | char(1) |  |  | ('Y') |  |  |
| 8 | `i_seq_no` | int |  |  | ((1)) |  |  |
| 9 | `n_remark` | nvarchar(500) | ✔ |  |  |  |  |
| 10 | `i_create_user` | varchar(20) | ✔ |  |  |  |  |
| 11 | `d_create_date` | datetime |  |  | (getdate()) |  |  |
| 12 | `i_update_user` | varchar(20) | ✔ |  |  |  |  |
| 13 | `d_update_date` | datetime | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: TemplateDoc.InsertTemplateDoc
- `R`: ProjectTemplate.GetStates, ProjectTemplate.DeleteState, TemplateDoc.GetDocsByState, TemplateDoc.GetDocsByTemplate, TemplateDoc.IsDuplicate, TemplateDoc.GetNextSeqNo
- `U`: TemplateDoc.UpdateTemplateDoc
- `D`: ProjectTemplate.CopyStatesFrom, ProjectTemplate.Delete, TemplateDoc.DeleteTemplateDoc

### `RGP.m_template_state`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 42
- **Primary key:** `i_state_id` (clustered, `PK_RGP_m_template_state`)
- **Repository:** ProjectState, ProjectTemplate, TemplateDoc

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_state_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_template_id` | int |  |  |  | `RGP.m_project_template.i_template_id` |  |
| 3 | `n_state_name` | nvarchar(200) |  |  |  |  |  |
| 4 | `i_seq_no` | int |  |  |  |  |  |
| 5 | `c_description` | nvarchar(500) | ✔ |  |  |  |  |
| 6 | `f_required` | char(1) |  |  | ('Y') |  |  |
| 7 | `i_create_user` | varchar(20) |  |  |  |  |  |
| 8 | `d_create_date` | datetime |  |  | (getdate()) |  |  |

**ถูกอ้างโดย (FK in):** `RGP.m_template_doc` (i_state_id), `RGP.t_project_state` (i_state_id)

**Repository method ที่แตะตารางนี้**
- `C`: ProjectTemplate.CopyStatesFrom, ProjectTemplate.InsertState
- `R`: ProjectState.GetTemplateStates, ProjectTemplate.GetAll, ProjectTemplate.CopyStatesFrom, ProjectTemplate.GetStates, ProjectTemplate.GetNextStateSeqNo, TemplateDoc.GetDocsByState, TemplateDoc.GetDocsByTemplate
- `U`: ProjectTemplate.UpdateState
- `D`: ProjectTemplate.CopyStatesFrom, ProjectTemplate.Delete, ProjectTemplate.DeleteState

### `RGP.t_project`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 29
- **Primary key:** `i_project_id` (clustered, `PK_RGP_t_project`)
- **Repository:** Project, ProjectProgress, ProjectState, ProjectTemplate

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_project_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `c_project_no` | varchar(20) |  |  |  |  |  |
| 3 | `n_project_name` | nvarchar(300) |  |  |  |  |  |
| 4 | `i_template_id` | int | ✔ |  |  | `RGP.m_project_template.i_template_id` |  |
| 5 | `c_status` | varchar(20) |  |  | ('Open') |  | Open \| InProgress \| Completed (พบในโค้ด; ปิดโครงการด้วย CloseProject) |
| 6 | `c_description` | nvarchar(1000) | ✔ |  |  |  |  |
| 7 | `d_start_date` | date | ✔ |  |  |  |  |
| 8 | `d_due_date` | date | ✔ |  |  |  |  |
| 9 | `d_close_date` | datetime | ✔ |  |  |  |  |
| 10 | `f_active` | char(1) |  |  | ('Y') |  |  |
| 11 | `i_create_user` | varchar(20) |  |  |  |  |  |
| 12 | `d_create_date` | datetime |  |  | (getdate()) |  |  |
| 13 | `i_update_user` | varchar(20) | ✔ |  |  |  |  |
| 14 | `d_update_date` | datetime | ✔ |  |  |  |  |
| 15 | `n_project_owner` | nvarchar(200) | ✔ |  |  |  |  |
| 16 | `n_project_developer` | nvarchar(200) | ✔ |  |  |  |  |
| 17 | `n_legal_dict_json` | nvarchar(max) | ✔ |  |  |  |  |

**ถูกอ้างโดย (FK in):** `RGP.t_project_doc_workflow` (i_project_id), `RGP.t_project_member` (i_project_id), `RGP.t_project_notify_log` (i_project_id), `RGP.t_project_progress` (i_project_id), `RGP.t_project_state` (i_project_id), `RGP.t_project_state` (i_ref_project_id), `RGP.t_project_task` (i_project_id)

**Repository method ที่แตะตารางนี้**
- `C`: Project.InsertProject
- `R`: Project.SearchProjects, Project.GetProjectById, Project.IsProjectNoExists, ProjectState.GetStatesByProject, ProjectState.GetActiveProjectsForRef, ProjectProgress.GetLatestProgressByProject, ProjectTemplate.GetAll, ProjectTemplate.Delete
- `U`: Project.UpdateProject, Project.UpdateLegalDictJson, Project.DeleteProject, Project.UpdateProjectStatus

### `RGP.t_project_audit_log`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `C···` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 111
- **Primary key:** `i_audit_id` (clustered, `PK_RGP_t_project_audit_log`)
- **Repository:** ProjectAudit

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_audit_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_user_id` | nvarchar(100) |  |  |  |  |  |
| 3 | `n_module` | nvarchar(100) |  |  |  |  |  |
| 4 | `n_action` | nvarchar(100) |  |  |  |  |  |
| 5 | `n_table_name` | nvarchar(200) | ✔ |  |  |  |  |
| 6 | `i_record_id` | int | ✔ |  |  |  |  |
| 7 | `i_result` | tinyint |  |  |  |  |  |
| 8 | `n_message` | nvarchar(500) | ✔ |  |  |  |  |
| 9 | `n_machine_name` | nvarchar(200) | ✔ |  |  |  |  |
| 10 | `d_action_date` | datetime |  |  | (getdate()) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectAudit.Insert

### `RGP.t_project_doc_workflow`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 52
- **Primary key:** `i_doc_wf_id` (clustered, `PK_RGP_t_project_doc_workflow`)
- **Repository:** ProjectDocument

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_doc_wf_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_proj_state_id` | int |  |  |  | `RGP.t_project_state.i_proj_state_id` |  |
| 3 | `i_project_id` | int |  |  |  | `RGP.t_project.i_project_id` |  |
| 4 | `n_doc_name` | nvarchar(300) |  |  |  |  |  |
| 5 | `c_doc_type` | varchar(50) | ✔ |  |  |  |  |
| 6 | `f_required` | char(1) |  |  | ('Y') |  |  |
| 7 | `c_doc_status` | varchar(20) |  |  | ('Pending') |  |  |
| 8 | `n_remark` | nvarchar(500) | ✔ |  |  |  |  |
| 9 | `i_seq_no` | int |  |  | ((1)) |  |  |
| 10 | `i_create_user` | varchar(20) |  |  |  |  |  |
| 11 | `d_create_date` | datetime |  |  | (getdate()) |  |  |
| 12 | `i_update_user` | varchar(20) | ✔ |  |  |  |  |
| 13 | `d_update_date` | datetime | ✔ |  |  |  |  |
| 14 | `i_doc_id` | int | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectDocument.InsertDocWorkflow
- `R`: ProjectDocument.GetDocsByState, ProjectDocument.GetDocsByProject, ProjectDocument.GetNextSeqNo
- `U`: ProjectDocument.UpdateDocWorkflow, ProjectDocument.UpdateDocStatus
- `D`: ProjectDocument.DeleteDocWorkflow

### `RGP.t_project_member`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 62
- **Primary key:** `i_member_id` (clustered, `PK_RGP_t_project_member`)
- **Repository:** ProjectMember

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_member_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_project_id` | int |  |  |  | `RGP.t_project.i_project_id` |  |
| 3 | `n_member_name` | nvarchar(200) |  |  |  |  |  |
| 4 | `c_role` | nvarchar(100) |  |  |  |  |  |
| 5 | `i_create_user` | nvarchar(100) | ✔ |  |  |  |  |
| 6 | `d_create_date` | datetime | ✔ |  | (getdate()) |  |  |
| 7 | `i_update_user` | nvarchar(100) | ✔ |  |  |  |  |
| 8 | `d_update_date` | datetime | ✔ |  | (getdate()) |  |  |
| 9 | `department_code` | nvarchar(10) | ✔ |  |  |  |  |
| 10 | `c_member_type` | nvarchar(20) | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectMember.Insert
- `R`: ProjectMember.GetByProject
- `D`: ProjectMember.Delete

### `RGP.t_project_notify_log`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CR··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 10
- **Primary key:** `i_notify_id` (clustered, `PK_RGP_t_project_notify_log`)
- **Repository:** ProjectNotifyLog, ProjectStateMember

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_notify_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_project_id` | int |  |  |  | `RGP.t_project.i_project_id` |  |
| 3 | `i_proj_state_id` | int |  |  |  | `RGP.t_project_state.i_proj_state_id` |  |
| 4 | `i_state_member_id` | int |  |  |  | `RGP.t_project_state_member.i_state_member_id` |  |
| 5 | `n_recipient_name` | nvarchar(200) |  |  |  |  |  |
| 6 | `i_task_id` | int | ✔ |  |  |  |  |
| 7 | `f_task_created` | char(1) |  |  | ('N') |  |  |
| 8 | `c_api_result` | varchar(20) |  |  | ('Success') |  |  |
| 9 | `n_message` | nvarchar(500) | ✔ |  |  |  |  |
| 10 | `i_send_user` | nvarchar(100) | ✔ |  |  |  |  |
| 11 | `d_send_date` | datetime |  |  | (getdate()) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectNotifyLog.Insert
- `R`: ProjectStateMember.GetByState, ProjectNotifyLog.GetExistingTaskId

### `RGP.t_project_progress`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CR··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 218
- **Primary key:** `i_progress_id` (clustered, `PK_RGP_t_project_progress`)
- **Repository:** Project, ProjectProgress, ProjectState

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_progress_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_proj_state_id` | int |  |  |  | `RGP.t_project_state.i_proj_state_id` |  |
| 3 | `i_project_id` | int |  |  |  | `RGP.t_project.i_project_id` |  |
| 4 | `c_status` | varchar(20) |  |  |  |  |  |
| 5 | `n_remark` | nvarchar(1000) | ✔ |  |  |  |  |
| 6 | `i_pct_complete` | int |  |  | ((0)) |  |  |
| 7 | `d_action_date` | datetime |  |  | (getdate()) |  |  |
| 8 | `i_action_user` | varchar(20) |  |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectProgress.InsertProgress
- `R`: Project.SearchProjects, ProjectState.GetStatesByProject, ProjectState.HasProgressRecords, ProjectState.GetActiveProjectsForRef, ProjectProgress.GetLatestProgressByProject, ProjectProgress.CalculateOverallProgress

### `RGP.t_project_state`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRUD` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 183
- **Primary key:** `i_proj_state_id` (clustered, `PK_RGP_t_project_state`)
- **Repository:** Project, ProjectDocument, ProjectProgress, ProjectState, ProjectTask

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_proj_state_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_project_id` | int |  |  |  | `RGP.t_project.i_project_id` |  |
| 3 | `i_state_id` | int | ✔ |  |  | `RGP.m_template_state.i_state_id` |  |
| 4 | `n_state_name` | nvarchar(200) |  |  |  |  |  |
| 5 | `i_seq_no` | int |  |  |  |  |  |
| 6 | `c_description` | nvarchar(500) | ✔ |  |  |  |  |
| 7 | `f_required` | char(1) |  |  | ('Y') |  |  |
| 8 | `c_status` | varchar(20) |  |  | ('Pending') |  | Pending \| InProgress \| Completed (คำนวณจาก % ความคืบหน้า: 0=Pending, 100=Completed, อื่นๆ=InProgress) |
| 9 | `i_create_user` | varchar(20) |  |  |  |  |  |
| 10 | `d_create_date` | datetime |  |  | (getdate()) |  |  |
| 11 | `i_update_user` | varchar(20) | ✔ |  |  |  |  |
| 12 | `d_update_date` | datetime | ✔ |  |  |  |  |
| 13 | `i_estimated_days` | int | ✔ |  |  |  |  |
| 14 | `i_ref_project_id` | int | ✔ |  |  | `RGP.t_project.i_project_id` |  |

**ถูกอ้างโดย (FK in):** `RGP.t_project_doc_workflow` (i_proj_state_id), `RGP.t_project_notify_log` (i_proj_state_id), `RGP.t_project_progress` (i_proj_state_id), `RGP.t_project_state_member` (i_proj_state_id), `RGP.t_project_task` (i_proj_state_id)

**Repository method ที่แตะตารางนี้**
- `C`: ProjectState.InsertState
- `R`: Project.SearchProjects, Project.HasActiveProgress, Project.AllRequiredStatesCompleted, ProjectState.GetStatesByProject, ProjectState.GetNextSeqNo, ProjectState.GetTotalEstimatedDays, ProjectState.GetActiveProjectsForRef, ProjectState.GetStatesForCombo, ProjectTask.GetByState, ProjectTask.GetByProject, ProjectTask.GetAllTasksForProject, ProjectProgress.GetLatestProgressByProject, ProjectProgress.CalculateOverallProgress, ProjectProgress.HasAnyProgress … (+2)
- `U`: ProjectState.UpdateState, ProjectState.UpdateStateStatus, ProjectState.ReorderStates
- `D`: ProjectState.DeleteState

### `RGP.t_project_state_member`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 39
- **Primary key:** `i_state_member_id` (clustered, `PK_RGP_t_project_state_member`)
- **Repository:** ProjectStateMember

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_state_member_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_proj_state_id` | int |  |  |  | `RGP.t_project_state.i_proj_state_id` |  |
| 3 | `i_project_id` | int |  |  |  |  |  |
| 4 | `n_member_name` | nvarchar(200) |  |  |  |  |  |
| 5 | `c_role` | nvarchar(100) |  |  |  |  |  |
| 6 | `i_create_user` | nvarchar(100) | ✔ |  |  |  |  |
| 7 | `d_create_date` | datetime | ✔ |  | (getdate()) |  |  |
| 8 | `c_member_type` | nvarchar(20) | ✔ |  |  |  |  |

**ถูกอ้างโดย (FK in):** `RGP.t_project_notify_log` (i_state_member_id)

**Repository method ที่แตะตารางนี้**
- `C`: ProjectStateMember.Insert
- `R`: ProjectStateMember.GetByState
- `D`: ProjectStateMember.Delete

### `RGP.t_project_task`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 33
- **Primary key:** `i_task_id` (clustered, `PK_RGP_t_project_task`)
- **Repository:** ProjectTask

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_task_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `c_task_code` | varchar(20) |  |  |  |  |  |
| 3 | `i_proj_state_id` | int |  |  |  | `RGP.t_project_state.i_proj_state_id` |  |
| 4 | `i_project_id` | int |  |  |  | `RGP.t_project.i_project_id` |  |
| 5 | `i_parent_task_id` | int | ✔ |  |  | `RGP.t_project_task.i_task_id` |  |
| 6 | `i_subtask_depth` | int |  |  | ((0)) |  |  |
| 7 | `n_title` | nvarchar(300) |  |  |  |  |  |
| 8 | `n_description` | nvarchar(max) | ✔ |  |  |  |  |
| 9 | `i_priority` | int |  |  | ((2)) |  |  |
| 10 | `c_status` | varchar(20) |  |  | ('Todo') |  | Todo \| InProgress \| Done \| OnHold \| Cancelled (พบในโค้ด) |
| 11 | `i_pct_complete` | int |  |  | ((0)) |  |  |
| 12 | `n_assignee` | nvarchar(200) | ✔ |  |  |  |  |
| 13 | `d_due_date` | date | ✔ |  |  |  |  |
| 14 | `d_start_date` | date | ✔ |  |  |  |  |
| 15 | `i_estimated_hours` | int | ✔ |  |  |  |  |
| 16 | `i_actual_hours` | int | ✔ |  |  |  |  |
| 17 | `n_extend_reason` | nvarchar(500) | ✔ |  |  |  |  |
| 18 | `f_active` | char(1) |  |  | ('Y') |  |  |
| 19 | `d_deleted_date` | datetime | ✔ |  |  |  |  |
| 20 | `d_recycle_expiry` | datetime | ✔ |  |  |  |  |
| 21 | `i_create_user` | varchar(20) |  |  |  |  |  |
| 22 | `d_create_date` | datetime |  |  | (getdate()) |  |  |
| 23 | `i_update_user` | varchar(20) | ✔ |  |  |  |  |
| 24 | `d_update_date` | datetime | ✔ |  |  |  |  |

**ถูกอ้างโดย (FK in):** `RGP.t_project_task_comment` (i_task_id), `RGP.t_project_task_status_log` (i_task_id), `RGP.t_project_task` (i_parent_task_id)

**Repository method ที่แตะตารางนี้**
- `C`: ProjectTask.InsertTask
- `R`: ProjectTask.GetByState, ProjectTask.GetByProject, ProjectTask.GetAllTasksForProject, ProjectTask.GetById, ProjectTask.CalcStatePctFromTasks
- `U`: ProjectTask.UpdateTask, ProjectTask.UpdateStatus, ProjectTask.SoftDelete

### `RGP.t_project_task_comment`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 21
- **Primary key:** `i_comment_id` (clustered, `PK_RGP_t_project_task_comment`)
- **Repository:** ProjectTask

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_comment_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_task_id` | int |  |  |  | `RGP.t_project_task.i_task_id` |  |
| 3 | `i_parent_comment_id` | int | ✔ |  |  | `RGP.t_project_task_comment.i_comment_id` |  |
| 4 | `i_thread_depth` | int |  |  | ((0)) |  |  |
| 5 | `n_content` | nvarchar(max) |  |  |  |  |  |
| 6 | `f_is_edited` | char(1) |  |  | ('N') |  |  |
| 7 | `f_is_deleted` | char(1) |  |  | ('N') |  |  |
| 8 | `i_create_user` | varchar(20) |  |  |  |  |  |
| 9 | `d_create_date` | datetime |  |  | (getdate()) |  |  |
| 10 | `d_edited_date` | datetime | ✔ |  |  |  |  |

**ถูกอ้างโดย (FK in):** `RGP.t_project_task_comment` (i_parent_comment_id)

**Repository method ที่แตะตารางนี้**
- `C`: ProjectTask.InsertComment
- `R`: ProjectTask.GetComments
- `U`: ProjectTask.SoftDeleteComment

### `RGP.t_project_task_status_log`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `C···` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 8
- **Primary key:** `i_log_id` (clustered, `PK__t_projec__2D31EAA81088C435`)
- **Repository:** ProjectTaskStatusLog

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_log_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_task_id` | int |  |  |  | `RGP.t_project_task.i_task_id` |  |
| 3 | `c_old_status` | nvarchar(20) | ✔ |  |  |  |  |
| 4 | `c_new_status` | nvarchar(20) |  |  |  |  |  |
| 5 | `i_pct_at_change` | int |  |  |  |  |  |
| 6 | `i_change_user` | nvarchar(100) | ✔ |  |  |  |  |
| 7 | `d_change_date` | datetime |  |  | (getdate()) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectTaskStatusLog.Insert

### `RunningNumber`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 22
- **Primary key:** `id` (clustered, `PK__RunningN__3213E83F144D8937`)
- **Repository:** Project, ProjectTask
- **Connection:** `ProjectDbConnectionString`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `running_type` | nvarchar(20) |  |  |  |  |  |
| 3 | `product` | nvarchar(5) |  |  |  |  |  |
| 4 | `businessline` | nvarchar(20) | ✔ |  |  |  |  |
| 5 | `prefix` | nvarchar(50) | ✔ |  |  |  |  |
| 6 | `format` | nvarchar(100) |  |  |  |  |  |
| 7 | `digit_number` | int |  |  |  |  |  |
| 8 | `maximum_number` | bigint |  |  |  |  |  |
| 9 | `Year_UW` | int | ✔ |  |  |  |  |
| 10 | `Month_UW` | int | ✔ |  |  |  |  |
| 11 | `current_number` | bigint |  |  |  |  |  |
| 12 | `created_date` | datetime | ✔ |  | (getdate()) |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: ProjectTask.GenerateTaskCode
- `R`: Project.GenerateProjectNo, ProjectTask.GenerateTaskCode
- `U`: Project.GenerateProjectNo, ProjectTask.GenerateTaskCode

### `storage.t_project_attachment`

- **เจ้าของ module:** RGP
- **ใช้โดย:** RGP
- **การกระทำที่ใช้จริง:** `CR·D` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 7
- **Primary key:** `i_attach_id` (clustered, `PK__t_projec__62C52AEBB417FCD1`)
- **Repository:** ProjectAttachment

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `i_attach_id` 🔑 | int |  | ✔ |  |  |  |
| 2 | `i_project_id` | int |  |  |  |  |  |
| 3 | `i_file_id` | int |  |  |  |  |  |
| 4 | `i_create_user` | nvarchar(100) |  |  |  |  |  |
| 5 | `d_create_date` | datetime |  |  | (getdate()) |  |  |

**Index / Unique:** `UQ_project_attachment` (UNIQUE i_project_id,i_file_id)

**Repository method ที่แตะตารางนี้**
- `C`: ProjectAttachment.Insert
- `R`: ProjectAttachment.GetByProject, ProjectAttachment.Insert
- `D`: ProjectAttachment.DeleteByProjectAndFile

