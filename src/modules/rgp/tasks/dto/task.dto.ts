import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { TASK_STATUSES } from '../../common/rgp-rules';
import { IsDateOnly, toBool, trim } from '../../common/rgp-validators';

export class TaskDto {
  @ApiProperty() taskId: number;
  @ApiProperty({ example: 'TK-26-000001' }) taskCode: string;
  @ApiProperty() projStateId: number;
  @ApiPropertyOptional({ nullable: true }) stateName?: string | null;
  @ApiProperty() projectId: number;
  @ApiPropertyOptional({ nullable: true }) parentTaskId?: number | null;
  @ApiProperty({ description: '0 = task หลัก, 1+ = sub task' }) subtaskDepth: number;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty({ description: '1=Low, 2=Medium, 3=High, 4=Critical' }) priority: number;
  @ApiProperty({ enum: TASK_STATUSES }) status: string;
  @ApiProperty() pctComplete: number;
  @ApiPropertyOptional({ nullable: true }) assignee?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-03-31' }) dueDate?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' }) startDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) estimatedHours?: number | null;
  @ApiPropertyOptional({ nullable: true }) actualHours?: number | null;
  @ApiPropertyOptional({ nullable: true }) extendReason?: string | null;
  @ApiProperty({ description: 'false = ถูกลบ (soft delete)' }) active: boolean;
  @ApiPropertyOptional({ nullable: true }) deletedDate?: Date | null;
  @ApiProperty() createUser: string;
  @ApiProperty() createDate: Date;
  @ApiPropertyOptional({ nullable: true }) updateUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) updateDate?: Date | null;
  @ApiProperty({ description: 'เลยกำหนดแล้ว (ยังไม่ Done/OnHold)' }) overdue: boolean;
  @ApiProperty({ description: 'เวลาผ่านไป ≥ 80% ของช่วงสร้าง→กำหนดเสร็จ (ยังไม่ Done/OnHold)' })
  slaWarning: boolean;
  @ApiProperty() subtaskCount: number;
  @ApiProperty() subtaskDone: number;
}

export class TaskTreeItemDto extends TaskDto {
  @ApiProperty({ description: 'ระดับในต้นไม้ (0 = ราก)' }) treeDepth: number;
}

export class TaskListQueryDto {
  @ApiPropertyOptional({ description: 'true = รวม task ที่ถูกลบ (ถังขยะ)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeDeleted?: boolean;
}

export class CreateTaskDto {
  @ApiProperty({ example: 'จัดทำร่างเอกสาร' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @ApiPropertyOptional({ description: '1=Low, 2=Medium, 3=High, 4=Critical', default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  @ApiPropertyOptional({ nullable: true, description: 'ชื่อผู้ใช้ AD ผู้รับผิดชอบ' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  assignee?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ต้องไม่ผ่านมาแล้ว (ตรวจเฉพาะตอนสร้าง)',
    example: '2026-03-31',
  })
  @IsOptional()
  @IsDateOnly()
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' })
  @IsOptional()
  @IsDateOnly()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedHours?: number | null;

  @ApiPropertyOptional({ default: 0, description: 'สถานะเริ่มต้นเป็น Todo เสมอ' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  pctComplete?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'สร้างเป็น sub task ของ task นี้ (ต้องอยู่ขั้นตอนเดียวกัน)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentTaskId?: number | null;
}

/** แก้ไข task — ไม่แก้สถานะ/% (ใช้ PATCH /rgp/tasks/:id/status) · ฟิลด์ที่ไม่ส่ง = ไม่เปลี่ยน, null = ล้างค่า */
export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20000)
  description?: string | null;

  @ApiPropertyOptional({ description: '1=Low, 2=Medium, 3=High, 4=Critical' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  assignee?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-03-31' })
  @IsOptional()
  @IsDateOnly()
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' })
  @IsOptional()
  @IsDateOnly()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedHours?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  actualHours?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'เหตุผลที่ขยายเวลา' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  extendReason?: string | null;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: TASK_STATUSES })
  @IsIn(TASK_STATUSES)
  status: (typeof TASK_STATUSES)[number];

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    description:
      'OnHold = ตรึง % เดิม (ค่านี้ถูกเมินเฉย) · Done = 100 · Todo = 0 · สถานะอื่นไม่ส่ง = คง % เดิม',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  pctComplete?: number;
}

export class TaskStatusResultDto {
  @ApiProperty({ type: TaskDto }) task: TaskDto;
  @ApiProperty({ description: '% ของขั้นตอน (state) หลัง sync จาก task' }) statePct: number;
  @ApiProperty({ enum: ['Pending', 'InProgress', 'Completed'] }) stateStatus: string;
  @ApiPropertyOptional({ nullable: true, description: 'สถานะโครงการหลังคำนวณใหม่' })
  projectStatus?: string | null;
}

export class TaskStatusLogDto {
  @ApiProperty() logId: number;
  @ApiProperty() taskId: number;
  @ApiPropertyOptional({ nullable: true }) oldStatus?: string | null;
  @ApiProperty() newStatus: string;
  @ApiProperty() pctAtChange: number;
  @ApiPropertyOptional({ nullable: true }) changeUser?: string | null;
  @ApiProperty() changeDate: Date;
}

// ───────────── Comment ─────────────

export class TaskCommentDto {
  @ApiProperty() commentId: number;
  @ApiProperty() taskId: number;
  @ApiPropertyOptional({ nullable: true }) parentCommentId?: number | null;
  @ApiProperty({ description: '0–2 (ตอบกลับซ้อนได้ 3 ระดับ)' }) threadDepth: number;
  @ApiPropertyOptional({ nullable: true, description: 'null เมื่อถูกลบแล้ว' }) content?:
    string | null;
  @ApiProperty() isEdited: boolean;
  @ApiProperty() isDeleted: boolean;
  @ApiProperty() createUser: string;
  @ApiProperty() createDate: Date;
  @ApiPropertyOptional({ nullable: true }) editedDate?: Date | null;
}

export class CreateCommentDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'ตอบกลับ comment นี้ (ต้องเป็น comment ของ task เดียวกัน ยังไม่ถูกลบ และลึกไม่เกิน 3 ระดับ)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentCommentId?: number | null;
}
