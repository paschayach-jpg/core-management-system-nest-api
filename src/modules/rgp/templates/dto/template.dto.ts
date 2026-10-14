import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { toBool, trim } from '../../common/rgp-validators';

export class TemplateListItemDto {
  @ApiProperty() templateId: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty() active: boolean;
  @ApiProperty({ description: 'ประเภทพจนานุกรมกฎหมาย' }) isLegalDict: boolean;
  @ApiProperty() createDate: Date;
  @ApiProperty() stateCount: number;
  @ApiProperty({ description: 'จำนวนโครงการที่ใช้ template นี้ (รวมที่ถูกลบ)' })
  projectCount: number;
}

export class TemplateListQueryDto {
  @ApiPropertyOptional({ description: 'true = เฉพาะ template ที่เปิดใช้งาน (สำหรับ dropdown)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;
}

export class TemplateStateDto {
  @ApiProperty() stateId: number;
  @ApiProperty() templateId: number;
  @ApiProperty() name: string;
  @ApiProperty() seqNo: number;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty() required: boolean;
  @ApiProperty() docCount: number;
}

export class TemplateDocDto {
  @ApiProperty() templateDocId: number;
  @ApiProperty() templateId: number;
  @ApiProperty() stateId: number;
  @ApiProperty({ description: 'doc_id ของเอกสารมาสเตอร์ (BUI_RG.dbo.m_document)' })
  masterDocId: number;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true, description: 'รหัสเอกสาร (doc_code) ตอนที่เลือก' })
  docType?: string | null;
  @ApiProperty() required: boolean;
  @ApiProperty() seqNo: number;
  @ApiPropertyOptional({ nullable: true }) remark?: string | null;
}

export class TemplateDetailDto extends TemplateListItemDto {
  @ApiProperty({ type: [TemplateStateDto] }) states: TemplateStateDto[];
  @ApiProperty({ type: [TemplateDocDto] }) docs: TemplateDocDto[];
}

export class CreateTemplateDto {
  @ApiProperty({ example: 'LEGAL', description: 'รหัสประเภทโครงการ (ไม่ซ้ำ)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string;

  @ApiProperty({ example: 'โครงการพจนานุกรมกฎหมาย' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLegalDict?: boolean;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLegalDict?: boolean;
}

export class CreateTemplateStateDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ description: 'ไม่ระบุ = ต่อท้าย (MAX+1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  seqNo?: number;
}

export class UpdateTemplateStateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  seqNo?: number;
}

export class CreateTemplateDocDto {
  @ApiProperty({
    description: 'doc_id ของเอกสารมาสเตอร์ (ชื่อ/รหัสเอกสารคัดลอกจากมาสเตอร์ตอนบันทึก)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  masterDocId: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ description: 'ไม่ระบุ = ต่อท้ายของขั้นตอน' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  seqNo?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  remark?: string | null;
}

export class UpdateTemplateDocDto {
  @ApiPropertyOptional({ description: 'เปลี่ยนเอกสารมาสเตอร์ (ชื่อ/รหัสถูกคัดลอกใหม่)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  masterDocId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  seqNo?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  remark?: string | null;
}

export class CopyTemplateStatesDto {
  @ApiProperty({
    description:
      'คัดลอกขั้นตอนจาก template ต้นทางมาแทนที่ขั้นตอนเดิมทั้งหมด (เอกสารของ template นี้ถูกลบ)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceTemplateId: number;
}

export class CopyTemplateStatesResultDto {
  @ApiProperty() copiedStates: number;
}

// ───────────── แม่แบบสำหรับสร้างโครงการ ─────────────

export class BlueprintStateDto {
  @ApiProperty() templateStateId: number;
  @ApiProperty() name: string;
  @ApiProperty() seqNo: number;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty() required: boolean;
}

export class BlueprintDocDto {
  @ApiProperty({ description: 'ตำแหน่งของขั้นตอนใน states[]' }) stateIndex: number;
  @ApiProperty() masterDocId: number;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) docType?: string | null;
  @ApiProperty() required: boolean;
  @ApiPropertyOptional({ nullable: true }) remark?: string | null;
}

/** รูปแบบเดียวกับ states/documents ของ POST /rgp/projects — client ดึงไปแก้ก่อนบันทึก (แทนการ "stage" ในหน่วยความจำของโปรแกรมเดิม) */
export class TemplateBlueprintDto {
  @ApiProperty() templateId: number;
  @ApiProperty() isLegalDict: boolean;
  @ApiProperty({ type: [BlueprintStateDto] }) states: BlueprintStateDto[];
  @ApiProperty({ type: [BlueprintDocDto] }) documents: BlueprintDocDto[];
}
