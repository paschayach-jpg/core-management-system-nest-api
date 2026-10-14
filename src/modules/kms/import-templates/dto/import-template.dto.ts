import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { toBool, trim } from '../../kms-dto.util';

export class TemplateColumnDto {
  @ApiProperty({
    description: 'คอลัมน์ของ t_KBArticle หรือแถวเสมือน Attachment / LawReference / LayoutType',
  })
  targetColumnName: string;
  @ApiProperty() columnDescription: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ตัวอักษรคอลัมน์ ("C"), ชื่อหัวตาราง, นิพจน์ "มาตรา {C}" · LayoutType = Law/Decree/NonLaw · ArticleType = 1-5 · ว่าง = ไม่ map',
  })
  excelColumnRef: string | null;
  @ApiProperty() displayOrder: number;
}

export class TemplateListQueryDto {
  @ApiPropertyOptional({ description: 'true = เฉพาะ Template ที่เปิดใช้งาน' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;
}

export class ImportTemplateDto {
  @ApiProperty() templateId: number;
  @ApiProperty() templateName: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ nullable: true }) createdBy: string | null;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) updatedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedDate: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['Law', 'Decree', 'NonLaw'],
    description: 'ประเภทไฟล์ที่ Template ตั้งไว้',
  })
  layoutType: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'ArticleType (1-5) ที่ Template ตั้งไว้' })
  articleType: number | null;
  @ApiProperty({
    description: 'Template map Attachment (ต้องเลือกโฟลเดอร์ DMS + ไฟล์แนบตอน import)',
  })
  hasAttachment: boolean;
}

export class ImportTemplateDetailDto extends ImportTemplateDto {
  @ApiProperty({
    type: [TemplateColumnDto],
    description: 'ตาราง mapping ครบทุกคอลัมน์เป้าหมาย (ที่ยังไม่ map ว่าง)',
  })
  columns: TemplateColumnDto[];
  @ApiProperty({
    type: [String],
    description: 'ข้อที่ Template ยังตั้งค่าไม่ครบ (ว่าง = ใช้งานได้)',
  })
  problems: string[];
}

export class TemplateColumnInputDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  targetColumnName: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  excelColumnRef?: string | null;
}

export class SaveTemplateDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  templateName: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiProperty({ type: [TemplateColumnInputDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TemplateColumnInputDto)
  columns: TemplateColumnInputDto[];
}

export class TemplateOptionsDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } }) layouts: {
    layoutType: string;
    description: string;
  }[];
  @ApiProperty({ type: 'array', items: { type: 'object' } }) articleTypes: {
    articleType: number;
    description: string;
  }[];
}
