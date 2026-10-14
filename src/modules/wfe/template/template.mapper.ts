import { WorkflowStepType, WorkflowTemplateStatus } from '../../../common/constants/enums';
import type { WfConnection } from '../entities/wf-connection.entity';
import type { WfDefinition } from '../entities/wf-definition.entity';
import type { WfStep } from '../entities/wf-step.entity';
import type { DesignConnection, DesignStep } from './template-definition';
import type { TemplateCounts, TemplateListRow } from './template.store';
import type {
  ConnectionDto,
  StepDto,
  TemplateSummaryDto,
  TemplateVersionDto,
} from './dto/template.dto';

export function toSummaryFromRow(r: TemplateListRow): TemplateSummaryDto {
  return {
    workflowDefinitionId: r.wfDefinitionId,
    name: r.wfName,
    description: r.wfDescription ?? null,
    category: r.category ?? null,
    version: r.version,
    isActive: Boolean(r.isActive),
    approvalStatus: r.approvalStatus as WorkflowTemplateStatus,
    createdBy: r.createdBy,
    createdDate: r.createdDate,
    modifiedBy: r.modifiedBy ?? null,
    modifiedDate: r.modifiedDate ?? null,
    submittedBy: r.submittedBy ?? null,
    submittedDate: r.submittedDate ?? null,
    approvedBy: r.approvedBy ?? null,
    approvedDate: r.approvedDate ?? null,
    rejectionReason: r.rejectionReason ?? null,
    disabledBy: r.disabledBy ?? null,
    disabledDate: r.disabledDate ?? null,
    disabledReason: r.disabledReason ?? null,
    stepCount: Number(r.stepCount ?? 0),
    totalInstanceCount: Number(r.totalInstanceCount ?? 0),
    activeInstanceCount: Number(r.activeInstanceCount ?? 0),
  };
}

export function toSummary(e: WfDefinition, counts?: TemplateCounts): TemplateSummaryDto {
  return {
    workflowDefinitionId: e.wfDefinitionId,
    name: e.wfName,
    description: e.wfDescription ?? null,
    category: e.category ?? null,
    version: e.version ?? 1,
    isActive: Boolean(e.isActive),
    approvalStatus: (e.approvalStatus ?? 0) as WorkflowTemplateStatus,
    createdBy: e.createdBy,
    createdDate: e.createdDate as Date,
    modifiedBy: e.modifiedBy ?? null,
    modifiedDate: e.modifiedDate ?? null,
    submittedBy: e.submittedBy ?? null,
    submittedDate: e.submittedDate ?? null,
    approvedBy: e.approvedBy ?? null,
    approvedDate: e.approvedDate ?? null,
    rejectionReason: e.rejectionReason ?? null,
    disabledBy: e.disabledBy ?? null,
    disabledDate: e.disabledDate ?? null,
    disabledReason: e.disabledReason ?? null,
    stepCount: counts?.stepCount ?? 0,
    totalInstanceCount: counts?.totalInstanceCount ?? 0,
    activeInstanceCount: counts?.activeInstanceCount ?? 0,
  };
}

export function toVersion(e: WfDefinition): TemplateVersionDto {
  return {
    workflowDefinitionId: e.wfDefinitionId,
    version: e.version ?? 1,
    name: e.wfName,
    createdBy: e.createdBy,
    createdDate: e.createdDate as Date,
    isActive: Boolean(e.isActive),
  };
}

export function toStepDto(e: WfStep): StepDto {
  return {
    workflowStepId: e.wfStepId,
    workflowDefinitionId: e.wfDefinitionId,
    stepName: e.stepName,
    stepType: (e.stepType ?? 0) as WorkflowStepType,
    description: e.description ?? null,
    assignedRole: e.assignedRole ?? null,
    assignedUser: e.assignedUser ?? null,
    assignedOrgUnit: e.assignedOrgUnit ?? null,
    slaHours: e.slaHours ?? null,
    slaDays: e.slaDays ?? null,
    allowDelegation: Boolean(e.allowDelegation),
    maxDelegationDepth: e.maxDelegationDepth ?? 1,
    sequenceNumber: e.sequenceNumber,
    stepConfig: e.stepConfig ?? null,
  };
}

export function toConnectionDto(e: WfConnection): ConnectionDto {
  return {
    workflowConnectionId: e.wfConnectionId,
    workflowDefinitionId: e.wfDefinitionId,
    fromStepId: e.fromStepId,
    toStepId: e.toStepId,
    conditionExpression: e.conditionExpression ?? null,
    sequenceNumber: e.sequenceNumber,
  };
}

/** step ที่ยังไม่มีแถวใน DB (อ่านจาก definition) — workflowStepId = รหัสใน layout ของ designer */
export function toStepDtoFromDesign(definitionId: number, s: DesignStep): StepDto {
  return {
    workflowStepId: s.key,
    workflowDefinitionId: definitionId,
    stepName: s.stepName,
    stepType: s.stepType,
    description: s.description,
    assignedRole: null,
    assignedUser: s.assignedUser,
    assignedOrgUnit: null,
    slaHours: null,
    slaDays: s.slaDays,
    allowDelegation: s.allowDelegation,
    maxDelegationDepth: 1,
    sequenceNumber: s.sequenceNumber,
    stepConfig: null,
  };
}

export function toConnectionDtoFromDesign(
  definitionId: number,
  c: DesignConnection,
): ConnectionDto {
  return {
    workflowConnectionId: c.sequenceNumber,
    workflowDefinitionId: definitionId,
    fromStepId: c.fromKey,
    toStepId: c.toKey,
    conditionExpression: c.condition,
    sequenceNumber: c.sequenceNumber,
  };
}
