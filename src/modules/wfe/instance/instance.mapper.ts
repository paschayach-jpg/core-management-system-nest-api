import {
  SlaStatus,
  WorkflowInstanceStatus,
  WorkflowStepInstanceStatus,
  WorkflowStepType,
} from '../../../common/constants/enums';
import { OPEN_STEP_STATUSES } from '../common/wfe.constants';
import { evaluateSlaStatus, minutesRemaining } from '../sla/sla-calculator';
import type { StepInstanceDto, TaskDto, InstanceSummaryDto } from './dto/instance.dto';
import type { InstanceListRow, StepInstanceRow, TaskRow } from './instance.store';

const isOpenStep = (status: number) => OPEN_STEP_STATUSES.includes(status);

/**
 * สถานะ SLA ที่แสดง: งานที่ยังเปิดอยู่คำนวณสดจาก deadline (ค่าใน DB ล้าสมัยได้เพราะงาน SLA เบื้องหลังปิดเป็นค่าเริ่มต้น)
 * งานที่ปิดแล้วใช้ค่าที่บันทึกไว้ตอนปิด
 */
export function liveSlaStatus(r: StepInstanceRow, now: Date, thresholdPercent: number): SlaStatus {
  if (isOpenStep(r.status))
    return evaluateSlaStatus(
      { status: r.status, assignedDate: r.assignedDate, slaDeadline: r.slaDeadline },
      now,
      thresholdPercent,
    );
  const stored = r.slaStatus;
  return stored && stored >= 1 && stored <= 3 ? (stored as SlaStatus) : SlaStatus.OnTime;
}

export function toStepInstanceDto(
  r: StepInstanceRow,
  now: Date,
  thresholdPercent: number,
): StepInstanceDto {
  return {
    workflowStepInstanceId: r.wfStepInstanceId,
    workflowInstanceId: r.wfInstanceId,
    workflowStepId: r.wfStepId,
    stepName: r.stepName ?? null,
    stepType: (r.stepType ?? null) as WorkflowStepType | null,
    assignedTo: r.assignedTo ?? null,
    assignedDate: r.assignedDate ?? null,
    startedDate: r.startedDate ?? null,
    status: r.status as WorkflowStepInstanceStatus,
    completedDate: r.completedDate ?? null,
    completedBy: r.completedBy ?? null,
    outputData: r.outputData ?? null,
    // ระบบเดิมเก็บหมายเหตุไว้ใน OutputData; แถวใหม่เก็บใน Remarks ด้วย → แถวเก่าใช้ OutputData แทน
    remarks: r.remarks ?? r.outputData ?? null,
    slaDeadline: r.slaDeadline ?? null,
    slaStatus: liveSlaStatus(r, now, thresholdPercent),
    timeRemainingMinutes: isOpenStep(r.status) ? minutesRemaining(r.slaDeadline, now) : null,
  };
}

export function toInstanceSummary(r: InstanceListRow): InstanceSummaryDto {
  return {
    workflowInstanceId: r.wfInstanceId,
    workflowDefinitionId: r.wfDefinitionId,
    templateName: r.templateName ?? null,
    templateVersion: r.templateVersion,
    initiatedBy: r.initiatedBy,
    initiatedDate: r.initiatedDate,
    status: r.status as WorkflowInstanceStatus,
    currentStepId: r.currentStepId ?? null,
    currentStepName: r.currentStepName ?? null,
    totalStepCount: Number(r.totalStepCount ?? 0),
    completedStepCount: Number(r.completedStepCount ?? 0),
    completedDate: r.completedDate ?? null,
  };
}

export function toTaskDto(r: TaskRow, now: Date, thresholdPercent: number): TaskDto {
  return {
    ...toStepInstanceDto(r, now, thresholdPercent),
    workflowName: r.templateName ?? 'ไม่ระบุ',
    stepName: r.stepName ?? 'ไม่ระบุ',
    stepDescription: r.stepDescription ?? null,
    initiatedBy: r.initiatedBy,
    instanceStatus: r.instanceStatus as WorkflowInstanceStatus,
    canDelegate: Boolean(r.allowDelegation),
    maxDelegationDepth: Number(r.maxDelegationDepth ?? 0),
    stepOrder: Number(r.stepSequence ?? 0),
    totalSteps: Number(r.totalSteps ?? 0),
  };
}
