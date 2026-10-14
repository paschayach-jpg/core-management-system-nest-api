/**
 * รายการตารางที่ระบบใช้งานจริง (63 ตาราง) -> module / ชื่อ class / DataSource
 * ที่มา: docs/reference/legacy-analysis (วิเคราะห์ call graph ของระบบเดิม) + docs/reference/db-export (DDL จริง)
 */
export type ModuleName = 'shared' | 'dms' | 'kms' | 'rgp' | 'wfe';
export type DataSourceName = 'main' | 'project';

export interface ManualColumn {
  name: string;
  type: string; // ชนิด SQL เช่น int, nvarchar(200), datetime
  nullable?: boolean;
  identity?: boolean;
  pk?: boolean;
}

export interface TableConfig {
  /** ชื่อเต็มตามที่ใช้ใน export: `schema.table` หรือ `BUI_RG.dbo.table` */
  key: string;
  module: ModuleName;
  className: string;
  dataSource?: DataSourceName;
  /** ตารางที่ไม่มี DDL ใน export — ระบุคอลัมน์เอง (ต้องตรวจกับ DB จริง) */
  manual?: ManualColumn[];
  /** คอลัมน์ที่ไม่ส่งออกใน JSON (เช่น password hash) */
  hidden?: string[];
  /** ใช้ตัดคำนำหน้า i_/c_/n_/d_/f_ ของตาราง RGP */
  stripRgpPrefix?: boolean;
  /** สร้าง DTO (create/update) ให้ one-time (ไม่เขียนทับไฟล์ที่มีอยู่) */
  scaffoldDto?: { omit?: string[] };
  /** ใช้เมื่อตารางจริงไม่มี PK constraint (TypeORM ต้องมีคอลัมน์ PK อย่างน้อยหนึ่งคอลัมน์) */
  fallbackPk?: string[];
  note?: string;
}

const rgp = (key: string, className: string, extra: Partial<TableConfig> = {}): TableConfig => ({
  key,
  module: 'rgp',
  className,
  stripRgpPrefix: true,
  ...extra,
});

