# Enum / ค่า Lookup ที่ API ต้องใช้

> รวบรวมจาก `CMS.Domain/Enums`, CHECK constraint ใน DB (`db-export/CMS_DB_1.4_check_rowcount.csv`) และค่าที่พบในโค้ด
> ⚠ คอลัมน์ "ตรงกันไหม" ระบุที่โค้ดกับ DB ไม่สอดคล้องกัน — ต้องตัดสินใจก่อนทำ DTO/Enum ของ Nest

## 1. Enum แบบตัวเลข

| ชื่อ (C#) | ค่า | ใช้ที่คอลัมน์ | CHECK ใน DB | ตรงกันไหม |
|---|---|---|---|---|
| `UserRole` (AppRole) | 1=Officer, 2=SrOfficer, 3=Manager, 4=Admin | `EMS.UserAccount.AppRole`, `EMS.MenuItem.RequiredAppRole` | ไม่มี | ✔ — ใช้ใน Guard ทั่วระบบ (`AppRole < 3` = ต้อง Manager/Admin) |
| `ConfidentialityLevel` | 1=HC, 2=SC, 3=NC, 4=PC | `storage.Folder`, `storage.FolderTemplateItem`, `EMS.FolderAuthorityConfig`, `KMS.t_KBArticle` | `1–4` | ✔ — รหัสข้อความคู่กัน `'1HC'`,`'2SC'`,`'3NC'`,`'4PC'` ใช้เป็นชื่อ Root folder และ `FolderAuthorityConfig.LevelCode` |
| `ApprovalRequestStatus` | 1=Pending, 2=Approved, 3=Rejected, 4=Expired | `workflow.ApprovalRequest.RequestStatus` | `1–5` | ⚠ DB อนุญาต 5 แต่ไม่มี enum; โค้ด "Withdraw" ใช้ 4 (Expired) |
| `ApprovalStepStatus` | 1=Pending, 2=Approved, 3=Rejected, 4=Delegated | `workflow.ApprovalStep.StepStatus` | `1–4` | ⚠ 4 ถูกใช้เป็น "auto-closed/escalated" ด้วย |
| `PrincipalType` | 1=User, 2=Role, 3=Department, 4=Division, 5=Group, 6=OrgUnit | `security.FolderPermission.PrincipalType`, `security.FilePermission.PrincipalType` | FolderPermission: `1–4` | ⚠ 5,6 ใช้ไม่ได้กับ FolderPermission (CHECK); FilePermission ไม่มี CHECK |
| `PermissionType` | 1=Read, 2=Write, 3=Delete, 4=Modify, 5=FullControl | ค่าสิทธิ์เก็บเป็นคอลัมน์ bit `CanRead/CanWrite/CanDelete/CanModify/CanFullControl` | — | enum นี้ใช้เป็นชื่อสิทธิ์ตอนเช็ก (`"Read"`,`"Write"`,…) |
| `OrgUnitTier` / `EMS.OrgUnit.OrgUnitType` | 1=SubCommittee, 2=Division, 3=Department | `EMS.OrgUnit.OrgUnitType` | ไม่มี | ✔ (ยืนยันจาก `sp_GetFileDocumentsByOrgUnit`) |
| `QuotaRequestStatus` | 1=Pending, 2=Approved, 3=Rejected, 4=Cancelled | `dms.FolderQuotaChangeRequest.Status` | `1–4` | ✔ |
| `QuotaAlertLevel` | 0=Normal, 1=Warning, 2=Critical, 3=Full | (คำนวณ ไม่เก็บ) | — | — |
| `KBEntityType` | 1=Folder, 2=Task, 3=Program, 4=Law, 5=Project, 6=Department | `KMS.t_KBArticleLink.EntityType` | `1–6` | ✔ (Editor จัดการเฉพาะ 4=Law) |
| (KB) `Status` | 1=Draft, 2=Review, 3=Published, 4=Archived | `KMS.t_KBArticle.Status` | `1–4` | ✔ |
| (KB) `ArticleType` | 1=ขั้นตอนงาน, 2=FAQ, 3=แนวทางปฏิบัติ, 4=แม่แบบ, 5=กฎ/นโยบาย | `KMS.t_KBArticle.ArticleType` | `1–5` | ✔ |
| FileStatus | 1=Active, 2=Archived, 3=Deleted | `storage.FileDocument.FileStatus` | `1–3` | ✔ |
| VirusScanStatus | 0=Pending, 1=Clean, 2=Infected, 3=Error | `storage.FileDocument.VirusScanStatus` | `0–3` | ✔ (โค้ดอัปโหลดข้ามการสแกนและบันทึก 1) |
| `WorkflowStepType` | 1=Start, 2=Approval, 3=Review, 4=Notification, 5=Parallel, 6=Decision, 7=Merge, 8=End | `WFE.s_WFStep.StepType` | ไม่มี | ✔ |
| `WorkflowInstanceStatus` | 1=Created, 2=InProgress, 3=Completed, 4=Rejected, 5=Suspended, 6=Cancelled | `WFE.t_WFInstance.Status` | ไม่มี | ⚠ `WFE.sp_CreateWFInstance` ใส่ **0** แล้ว service ปรับเป็น InProgress ภายหลัง |
| `WorkflowStepInstanceStatus` | 1=Pending, 2=InProgress, 3=Completed, 4=Rejected, 5=Delegated | `WFE.t_WFStepInstance.Status` | ไม่มี | ✔ (`sp_CreateWFStepInstance` ใส่ 1) |
| `SLAStatus` | 1=OnTime, 2=AtRisk, 3=Overdue | `WFE.t_WFStepInstance.SLAStatus` | ไม่มี | ✔ คอลัมน์เป็น `tinyint` (SP ส่งค่าเป็นสตริง `N'1'`/เทียบกับ `'3'` แล้ว SQL Server แปลงให้) |
| `WorkflowTemplateStatus` | 0=Draft, 1=PendingApproval, 2=Active, 3=Inactive, 4=Deprecated | `WFE.s_WFDefinition.ApprovalStatus` | ไม่มี | ✔ |
| `EscalationAction` | 1=NotifyManager, 2=IncreasePriority, 3=Reassign, 4=AutoReject | (ใช้ใน SLA job ที่เป็น dead code) | — | — |
| `EmploymentType` / `EmploymentStatus` | ไม่มี enum ในโค้ด | `EMS.m_Employee` | `1–4` / `1–5` | ❓ ไม่ทราบความหมาย — ดู `OPEN_QUESTIONS.md` |

## 2. ค่าแบบสตริง

| ที่ | ค่า | หมายเหตุ |
|---|---|---|
| `workflow.ApprovalRequest.RequestType` | `CREATE_HC`, `UPLOAD_HC`, `DELETE_FOLDER`, `CHANGE_PERMISSION`, `DOWNLOAD_FILE`, `EXTERNAL_SHARE`, `INTERNAL_SHARE`, `SHARE_PERMISSION_CHANGE` | CHECK constraint ครบ 8 ค่า; โค้ด ShareService มี fallback เป็น `CHANGE_PERMISSION` ถ้า DB รุ่นเก่าไม่รองรับ `EXTERNAL_SHARE` |
| `storage.ExternalShare.ShareTokenStatus`, `storage.ShareToken.Status` | `Pending`, `Active`, `Disabled`, `Expired`, `Revoked` | วงจร: สร้าง=Pending → อนุมัติ=Active → (Disable↔Enable) → Expired/Revoked |
| `storage.ShareAccessLog.AccessType` | `View`, `Download` | |
| `storage.FolderTemplate.TargetType` | `Any`, `SubCommittee`, `Division`, `Department` | |
| `EMS.FolderAuthorityConfig.LevelCode` | `1HC`, `2SC`, `3NC`, `4PC` | คู่กับ `ConfidentialityLevel` (SP คำนวณให้ถ้าส่งมาเพียงอย่างเดียว) |
| RGP `t_project.c_status` | `Open`, `InProgress`, `Completed` | คำนวณจากสถานะ state (ดู `04-business-rules.md`) |
| RGP `t_project_state.c_status` | `Pending`, `InProgress`, `Completed` | จาก % ความคืบหน้า: 0=Pending, 100=Completed, อื่นๆ=InProgress |
| RGP `t_project_task.c_status` | `Todo`, `InProgress`, `Done`, `OnHold`, `Cancelled` | `OnHold` ตรึง % ไว้ที่ค่าเดิม |
| RGP flag | `'Y'` / `'N'` | ธง active/required ใช้ตัวอักษร ไม่ใช่ bit |
| `KMS.m_KBCategory.ImportTypeDigit` | `NULL` หรือ `'1'`–`'9'` (unique) | ตัวเลขตำแหน่งที่ 25 ของ Code รวมตอน import NonLaw |
| `EMS.Notification.EventType` | `ApprovalRequestPending`, `ApprovalRequestApproved`, `ApprovalEscalation`, `ExternalShareCreated`, … (สตริงอิสระ ไม่มี CHECK) | ดู `05-cross-cutting.md` หัวข้อ Notification |

## 3. ข้อแนะนำสำหรับ Nest

```ts
// ตัวอย่าง — เก็บ enum ไว้ที่เดียว (libs/common) และให้ DTO/Entity อ้างอิง
export enum AppRole { Officer = 1, SrOfficer = 2, Manager = 3, Admin = 4 }
export enum Confidentiality { HC = 1, SC = 2, NC = 3, PC = 4 }
export const CONF_ROOT_CODE = { 1: '1HC', 2: '2SC', 3: '3NC', 4: '4PC' } as const;
export enum ApprovalRequestStatus { Pending = 1, Approved, Rejected, Expired }
```

- แปลงค่าสถานะที่ DB เก็บเป็นสตริง (`ExternalShare.ShareTokenStatus`, `ShareToken.Status`) ที่ชั้น mapper อย่าเปิดเผยตรงใน API
- ห้ามเปลี่ยนความหมายของ `4` ใน `RequestStatus`/`StepStatus` ก่อนตัดสินใจเรื่อง Withdraw/Escalate (ดู `OPEN_QUESTIONS.md`)
