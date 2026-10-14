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
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === '1' || value === true
    ? true
    : value === 'false' || value === '0' || value === false
      ? false
      : undefined;

export class DelegationDto {
  @ApiProperty() wfDelegationId: number;
  @ApiProperty({ description: 'WFStepInstanceId ของงานที่ถูกมอบหมาย' })
  workflowStepInstanceId: number;
  @ApiProperty() delegatedFrom: string;
  @ApiProperty() delegatedTo: string;
  @ApiPropertyOptional() delegationReason?: string | null;
  @ApiProperty() delegationDate: Date;
  @ApiProperty({ description: 'ระดับการมอบหมาย (1..3) — นับสะสมต่องาน ไม่รีเซ็ตเมื่อคืนงาน' })
  delegationDepth: number;
  @ApiProperty({ description: 'มีผลอยู่ (มีเพียงรายการล่าสุดของงานที่ active)' }) isActive: boolean;
  @ApiPropertyOptional({
    description: 'ระบบเก็บไว้เฉยๆ ไม่ได้บังคับให้สิ้นสุดอัตโนมัติ (เหมือนระบบเดิม)',
  })
  startDate?: Date | null;
  @ApiPropertyOptional() endDate?: Date | null;
  @ApiPropertyOptional() remarks?: string | null;
}

export class DelegateTaskDto {
  @ApiProperty({ description: 'WFStepInstanceId ของงานที่จะมอบหมาย (ต้องเป็นงานของคุณ)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workflowStepInstanceId: number;

  @ApiProperty({ description: 'ชื่อผู้ใช้ AD ของผู้รับ (ต้องเป็นผู้ใช้ที่ใช้งานอยู่)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  delegateToUserName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  delegationReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  remarks?: string;

  @ApiPropertyOptional({ description: 'ISO 8601' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({ description: 'ISO 8601 — ต้องมากกว่า startDate' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;
}

export class DelegationListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['from', 'to', 'any'],
    default: 'any',
    description: 'from = ที่ฉันมอบให้ผู้อื่น · to = ที่ฉันได้รับมอบ · any = ทั้งสองทาง',
  })
  @IsOptional()
  @IsIn(['from', 'to', 'any'])
  direction?: 'from' | 'to' | 'any';

  @ApiPropertyOptional({ default: false, description: 'true = เฉพาะที่ยังมีผลอยู่' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  activeOnly?: boolean;
}
