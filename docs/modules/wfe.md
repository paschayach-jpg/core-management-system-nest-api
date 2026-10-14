# WFE (Workflow Engine) — สรุปการพัฒนา

> ผู้ใช้เอกสาร: ทีมพัฒนา (C#/.NET → NestJS) · ต้นฉบับ: `CMS.Services/Workflow*.cs, StepResolverService.cs, SLACalculator.cs`, `CMS.Data/Repositories/WF*.cs`, `CMS.Presentation/Modules/WFE`
> อ้างอิงวิเคราะห์ระบบเดิม: `docs/reference/legacy-analysis/04-business-rules.md` §5, `06-service-use-cases.md`, `data-dictionary/WFE.md`, SP ใน `db-export/sp-by-schema/WFE.md` และ `dbo.md`

ทุก endpoint อยู่ใต้ `/api/v1/wfe/...` และต้อง login (ไม่มี `@Public`) · สิทธิ์ `O` = ทุกคนที่ login แล้วตรวจสิทธิ์ทรัพยากรใน service, `M` = `@MinRole(Manager)`, `A` = `@MinRole(Admin)`
(ตารางสิทธิ์นี้ถูกล็อกด้วยเทสต์ `test/unit/wfe/controllers.spec.ts` — แก้ที่ใดต้องแก้อีกที่)

## 1. Endpoint ที่ให้บริการ (49)

### 1.1 Template — `/wfe/templates` (25)
| Method | Path | สิทธิ์ | คำอธิบาย / use case เดิม |
|---|---|:-:|---|
| GET | `/wfe/templates` | O | รายการแบ่งหน้า กรอง `approvalStatus` `isActive` `category` `createdBy` `q` · sort: name/createdDate/modifiedDate/version/approvalStatus/category — `GetTemplates` |
| POST | `/wfe/templates` | M | สร้าง (Draft เสมอ) — `CreateTemplate` · log `WorkflowTemplateCreated` |
| POST | `/wfe/templates/import` | M | นำเข้าจากข้อมูล export → Draft ชื่อ "(Imported)" — `WorkflowTemplateListPresenter.ImportTemplate` · log `WorkflowTemplateImported` |
| GET | `/wfe/templates/:id` | O | รายละเอียด + `structure` (step/connection) + `validation` — `GetTemplate` (+ รวม SQL อ่านโครงสร้างของ `WorkflowCreateTemplateForm`) |
| PATCH | `/wfe/templates/:id` | M | แก้ไข (Version+1) — `UpdateTemplate` · log `WorkflowTemplateUpdated` |
| DELETE | `/wfe/templates/:id` | M | soft delete; ห้ามถ้ามี instance ที่ทำงานอยู่ — `DeleteTemplate` · log `WorkflowTemplateDeleted` |
| GET | `/wfe/templates/:id/versions` | O | `GetTemplateVersions` (แถวเดียวเสมอ — ดูข้อ 3 #24) |
| GET | `/wfe/templates/:id/export` | M | ส่งออกเป็น JSON · log (READ) `WorkflowTemplateExported` |
| POST | `/wfe/templates/:id/copy` | M | คัดลอกเป็น Draft ใหม่ รวม step/connection — ย้าย SQL ตรงจาก `WorkflowCreateTemplateForm` เข้า service · log `WorkflowTemplateDuplicated` |
| POST | `/wfe/templates/:id/submit` | M | Draft → PendingApproval (ตรวจผังก่อน) — `SubmitForApproval` · `WorkflowTemplateSubmittedForApproval` |
| POST | `/wfe/templates/:id/approve` | A | PendingApproval → Active — `ApproveTemplate` · `WorkflowTemplateApproved` |
| POST | `/wfe/templates/:id/reject` | A | PendingApproval → Draft (ต้องมีเหตุผล) — `RejectTemplate` · `WorkflowTemplateRejected` |
| POST | `/wfe/templates/:id/publish` | A | Draft/Inactive → Active ตรง — `PublishTemplate` · `WorkflowTemplatePublished` |
| POST | `/wfe/templates/:id/deactivate` | M | Active → Inactive — `DeactivateTemplate` · `WorkflowTemplateDeactivated` |
| POST | `/wfe/templates/:id/deprecate` | A | Active/Inactive → Deprecated (สิ้นสุด) — **ใหม่** · `WorkflowTemplateDeprecated` |
| GET | `/wfe/templates/:id/validation` | O | ตรวจผัง: Start/End, step ลอย, เดินถึง End, ผู้รับผิดชอบ |
| POST | `/wfe/templates/:id/sync-steps` | M | สร้างแถว step/connection ใหม่ทั้งชุดจาก TemplateDefinition (Draft) — `SyncStepsFromTemplateDefinition` |
| GET/POST | `/wfe/templates/:id/steps` | O / M | `GetStepsByTemplate` / `CreateStep` · `WorkflowStepCreated` |
| PATCH/DELETE | `/wfe/templates/:id/steps/:stepId` | M | แก้/ลบ step (Draft) — `UpdateStep`/`SoftDeleteStep` (เดิม dead) |
| GET/POST | `/wfe/templates/:id/connections` | O / M | `GetConnectionsByTemplate` / `CreateConnection` |
| PATCH/DELETE | `/wfe/templates/:id/connections/:connectionId` | M | แก้/ลบเส้นเชื่อม (Draft) — เดิม dead |

### 1.2 Instance / งาน — `/wfe/instances`, `/wfe/tasks`, `/wfe/step-instances` (14)
| Method | Path | สิทธิ์ | คำอธิบาย / use case เดิม |
|---|---|:-:|---|
| GET | `/wfe/instances` | O | รายการแบ่งหน้า (กรอง template/สถานะ/ผู้เริ่ม/ช่วงวันที่/`q`) — Officer เห็นเฉพาะของที่เกี่ยวข้องกับตน, Manager+ เห็นทั้งหมด — `GetWorkflowInstances` |
| POST | `/wfe/instances` | O | เริ่ม workflow ใหม่ — `CreateWorkflowInstance` · `WorkflowInstanceCreated` |
| GET | `/wfe/instances/:id` | O | รายละเอียด + ประวัติ step + `allowedActions` — `GetWorkflowInstance` |
| GET | `/wfe/instances/:id/history` | O | step instance ทั้งหมด + audit (`AuditLogsService.byWorkflowInstance`) |
| POST | `/wfe/instances/:id/suspend` · `resume` · `cancel` | O* | *ผู้เริ่มหรือ Manager+ ตรวจใน service · `WorkflowInstanceSuspended/Resumed/Cancelled` |
| DELETE | `/wfe/instances/:id?reason=` | M | soft delete instance ที่จบแล้ว · `WorkflowInstanceDeleted` |
| GET | `/wfe/tasks/mine` | O | `GetMyTasks` แบ่งหน้า (`onlyOpen`) |
| GET | `/wfe/tasks/summary` | O | KPI ของงานฉัน (ค้าง/ใกล้ครบกำหนด/เลยกำหนด/เสร็จวันนี้/%SLA) — แทนการนับจากทุกหน้า |
| GET | `/wfe/step-instances/:id` | O | `GetStepInstance` (id = `WFStepInstanceId`) |
| POST | `/wfe/step-instances/:id/start` | O* | Pending → InProgress (ผู้รับผิดชอบ) — **ใหม่** · `WorkflowStepStarted` |
| POST | `/wfe/step-instances/:id/complete` | O* | `CompleteWorkflowStep` (ผู้รับผิดชอบ) · `WorkflowStepCompleted` |
| POST | `/wfe/step-instances/:id/reject` | O* | `RejectWorkflowStep` (ผู้รับผิดชอบ) · `WorkflowStepRejected` |

### 1.3 Delegation — `/wfe/delegations` (6)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|:-:|---|
| POST | `/wfe/delegations` | O* | `DelegateTask` — สูงสุด 3 ระดับ · `TaskDelegated` |
| GET | `/wfe/delegations/mine` | O | ที่ฉันมอบ/ได้รับ (`direction` `activeOnly`) แบ่งหน้า |
| GET | `/wfe/delegations/step-instances/:stepInstanceId` | O* | `GetDelegationHistory` (`sp_WF_GetDelegationHistory`) |
| GET | `/wfe/delegations/:id` | O* | `GetDelegation` |
| POST | `/wfe/delegations/:id/return` | O* | ผู้รับ "คืนงาน" ให้ผู้มอบ · `DelegationReturned` |
| POST | `/wfe/delegations/:id/deactivate` | O* | ผู้มอบ/Manager+ ยกเลิก — `DeactivateDelegation` · `DelegationDeactivated` |

### 1.4 SLA — `/wfe/sla` (4)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|:-:|---|
| GET | `/wfe/sla/compliance` | M | รายงานภาพรวม: สรุป (`sp_WF_GetSLAComplianceMetrics`), ตาม template, top 5 ผู้เกินกำหนด (`sp_WF_GetTaskDistribution`), แนวโน้มรายสัปดาห์, การกระจายระยะเวลา — `SLACalculator.GetSLAComplianceMetrics` |
| GET | `/wfe/sla/task-distribution` | M | การกระจายงานต่อผู้รับผิดชอบ (แบ่งหน้า) |
| GET | `/wfe/sla/overdue` | M | **รายงานเกินกำหนดแบบสด** (step เปิดอยู่ที่ deadline < ตอนนี้) |
| POST | `/wfe/sla/refresh` | A | สั่งอัปเดตสถานะ SLA ทันที (งานเดียวกับ cron) · `SLAStatusRefreshed` |

### 1.5 งานเบื้องหลัง
`WorkflowSlaService.scheduledRefresh()` (`@Cron` ทุกต้นนาที) — **ปิดเป็นค่าเริ่มต้น** เปิดด้วย `WorkflowEscalationEnabled = true` ใน `dbo.SystemConfig`; รันตาม `WorkflowSLAJobIntervalMinutes`;
ล็อกด้วย `sp_getapplock` กันรันซ้ำเมื่อมีหลาย instance · ทำ: อัปเดต `SLAStatus` ของ step ที่เปิดอยู่ (เฉพาะ workflow ที่ InProgress), เมื่อ**เปลี่ยน**เป็น AtRisk → แจ้งเตือนผู้รับผิดชอบ, เป็น Overdue → audit `SLAEscalated` (ผู้ทำ = `system`) + แจ้งเตือนผู้รับผิดชอบและผู้เริ่ม

### 1.6 ค่าตั้งใน `dbo.SystemConfig` ที่ WFE อ่าน (ไม่มี key = ใช้ค่าเริ่มต้น)
| Key | ค่าเริ่มต้น | ใช้ทำอะไร |
|---|---|---|
| `WorkflowSLADefaultHours` | 24 | deadline ของ step ที่ไม่ได้ตั้ง SLAHours/SLADays |
| `WorkflowSLAWarningThresholdPercent` | 75 | เกณฑ์ AtRisk |
| `WorkflowSLAJobIntervalMinutes` | 5 | ช่วงห่างของงานเบื้องหลัง |
| `WorkflowEscalationEnabled` | **false** | เปิดงานเบื้องหลัง SLA/escalation |
| `WorkflowAutoRejectOnOverdue` | false | **ยังไม่รองรับ** (มีแต่เตือนใน log ถ้าเปิด) |
| `WorkflowNotificationEnabled` / `WorkflowNotificationInAppEnabled` | true / true | ส่งแจ้งเตือนผ่าน `NotificationsService` |
| `WorkflowNotificationEmailEnabled` | false | **ยังไม่รองรับ** (ไม่มีบริการอีเมลใน API) |

## 2. กฎธุรกิจที่พอร์ตมา (พร้อมไฟล์ที่ทำ)

โครงสร้าง `src/modules/wfe/`: `template/` · `instance/` · `delegation/` · `sla/` · `common/` · `entities/` (codegen — ไม่แก้) · `wfe.module.ts`
รูปแบบ: **controller บาง → service (กฎ + `logged`) → store (SQL ล้วน รับ `EntityManager` เพื่อรันใน transaction เดียวกัน)**; กฎที่เป็นฟังก์ชันล้วนแยกไฟล์และเทสต์ตรง

| กฎ | ไฟล์ (pure = ไม่แตะ DB) |
|---|---|
| วงจรสถานะ template: `Draft → Submit → PendingApproval → Approve → Active`, Reject กลับ Draft, Publish ตรง, Deactivate, Deprecate · `IsActive` คู่กับสถานะ (true เฉพาะ Active) | `template/template-status.ts` (pure, ตารางเปลี่ยนสถานะ) + `template.service.ts` |
| ตรวจความถูกต้องของกราฟ: มี Start ตัวเดียว/มี End, ไม่มี step ลอย, ไม่มีทางตัน, เดินจาก Start ถึงทุก step และถึง End ได้, เส้นเชื่อมอ้าง step จริง/ไม่วนหาตัวเอง/ไม่ซ้ำ; ไม่มีเส้นเชื่อมเลย = เดินตาม SequenceNumber (ตรงกับ sequential fallback ตอนรัน) | `template/template-definition.ts` (pure) — รันที่ Submit/Approve/Publish และ `GET :id/validation` |
| อ่าน `TemplateDefinition` ทั้งรูปแบบ designer (`Steps/Connections`) และ wizard (`Action/NextStep`) — `MapStringToStepType` เดิม (Sub-Workflow/System Task/Wait Timer → Approval) | `template/template-definition.ts` |
| `SyncStepsFromTemplateDefinition` (designer เก็บผังใน JSON อย่างเดียว) — ใช้เป็น fallback ตอนสร้าง instance และสร้างแถวทันทีที่บันทึก Draft | `template/template-structure.service.ts` |
| ลบ template ไม่ได้ถ้ามี instance ที่ยังทำงานอยู่ (สถานะ 0/Created/InProgress/Suspended) | `template.store.ts#countOpenInstances` + `template.service.ts#remove` |
| สร้าง instance: template ต้อง Active, ต้องมี Start; **`WFE.sp_CreateWFInstance` (Status=0) → `WFE.sp_CreateWFStepInstance` → ปรับ Status เป็น InProgress + CurrentStepId** ใน `TransactionRunner` เดียว (ไม่ INSERT ตรง) | `instance/instance.service.ts#create` |
| StepResolver: เส้นออกทุกเส้นที่เงื่อนไขเป็นจริงถูกเดินพร้อมกัน; End ปิด instance ต่อเมื่อไม่มี step อื่นค้าง; ไม่มีเส้นออก → ตาม SequenceNumber; ผู้รับผิดชอบ = `AssignedUser` หรือผู้ทำรายการ | `instance/step-resolver.ts` (pure: `resolveNextSteps`, `planCompletion`, `decideAssignee`) |
| สถานะ instance (ระงับ/ทำต่อ/ยกเลิก/ลบ) และ step (เริ่ม/เสร็จ/ปฏิเสธ) | `instance/instance-rules.ts` (pure) |
| Delegation: ความลึก ≤ 3 (MAX(depth)+1 เหมือน SP), ห้ามมอบให้ตัวเอง, ห้ามวนกลับหาคนที่เคยอยู่ในสาย, ต้อง `AllowDelegation`, มอบได้เฉพาะผู้รับผิดชอบ, ผู้รับต้องเป็นผู้ใช้ที่ใช้งานอยู่ | `delegation/delegation-rules.ts` (pure) + `delegation.service.ts` (เรียก `dbo.sp_WF_CreateDelegation`) |
| SLA: Overdue/AtRisk/OnTime จาก deadline + `WorkflowSLAWarningThresholdPercent`; deadline = SLAHours → SLADays×24 → ค่าเริ่มต้น | `sla/sla-calculator.ts` (pure) |
| รายงาน SLA (SP `sp_WF_GetSLAComplianceMetrics`, `sp_WF_GetTaskDistribution` + SQL by-template/weekly/cycle-time) และรายงานเกินกำหนดแบบสด | `sla/sla.service.ts`, `sla/sla.store.ts` |
| แจ้งเตือน workflow ตามค่าตั้ง `WorkflowNotification*` ผ่าน `NotificationsService` (หลัง commit, ไม่ทำให้งานหลักล้ม, ไม่แจ้งตัวเอง) | `common/wfe-notifications.service.ts` |
| CRUD-log: ทุก mutation ผ่าน `logged()` ด้วยชื่อ Action เดิม; event ของ instance/step instance ใช้ `entity` = `WorkflowInstance` / `WorkflowStepInstance` (id = WFInstanceId / WFStepInstanceId) เพื่อให้ `AuditLogsService.byWorkflowInstance` ค้นเจอ; template = `WorkflowDefinition` | ทุก service |
| รันซ้ำเมื่อถูกเลือกเป็น deadlock victim (SQL 1205) | `common/wfe-retry.ts` |

## 3. ส่วนที่ต่างจากระบบเดิม / ต้องตัดสินใจ

| # | เรื่อง | ระบบเดิม | API นี้ | เหตุผล / ทางเลือก |
|---|---|---|---|---|
| 1 | `IsActive` ของ template | รับจาก client; หน้าจอบางหน้าบันทึก `IsActive=1` ทั้งที่เป็น Draft (ข้อมูลจริงอาจมี Draft+IsActive=1) | คู่กับสถานะเสมอ (true เฉพาะ Active); สร้างเป็น Draft/false เสมอ; **สร้าง instance ต้อง `ApprovalStatus=Active` และ `IsActive`** | ตาม 04 §5.1. **ผลกับข้อมูลเดิม:** template ที่ใช้งานอยู่โดย Draft+IsActive=1 จะสร้าง instance ไม่ได้จนกว่าจะ Publish — แนะนำ DBA ตรวจ `SELECT WFDefinitionId, ApprovalStatus, IsActive FROM WFE.s_WFDefinition WHERE (ApprovalStatus=2) <> IsActive` แล้วตัดสินใจ (API ไม่แก้ข้อมูลเอง) |
| 2 | Publish/Deactivate | ไม่ตรวจสถานะก่อน (ทำได้จากทุกสถานะ) | ตามตารางเปลี่ยนสถานะ: Publish จาก Draft/Inactive, Deactivate จาก Active เท่านั้น; ใหม่: Deprecate | enum `Deprecated(4)` มีแต่เดิมไม่มี method; ทุกครั้งใช้ `UPDATE … WHERE ApprovalStatus = <ที่อ่านมา>` กันกดพร้อมกัน (409 `TEMPLATE_STATE_CHANGED`) |
| 3 | แก้ template | แก้ได้ทุกสถานะ (ตั้งใจ bypass การเช็ก instance) และ Version+1 | คงการแก้ได้ตอน Draft/Active/Inactive + Version+1; **ห้ามตอน PendingApproval/Deprecated**; **แก้ `TemplateDefinition` ของ Active/Inactive ที่มีแถว step แล้วไม่ได้** (422 `TEMPLATE_STRUCTURE_LOCKED`) | engine รันจากแถว s_WFStep ที่สร้างครั้งเดียว — แก้ JSON ภายหลังไม่มีผลกับ instance ใดเลย แต่หน้าจอเข้าใจว่าแก้แล้ว (เงียบ) → ปฏิเสธให้ชัด แนะนำคัดลอกเป็น Draft; Active ที่ยังไม่มีแถว (ผังอยู่ใน JSON อย่างเดียว) แก้ได้ตามเดิม |
| 4 | แถว step/connection | สร้างเฉพาะตอน instance แรก (fallback) · `UpdateStep/SoftDelete*` เป็น dead | Draft: บันทึก `TemplateDefinition` แบบ designer แล้วสร้างแถวให้ทันที (แทนของเดิม); มี CRUD step/connection เฉพาะ Draft; fallback เดิมยังอยู่ | ให้ผัง ↔ แถวตรงกันและตรวจกราฟได้ก่อนส่งอนุมัติ; แบบ wizard (ไม่มี Start/End) ไม่สร้างแถว |
| 5 | ตรวจผังก่อนส่งอนุมัติ/เผยแพร่ | ตรวจ Start/End เฉพาะฝั่ง designer ตอนกด Save | ตรวจที่ Submit/Approve/Publish (422 `TEMPLATE_GRAPH_INVALID` พร้อมรายการ `issues`) รวมตรวจว่า `AssignedUser` เป็นผู้ใช้ที่ใช้งานอยู่ | ตามที่ผู้ว่าจ้างระบุ; ผู้ใช้เป็นกลุ่ม AD/บทบาทอย่างเดียวถือว่าไม่ผ่าน (ดู #12) |
| 6 | "instance ที่ยังทำงานอยู่" | service เดิมนับเฉพาะ `InProgress` และ **กลืน exception คืน false**; repository อีกตัวใช้ `NOT IN (3,4)` (นับ Cancelled ด้วย) | ถือเป็นงานค้าง: 0, Created, InProgress, Suspended (ไม่รวม Completed/Rejected/Cancelled/ลบแล้ว) | ปลอดภัยสุดที่ไม่ลบ template ที่ยังมีงานทำอยู่; ไม่กลืน error |
| 7 | สิทธิ์ | service ไม่ตรวจเลย (`CanCreate/CanView` เป็น TODO คืน true) | ดูตารางสิทธิ์: เขียน template = Manager+; approve/reject/publish/deprecate = Admin; รายงาน SLA = Manager+; ระงับ/ทำต่อ/ยกเลิก = ผู้เริ่มหรือ Manager+; ดู instance = ผู้เริ่ม/ผู้มี step/Manager+; ลบ instance = Manager+; step = ผู้รับผิดชอบเท่านั้น | กฎเดิมอยู่ที่ UI/เมนูตาม role เท่านั้น (04 §0.1) — กำหนดแบบเข้มไว้ก่อน **ต้องยืนยันกับเจ้าของระบบ** (โดยเฉพาะ "Workflow Owner Committee" = Admin ได้หรือไม่) |
| 8 | สร้าง instance | 3 คำสั่งคอมมิตแยกกัน (instance → step → update); พลาดกลางทางเหลือ instance Status=0 ค้าง; ตรวจ Start หลังสร้าง instance | transaction เดียว; ตรวจ template/Start/ผู้รับผิดชอบ **ก่อน**เรียก SP; พลาด = rollback ทั้งหมด; แจ้งเตือนหลัง commit | แก้ข้อบกพร่องที่ระบุใน OPEN_QUESTIONS C12/05 §8 |
| 9 | ทำงานกับ step | ไม่ตรวจสถานะ instance (ระงับแล้วยังกดเสร็จได้); กันเฉพาะ "complete ซ้ำ" | ต้องเป็นผู้รับผิดชอบ, step ต้องยัง Pending/InProgress/Delegated, **instance ต้อง InProgress** | ให้ "ระงับ/ยกเลิก" มีผลจริง |
| 10 | ปฏิเสธ step | instance → Rejected แต่ step สาขาอื่นที่ค้าง (Parallel) ค้างเป็นงานผีของผู้อื่น | ปิด step ที่ค้างทั้งหมดเป็น Rejected ("ยกเลิก: workflow ถูกปฏิเสธ"); บังคับระบุเหตุผล | ไม่ให้เหลืองานที่ทำต่อไม่ได้ในรายการงาน |
| 11 | ยกเลิก instance | ปิดเฉพาะ Pending/InProgress, ยกเลิกได้แม้ Rejected | ปิด Pending/InProgress/**Delegated**; ยกเลิกจาก Created/InProgress/Suspended เท่านั้น | ตรงกับปุ่มใน `WorkflowInstanceDetailPresenter` |
| 12 | ผู้รับผิดชอบของ step | `AssignedUser ?? ผู้ทำรายการ`; ไม่ใช้ AssignedRole/AssignedOrgUnit (ค่า "AD Group: …" ใน AssignedUser กลายเป็นงานที่ไม่มีใครทำได้) | `AssignedUser` ต้องเป็นผู้ใช้ที่ใช้งานอยู่ (422 `STEP_ASSIGNEE_NOT_FOUND`); ระบุเฉพาะบทบาท/หน่วยงาน = 422 `STEP_ASSIGNEE_UNSUPPORTED`; ว่างทั้งหมดยังใช้ผู้ทำรายการ | ไม่เดาการ map บทบาท/กลุ่ม AD (คำถามเปิด Q1) · การมอบให้ผู้ทำรายการเงียบๆ เสี่ยง "อนุมัติเอง" |
| 13 | SLA deadline | `now + 24 ชม.` ทุก step (ไม่อ่าน SLAHours/SLADays ที่ designer ตั้ง) | `SLAHours` → `SLADays×24` → `WorkflowSLADefaultHours` (24) | ค่าที่ผู้ใช้ตั้งใน designer ควรมีผล — **กระทบตัวเลขรายงาน SLA เมื่อเทียบกับข้อมูลเดิม** |
| 14 | SLAStatus ที่แสดง | อ่านค่าที่เก็บ (ซึ่งเป็น 1 ตลอดจนกว่าจะเสร็จเพราะงานเบื้องหลัง dead) | งานที่เปิดอยู่คำนวณสดจาก deadline; รายงาน `compliance` ยังนับจากค่าที่เก็บ (ตาม SP) → ใช้ `/wfe/sla/overdue` ดูของจริง หรือเปิด `WorkflowEscalationEnabled` | ดู #28 |
| 15 | Delegation | `CanDelegate` เป็น TODO (ไม่ตรวจ AllowDelegation); ไม่ตรวจตัวเอง/วน/ผู้รับ; `DeactivateDelegation` แค่ปิดธง (งานค้างอยู่กับผู้รับ); `GetStepInstancesByUser` ไม่รวมสถานะ Delegated → **งานที่ถูกมอบหายจากรายการของทุกคน** | บังคับตามที่ระบุ + ผู้รับต้องเป็นผู้ใช้ที่ใช้งานอยู่; ยกเลิก/คืนงานคืนผู้รับผิดชอบให้ผู้มอบ (สถานะ Pending); `mine` รวมสถานะ Delegated; ความลึกสูงสุด 3 คงที่ (ไม่ใช้ `Step.MaxDelegationDepth` ซึ่งค่าเริ่มต้น DB = 1 และ UI เดิมใช้ไม่สม่ำเสมอ) | ตาราง `dbo.WFDelegation` มี 0 แถว — ฟีเจอร์ยังไม่เคยใช้จริงจึงปรับได้อย่างปลอดภัย · ความลึกนับจากประวัติทั้งหมด ไม่รีเซ็ตเมื่อคืนงาน · ผู้ที่เคยรับแล้วคืน ถือว่าอยู่ในสาย (มอบกลับให้ไม่ได้) |
| 16 | แจ้งเตือน | `WorkflowNotificationService` ทุกเมธอดเป็น TODO (แค่ log) | ส่งจริงผ่าน `NotificationsService` ตามค่าตั้ง เมื่อ: ได้รับงานใหม่, workflow เสร็จ (ถึงผู้เริ่ม), step ถูกปฏิเสธ (ถึงผู้เริ่ม), ได้รับมอบหมาย, คืนงาน, SLA ใกล้ครบ/เลยกำหนด | ตามที่ผู้ว่าจ้างระบุ; ค่าเริ่มต้น `WorkflowNotificationEnabled=true` (ตาม `WorkflowConfiguration.cs`) — ถ้าไม่ต้องการให้เริ่มส่งตอนสลับระบบ ให้ตั้ง `false` ก่อน |
| 17 | Audit | `Module` ไม่ระบุ; มี Action ซ้ำจาก UI (`…FromUI`, `…FromList`) | ชื่อ Action เดิมเป็น `operation`; Module = `WFE` (ชุดค่าของ `CrudModuleName` — tasklist เสนอ `Workflow`); ไม่ทำ log ซ้ำแบบ `…FromUI`; delegation ผูกกับ `WorkflowStepInstance` (เดิม `WFDelegation`+id ของ delegation ซึ่งไม่ตรงกับรหัส step instance จึงไม่เคยค้นเจอในหน้าประวัติ) | |
| 18 | เวลา UTC/ท้องถิ่น | `InitiatedDate`/Created/Modified/DeletedDate ของ template = UTC (`GETUTCDATE`), เวลาของ step = ท้องถิ่น | ยึดตามคอลัมน์เดิม (ไม่แปลง timezone ตาม CONVENTIONS) — จึงเห็น `initiatedDate` ช้ากว่าจริง 7 ชม.; **ระยะเวลาในกราฟ cycle-time คลาดเคลื่อน +7 ชม.** เหมือนเดิม | OPEN_QUESTIONS B10 รอการตัดสินใจ |
| 19 | รหัส step instance | ตาราง PK ประกอบ `(WorkflowStepInstanceId = MAX+1, WFStepInstanceId = IDENTITY)`; โค้ดเดิมอ้างด้วย **WFStepInstanceId** ทั้งหมด (SP คืน OUTPUT เป็นค่าเดียวกัน) | ใช้ `WFStepInstanceId` เป็น `workflowStepInstanceId` ใน API และ `dbo.WFDelegation.WorkflowStepInstanceId` | |
| 20 | ชื่อตารางมอบหมาย | (โจทย์ระบุ `WFE.t_WFDelegation`) | ตารางจริงคือ **`dbo.WFDelegation`** (DDL/SP) | ยึด DB |
| 21 | Deadlock | แต่ละคำสั่งคอมมิตแยกกัน | `sp_CreateWFStepInstance` ล็อกทั้งตาราง (`TABLOCKX,HOLDLOCK`) ถึงจบ transaction; อ่าน/ล็อกแถวก่อนเรียก SP อาจ deadlock → `withDeadlockRetry` (3 ครั้ง) ครอบทุก transaction ที่แก้ instance/step/delegation | ดูข้อ 5 ที่ต้องทดสอบจริง |
| 22 | Parallel / Decision / Merge | ไม่มีตรรกะพิเศษ | **คงพฤติกรรมเดิมทุกข้อ**: เงื่อนไขเส้นเชื่อมไม่ถูกประเมิน (evaluator เดิมเป็น stub คืน true) → Decision สร้างทุกสาขา; Merge ไม่รอสาขาอื่น (สาขาที่มาถึงทีหลังสร้าง step ซ้ำ); ถ้า step ถัดไปมีทั้ง End และ step อื่น จะปิด workflow โดยไม่สร้าง step อื่น | คำถามเปิด Q2 — ไม่เดาไวยากรณ์เงื่อนไข (เป็นข้อความอิสระที่ผู้ใช้พิมพ์); ล็อกไว้ด้วยเทสต์ `step-resolver.spec.ts` |
| 23 | Archive / Restore instance | `WorkflowDataRetentionService` ไม่อยู่ใน .csproj (dead) และเมธอดเป็น TODO ที่แค่เขียน audit | **ไม่ทำ** — ไม่มีคอลัมน์รองรับสถานะ archive ใน `WFE.t_WFInstance`; ทำเฉพาะ soft delete ของ instance ที่จบแล้ว (`WorkflowInstanceDeleted`) | ดูข้อ 4 |
| 24 | Version ของ template | `GetTemplateVersions` ค้นด้วย `WFDefinitionId` (PK) จึงได้แถวเดียว; `CompareTemplateVersions` เป็น TODO คืน "ไม่ต่าง" | `GET :id/versions` คืนแถวเดียวเหมือนเดิม; ไม่ทำ compare | ถ้าต้องการประวัติเวอร์ชันจริงต้องออกแบบตารางเก็บ snapshot (ยังไม่มีใน DB) |
| 25 | เพิ่มเติมที่เป็นประโยชน์ | — | `start` step, `deprecate`, `export/import`, `validation`, `sync-steps`, `tasks/summary`, `sla/overdue` (สด), `sla/refresh` | ทั้งหมดอิงฟีเจอร์ที่มีใน UI เดิมหรือจำเป็นต่อการใช้ API แบบ stateless |
| 26 | งานของฉัน | โหลดทั้งหมด แล้วเหลือหนึ่งแถวต่อ instance ตามความเร่งด่วน (InProgress > Pending > Rejected > Completed) | แบ่งหน้าในฐานข้อมูล เหลือหนึ่งแถวต่อ instance ตามลำดับเดียวกัน (Delegated เท่า Pending); Rejected ไม่แสดง (เดิม query ก็ไม่รวม) | `onlyOpen=true` ซ่อนงานที่เสร็จซึ่งเดิมแสดงต่อท้าย |
| 27 | รายงาน SLA | `byUser` มีค่าที่เป็น placeholder (`AvgOverdueDays=1.5`, `AverageCompletionHours=0`) และ `OnTimeCount = Completed − Overdue` | ส่งเฉพาะตัวเลขจริงที่ SP คืน (total/completed/pending/rejected/overdue) | ไม่ส่งค่าปลอม |
| 28 | `CheckAndEscalateSLA` | เขียน audit `SLAEscalated` แล้วคืน true (ส่วน escalate จริงเป็น TODO; `WFESLABackgroundJob` ไม่เคยถูกเรียก) | งานเบื้องหลังทำเท่านี้ + แจ้งเตือน และ**ทำเฉพาะตอนสถานะเปลี่ยน** (ไม่ซ้ำทุกรอบ); workflow ที่ถูกระงับไม่ถูกตรวจ | ดูข้อ 4 |

## 4. สิ่งที่ยังไม่ได้ทำ (deferred) และเหตุผล

- **Archive / Restore instance** — dead ในระบบเดิม และ DB ไม่มีที่เก็บสถานะ (ต้องมีคอลัมน์ เช่น `ArchivedDate` ผ่านสคริปต์ DBA ก่อน)
- **ประเมินเงื่อนไขเส้นเชื่อม / join ของ Merge / สาขา Decision เลือกทางเดียว** — ระบบเดิมไม่ทำ (ดู #22); ต้องกำหนดไวยากรณ์เงื่อนไขก่อน (Q2)
- **มอบหมายตามบทบาท/หน่วยงาน/กลุ่ม AD** (`AssignedRole`, `AssignedOrgUnit`) — ระบบเดิมไม่ใช้ค่านี้ (Q1)
- **อีเมลแจ้งเตือน** (`WorkflowNotificationEmailEnabled`) — API ไม่มีบริการอีเมล
- **ปฏิเสธอัตโนมัติเมื่อเลยกำหนด** (`WorkflowAutoRejectOnOverdue`) และ **ส่งต่อให้ผู้จัดการตามสายบังคับบัญชา** — ระบบเดิมเป็น dead/TODO และไม่มีนิยามว่าใครคือผู้จัดการของ step
- **หมดอายุของ delegation ตาม `EndDate`** — ระบบเดิมเก็บวันที่ไว้เฉยๆ ไม่บังคับ
- **Bottleneck analysis / escalation statistics / admin dashboard metrics** — ใช้ตาราง `dbo.WFSLARule` (dead) หรือเป็น TODO
- **Workflow Engine V2, Plugin registry, Compliance/PDPA/Encryption/DataRetention services, `WFDelegationRule` (OOF)** — ไม่ถูกเรียกใช้ (dead ตามภาคผนวก A)
- **ค้นหาพนักงาน/ผู้รับมอบ** — ใช้ `GET /users/lookup` ของ Shared (เดิม `GetEligibleDelegates` เป็น TODO)
- **ผังแบบ wizard → แถว step** — ต้องเติม Start/End ใน designer ก่อน (ไม่เดาแปลง)

### คำถามเปิดสำหรับเจ้าของระบบ
1. **Q1** `AssignedUser` ที่เป็น "AD Group: …" / `AssignedRole` ต้องการให้ resolve เป็นผู้ใช้อย่างไร (ตอนนี้ API ปฏิเสธและบอกให้ระบุชื่อผู้ใช้)
2. **Q2** Decision/Parallel/Merge: ต้องการให้เงื่อนไขเส้นเชื่อมทำงานจริงหรือไม่ (ไวยากรณ์?), Merge ต้องรอทุกสาขาหรือไม่ — ตอนนี้คงพฤติกรรมเดิม
3. **Q3** "Workflow Owner Committee" ที่อนุมัติ template คือกลุ่มใด (ตอนนี้ map เป็น Admin) และใครสร้าง/ส่งอนุมัติได้ (ตอนนี้ Manager+)
4. **Q4** เปิด `WorkflowNotificationEnabled` ตั้งแต่วันแรกหรือไม่ (ระบบเดิมไม่เคยส่งแจ้งเตือน workflow จริง)
5. **Q5** เปิดงานเบื้องหลัง SLA (`WorkflowEscalationEnabled`) เมื่อใด และต้องการ escalate ไปที่ใดนอกจากผู้รับผิดชอบ/ผู้เริ่ม
6. **Q6** template เดิมที่ Draft+`IsActive=1` (ดู #1) ให้ Publish/ย้ายสถานะอย่างไร

## 5. ต้องทดสอบกับ SQL Server จริง (เทสต์อัตโนมัติพิสูจน์ไม่ได้)

เทสต์ทั้งหมดเป็น in-memory (`test/unit/wfe/fakes.ts` จำลอง store/SP/transaction ตามนิยามจริง) — พิสูจน์ตรรกะ ลำดับการเรียก SP, rollback และ CRUD-log แต่**ไม่ได้รัน SQL** รายการต่อไปนี้ต้องทดสอบมือ:

1. `WFE.sp_CreateWFInstance` → `sp_CreateWFStepInstance` ใน transaction เดียวของ `TransactionRunner`: ค่า OUTPUT `NewWFInstanceId` / `NewWFStepInstanceId`, `BEGIN TRAN` ซ้อน + `SET XACT_ABORT ON` ในตัว SP, `SLADeadline` ที่ส่งเป็น `Date` (SP แปลงเป็นสตริง 126 แล้วกลับเป็น datetime), `SLAStatus` เริ่มที่ 1
2. **Deadlock/ล็อก**: จบ step พร้อมกันสองคำขอต่างกัน (UPDLOCK แถว + `TABLOCKX` ของ SP), delegation พร้อมกับ complete, ตรวจว่า `withDeadlockRetry` ทำงาน และไม่มีการค้างล็อกนานผิดปกติ (ตารางเล็ก 168 แถว)
3. `UPDATE … ; SELECT @@ROWCOUNT AS n;` ในแบตช์เดียว — ตรวจว่า TypeORM `query()` คืน recordset ของ SELECT (ใช้คืนจำนวนแถวที่แก้)
4. `WITH (UPDLOCK, ROWLOCK)` ที่ต่อท้ายชื่อตารางที่มี alias (`FROM WFE.t_WFStepInstance si WITH (UPDLOCK, ROWLOCK)`)
5. TypeORM: `update()` ที่ใช้ `() => 'GETUTCDATE()'`, `insert()` ของ `WfDefinition/WfStep/WfConnection` (ค่า `DEFAULT` ของคอลัมน์ที่ไม่ส่ง และ `identifiers`), การโหลด metadata ของ entity `WfStepInstance` ที่มี PK ประกอบ (`PrimaryColumn` + `PrimaryGeneratedColumn`)
6. SQL รายการ: `COUNT(*) OVER ()` + `OFFSET/FETCH`, CTE + `ROW_NUMBER()` ของ `tasks/mine` (รวมลำดับความสำคัญ), `TOP (@1)` ของงาน SLA, `LIKE … ESCAPE '\'`, ชื่อ bucket ที่มีอักษร en-dash (`N'0–1'`), `DATEPART(WEEK)` กับการตั้งค่า `DATEFIRST` ของเซิร์ฟเวอร์
7. `sp_getapplock` แบบ `Session` บน connection เฉพาะ (ปล่อยล็อกเมื่อ `release()`/ปิด connection) ของงาน SLA; พฤติกรรมเมื่อรันสอง instance พร้อมกัน
8. `dbo.sp_WF_CreateDelegation` ใน transaction: การปิด delegation เดิมก่อนตรวจความลึก (rollback เมื่อ RAISERROR), ข้อความ `Maximum delegation depth exceeded` ถูกแปลงเป็น 422
9. `sp_WF_GetSLAComplianceMetrics` เมื่อไม่มีแถว (SUM เป็น NULL) และ `sp_WF_GetTaskDistribution`
10. เวลา: ค่า `datetime` ที่อ่าน/เขียนด้วย `useUTC:false` (คอลัมน์ UTC vs ท้องถิ่น ดู #18), การเทียบ `SLADeadline < now` ของรายงานเกินกำหนด
11. **ข้อมูลเดิมในฐานจริง**: template ที่ `ApprovalStatus`/`IsActive` ไม่คู่กัน, step ที่ `AssignedUser` เป็นชื่อกลุ่ม, instance สถานะ 0 ค้าง, template ที่มีแต่ JSON ไม่มีแถว step (fallback), รูปแบบ `TemplateDefinition` จริงทั้ง designer/wizard ผ่าน `GET :id` และ `validation`
12. ผลของ `NotificationsService` กับ `EMS.Notification` (525k แถว) เมื่อเปิดแจ้งเตือน workflow; ตัว UI ที่อ่าน `EventType` ใหม่ (`WorkflowTaskAssigned`, `WorkflowCompleted`, `WorkflowTaskRejected`, `WorkflowTaskDelegated`, `WorkflowDelegationEnded`, `WorkflowSLAWarning`, `WorkflowSLAEscalated`)

## 6. ขอแก้ core (ถ้ามี)

ยังไม่ได้แก้ไฟล์นอกขอบเขต — ข้อเสนอสำหรับเจ้าของ core/Shared:

1. **`UsersService.findByAdUserNames(names)`** (Shared) — WFE ต้องแปลงชื่อผู้ใช้ AD ↔ UserID และตรวจว่าผู้ใช้ใช้งานอยู่ จึงอ่าน `EMS.UserAccount` แบบอ่านอย่างเดียวผ่าน `common/wfe-user-directory.ts` ชั่วคราว
2. **`TransactionRunner`**: เสนอเพิ่มตัวเลือก retry เมื่อ deadlock (1205) เป็นมาตรฐานกลาง — ตอนนี้ WFE มี `common/wfe-retry.ts` ของตัวเอง
3. **`GET /audit-logs/workflow-instances/:instanceId`** (Shared) ไม่ตรวจสิทธิ์ (ผู้ที่ login ใครก็อ่าน audit ของ workflow ใดก็ได้) — WFE ให้ `GET /wfe/instances/:id/history` ที่ตรวจสิทธิ์ดู instance แล้ว; ควรจำกัด/ยกเลิก endpoint เดิม
4. **`CrudModuleName`**: tasklist §5 เสนอ `Module='Workflow'` สำหรับ audit WFE แต่ชุดค่ามาตรฐานคือ `WFE` — ถ้ารายงาน audit เดิมกรองตามชื่อ Module ต้องตัดสินใจร่วมกัน
5. **ค่าตั้งใหม่ใน `dbo.SystemConfig`** ตามข้อ 1.6 (ยังไม่มีตัวสร้างค่าเริ่มต้น — ใช้ค่า default ในโค้ดเมื่อไม่มี key)
