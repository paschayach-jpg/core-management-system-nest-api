import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class SlaReportQueryDto {
  @ApiPropertyOptional({ description: 'กรองตาม Template (ว่าง = ทุก template)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workflowDefinitionId?: number;

  @ApiPropertyOptional({
    description: 'นับ step ที่ได้รับมอบหมายตั้งแต่ (ISO 8601) — ว่าง = ไม่จำกัด',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fromDate?: Date;

  @ApiPropertyOptional({ description: 'ถึง (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  toDate?: Date;

  @ApiPropertyOptional({
    default: 12,
    minimum: 1,
    maximum: 52,
    description: 'จำนวนสัปดาห์ของกราฟแนวโน้ม',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  weeks?: number;
}

export class SlaTaskDistributionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workflowDefinitionId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() fromDate?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() toDate?: Date;
}

export class SlaOverdueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workflowDefinitionId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() fromDate?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() toDate?: Date;
  // ?q= ค้นชื่อผู้รับผิดชอบ/ชื่อ template/ชื่อขั้นตอน
}

export class SlaSummaryDto {
  @ApiProperty({ description: 'จำนวน step instance ที่นับ' }) totalTasks: number;
  @ApiProperty() onTimeCount: number;
  @ApiProperty() atRiskCount: number;
  @ApiProperty() overdueCount: number;
  @ApiProperty({ description: 'OnTime ÷ ทั้งหมด × 100 (นิยามของ sp_WF_GetSLAComplianceMetrics)' })
  onTimePercent: number;
  @ApiProperty() averageCompletionHours: number;
}

export class SlaTemplateRowDto {
  @ApiProperty() workflowDefinitionId: number;
  @ApiProperty() templateName: string;
  @ApiProperty() totalTasks: number;
  @ApiProperty() onTimeCount: number;
  @ApiProperty() atRiskCount: number;
  @ApiProperty() overdueCount: number;
  @ApiProperty({
    description: '(OnTime + AtRisk) ÷ ทั้งหมด × 100 — นิยามเดิมของรายงานตาม template',
  })
  compliancePercent: number;
}

export class SlaUserRowDto {
  @ApiProperty() userName: string;
  @ApiProperty() totalAssigned: number;
  @ApiProperty() completed: number;
  @ApiProperty() pending: number;
  @ApiProperty() rejected: number;
  @ApiProperty() overdue: number;
}

export class SlaTrendPointDto {
  @ApiProperty() year: number;
  @ApiProperty({ description: 'สัปดาห์ของปี (DATEPART WEEK)' }) week: number;
  @ApiProperty({ example: 'W1', description: 'ป้ายตามลำดับในช่วง (เหมือนระบบเดิม)' })
  weekLabel: string;
  @ApiProperty() compliancePercent: number;
  @ApiProperty() totalTasks: number;
}

export class SlaCycleBucketDto {
  @ApiProperty({ example: '2–3', description: 'วันที่ใช้ตั้งแต่เริ่มจนจบ workflow' }) label: string;
  @ApiProperty() count: number;
  @ApiProperty({ enum: ['pass', 'near', 'over'] }) category: 'pass' | 'near' | 'over';
}

export class SlaComplianceReportDto {
  @ApiProperty({
    description:
      'หมายเหตุ: สถานะ SLA ที่เก็บใน DB ของงานที่ยังเปิดอยู่จะล้าสมัยถ้างาน SLA เบื้องหลังปิดอยู่ (ค่าเริ่มต้น) — ดูรายการเกินกำหนดแบบสดที่ /wfe/sla/overdue',
  })
  summary: SlaSummaryDto;
  @ApiProperty({ type: [SlaTemplateRowDto] }) byTemplate: SlaTemplateRowDto[];
  @ApiProperty({ type: [SlaUserRowDto], description: '5 อันดับผู้ที่มีงานเกินกำหนดมากสุด' })
  topOverdueUsers: SlaUserRowDto[];
  @ApiProperty({ type: [SlaTrendPointDto] }) weeklyTrend: SlaTrendPointDto[];
  @ApiProperty({ type: [SlaCycleBucketDto] }) cycleTimeDistribution: SlaCycleBucketDto[];
  @ApiPropertyOptional() fromDate?: Date | null;
  @ApiPropertyOptional() toDate?: Date | null;
}

export class SlaOverdueRowDto {
  @ApiProperty() workflowStepInstanceId: number;
  @ApiProperty() workflowInstanceId: number;
  @ApiPropertyOptional() templateName?: string | null;
  @ApiPropertyOptional() stepName?: string | null;
  @ApiPropertyOptional() assignedTo?: string | null;
  @ApiPropertyOptional() initiatedBy?: string | null;
  @ApiPropertyOptional() assignedDate?: Date | null;
  @ApiProperty() slaDeadline: Date;
  @ApiProperty({ description: 'ชั่วโมงที่เลยกำหนด ณ เวลาที่เรียก' }) hoursOverdue: number;
}

export class SlaRefreshResultDto {
  @ApiProperty({ description: 'จำนวน step instance ที่ตรวจ' }) checked: number;
  @ApiProperty({ description: 'จำนวนที่สถานะ SLA เปลี่ยนและถูกอัปเดต' }) updated: number;
  @ApiProperty() becameAtRisk: number;
  @ApiProperty() becameOverdue: number;
  @ApiProperty({
    description: 'true = ส่งแจ้งเตือน/บันทึก SLAEscalated (เมื่อเปิด WorkflowEscalationEnabled)',
  })
  escalated: boolean;
}
