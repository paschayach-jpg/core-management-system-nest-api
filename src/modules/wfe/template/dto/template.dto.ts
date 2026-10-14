import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { WorkflowStepType, WorkflowTemplateStatus } from '../../../../common/constants/enums';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { MAX_TEMPLATE_DEFINITION_CHARS } from '../../common/wfe.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === '1' || value === true
    ? true
    : value === 'false' || value === '0' || value === false
      ? false
      : value; // ค่าที่ไม่รู้จักปล่อยผ่านให้ @IsBoolean ปฏิเสธ (400) แทนที่จะเงียบหาย

const STATUS_DESC = '0=Draft, 1=PendingApproval, 2=Active, 3=Inactive, 4=Deprecated';
const STEP_TYPE_DESC =
  '1=Start, 2=Approval, 3=Review, 4=Notification, 5=Parallel, 6=Decision, 7=Merge, 8=End';

// ───────────────────────── response ─────────────────────────

export class StepDto {
  @ApiProperty({
    description: 'WFStepId (กรณีโครงสร้างอ่านจาก definition = รหัสใน layout ของ designer)',
  })
  workflowStepId: number;
  @ApiProperty() workflowDefinitionId: number;
  @ApiProperty() stepName: string;
  @ApiProperty({
    enum: WorkflowStepType,
    enumName: 'WorkflowStepType',
    description: STEP_TYPE_DESC,
  })
  stepType: WorkflowStepType;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() assignedRole?: string | null;
  @ApiPropertyOptional({
    description: 'ชื่อผู้ใช้ AD ของผู้รับผิดชอบ (ว่าง = ผู้ที่ทำรายการก่อนหน้า)',
  })
  assignedUser?: string | null;
  @ApiPropertyOptional() assignedOrgUnit?: string | null;
  @ApiPropertyOptional() slaHours?: number | null;
  @ApiPropertyOptional() slaDays?: number | null;
  @ApiProperty() allowDelegation: boolean;
  @ApiProperty() maxDelegationDepth: number;
  @ApiProperty() sequenceNumber: number;
  @ApiPropertyOptional() stepConfig?: string | null;
}

export class ConnectionDto {
  @ApiProperty({ description: 'WFConnectionId (กรณีอ่านจาก definition = ลำดับที่ในรายการ)' })
  workflowConnectionId: number;
  @ApiProperty() workflowDefinitionId: number;
  @ApiProperty() fromStepId: number;
  @ApiProperty() toStepId: number;
  @ApiPropertyOptional({
    description:
      'ข้อความเงื่อนไข — ระบบเดิมยังไม่ประเมินเงื่อนไข (stub คืน true เสมอ) เส้นเชื่อมทุกเส้นถูกเดิน',
  })
  conditionExpression?: string | null;
  @ApiProperty() sequenceNumber: number;
}

export class GraphIssueDto {
  @ApiProperty({ enum: ['error', 'warning'] }) severity: 'error' | 'warning';
  @ApiProperty({ example: 'NO_START' }) code: string;
  @ApiProperty() message: string;
  @ApiPropertyOptional() stepKey?: number;
}

export class GraphValidationDto {
  @ApiProperty() valid: boolean;
  @ApiProperty({ type: [GraphIssueDto] }) issues: GraphIssueDto[];
}

export class TemplateStructureDto {
  @ApiProperty({
    enum: ['rows', 'definition', 'none'],
    description:
      'rows = อ่านจาก WFE.s_WFStep/s_WFConnection · definition = ยังไม่มีแถว อ่านจาก TemplateDefinition (JSON) · none = ไม่มีผัง',
  })
  source: 'rows' | 'definition' | 'none';
  @ApiProperty({ type: [StepDto] }) steps: StepDto[];
  @ApiProperty({ type: [ConnectionDto] }) connections: ConnectionDto[];
}

export class TemplateSummaryDto {
  @ApiProperty() workflowDefinitionId: number;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() category?: string | null;
  @ApiProperty() version: number;
  @ApiProperty({ description: 'true เฉพาะเมื่อ approvalStatus = Active (คู่กับสถานะเสมอ)' })
  isActive: boolean;
  @ApiProperty({
    enum: WorkflowTemplateStatus,
    enumName: 'WorkflowTemplateStatus',
    description: STATUS_DESC,
  })
  approvalStatus: WorkflowTemplateStatus;
  @ApiProperty() createdBy: string;
  @ApiProperty() createdDate: Date;
  @ApiPropertyOptional() modifiedBy?: string | null;
  @ApiPropertyOptional() modifiedDate?: Date | null;
  @ApiPropertyOptional() submittedBy?: string | null;
  @ApiPropertyOptional() submittedDate?: Date | null;
  @ApiPropertyOptional() approvedBy?: string | null;
  @ApiPropertyOptional() approvedDate?: Date | null;
  @ApiPropertyOptional() rejectionReason?: string | null;
  @ApiPropertyOptional() disabledBy?: string | null;
  @ApiPropertyOptional() disabledDate?: Date | null;
  @ApiPropertyOptional() disabledReason?: string | null;
  @ApiProperty() stepCount: number;
  @ApiProperty() totalInstanceCount: number;
  @ApiProperty({ description: 'instance ที่ยังทำงานอยู่ (ยังไม่จบ/ยังไม่ยกเลิก)' })
  activeInstanceCount: number;
}

