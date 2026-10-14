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
import { DOC_STATUSES } from '../../common/rgp-rules';
import { trim } from '../../common/rgp-validators';

export class ProjectDocDto {
  @ApiProperty() docWfId: number;
  @ApiProperty() projStateId: number;
  @ApiProperty() projectId: number;
  @ApiPropertyOptional({ nullable: true }) stateName?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'อ้าง BUI_RG.dbo.m_document (null = กรอกเอง)',
  })
  masterDocId?: number | null;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) docType?: string | null;
  @ApiProperty() required: boolean;
  @ApiProperty({ enum: DOC_STATUSES }) status: string;
  @ApiPropertyOptional({ nullable: true }) remark?: string | null;
  @ApiProperty() seqNo: number;
  @ApiProperty() createUser: string;
  @ApiProperty() createDate: Date;
  @ApiPropertyOptional({ nullable: true }) updateUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) updateDate?: Date | null;
}

/** ฟิลด์เอกสารที่ใช้ร่วมกันระหว่าง "เพิ่มเอกสาร" และ "สร้างโครงการพร้อมเอกสาร" */
export class DocInputDto {
  @ApiProperty({ example: 'หนังสือขออนุมัติ' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  docType?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  remark?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'doc_id ของเอกสารมาสเตอร์ (BUI_RG.dbo.m_document)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  masterDocId?: number | null;
}

export class CreateDocDto extends DocInputDto {}

export class UpdateDocDto {
  @ApiPropertyOptional({ description: 'ย้ายไปขั้นตอนอื่นของโครงการเดียวกัน' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projStateId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  docType?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ enum: DOC_STATUSES })
  @IsOptional()
  @IsIn(DOC_STATUSES)
  status?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  remark?: string | null;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  seqNo?: number;
}

export class UpdateDocStatusDto {
  @ApiProperty({ enum: DOC_STATUSES })
  @IsIn(DOC_STATUSES)
  status: string;
}
