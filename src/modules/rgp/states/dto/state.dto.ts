import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { toBool, trim } from '../../common/rgp-validators';

export class ProjectStateDto {
  @ApiProperty() projStateId: number;
  @ApiProperty() projectId: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'อ้างขั้นตอนของ template (m_template_state)',
  })
  templateStateId?: number | null;
  @ApiProperty() name: string;
  @ApiProperty() seqNo: number;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty() required: boolean;
  @ApiProperty({ enum: ['Pending', 'InProgress', 'Completed'] }) status: string;
  @ApiPropertyOptional({ nullable: true }) estimatedDays?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'โครงการอ้างอิง (ref project)' })
  refProjectId?: number | null;
  @ApiPropertyOptional({ nullable: true }) refProjectNo?: string | null;
  @ApiPropertyOptional({ nullable: true }) refProjectName?: string | null;
  @ApiProperty({ description: '% รวมของโครงการอ้างอิง (0 ถ้าไม่มี)' }) refPctOverall: number;
  @ApiProperty({ description: '% ล่าสุดจากความคืบหน้า (0 ถ้ายังไม่มี)' }) pctComplete: number;
  @ApiPropertyOptional({ nullable: true }) latestRemark?: string | null;
  @ApiProperty() createUser: string;
  @ApiProperty() createDate: Date;
  @ApiPropertyOptional({ nullable: true }) updateUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) updateDate?: Date | null;
}

/** ฟิลด์ของขั้นตอนที่ใช้ร่วมกันระหว่าง "เพิ่มขั้นตอน" และ "สร้างโครงการพร้อมขั้นตอน" */
export class StateInputDto {
  @ApiProperty({ example: 'ยื่นขออนุมัติ' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ default: true, description: 'ขั้นตอนที่จำเป็น (Required)' })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'จำนวนวันคาดการณ์ (ผลรวมต้องไม่เกินช่วงวันของโครงการ)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  estimatedDays?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'โครงการอ้างอิง (ต้องเป็นโครงการที่ยังใช้งาน ≠ ตัวเอง)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  refProjectId?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'i_state_id ของขั้นตอนใน template (ถ้าสร้างมาจาก template)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  templateStateId?: number | null;
}

export class CreateStateDto extends StateInputDto {}

export class UpdateStateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  seqNo?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  estimatedDays?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  refProjectId?: number | null;
}

export class ReorderItemDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) stateId: number;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(10000) seqNo: number;
}

export class ReorderStatesDto {
  @ApiProperty({ type: [ReorderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

export class EstimatedDaysQueryDto {
  @ApiPropertyOptional({ description: 'ไม่นับ state นี้ (ตอนแก้ไข)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  excludeStateId?: number;
}

export class EstimatedDaysDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'จำนวนวันทั้งโครงการ (null = ยังไม่มีช่วงวันที่ถูกต้อง)',
  })
  totalDays: number | null;
  @ApiProperty({ description: 'ผลรวมวันคาดการณ์ของ state อื่น' }) usedDays: number;
  @ApiPropertyOptional({ nullable: true }) remainingDays: number | null;
}

export class DeleteStateQueryDto {
  @ApiPropertyOptional({
    description:
      'true = ลบเอกสาร workflow และผู้เกี่ยวข้องของขั้นตอนนี้ไปด้วย (task/ประวัติแจ้งเตือน/ความคืบหน้ายังบล็อกการลบ)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  cascade?: boolean;
}

// ───────────── ผู้เกี่ยวข้องของขั้นตอน ─────────────

export class StateMemberDto {
  @ApiProperty() stateMemberId: number;
  @ApiProperty() projStateId: number;
  @ApiProperty() projectId: number;
  @ApiProperty({ description: 'ชื่อ (พนักงาน = ชื่อผู้ใช้ AD)' }) name: string;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['SubCommittee', 'Division', 'Department', 'Employee'],
  })
  memberType?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'ข้อความประเภทตามที่เก็บในฐานข้อมูล' })
  memberTypeName?: string | null;
  @ApiProperty() role: string;
  @ApiProperty({ description: 'จำนวนครั้งที่ส่งแจ้งเตือนแล้ว' }) notifyCount: number;
  @ApiPropertyOptional({ nullable: true }) createUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) createDate?: Date | null;
}

export class AddStateMemberDto {
  @ApiProperty({ description: 'i_member_id ของบุคคลในโครงการ (เลือกได้เฉพาะคนที่อยู่ในโครงการ)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectMemberId: number;
}

export class NotifyResultDto {
  @ApiProperty({ description: 'ส่งแจ้งเตือนสำเร็จหรือไม่' }) sent: boolean;
  @ApiPropertyOptional({ nullable: true }) taskId?: number | null;
  @ApiProperty({ description: 'true = สร้าง Task ติดตามใหม่รอบนี้, false = ใช้ Task เดิม' })
  taskCreated: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'เหตุผลเมื่อส่งไม่สำเร็จ' })
  message?: string | null;
}