export class TemplateDetailDto extends TemplateSummaryDto {
  @ApiPropertyOptional({ description: 'JSON ของ designer/wizard (string)' })
  templateDefinition?: string | null;
  @ApiProperty({ type: TemplateStructureDto }) structure: TemplateStructureDto;
  @ApiProperty({ type: GraphValidationDto }) validation: GraphValidationDto;
}

export class TemplateVersionDto {
  @ApiProperty() workflowDefinitionId: number;
  @ApiProperty() version: number;
  @ApiProperty() name: string;
  @ApiProperty() createdBy: string;
  @ApiProperty() createdDate: Date;
  @ApiProperty() isActive: boolean;
}

export class TemplateExportDto {
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() category?: string | null;
  @ApiProperty() version: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ enum: WorkflowTemplateStatus, enumName: 'WorkflowTemplateStatus' })
  approvalStatus: WorkflowTemplateStatus;
  @ApiPropertyOptional() templateDefinition?: string | null;
}

// ───────────────────────── request ─────────────────────────

export class TemplateListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: WorkflowTemplateStatus,
    enumName: 'WorkflowTemplateStatus',
    description: STATUS_DESC,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1, 2, 3, 4])
  approvalStatus?: WorkflowTemplateStatus;

  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ description: 'กรองตามหมวดหมู่ (ตรงทั้งหมด)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ description: 'กรองตามผู้สร้าง (ชื่อผู้ใช้ AD)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  createdBy?: string;
  // ?q= ค้นชื่อ/คำอธิบาย · ?sortBy= name | createdDate | modifiedDate | version | approvalStatus | category
}

export class CreateTemplateDto {
  @ApiProperty({ example: 'ขออนุมัติจัดซื้อ' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ example: 'งานบุคคล (HR)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({
    description:
      'JSON string ของผังที่ designer/wizard สร้าง — รูปแบบ designer: {"Steps":[{WorkflowStepId,StepName,StepType,AssignedUser,SLADays,...}],"Connections":[{FromStepId,ToStepId,Condition}]}',
    maxLength: MAX_TEMPLATE_DEFINITION_CHARS,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEMPLATE_DEFINITION_CHARS)
  templateDefinition?: string;
}

export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {
  @ApiPropertyOptional({ description: 'เหตุผลการแก้ไข (เก็บใน audit)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  changeDescription?: string;
}

export class CopyTemplateDto {
  @ApiPropertyOptional({ description: 'ชื่อใหม่ (ว่าง = "<ชื่อเดิม> (Copy)")' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
}

export class RejectTemplateDto {
  @ApiProperty({ description: 'เหตุผลที่ปฏิเสธ (ส่งกลับให้ผู้ส่งแก้ไข)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class DisableTemplateDto {
  @ApiPropertyOptional({ description: 'เหตุผล (เก็บใน DisabledReason)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ImportTemplateDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  category?: string;
  @ApiPropertyOptional({ maxLength: MAX_TEMPLATE_DEFINITION_CHARS })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEMPLATE_DEFINITION_CHARS)
  templateDefinition?: string;
  // ฟิลด์ที่ได้จากไฟล์ export — รับไว้แต่ไม่ใช้ (template ที่นำเข้าเป็น Draft เวอร์ชัน 1 เสมอ)
  @ApiPropertyOptional({ description: 'ไม่ใช้' }) @IsOptional() @IsInt() version?: number;
  @ApiPropertyOptional({ description: 'ไม่ใช้' }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'ไม่ใช้' }) @IsOptional() @IsInt() approvalStatus?: number;
}

export class CreateStepDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) stepName: string;

  @ApiProperty({
    enum: WorkflowStepType,
    enumName: 'WorkflowStepType',
    description: STEP_TYPE_DESC,
  })
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5, 6, 7, 8])
  stepType: WorkflowStepType;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  assignedRole?: string;
  @ApiPropertyOptional({ description: 'ชื่อผู้ใช้ AD ของผู้รับผิดชอบ' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  assignedUser?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  assignedOrgUnit?: string;

  @ApiPropertyOptional({ description: 'SLA เป็นชั่วโมง (มาก่อน slaDays)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  slaHours?: number;

  @ApiPropertyOptional({ description: 'SLA เป็นวัน' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  slaDays?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  allowDelegation?: boolean;

  @ApiPropertyOptional({
    description: 'ไม่ถูกใช้บังคับ — ความลึกสูงสุดของระบบคือ 3 ระดับ',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  maxDelegationDepth?: number;

  @ApiPropertyOptional({ description: 'ว่าง = ต่อท้าย (max + 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  sequenceNumber?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100000) stepConfig?: string;
}

export class UpdateStepDto extends PartialType(CreateStepDto) {}

export class CreateConnectionDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) fromStepId: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) toStepId: number;

  @ApiPropertyOptional({
    description: 'ข้อความเงื่อนไข (ยังไม่ถูกประเมิน — ดูคำอธิบายใน ConnectionDto)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  conditionExpression?: string;

  @ApiPropertyOptional({ description: 'ว่าง = ต่อท้าย (max + 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  sequenceNumber?: number;
}

export class UpdateConnectionDto extends PartialType(CreateConnectionDto) {}
