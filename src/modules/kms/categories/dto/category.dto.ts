import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { toBool, trim } from '../../kms-dto.util';

export class KbCategoryDto {
  @ApiProperty() categoryId: number;
  @ApiPropertyOptional({ nullable: true }) parentCategoryId: number | null;
  @ApiPropertyOptional({ nullable: true }) parentCategoryName: string | null;
  @ApiProperty() categoryCode: string;
  @ApiProperty() categoryName: string;
  @ApiPropertyOptional({ nullable: true, description: 'รหัสไอคอน "1"-"9" (KBCategoryIcon)' })
  icon: string | null;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ nullable: true }) displayProfileId: number | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'รหัสประเภทเอกสาร 1-9 = ตัวที่ 25 ของ Code รวมตอน import ไฟล์ที่ไม่ใช่กฎหมาย (unique)',
  })
  importTypeDigit: string | null;
  @ApiPropertyOptional({ nullable: true }) createdBy: string | null;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
  @ApiProperty({ description: 'ระดับชั้นในต้นไม้ (0 = root) — ตามลำดับการแสดงผลแบบ tree' })
  depth: number;
  @ApiProperty({ description: 'เส้นทางชื่อจาก root เช่น "กฎหมาย › พ.ร.บ. X › X2535"' })
  path: string;
}

export class CategoryListQueryDto {
  @ApiPropertyOptional({ description: 'true = เฉพาะหมวดที่เปิดใช้งาน' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;

  @ApiPropertyOptional({ description: 'เฉพาะลูกโดยตรงของหมวดนี้' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number;

  @ApiPropertyOptional({ description: 'true = เฉพาะหมวดราก (ไม่มี parent)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  rootsOnly?: boolean;
}

export class CreateCategoryDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'หมวดแม่ (ไม่ระบุ = หมวดราก) · ลึกกี่ชั้นก็ได้',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentCategoryId?: number | null;

  @ApiProperty({ example: 'PVI00', description: 'รหัสหมวด (unique) — กฎหมาย: 5 ตัว เช่น PVI00' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  categoryCode: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  categoryName: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @Matches(/^[1-9]$/, { message: 'icon ต้องเป็น "1"-"9"' })
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'รหัสประเภทเอกสาร "1"-"9" (ห้ามซ้ำ · ห้ามตั้งให้หมวด LW หรือหมวดใต้กฎหมาย) · null/ว่าง = ไม่ใช่หมวดประเภทเอกสาร',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5)
  importTypeDigit?: string | null;
}

/** แก้บางส่วน: ฟิลด์ที่ไม่ส่ง = คงเดิม (ส่ง parentCategoryId/importTypeDigit/icon/description เป็น null = ล้างค่า) */
export class UpdateCategoryDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentCategoryId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  categoryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  categoryName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[1-9]$/, { message: 'icon ต้องเป็น "1"-"9"' })
  icon?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5)
  importTypeDigit?: string | null;
}

export class CategorySummaryDto {
  @ApiProperty() categoryId: number;
  @ApiProperty({ description: 'จำนวนบทความ (ไม่ถูกลบ) ในหมวดนี้โดยตรง' }) ownCount: number;
  @ApiProperty({ description: 'รวมบทความของหมวดย่อยทุกชั้น' }) totalCount: number;
}

export class CategoryTitleDto {
  @ApiProperty() title: string;
  @ApiProperty({ description: 'จำนวนบทความที่ใช้ Title นี้ในหมวด' }) articleCount: number;
  @ApiProperty() firstArticleId: number;
}

export class CategoryTitlesQueryDto extends PaginationQueryDto {}
