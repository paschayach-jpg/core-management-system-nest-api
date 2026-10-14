import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  SlaStatus,
  WorkflowInstanceStatus,
  WorkflowStepInstanceStatus,
  WorkflowStepType,
} from '../../../../common/constants/enums';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import type { AuditLogRow } from '../../../shared/audit/audit.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === '1' || value === true
    ? true
    : value === 'false' || value === '0' || value === false
      ? false
      : value; // ค่าที่ไม่รู้จักปล่อยผ่านให้ @IsBoolean ปฏิเสธ (400) แทนที่จะเงียบหาย

const INSTANCE_STATUS_DESC =
  '1=Created, 2=InProgress, 3=Completed, 4=Rejected, 5=Suspended, 6=Cancelled (0 = ค่าที่ SP ใส่ตอนสร้าง ซึ่งค้างจากระบบเดิม)';
const STEP_STATUS_DESC = '1=Pending, 2=InProgress, 3=Completed, 4=Rejected, 5=Delegated';
const SLA_DESC =
  '1=OnTime, 2=AtRisk, 3=Overdue — งานที่ยังเปิดอยู่คำนวณสดจาก deadline ณ เวลาที่เรียก (ค่าที่เก็บใน DB อัปเดตเมื่อเสร็จงานหรือเมื่องาน SLA ทำงาน)';

// ───────────────────────── response ─────────────────────────

export class StepInstanceDto {
  @ApiProperty({
    description: 'WFStepInstanceId (IDENTITY) — ใช้เป็นรหัส step instance ทุกที่ในระบบ',
  })
  workflowStepInstanceId: number;
  @ApiProperty() workflowInstanceId: number;
  @ApiProperty() workflowStepId: number;
  @ApiPropertyOptional() stepName?: string | null;
  @ApiPropertyOptional({ enum: WorkflowStepType, enumName: 'WorkflowStepType' })
  stepType?: WorkflowStepType | null;
  @ApiPropertyOptional() assignedTo?: string | null;
  @ApiPropertyOptional() assignedDate?: Date | null;
  @ApiPropertyOptional() startedDate?: Date | null;
  @ApiProperty({
    enum: WorkflowStepInstanceStatus,
    enumName: 'WorkflowStepInstanceStatus',
    description: STEP_STATUS_DESC,
  })
  status: WorkflowStepInstanceStatus;
  @ApiPropertyOptional() completedDate?: Date | null;
  @ApiPropertyOptional() completedBy?: string | null;
  @ApiPropertyOptional({ description: 'ผลลัพธ์/เหตุผลที่ผู้ทำงานบันทึก' }) outputData?:
    string | null;
  @ApiPropertyOptional() remarks?: string | null;
  @ApiPropertyOptional() slaDeadline?: Date | null;
  @ApiProperty({ enum: SlaStatus, enumName: 'SlaStatus', description: SLA_DESC })
  slaStatus: SlaStatus;
  @ApiPropertyOptional({
    description: 'นาทีที่เหลือถึงกำหนด (ติดลบ = เลยกำหนด) — เฉพาะงานที่ยังเปิดอยู่',
  })
  timeRemainingMinutes?: number | null;
}

export class InstanceSummaryDto {
  @ApiProperty() workflowInstanceId: number;
  @ApiProperty() workflowDefinitionId: number;
  @ApiPropertyOptional() templateName?: string | null;
  @ApiProperty() templateVersion: number;
  @ApiProperty() initiatedBy: string;
  @ApiProperty({ description: 'ระบบเดิมเก็บเวลานี้เป็น UTC (GETUTCDATE) ต่างจากเวลาของ step' })
  initiatedDate: Date;
  @ApiProperty({
    enum: WorkflowInstanceStatus,
    enumName: 'WorkflowInstanceStatus',
    description: INSTANCE_STATUS_DESC,
  })
  status: WorkflowInstanceStatus;
  @ApiPropertyOptional() currentStepId?: number | null;
  @ApiPropertyOptional() currentStepName?: string | null;
  @ApiProperty() totalStepCount: number;
  @ApiProperty() completedStepCount: number;
  @ApiPropertyOptional() completedDate?: Date | null;
}

export type InstanceAllowedAction = 'SUSPEND' | 'RESUME' | 'CANCEL' | 'DELETE';

export class InstanceDetailDto extends InstanceSummaryDto {
  @ApiPropertyOptional({ description: 'JSON string ที่ส่งตอนสร้าง' }) inputParameters?:
    string | null;
  @ApiProperty({ type: [StepInstanceDto] }) stepHistory: StepInstanceDto[];
  @ApiProperty({
    enum: ['SUSPEND', 'RESUME', 'CANCEL', 'DELETE'],
    isArray: true,
    description: 'การกระทำระดับ instance ที่ผู้เรียกทำได้ตอนนี้ (ตามสถานะ + สิทธิ์)',
  })
  allowedActions: InstanceAllowedAction[];
}

