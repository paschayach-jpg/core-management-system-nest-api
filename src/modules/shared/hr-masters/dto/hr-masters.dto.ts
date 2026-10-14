import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const opt = () => IsOptional();

// ── ฝ่าย (EMS.m_Division) ────────────────────────────────────
export class CreateDivisionDto {
  @ApiProperty() @IsString() @MaxLength(20) divisionCode: string;
  @ApiProperty() @IsString() @MaxLength(200) divisionName: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(200) divisionNameTh?: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(200) divisionNameEn?: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(50) level?: string;
  @ApiPropertyOptional({ default: true }) @opt() @IsBoolean() isActive?: boolean;
}
export class UpdateDivisionDto extends PartialType(CreateDivisionDto) {}

// ── แผนก (EMS.m_Department) ──────────────────────────────────
export class CreateDepartmentDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) divisionId: number;
  @ApiProperty() @IsString() @MaxLength(20) departmentCode: string;
  @ApiProperty() @IsString() @MaxLength(200) departmentName: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(200) departmentNameTh?: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(200) departmentNameEn?: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(50) level?: string;
  @ApiPropertyOptional({ default: true }) @opt() @IsBoolean() isActive?: boolean;
}
export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

// ── ตำแหน่ง (EMS.m_Role) ─────────────────────────────────────
export class CreatePositionDto {
  @ApiProperty() @IsString() @MaxLength(20) positionCode: string;
  @ApiProperty() @IsString() @MaxLength(200) positionName: string;
  @ApiPropertyOptional()
  @opt()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(255)
  positionLevel?: number;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(4) levelCode?: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(50) level?: string;
  @ApiPropertyOptional({ default: true }) @opt() @IsBoolean() isActive?: boolean;
}
export class UpdatePositionDto extends PartialType(CreatePositionDto) {}

// ── ระดับตำแหน่ง (EMS.m_Position) ────────────────────────────
export class CreatePositionLevelDto {
  @ApiProperty({ description: 'รหัสระดับ (PK) เช่น C10' })
  @IsString()
  @Length(1, 4)
  levelCode: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) levelGroup: number;
  @ApiProperty() @IsString() @MaxLength(10) levelVariant: string;
  @ApiProperty() @IsString() @MaxLength(100) levelName: string;
  @ApiProperty() @IsString() @MaxLength(50) levelCategory: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) sortOrder: number;
  @ApiPropertyOptional({ default: true }) @opt() @IsBoolean() isActive?: boolean;
}
export class UpdatePositionLevelDto {
  @ApiPropertyOptional() @opt() @Type(() => Number) @IsInt() @Min(0) levelGroup?: number;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(10) levelVariant?: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(100) levelName?: string;
  @ApiPropertyOptional() @opt() @IsString() @MaxLength(50) levelCategory?: string;
  @ApiPropertyOptional() @opt() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
}

// ── การผูกตำแหน่งกับฝ่าย/แผนก (EMS.m_PositionMapping) ────────
export class CreatePositionMappingDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) positionId: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) divisionId: number;
  @ApiPropertyOptional({ nullable: true })
  @opt()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId?: number | null;
  @ApiPropertyOptional({ default: 1 })
  @opt()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  headCount?: number;
  @ApiPropertyOptional({ default: true }) @opt() @IsBoolean() isActive?: boolean;
}
export class UpdatePositionMappingDto extends PartialType(CreatePositionMappingDto) {}

export class PositionMappingViewDto {
  @ApiProperty() mappingId: number;
  @ApiProperty() positionId: number;
  @ApiPropertyOptional() positionName?: string | null;
  @ApiProperty() divisionId: number;
  @ApiPropertyOptional() divisionName?: string | null;
  @ApiPropertyOptional() departmentId?: number | null;
  @ApiPropertyOptional() departmentName?: string | null;
  @ApiProperty() headCount: number;
  @ApiProperty() isActive: boolean;
}
