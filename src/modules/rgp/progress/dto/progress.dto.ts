import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/rgp-validators';

export class UpdateProgressDto {
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: '% ความคืบหน้าของขั้นตอน — 0 = Pending, 100 = Completed, อื่นๆ = InProgress',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  pctComplete: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  remark?: string | null;
}

export class ProgressResultDto {
  @ApiProperty() progressId: number;
  @ApiProperty() projStateId: number;
  @ApiProperty() projectId: number;
  @ApiProperty() pctComplete: number;
  @ApiProperty({ enum: ['Pending', 'InProgress', 'Completed'] }) stateStatus: string;
  @ApiPropertyOptional({ nullable: true, description: 'สถานะโครงการหลังคำนวณใหม่' })
  projectStatus?: string | null;
  @ApiProperty({ description: '% รวมของโครงการหลังบันทึก' }) projectPctOverall: number;
}

export class ProgressHistoryDto {
  @ApiProperty() progressId: number;
  @ApiProperty() projStateId: number;
  @ApiProperty() projectId: number;
  @ApiProperty() stateName: string;
  @ApiProperty() status: string;
  @ApiProperty() pctComplete: number;
  @ApiPropertyOptional({ nullable: true }) remark?: string | null;
  @ApiProperty() actionDate: Date;
  @ApiProperty() actionUser: string;
}

/** ความคืบหน้าล่าสุดต่อขั้นตอนของโครงการ (แท็บ Progress) */
export class LatestProgressDto {
  @ApiProperty() projStateId: number;
  @ApiProperty() projectId: number;
  @ApiProperty() stateName: string;
  @ApiProperty() seqNo: number;
  @ApiProperty() required: boolean;
  @ApiProperty({ description: 'สถานะของขั้นตอน' }) stateStatus: string;
  @ApiProperty({ description: 'สถานะจาก progress ล่าสุด (Pending ถ้ายังไม่มี)' }) status: string;
  @ApiProperty() pctComplete: number;
  @ApiProperty() remark: string;
  @ApiPropertyOptional({ nullable: true }) actionDate?: Date | null;
  @ApiPropertyOptional({ nullable: true }) actionUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) progressId?: number | null;
  @ApiPropertyOptional({ nullable: true }) refProjectId?: number | null;
  @ApiPropertyOptional({ nullable: true }) refProjectNo?: string | null;
  @ApiPropertyOptional({ nullable: true }) refProjectName?: string | null;
  @ApiProperty() refPctOverall: number;
}

export class ProjectProgressOverviewDto {
  @ApiProperty() projectId: number;
  @ApiProperty({ description: '% รวมของโครงการ' }) pctOverall: number;
  @ApiProperty({ type: [LatestProgressDto] }) states: LatestProgressDto[];
}
