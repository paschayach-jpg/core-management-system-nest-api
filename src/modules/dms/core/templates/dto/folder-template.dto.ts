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
import { toBoolean, trim } from '../../dto-utils';
import { FolderDto } from '../../folders/dto/folder.dto';

export const TEMPLATE_TARGET_TYPES = ['Any', 'SubCommittee', 'Division', 'Department'] as const;

export class FolderTemplateDto {
  @ApiProperty() templateId: number;
  @ApiProperty() templateCode: string;
  @ApiProperty() templateName: string;
  @ApiProperty({ enum: TEMPLATE_TARGET_TYPES }) targetType: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiPropertyOptional({ nullable: true }) orgUnitId: number | null;
  @ApiPropertyOptional({ nullable: true }) orgUnitName: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdBy: number;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
}

export class FolderTemplateItemDto {
  @ApiProperty() itemId: number;
  @ApiProperty() templateId: number;
  @ApiPropertyOptional({ nullable: true, description: 'ว่าง = อยู่ชั้นบนสุดของแม่แบบ' })
  parentItemId: number | null;
  @ApiProperty() folderName: string;
  @ApiProperty({ description: '1=HC, 2=SC, 3=NC, 4=PC (ใช้เมื่อ inheritPermission=false)' })
  confidentialityLevel: number;
  @ApiProperty() sortOrder: number;
  @ApiProperty() inheritPermission: boolean;
}

export class FolderTemplateDetailDto extends FolderTemplateDto {
  @ApiProperty({ type: [FolderTemplateItemDto] }) items: FolderTemplateItemDto[];
}

export class TemplateListQueryDto {
  @ApiPropertyOptional({ description: 'true = รวมแม่แบบที่ปิดใช้งาน (Manager+)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateFolderTemplateDto {
  @ApiProperty({ maxLength: 50 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  templateCode: string;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  templateName: string;

  @ApiProperty({ enum: TEMPLATE_TARGET_TYPES })
  @IsIn(TEMPLATE_TARGET_TYPES as unknown as string[])
  targetType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'หน่วยงานเจ้าของแม่แบบ (ไม่บังคับ)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId?: number;
}

export class UpdateFolderTemplateDto {
  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  templateCode?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  templateName?: string;

  @ApiPropertyOptional({ enum: TEMPLATE_TARGET_TYPES })
  @IsOptional()
  @IsIn(TEMPLATE_TARGET_TYPES as unknown as string[])
  targetType?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTemplateItemDto {
  @ApiPropertyOptional({
    description: 'รหัสรายการแม่ (ต้องอยู่ในแม่แบบเดียวกัน) — ไม่ระบุ = ชั้นบนสุด',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentItemId?: number;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  folderName: string;

  @ApiPropertyOptional({ enum: [1, 2, 3, 4], default: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  confidentialityLevel?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  inheritPermission?: boolean;
}

export class UpdateTemplateItemDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  folderName?: string;

  @ApiPropertyOptional({ enum: [1, 2, 3, 4] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  confidentialityLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inheritPermission?: boolean;
}

export class ApplyTemplateDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) templateId: number;
}

export class ApplyTemplateToOrgUnitDto {
  @ApiProperty({ description: 'หน่วยงานที่จะสร้าง Root ใหม่จากแม่แบบ' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId: number;

  @ApiProperty({ example: '2SC - ฝ่ายบริหาร [2SC]' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  rootFolderName: string;

  @ApiProperty({
    enum: [2, 3, 4],
    description: 'ชั้นความลับของ Root (1HC ต้องสร้างผ่าน POST /dms/folders เพื่อขออนุมัติ)',
  })
  @Type(() => Number)
  @IsIn([2, 3, 4])
  confidentialityLevel: number;
}

export class ApplyTemplateResultDto {
  @ApiProperty({ description: 'จำนวนโฟลเดอร์ที่สร้างทั้งหมด (รวมลูกหลาน)' }) createdCount: number;
  @ApiProperty({ type: [FolderDto], description: 'โฟลเดอร์ชั้นบนสุดที่สร้าง (หรือ Root ใหม่)' })
  folders: FolderDto[];
}
