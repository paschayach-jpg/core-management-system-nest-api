import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../../common/dto/pagination.dto';

/** จำนวนไบต์เป็นสตริงตัวเลข (bigint ส่งเป็นสตริง) ไม่เกิน 15 หลัก (< 1 PB; ปลอดภัยกับ number ของ JS) */
export const BYTES_PATTERN = /^[1-9]\d{0,14}$/;

export class QuotaUnitParamDto {
  @ApiProperty({ enum: [1, 2, 3], description: '1=SubCommittee, 2=Division, 3=Department' })
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3])
  unitType: 1 | 2 | 3;

  @ApiProperty({ description: 'PK ของตารางหลัก: SubCommitteeID / DivisionID / DepartmentID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitId: number;
}

export class SetQuotaDto {
  @ApiProperty({ description: 'โควตา (ไบต์) เป็นสตริงตัวเลข มากกว่า 0', example: '10737418240' })
  @IsString()
  @Matches(BYTES_PATTERN, { message: 'quotaBytes ต้องเป็นจำนวนเต็มบวกในรูปสตริง' })
  quotaBytes: string;
}

export class SubmitQuotaRequestDto {
  @ApiProperty({ description: 'EMS.OrgUnitID ของหน่วยงานที่ขอเพิ่มโควตา' })
  @IsInt()
  @Min(1)
  orgUnitId: number;

  @ApiProperty({ description: 'โควตาที่ขอ (ไบต์) ต้องมากกว่าปัจจุบัน', example: '21474836480' })
  @IsString()
  @Matches(BYTES_PATTERN, { message: 'requestedQuotaBytes ต้องเป็นจำนวนเต็มบวกในรูปสตริง' })
  requestedQuotaBytes: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class QuotaRemarkDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'หมายเหตุ (อนุมัติ: ไม่บังคับ · ปฏิเสธ: บังคับ)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class QuotaRequestListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '1=Pending, 2=Approved, 3=Rejected, 4=Cancelled' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  status?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId?: number;
}

// ── ตอบกลับ ──────────────────────────────────────────────────

export class QuotaUnitDto {
  @ApiProperty({ enum: [1, 2, 3] }) unitType: number;
  @ApiProperty() unitId: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'EMS.OrgUnitID ที่รหัสตรงกัน (ใช้ยื่นคำขอเพิ่มโควตา)',
  })
  emsOrgUnitId: number | null;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true, description: 'Department → DivisionID' }) parentUnitId:
    number | null;
  @ApiProperty({ description: 'โควตา (ไบต์, สตริง) — "0" = ไม่จำกัด' }) quotaBytes: string;
  @ApiProperty({ description: 'ขนาดที่ใช้รวมลำดับชั้น (ไบต์, สตริง)' }) usedBytes: string;
  @ApiProperty() fileCount: number;
  @ApiProperty({ description: 'ร้อยละที่ใช้ (0 เมื่อยังไม่ตั้งโควตา)' }) usedPercent: number;
  @ApiProperty({ enum: [0, 1, 2, 3], description: '0=Normal, 1=Warning, 2=Critical, 3=Full' })
  alertLevel: number;
  @ApiProperty({ enum: ['Normal', 'Warning', 'Critical', 'Full'] }) alertName: string;
}

export class OrgQuotaUsageDto {
  @ApiProperty() orgUnitId: number;
  @ApiProperty() orgUnitName: string;
  @ApiProperty({ description: '"0" = ยังไม่ตั้งโควตา (ไม่จำกัด)' }) quotaBytes: string;
  @ApiProperty() usedBytes: string;
  @ApiProperty() usedPercent: number;
  @ApiProperty({ enum: [0, 1, 2, 3] }) alertLevel: number;
  @ApiProperty({ enum: ['Normal', 'Warning', 'Critical', 'Full'] }) alertName: string;
  @ApiProperty() warnThresholdPct: number;
  @ApiProperty() criticalThresholdPct: number;
}

export class QuotaRequestDto {
  @ApiProperty() requestId: number;
  @ApiProperty() orgUnitId: number;
  @ApiPropertyOptional({ nullable: true }) orgUnitName: string | null;
  @ApiProperty() currentQuotaBytes: string;
  @ApiProperty() requestedQuotaBytes: string;
  @ApiPropertyOptional({ nullable: true }) reason: string | null;
  @ApiProperty({ description: '1=Pending, 2=Approved, 3=Rejected, 4=Cancelled' }) status: number;
  @ApiProperty() requestedBy: number;
  @ApiPropertyOptional({ nullable: true }) requestedByName: string | null;
  @ApiProperty() requestedDate: Date;
  @ApiPropertyOptional({ nullable: true }) reviewedBy: number | null;
  @ApiPropertyOptional({ nullable: true }) reviewedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) reviewRemark: string | null;
}
