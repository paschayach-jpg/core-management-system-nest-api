/**
 * ค่าคงที่กลางของ WFE — ชื่อ operation ใน CRUD-log (ตรงกับชื่อ Action ใน audit.AuditLog ของระบบเดิม),
 * entity ที่ใช้เป็น TableName, key ค่าตั้งใน dbo.SystemConfig และค่า default
 */

/** TableName เดิมของ audit ที่ผูกกับ instance — `AuditLogsService.byWorkflowInstance` ค้นด้วยสองชื่อนี้ */
export const WFE_ENTITY = {
  template: 'WorkflowDefinition',
  step: 'WorkflowStep',
  connection: 'WorkflowConnection',
  instance: 'WorkflowInstance',
  stepInstance: 'WorkflowStepInstance',
  delegation: 'WFDelegation',
} as const;

/** ชื่อ Action เดิมของ audit (06-service-use-cases.md คอลัมน์ Audit) — ใส่เป็น `operation` ของ CRUD-log */
export const WFE_OP = {
  // template
  templateCreated: 'WorkflowTemplateCreated',
  templateUpdated: 'WorkflowTemplateUpdated',
  templateDeleted: 'WorkflowTemplateDeleted',
  templateSubmitted: 'WorkflowTemplateSubmittedForApproval',
  templateApproved: 'WorkflowTemplateApproved',
  templateRejected: 'WorkflowTemplateRejected',
  templatePublished: 'WorkflowTemplatePublished',
  templateDeactivated: 'WorkflowTemplateDeactivated',
  /** ใหม่ — ระบบเดิมมี enum Deprecated แต่ไม่มี method */
  templateDeprecated: 'WorkflowTemplateDeprecated',
  templateDuplicated: 'WorkflowTemplateDuplicated',
  templateExported: 'WorkflowTemplateExported',
  templateImported: 'WorkflowTemplateImported',
  templateStepsSynced: 'WorkflowTemplateStepsSynced',
  stepCreated: 'WorkflowStepCreated',
  stepUpdated: 'WorkflowStepUpdated',
  stepDeleted: 'WorkflowStepDeleted',
  connectionCreated: 'WorkflowConnectionCreated',
  connectionUpdated: 'WorkflowConnectionUpdated',
  connectionDeleted: 'WorkflowConnectionDeleted',
  // instance / step instance
  instanceCreated: 'WorkflowInstanceCreated',
  instanceSuspended: 'WorkflowInstanceSuspended',
  instanceResumed: 'WorkflowInstanceResumed',
  instanceCancelled: 'WorkflowInstanceCancelled',
  instanceDeleted: 'WorkflowInstanceDeleted',
  /** ใหม่ — ระบบเดิมไม่มีการกด "เริ่มงาน" (Pending → InProgress) */
  stepStarted: 'WorkflowStepStarted',
  stepCompleted: 'WorkflowStepCompleted',
  stepRejected: 'WorkflowStepRejected',
  // delegation
  taskDelegated: 'TaskDelegated',
  delegationDeactivated: 'DelegationDeactivated',
  /** ใหม่ — ผู้รับมอบคืนงานให้ผู้มอบ */
  delegationReturned: 'DelegationReturned',
  // SLA
  slaEscalated: 'SLAEscalated',
  slaRefreshed: 'SLAStatusRefreshed',
} as const;

/** key ใน dbo.SystemConfig (05-cross-cutting.md §6) */
export const WFE_CONFIG_KEY = {
  slaDefaultHours: 'WorkflowSLADefaultHours',
  slaWarningThresholdPercent: 'WorkflowSLAWarningThresholdPercent',
  slaJobIntervalMinutes: 'WorkflowSLAJobIntervalMinutes',
  escalationEnabled: 'WorkflowEscalationEnabled',
  autoRejectOnOverdue: 'WorkflowAutoRejectOnOverdue',
  notificationEnabled: 'WorkflowNotificationEnabled',
  notificationInAppEnabled: 'WorkflowNotificationInAppEnabled',
  notificationEmailEnabled: 'WorkflowNotificationEmailEnabled',
} as const;

/** ค่าเริ่มต้นเมื่อ key ไม่อยู่ใน SystemConfig (ตาม WorkflowConfiguration.cs / SLACalculator.cs เดิม) */
export const WFE_DEFAULTS = {
  slaDefaultHours: 24,
  slaWarningThresholdPercent: 75,
  slaJobIntervalMinutes: 5,
  /** ปิดเป็นค่าเริ่มต้น — งานเบื้องหลัง SLA/escalation ของระบบเดิมเป็น dead code */
  escalationEnabled: false,
  autoRejectOnOverdue: false,
  notificationEnabled: true,
  notificationInAppEnabled: true,
  notificationEmailEnabled: false,
} as const;

/** ลึกสูงสุดของการมอบหมายต่อ step instance (sp_WF_CreateDelegation default 3; DelegationService เดิมเช็ก >= 3) */
export const MAX_DELEGATION_DEPTH = 3;

/** `WFE.sp_CreateWFInstance` ใส่ Status = 0 (ไม่อยู่ใน enum) แล้ว service ปรับเป็น InProgress ภายหลัง */
export const SP_INITIAL_INSTANCE_STATUS = 0;

/** instance ที่ "ยังทำงานอยู่" = ลบ template ไม่ได้: SP ใส่ 0, Created, InProgress, Suspended */
export const OPEN_INSTANCE_STATUSES: readonly number[] = [0, 1, 2, 5];

/** instance ที่จบแล้ว (ลบ/ซ่อนได้): Completed, Rejected, Cancelled */
export const TERMINAL_INSTANCE_STATUSES: readonly number[] = [3, 4, 6];

/** step instance ที่ "ยังเปิดอยู่" — Pending, InProgress, Delegated (นิยามเดียวกับ CompleteWorkflowStep เดิม) */
export const OPEN_STEP_STATUSES: readonly number[] = [1, 2, 5];

/** ขนาดสูงสุดของ TemplateDefinition (ตัวอักษร) — กัน payload ใหญ่เกินเหตุ */
export const MAX_TEMPLATE_DEFINITION_CHARS = 2_000_000;