export const TABLES: TableConfig[] = [
  // ───────── Shared ─────────
  { key: 'EMS.UserAccount', module: 'shared', className: 'UserAccount' },
  { key: 'EMS.OrgUnit', module: 'shared', className: 'OrgUnit' },
  {
    key: 'EMS.OrgUnitRelationship',
    module: 'shared',
    className: 'OrgUnitRelationship',
    fallbackPk: ['RelationshipID'],
    note: 'ตารางจริงไม่มี PK constraint (RelationshipID เป็น identity)',
  },
  { key: 'EMS.m_Division', module: 'shared', className: 'HrDivision' },
  { key: 'EMS.m_Department', module: 'shared', className: 'HrDepartment' },
  {
    key: 'EMS.m_Role',
    module: 'shared',
    className: 'HrPosition',
    note: 'ตำแหน่ง (ชื่อตารางสลับกับ m_Position ตามระบบเดิม)',
  },
  {
    key: 'EMS.m_Position',
    module: 'shared',
    className: 'HrPositionLevel',
    note: 'ระดับตำแหน่ง (LevelCode)',
  },
  { key: 'EMS.m_PositionMapping', module: 'shared', className: 'HrPositionMapping' },
  { key: 'EMS.m_SubCommittee', module: 'shared', className: 'SubCommittee' },
  { key: 'EMS.m_Employee', module: 'shared', className: 'Employee' },
  { key: 'EMS.Notification', module: 'shared', className: 'Notification' },
  { key: 'EMS.MenuItem', module: 'shared', className: 'MenuItem' },
  { key: 'audit.AuditLog', module: 'shared', className: 'AuditLog' },
  {
    key: 'dbo.SystemConfig',
    module: 'shared',
    className: 'SystemConfig',
    note: 'ยังไม่มี DDL ใน export — คอลัมน์อนุมานจาก SP sp_GetSystemConfig/sp_UpsertSystemConfig (ดู docs/OPEN_QUESTIONS A2)',
    manual: [
      { name: 'ConfigKey', type: 'nvarchar(200)', pk: true },
      { name: 'ConfigValue', type: 'nvarchar(2000)', nullable: true },
      { name: 'UpdatedByUserId', type: 'int', nullable: true },
      { name: 'UpdatedDate', type: 'datetime', nullable: true },
    ],
  },
  // ───────── DMS ─────────
  { key: 'EMS.FolderAuthorityConfig', module: 'dms', className: 'FolderAuthorityConfig' },
  { key: 'dms.FolderQuotaChangeRequest', module: 'dms', className: 'FolderQuotaChangeRequest' },
  { key: 'security.FilePermission', module: 'dms', className: 'FilePermission' },
  { key: 'security.FolderPermission', module: 'dms', className: 'FolderPermission' },
  { key: 'security.UserOrgVisibility', module: 'dms', className: 'UserOrgVisibility' },
  {
    key: 'storage.ExternalShare',
    module: 'dms',
    className: 'ExternalShare',
    hidden: ['PasswordHash'],
  },
  { key: 'storage.FileDocument', module: 'dms', className: 'FileDocument' },
  { key: 'storage.Folder', module: 'dms', className: 'Folder' },
  { key: 'storage.FolderTemplate', module: 'dms', className: 'FolderTemplate' },
  { key: 'storage.FolderTemplateItem', module: 'dms', className: 'FolderTemplateItem' },
  {
    key: 'storage.QuickAccessFolder',
    module: 'dms',
    className: 'QuickAccessFolder',
    note: 'ยังไม่มี DDL ใน export — คอลัมน์อนุมานจาก SP sp_AddQuickAccess/sp_GetQuickAccessByUser (ดู docs/OPEN_QUESTIONS A1)',
    manual: [
      { name: 'QuickAccessID', type: 'int', pk: true, identity: true },
      { name: 'UserID', type: 'int' },
      { name: 'FolderID', type: 'int' },
      { name: 'AddedDate', type: 'datetime' },
    ],
  },
  { key: 'storage.ShareAccessLog', module: 'dms', className: 'ShareAccessLog' },
  { key: 'storage.ShareToken', module: 'dms', className: 'ShareToken' },
  { key: 'workflow.ApprovalRequest', module: 'dms', className: 'ApprovalRequest' },
  { key: 'workflow.ApprovalStep', module: 'dms', className: 'ApprovalStep' },
  // ───────── KMS ─────────
  { key: 'KMS.m_KBArticleDisplayProfile', module: 'kms', className: 'KbArticleDisplayProfile' },
  {
    key: 'KMS.m_KBArticleDisplayProfileColumn',
    module: 'kms',
    className: 'KbArticleDisplayProfileColumn',
  },
  { key: 'KMS.m_KBCategory', module: 'kms', className: 'KbCategory' },
  { key: 'KMS.m_KBImportTemplate', module: 'kms', className: 'KbImportTemplate' },
  { key: 'KMS.m_KBImportTemplateColumn', module: 'kms', className: 'KbImportTemplateColumn' },
  { key: 'KMS.t_KBArticle', module: 'kms', className: 'KbArticle' },
  { key: 'KMS.t_KBArticleAttachment', module: 'kms', className: 'KbArticleAttachment' },
  { key: 'KMS.t_KBArticleLink', module: 'kms', className: 'KbArticleLink' },
  { key: 'KMS.t_KBVersion', module: 'kms', className: 'KbVersion' },
  // ───────── RGP ─────────
  rgp('RGP.m_project_member_role', 'ProjectMemberRole'),
  rgp('RGP.m_project_template', 'ProjectTemplate'),
  rgp('RGP.m_template_doc', 'TemplateDoc'),
  rgp('RGP.m_template_state', 'TemplateState'),
  rgp('RGP.t_project', 'Project'),
  rgp('RGP.t_project_audit_log', 'ProjectAuditLog'),
  rgp('RGP.t_project_doc_workflow', 'ProjectDocWorkflow'),
  rgp('RGP.t_project_member', 'ProjectMember'),
  rgp('RGP.t_project_notify_log', 'ProjectNotifyLog'),
  rgp('RGP.t_project_progress', 'ProjectProgress'),
  rgp('RGP.t_project_state', 'ProjectState'),
  rgp('RGP.t_project_state_member', 'ProjectStateMember'),
  rgp('RGP.t_project_task', 'ProjectTask'),
  rgp('RGP.t_project_task_comment', 'ProjectTaskComment'),
  rgp('RGP.t_project_task_status_log', 'ProjectTaskStatusLog'),
  rgp('storage.t_project_attachment', 'ProjectAttachment', {
    note: 'อยู่ schema storage แต่ใช้เฉพาะ RGP',
  }),
  rgp('BUI_RG.dbo.m_document', 'MasterDocument', { dataSource: 'project', stripRgpPrefix: false }),
  rgp('BUI_RG.dbo.m_document_type', 'MasterDocumentType', {
    dataSource: 'project',
    stripRgpPrefix: false,
  }),
  rgp('RunningNumber', 'RunningNumber', { dataSource: 'project', stripRgpPrefix: false }),
  // ───────── WFE ─────────
  { key: 'WFE.s_WFConnection', module: 'wfe', className: 'WfConnection' },
  { key: 'WFE.s_WFDefinition', module: 'wfe', className: 'WfDefinition' },
  { key: 'WFE.s_WFStep', module: 'wfe', className: 'WfStep' },
  { key: 'WFE.t_WFInstance', module: 'wfe', className: 'WfInstance' },
  { key: 'WFE.t_WFStepInstance', module: 'wfe', className: 'WfStepInstance' },
  { key: 'dbo.WFDelegation', module: 'wfe', className: 'WfDelegation' },
];

