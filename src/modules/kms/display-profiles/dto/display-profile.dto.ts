import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SLOT_KEYS } from '../effective-display';
import { trim } from '../../kms-dto.util';

export class ProfileColumnDto {
  @ApiProperty({
    description:
      'จุดแสดงผลคงที่ (Title, TitleCategory, ContentHTML, PublishedDate, EffectiveDate, ExpiryDate, LinkedEntities)',
  })
  slotKey: string;
  @ApiProperty() displayLabel: string;
  @ApiProperty() isVisible: boolean;
  @ApiProperty({ description: 'คำอธิบายจุดที่แสดงผล (แก้ได้ต่อ profile)' }) slotDescription: string;
}

export class ProfileColumnInputDto {
  @ApiProperty({ enum: SLOT_KEYS })
  @IsIn(SLOT_KEYS as string[])
  slotKey: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  displayLabel: string;

  @ApiProperty()
  @IsBoolean()
  isVisible: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  slotDescription?: string;
}

export class SaveProfileDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  profileName: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({
    type: [ProfileColumnInputDto],
    description: 'ค่าของแต่ละ slot (ไม่ซ้ำ slotKey) — slot ที่ไม่ส่งใช้ค่าเริ่มต้น',
  })
  @IsArray()
  @ArrayMaxSize(SLOT_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => ProfileColumnInputDto)
  columns: ProfileColumnInputDto[];
}

export class DisplayProfileDto {
  @ApiProperty() profileId: number;
  @ApiProperty() profileName: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ nullable: true }) createdBy: string | null;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
}

export class DisplayProfileDetailDto extends DisplayProfileDto {
  @ApiProperty({
    type: [ProfileColumnDto],
    description: 'ครบทุก slot (ที่ยังไม่เคยบันทึกใช้ค่าเริ่มต้น)',
  })
  columns: ProfileColumnDto[];
}

export class SlotSettingDto {
  @ApiProperty() label: string;
  @ApiProperty() visible: boolean;
}

export class EffectiveDisplayDto {
  @ApiProperty() categoryId: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'profile ที่ใช้จริง (null = ใช้ค่าเริ่มต้นทั้งหมด)',
  })
  profileId: number | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'slotKey → { label, visible }',
    example: { Title: { label: 'อ้างอิง', visible: true } },
  })
  settings: Record<string, SlotSettingDto>;
}

export class AssignProfileDto {
  @ApiProperty({
    nullable: true,
    description: 'null = ยกเลิกการผูก profile (ใช้ของหมวดแม่/ค่าเริ่มต้น)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  profileId: number | null;
}