export class TaskDto extends StepInstanceDto {
  @ApiProperty() workflowName: string;
  @ApiPropertyOptional() stepDescription?: string | null;
  @ApiProperty() initiatedBy: string;
  @ApiProperty({
    enum: WorkflowInstanceStatus,
    enumName: 'WorkflowInstanceStatus',
    description: INSTANCE_STATUS_DESC,
  })
  instanceStatus: WorkflowInstanceStatus;
  @ApiProperty({ description: 'ขั้นตอนนี้อนุญาตให้มอบหมายงานต่อ (AllowDelegation)' })
  canDelegate: boolean;
  @ApiProperty() maxDelegationDepth: number;
  @ApiProperty({ description: 'ลำดับของขั้นตอนใน template' }) stepOrder: number;
  @ApiProperty({ description: 'จำนวนขั้นตอนทั้งหมดของ template' }) totalSteps: number;
}

export class CompleteStepResultDto {
  @ApiProperty({ type: StepInstanceDto }) stepInstance: StepInstanceDto;
  @ApiProperty({
    enum: WorkflowInstanceStatus,
    enumName: 'WorkflowInstanceStatus',
    description: 'สถานะของ instance หลังจบ step นี้ (3=Completed เมื่อถึง End และไม่มีงานค้าง)',
  })
  instanceStatus: WorkflowInstanceStatus;
  @ApiPropertyOptional() currentStepId?: number | null;
  @ApiProperty({
    type: [StepInstanceDto],
    description: 'step instance ที่ถูกสร้างต่อจาก step นี้ (ว่างถ้า workflow จบ/ยังรอสาขาอื่น)',
  })
  createdStepInstances: StepInstanceDto[];
}

export class InstanceHistoryDto {
  @ApiProperty({ type: [StepInstanceDto] }) steps: StepInstanceDto[];
  @ApiProperty({
    description:
      'บันทึก audit ของ instance และ step instance ของมัน (เรียงเก่าสุดก่อน) — TableName = WorkflowInstance / WorkflowStepInstance',
    type: 'array',
    items: { type: 'object' },
  })
  audit: AuditLogRow[];
}

// ───────────────────────── request ─────────────────────────

export class CreateInstanceDto {
  @ApiProperty({ description: 'รหัส Template (ต้อง Active)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workflowDefinitionId: number;

  @ApiPropertyOptional({ description: 'ข้อมูลนำเข้าของ workflow เป็น JSON string' })
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  inputParameters?: string;
}

export class CompleteStepDto {
  @ApiPropertyOptional({
    description:
      'ผลลัพธ์ของ step (JSON string หรือข้อความ) — ใช้ตัดสินเงื่อนไขเส้นเชื่อมถัดไป ว่างจะใช้ remarks แทน',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  outputData?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  remarks?: string;
}

export class RejectStepDto {
  @ApiProperty({ description: 'เหตุผลที่ปฏิเสธ' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  remarks?: string;
}

export class CancelInstanceDto {
  @ApiPropertyOptional({ description: 'เหตุผลการยกเลิก (ว่าง = "ยกเลิกโดยผู้ใช้")' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DeleteInstanceQueryDto {
  @ApiProperty({ description: 'เหตุผลการลบ (บังคับ — ระบบเดิมบังคับเช่นกัน)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class InstanceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workflowDefinitionId?: number;

  @ApiPropertyOptional({
    enum: WorkflowInstanceStatus,
    enumName: 'WorkflowInstanceStatus',
    description: INSTANCE_STATUS_DESC,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1, 2, 3, 4, 5, 6])
  status?: WorkflowInstanceStatus;

  @ApiPropertyOptional({ description: 'ผู้เริ่ม (ชื่อผู้ใช้ AD)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  initiatedBy?: string;

  @ApiPropertyOptional({ description: 'เริ่มตั้งแต่ (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fromDate?: Date;

  @ApiPropertyOptional({ description: 'เริ่มถึง (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  toDate?: Date;
  // ?q= ค้นชื่อ template / ผู้เริ่ม · ?sortBy= initiatedDate | completedDate | status | workflowInstanceId | templateName | initiatedBy
}

export class MyTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: false,
    description: 'true = เฉพาะงานที่ยังต้องทำ (ซ่อนงานที่เสร็จแล้ว ซึ่งระบบเดิมแสดงต่อท้ายรายการ)',
  })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  onlyOpen?: boolean;
}
