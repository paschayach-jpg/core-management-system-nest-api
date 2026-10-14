import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { PROJECT_STATUSES } from '../../common/rgp-rules';
import { IsDateOnly, trim } from '../../common/rgp-validators';
import { DocInputDto, ProjectDocDto } from '../../documents/dto/document.dto';
import { MemberInputDto, ProjectMemberDto } from '../../members/dto/member.dto';
import { ProjectStateDto, StateInputDto } from '../../states/dto/state.dto';

/** แถวในรายการค้นหาโครงการ */
export class ProjectSummaryDto {
  @ApiProperty() projectId: number;
  @ApiProperty() projectNo: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) templateId?: number | null;
  @ApiProperty({ description: '"-" เมื่อไม่มี template' }) templateName: string;
  @ApiProperty({ enum: PROJECT_STATUSES }) status: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' }) startDate?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-12-31' }) dueDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) closeDate?: Date | null;
  @ApiProperty() createUser: string;
  @ApiProperty() createDate: Date;
  @ApiPropertyOptional({ nullable: true }) updateUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) updateDate?: Date | null;
  @ApiPropertyOptional({ nullable: true, description: 'ผู้ทำงานล่าสุด (จาก progress ล่าสุด)' })
  lastWorker?: string | null;
  @ApiPropertyOptional({ nullable: true }) lastUpdate?: Date | null;
  @ApiProperty() totalStates: number;
  @ApiProperty() completedStates: number;
  @ApiProperty({ description: '% รวมของโครงการ (ค่าเฉลี่ย % ล่าสุดของแต่ละขั้นตอน)' })
  pctOverall: number;
}

export class ProjectDetailDto {
  @ApiProperty() projectId: number;
  @ApiProperty() projectNo: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) templateId?: number | null;
  @ApiPropertyOptional({ nullable: true }) templateName?: string | null;
  @ApiProperty({ description: 'template เป็นประเภทพจนานุกรมกฎหมายหรือไม่' }) isLegalDict: boolean;
  @ApiProperty({ enum: PROJECT_STATUSES }) status: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' }) startDate?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-12-31' }) dueDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) closeDate?: Date | null;
  @ApiPropertyOptional({ nullable: true }) owner?: string | null;
  @ApiPropertyOptional({ nullable: true }) developer?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'JSON พจนานุกรมกฎหมาย (สตริง)' })
  legalDictJson?: string | null;
  @ApiProperty() createUser: string;
  @ApiProperty() createDate: Date;
  @ApiPropertyOptional({ nullable: true }) updateUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) updateDate?: Date | null;
  @ApiProperty({ description: '% รวมของโครงการ' }) pctOverall: number;
  @ApiProperty({ type: [ProjectStateDto] }) states: ProjectStateDto[];
  @ApiProperty({ type: [ProjectDocDto] }) documents: ProjectDocDto[];
  @ApiProperty({ type: [ProjectMemberDto] }) members: ProjectMemberDto[];
}

export class ProjectListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'เลขที่โครงการ (contains)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  projectNo?: string;

  @ApiPropertyOptional({ description: 'ชื่อโครงการ (contains)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  name?: string;

  @ApiPropertyOptional({ enum: PROJECT_STATUSES })
  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  templateId?: number;

  @ApiPropertyOptional({ description: 'สร้างตั้งแต่วันที่ (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateOnly()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'สร้างถึงวันที่ (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateOnly()
  createdTo?: string;
}

/** ขั้นตอนที่ส่งมาพร้อมการสร้างโครงการ (ลำดับ seqNo ใช้เรียง แล้วระบบกำหนดเลข 1..n ให้ใหม่) */
export class CreateProjectStateDto extends StateInputDto {
  @ApiPropertyOptional({ description: 'ลำดับที่ต้องการ (ไม่ระบุ = ตามลำดับใน array)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  seqNo?: number;
}

export class CreateProjectDocDto extends DocInputDto {
  @ApiProperty({
    minimum: 0,
    description: 'ตำแหน่ง (เริ่มที่ 0) ของขั้นตอนใน array states ที่เอกสารนี้สังกัด',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stateIndex: number;
}

export class CreateProjectDto {
  @ApiPropertyOptional({
    description: 'เลขที่โครงการ — ไม่ระบุ = ระบบออกเลขอัตโนมัติจาก RunningNumber (PRJ)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  projectNo?: string;

  @ApiProperty({ example: 'โครงการปรับปรุงระบบ' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name: string;

  @ApiPropertyOptional({ nullable: true, description: 'template ประเภทโครงการ (ต้องเปิดใช้งาน)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  templateId?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' })
  @IsOptional()
  @IsDateOnly()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-31' })
  @IsOptional()
  @IsDateOnly()
  dueDate?: string | null;

  @ApiPropertyOptional({
    type: [CreateProjectStateDto],
    description: 'ขั้นตอน — สร้างพร้อมโครงการใน transaction เดียว (ล้มรายการใดก็ rollback ทั้งหมด)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateProjectStateDto)
  states?: CreateProjectStateDto[];

  @ApiPropertyOptional({ type: [CreateProjectDocDto], description: 'เอกสารของแต่ละขั้นตอน' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateProjectDocDto)
  documents?: CreateProjectDocDto[];

  @ApiPropertyOptional({ type: [MemberInputDto], description: 'บุคคลที่เกี่ยวข้อง' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MemberInputDto)
  members?: MemberInputDto[];
}

/** แก้ไขข้อมูลหัวโครงการ — ฟิลด์ที่ไม่ส่ง = ไม่เปลี่ยน, `null` = ล้างค่า */
export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  templateId?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-03-01' })
  @IsOptional()
  @IsDateOnly()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-31' })
  @IsOptional()
  @IsDateOnly()
  dueDate?: string | null;
}

export class UpdateLegalDictDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'JSON พจนานุกรมกฎหมายเป็นสตริง (null = ล้าง)',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2_000_000)
  json: string | null;
}

export class CheckProjectNoQueryDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  projectNo: string;
}

export class ProjectNoCheckDto {
  @ApiProperty() projectNo: string;
  @ApiProperty({ description: 'true = มีโครงการที่ใช้งานอยู่ใช้เลขนี้แล้ว' }) exists: boolean;
}

export class ReferenceCandidatesQueryDto {
  @ApiPropertyOptional({ description: 'ไม่รวมโครงการนี้ (โครงการปัจจุบัน)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  excludeProjectId?: number;
}

export class ReferenceCandidateDto {
  @ApiProperty() projectId: number;
  @ApiProperty() projectNo: string;
  @ApiProperty() name: string;
  @ApiProperty() status: string;
  @ApiProperty() pctOverall: number;
}

export class ProjectStatusResultDto {
  @ApiProperty() projectId: number;
  @ApiProperty({ enum: PROJECT_STATUSES }) status: string;
}
