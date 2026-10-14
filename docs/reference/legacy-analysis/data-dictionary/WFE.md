# Data Dictionary — WFE — Workflow Engine

> สร้างจากผล export DDL จริง (`db-export/CMS_DB_1.x`, `BUI_RG_1.x`) รวมกับการวิเคราะห์โค้ดที่ใช้งานจริง · 🔑 = คอลัมน์ใน PK · Null ✔ = ยอมให้ NULL
> ชนิดข้อมูลสำหรับ Node/TypeORM ดู `README.md` หัวข้อ "Type mapping"

| ตาราง | แถว | CRUD | ใช้โดย |
|---|--:|:-:|---|
| [`WFE.s_WFConnection`](#wfes_wfconnection) | 22 | `CR··` | WFE |
| [`WFE.s_WFDefinition`](#wfes_wfdefinition) | 17 | `CRUd` | WFE |
| [`WFE.s_WFStep`](#wfes_wfstep) | 26 | `CR··` | WFE |
| [`WFE.t_WFInstance`](#wfet_wfinstance) | 96 | `CRU·` | WFE |
| [`WFE.t_WFStepInstance`](#wfet_wfstepinstance) | 168 | `CRU·` | WFE |
| [`dbo.WFDelegation`](#dbowfdelegation) | 0 | `CRUd` | WFE |

### `WFE.s_WFConnection`

- **เจ้าของ module:** WFE
- **ใช้โดย:** WFE
- **การกระทำที่ใช้จริง:** `CR··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 22
- **Primary key:** `WFConnectionId` (clustered, `PK__s_WFConn__5D9A77D94B6237F0`)
- **Repository:** WorkflowStep

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `WFConnectionId` 🔑 | int |  | ✔ |  |  |  |
| 2 | `WFDefinitionId` | int |  |  |  | `WFE.s_WFDefinition.WFDefinitionId` |  |
| 3 | `FromStepId` | int |  |  |  | `WFE.s_WFStep.WFStepId` |  |
| 4 | `ToStepId` | int |  |  |  | `WFE.s_WFStep.WFStepId` |  |
| 5 | `ConditionExpression` | nvarchar(max) | ✔ |  |  |  |  |
| 6 | `SequenceNumber` | int |  |  |  |  |  |
| 7 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 9 | `WorkflowConnectionId` | int | ✔ |  |  |  |  |

**Index / Unique:** `IX_WFConnection_DefinitionID` (WFDefinitionId); `IX_WFConnection_FromStep` (FromStepId); `IX_WFConnection_ToStep` (ToStepId); `IX_WFConnection_IsDeleted` (IsDeleted)

**Repository method ที่แตะตารางนี้**
- `C`: WorkflowStep.CreateConnection
- `R`: WorkflowStep.GetConnectionsByTemplate, WorkflowStep.GetConnectionsFromStep

### `WFE.s_WFDefinition`

- **เจ้าของ module:** WFE
- **ใช้โดย:** WFE
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 17
- **Primary key:** `WFDefinitionId` (clustered, `PK__s_WFDefi__B6A89D9069409320`)
- **Repository:** WFReport, WorkflowTemplate

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `WFDefinitionId` 🔑 | int |  | ✔ |  |  |  |
| 2 | `WFName` | nvarchar(200) |  |  |  |  |  |
| 3 | `WFDescription` | nvarchar(max) | ✔ |  |  |  |  |
| 4 | `Version` | int |  |  | ((1)) |  |  |
| 5 | `IsActive` | bit |  |  | ((1)) |  |  |
| 6 | `CreatedBy` | nvarchar(255) |  |  |  |  |  |
| 7 | `CreatedDate` | datetime |  |  | (getutcdate()) |  |  |
| 8 | `ModifiedBy` | nvarchar(255) | ✔ |  |  |  |  |
| 9 | `ModifiedDate` | datetime | ✔ |  |  |  |  |
| 10 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 11 | `DeletedDate` | datetime | ✔ |  |  |  |  |
| 12 | `ApprovalStatus` | tinyint |  |  | ((0)) |  | 0=Draft, 1=PendingApproval, 2=Active, 3=Inactive, 4=Deprecated |
| 13 | `SubmittedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 14 | `SubmittedDate` | datetime | ✔ |  |  |  |  |
| 15 | `ApprovedBy` | nvarchar(100) | ✔ |  |  |  |  |
| 16 | `ApprovedDate` | datetime | ✔ |  |  |  |  |
| 17 | `RejectionReason` | nvarchar(500) | ✔ |  |  |  |  |
| 18 | `TemplateDefinition` | nvarchar(max) | ✔ |  |  |  |  |
| 19 | `Category` | nvarchar(100) | ✔ |  |  |  |  |
| 20 | `UpdatedDate` | datetime2(7) | ✔ |  |  |  |  |
| 21 | `Description` | nvarchar(100) | ✔ |  |  |  |  |
| 22 | `DisabledBy` | nvarchar(100) | ✔ |  |  |  |  |
| 23 | `DisabledDate` | datetime | ✔ |  |  |  |  |
| 24 | `DisabledReason` | nvarchar(500) | ✔ |  |  |  |  |
| 25 | `DivisionId` | int | ✔ |  |  |  |  |
| 26 | `DepartmentId` | int | ✔ |  |  |  |  |

**Index / Unique:** `IX_WFDefinition_Name` (WFName); `IX_WFDefinition_IsActive` (IsActive); `IX_WFDefinition_IsDeleted` (IsDeleted); `IX_WFDef_ApprovalStatus_IsDeleted` (ApprovalStatus,IsDeleted)

**ถูกอ้างโดย (FK in):** `WFE.s_WFConnection` (WFDefinitionId), `WFE.s_WFStep` (WFDefinitionId), `WFE.t_WFInstance` (WFDefinitionId)

**Repository method ที่แตะตารางนี้**
- `C`: WorkflowTemplate.CreateTemplate
- `R`: WorkflowTemplate.GetTemplate, WorkflowTemplate.GetTemplateVersions, WorkflowTemplate.GetTemplates, WFReport.GetSLAByTemplate
- `U`: WorkflowTemplate.UpdateTemplate
- `d`: WorkflowTemplate.SoftDeleteTemplate

### `WFE.s_WFStep`

- **เจ้าของ module:** WFE
- **ใช้โดย:** WFE
- **การกระทำที่ใช้จริง:** `CR··` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 26
- **Primary key:** `WFStepId` (clustered, `PK__s_WFStep__4534D9E524718EF7`)
- **Repository:** WorkflowStep, WorkflowStepInstance, WorkflowTemplate

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `WFStepId` 🔑 | int |  | ✔ |  |  |  |
| 2 | `WFDefinitionId` | int |  |  |  | `WFE.s_WFDefinition.WFDefinitionId` |  |
| 3 | `StepName` | nvarchar(200) |  |  |  |  |  |
| 4 | `StepType` | tinyint |  |  | ((0)) |  | 1=Start, 2=Approval, 3=Review, 4=Notification, 5=Parallel, 6=Decision, 7=Merge, 8=End |
| 5 | `Description` | nvarchar(max) | ✔ |  |  |  |  |
| 6 | `AssignedRole` | nvarchar(255) | ✔ |  |  |  |  |
| 7 | `AssignedUser` | nvarchar(255) | ✔ |  |  |  |  |
| 8 | `AssignedOrgUnit` | nvarchar(255) | ✔ |  |  |  |  |
| 9 | `SLAHours` | int | ✔ |  |  |  |  |
| 10 | `SLADays` | int | ✔ |  |  |  |  |
| 11 | `AllowDelegation` | bit |  |  | ((0)) |  |  |
| 12 | `MaxDelegationDepth` | int |  |  | ((1)) |  |  |
| 13 | `SequenceNumber` | int |  |  |  |  |  |
| 14 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 16 | `StepConfig` | nvarchar(max) | ✔ |  |  |  |  |
| 17 | `WorkflowStepId` | int | ✔ |  |  |  |  |

**Index / Unique:** `IX_WFStep_DefinitionID` (WFDefinitionId); `IX_WFStep_Sequence` (WFDefinitionId,SequenceNumber); `IX_WFStep_IsDeleted` (IsDeleted)

**ถูกอ้างโดย (FK in):** `WFE.s_WFConnection` (FromStepId), `WFE.s_WFConnection` (ToStepId), `WFE.t_WFInstance` (CurrentStepId), `WFE.t_WFStepInstance` (WFStepId)

**Repository method ที่แตะตารางนี้**
- `C`: WorkflowStep.CreateStep
- `R`: WorkflowTemplate.GetTemplates, WorkflowStep.GetStep, WorkflowStep.GetStepsByTemplate, WorkflowStepInstance.GetStepInstancesByWorkflow

### `WFE.t_WFInstance`

- **เจ้าของ module:** WFE
- **ใช้โดย:** WFE
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 96
- **Primary key:** `WFInstanceId` (clustered, `PK__t_WFInst__58C1A04BE547136C`)
- **Repository:** WFReport, Workflow, WorkflowStepInstance, WorkflowTemplate
- **Stored procedure:** `WFE.sp_CreateWFInstance`, `WFE.sp_CreateWFStepInstance`, `dbo.sp_WF_GetSLAComplianceMetrics`, `dbo.sp_WF_GetTaskDistribution`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `WFInstanceId` 🔑 | int |  | ✔ |  |  |  |
| 2 | `WFDefinitionId` | int |  |  |  | `WFE.s_WFDefinition.WFDefinitionId` |  |
| 3 | `TemplateVersion` | int |  |  |  |  |  |
| 4 | `Status` | tinyint |  |  | ((0)) |  | enum โค้ด: 1=Created, 2=InProgress, 3=Completed, 4=Rejected, 5=Suspended, 6=Cancelled — แต่ SP sp_CreateWFInstance ใส่ 0 |
| 5 | `InitiatedBy` | nvarchar(255) |  |  |  |  |  |
| 6 | `InitiatedDate` | datetime |  |  | (getutcdate()) |  |  |
| 7 | `CurrentStepId` | int | ✔ |  |  | `WFE.s_WFStep.WFStepId` |  |
| 8 | `CompletedDate` | datetime | ✔ |  |  |  |  |
| 9 | `InputParameters` | nvarchar(max) | ✔ |  |  |  |  |
| 10 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 11 | `DeletedDate` | datetime | ✔ |  |  |  |  |

**Index / Unique:** `IX_WFInstance_DefinitionID` (WFDefinitionId); `IX_WFInstance_Status` (Status); `IX_WFInstance_IsDeleted` (IsDeleted); `IX_WFInstance_CurrentStep` (CurrentStepId)

**ถูกอ้างโดย (FK in):** `WFE.t_WFStepInstance` (WFInstanceId)

**Repository method ที่แตะตารางนี้**
- `C`: Workflow.CreateWorkflowInstance
- `R`: Workflow.GetWorkflowInstance, Workflow.GetWorkflowInstances, WorkflowTemplate.GetTemplates, WorkflowStepInstance.CreateStepInstance, WFReport.GetSLAComplianceMetrics, WFReport.GetTaskDistribution, WFReport.GetSLAByTemplate, WFReport.GetCycleTimeDistribution
- `U`: Workflow.UpdateWorkflowInstance

### `WFE.t_WFStepInstance`

- **เจ้าของ module:** WFE
- **ใช้โดย:** WFE
- **การกระทำที่ใช้จริง:** `CRU·` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 168
- **Primary key:** `WorkflowStepInstanceId,WFStepInstanceId` (clustered, `PK__t_WFStep__023884E8EDDC38F2`)
- **Repository:** Audit, WFReport, WorkflowStepInstance
- **Stored procedure:** `WFE.sp_CreateWFStepInstance`, `dbo.sp_WF_GetSLAComplianceMetrics`, `dbo.sp_WF_GetTaskDistribution`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `WorkflowStepInstanceId` 🔑 | int |  |  |  |  |  |
| 2 | `WFStepInstanceId` 🔑 | int |  | ✔ |  |  |  |
| 3 | `WFInstanceId` | int |  |  |  | `WFE.t_WFInstance.WFInstanceId` |  |
| 4 | `WFStepId` | int |  |  |  | `WFE.s_WFStep.WFStepId` |  |
| 5 | `Status` | tinyint |  |  | ((0)) |  | 1=Pending, 2=InProgress, 3=Completed, 4=Rejected, 5=Delegated |
| 6 | `AssignedTo` | nvarchar(255) | ✔ |  |  |  |  |
| 7 | `StartedDate` | datetime | ✔ |  |  |  |  |
| 8 | `CompletedDate` | datetime | ✔ |  |  |  |  |
| 9 | `Remarks` | nvarchar(max) | ✔ |  |  |  |  |
| 10 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 11 | `CompletedBy` | nvarchar(50) | ✔ |  |  |  |  |
| 12 | `OutputData` | nvarchar(max) | ✔ |  |  |  |  |
| 13 | `SLADeadline` | datetime | ✔ |  |  |  | SP sp_CreateWFStepInstance แปลงเป็นสตริง ISO ก่อน INSERT (implicit conversion กลับเป็น datetime) |
| 14 | `SLAStatus` | tinyint | ✔ |  |  |  | 1=OnTime, 2=AtRisk, 3=Overdue (tinyint) |
| 15 | `AssignedDate` | datetime | ✔ |  |  |  |  |
| 16 | `Outcome` | nvarchar(50) | ✔ |  |  |  |  |
| 17 | `Variables` | nvarchar(max) | ✔ |  |  |  |  |

**Index / Unique:** `IX_WFStepInstance_InstanceID` (WFInstanceId); `IX_WFStepInstance_StepID` (WFStepId); `IX_WFStepInstance_Status` (Status)

**Repository method ที่แตะตารางนี้**
- `C`: WorkflowStepInstance.CreateStepInstance
- `R`: Audit.GetAuditLogsByWorkflowInstance, WorkflowStepInstance.CreateStepInstance, WorkflowStepInstance.GetStepInstance, WorkflowStepInstance.GetStepInstancesByWorkflow, WorkflowStepInstance.GetStepInstancesByUser, WFReport.GetSLAComplianceMetrics, WFReport.GetTaskDistribution, WFReport.GetSLAByTemplate, WFReport.GetSLAWeeklyTrend
- `U`: WorkflowStepInstance.UpdateStepInstance

### `dbo.WFDelegation`

- **เจ้าของ module:** WFE
- **ใช้โดย:** WFE
- **การกระทำที่ใช้จริง:** `CRUd` (C/R/U/D; `d` = soft delete)
- **แถวโดยประมาณ:** 0
- **Primary key:** `WFDelegationId` (clustered, `PK_WFDelegation`)
- **Repository:** Delegation
- **Stored procedure:** `dbo.sp_WF_CreateDelegation`, `dbo.sp_WF_GetDelegationHistory`

| # | Column | Type | Null | Identity | Default | FK → | หมายเหตุ / ค่าที่เป็นไปได้ |
|--:|---|---|:-:|:-:|---|---|---|
| 1 | `WFDelegationId` 🔑 | int |  | ✔ |  |  |  |
| 2 | `WorkflowStepInstanceId` | int |  |  |  |  |  |
| 3 | `DelegatedFrom` | nvarchar(100) |  |  |  |  |  |
| 4 | `DelegatedTo` | nvarchar(100) |  |  |  |  |  |
| 5 | `DelegationReason` | nvarchar(500) | ✔ |  |  |  |  |
| 6 | `DelegationDate` | datetime |  |  | (getdate()) |  |  |
| 7 | `DelegationDepth` | int |  |  |  |  |  |
| 8 | `IsActive` | bit |  |  | ((1)) |  |  |
| 9 | `IsDeleted` | bit |  |  | ((0)) |  |  |
| 10 | `StartDate` | datetime | ✔ |  |  |  |  |
| 11 | `EndDate` | datetime | ✔ |  |  |  |  |
| 12 | `Remarks` | nvarchar(500) | ✔ |  |  |  |  |

**Repository method ที่แตะตารางนี้**
- `C`: Delegation.CreateDelegation
- `R`: Delegation.CreateDelegation, Delegation.GetDelegation, Delegation.GetDelegationsByStepInstance
- `U`: Delegation.UpdateDelegation
- `d`: Delegation.CreateDelegation

