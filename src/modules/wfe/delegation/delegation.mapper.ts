import type { WfDelegation } from '../entities/wf-delegation.entity';
import type { DelegationDto } from './dto/delegation.dto';
import type { DelegationHistoryItem } from './delegation-rules';

export function toDelegationDto(d: WfDelegation): DelegationDto {
  return {
    wfDelegationId: d.wfDelegationId,
    workflowStepInstanceId: d.workflowStepInstanceId,
    delegatedFrom: d.delegatedFrom,
    delegatedTo: d.delegatedTo,
    delegationReason: d.delegationReason ?? null,
    delegationDate: d.delegationDate as Date,
    delegationDepth: d.delegationDepth,
    isActive: Boolean(d.isActive),
    startDate: d.startDate ?? null,
    endDate: d.endDate ?? null,
    remarks: d.remarks ?? null,
  };
}

export function toHistoryItem(d: WfDelegation): DelegationHistoryItem {
  return {
    delegationId: d.wfDelegationId,
    delegatedFrom: d.delegatedFrom,
    delegatedTo: d.delegatedTo,
    delegationDepth: d.delegationDepth,
    isActive: Boolean(d.isActive),
  };
}
