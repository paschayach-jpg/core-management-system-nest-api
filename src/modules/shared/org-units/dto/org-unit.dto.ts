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
import { OrgUnitType } from '../../../../common/constants/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class OrgUnitDto {
  @ApiProperty() orgUnitId: number;
  @ApiProperty() orgUnitCode: string;
  @ApiProperty() orgUnitNameTh: string;
  @ApiPropertyOptional() orgUnitNameEn?: string | null;
  @ApiProperty({
    enum: OrgUnitType,
    enumName: 'OrgUnitType',
    description: '1=SubCommittee, 2=Division, 3=Department',
  })
  orgUnitType: OrgUnitType;
  @ApiPropertyOptional() parentOrgUnitId?: number | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() isDeleted: boolean;
  @ApiPropertyOptional() createdDate?: Date | null;
}

export class CreateOrgUnitDto {
  @ApiProperty({ enum: OrgUnitType, enumName: 'OrgUnitType' })
  @Type(() => Number)
  @IsIn([1, 2, 3])
  orgUnitType: OrgUnitType;

  @ApiProperty({ example: 'ฝ่ายบริหารทั่วไป' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  orgUnitNameTh: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  orgUnitNameEn?: string;

  @ApiPropertyOptional({
    description: 'ว่าง = ระบบสร้างให้ (SC-001 / DIV-001 / DEPT-001) · ซ้ำ = ระบบสร้างใหม่ให้',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  orgUnitCode?: string;

  @ApiPropertyOptional({
    description:
      'SubCommittee ห้ามมี parent · Division parent เป็น SubCommittee (ไม่บังคับ) · Department ต้องมี parent เป็น Division',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentOrgUnitId?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class UpdateOrgUnitDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  orgUnitNameTh: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  orgUnitNameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class MoveOrgUnitDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'null = ย้ายไประดับบนสุด (ใช้ได้กับ SubCommittee/Division)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentOrgUnitId?: number | null;
}

export class OrgUnitListQueryDto {
  @ApiPropertyOptional({ enum: OrgUnitType })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3])
  type?: OrgUnitType;

  @ApiPropertyOptional({ description: 'รวมหน่วยงานที่ปิดใช้งาน (ไม่รวมที่ลบแล้ว)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeInactive?: boolean;
}

export class DeleteOrgUnitQueryDto {
  @ApiPropertyOptional({
    description: 'true = ลบแม้มีโฟลเดอร์/ผู้ใช้อ้างอิง (โฟลเดอร์ทั้งหมดของหน่วยงานถูก soft delete)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  force?: boolean;
}

export class LinkDivisionDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) divisionOrgUnitId: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) subCommitteeOrgUnitId: number;
}

export class OrgUnitRelationshipDto {
  @ApiProperty() relationshipId: number;
  @ApiProperty() subCommitteeId: number;
  @ApiProperty() divisionId: number;
  @ApiProperty() isActive: boolean;
}