/** หมายเหตุค่า enum ต่อคอลัมน์ (แสดงเป็น JSDoc ในเอนทิตี) */
export const COLUMN_NOTES: Record<string, string> = {
  'storage.Folder.ConfidentialityLevel': '1=HC, 2=SC, 3=NC, 4=PC',
  'storage.FolderTemplateItem.ConfidentialityLevel': '1=HC, 2=SC, 3=NC, 4=PC',
  'storage.FileDocument.FileStatus': '1=Active, 2=Archived, 3=Deleted(soft)',
  'storage.FileDocument.VirusScanStatus': '0=Pending, 1=Clean, 2=Infected, 3=Error',
  'workflow.ApprovalRequest.RequestStatus': '1=Pending, 2=Approved, 3=Rejected, 4=Expired',
  'workflow.ApprovalRequest.RequestType':
    'CREATE_HC|UPLOAD_HC|DELETE_FOLDER|CHANGE_PERMISSION|DOWNLOAD_FILE|EXTERNAL_SHARE|INTERNAL_SHARE|SHARE_PERMISSION_CHANGE',
  'workflow.ApprovalStep.StepStatus': '1=Pending, 2=Approved, 3=Rejected, 4=Delegated',
  'security.FolderPermission.PrincipalType': '1=User, 2=Role, 3=Department, 4=Division',
  'security.FilePermission.PrincipalType': '1=User, 2=Role, 3=Department, 4=Division',
  'dms.FolderQuotaChangeRequest.Status': '1=Pending, 2=Approved, 3=Rejected, 4=Cancelled',
  'KMS.t_KBArticle.Status': '1=Draft, 2=Review, 3=Published, 4=Archived',
  'KMS.t_KBArticle.ArticleType': '1=ขั้นตอนงาน, 2=FAQ, 3=แนวทางปฏิบัติ, 4=แม่แบบ, 5=กฎ/นโยบาย',
  'KMS.t_KBArticleLink.EntityType': '1=Folder, 2=Task, 3=Program, 4=Law, 5=Project, 6=Department',
  'EMS.UserAccount.AppRole': '1=Officer, 2=SrOfficer, 3=Manager, 4=Admin',
  'EMS.OrgUnit.OrgUnitType': '1=SubCommittee, 2=Division, 3=Department',
  'EMS.FolderAuthorityConfig.LevelCode': '1HC|2SC|3NC|4PC',
  'WFE.t_WFInstance.Status':
    '1=Created, 2=InProgress, 3=Completed, 4=Rejected, 5=Suspended, 6=Cancelled (SP ใส่ 0 ตอนสร้าง)',
  'WFE.t_WFStepInstance.Status': '1=Pending, 2=InProgress, 3=Completed, 4=Rejected, 5=Delegated',
  'WFE.t_WFStepInstance.SLAStatus': '1=OnTime, 2=AtRisk, 3=Overdue',
  'WFE.s_WFStep.StepType':
    '1=Start, 2=Approval, 3=Review, 4=Notification, 5=Parallel, 6=Decision, 7=Merge, 8=End',
  'WFE.s_WFDefinition.ApprovalStatus':
    '0=Draft, 1=PendingApproval, 2=Active, 3=Inactive, 4=Deprecated',
  'storage.ExternalShare.ShareTokenStatus': 'Pending|Active|Disabled|Expired|Revoked',
  'storage.ShareToken.Status': 'Pending|Active|Disabled|Expired|Revoked',
  'storage.ShareAccessLog.AccessType': 'View|Download',
  'storage.FolderTemplate.TargetType': 'Any|SubCommittee|Division|Department',
  'RGP.t_project.c_status': 'Open|InProgress|Completed',
  'RGP.t_project_state.c_status': 'Pending|InProgress|Completed',
  'RGP.t_project_task.c_status': 'Todo|InProgress|Done|OnHold|Cancelled',
};
