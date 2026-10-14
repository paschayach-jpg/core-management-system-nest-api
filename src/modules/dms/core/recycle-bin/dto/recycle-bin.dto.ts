import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../../../common/dto/pagination.dto';
import { toBoolean } from '../../dto-utils';

export class RecycleBinFolderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'กรองตามหน่วยงาน' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId?: number;

  @ApiPropertyOptional({
    description:
      'true = แสดงโฟลเดอร์ย่อยที่ถูกลบตามแม่ด้วย (ค่าเริ่มต้นแสดงเฉพาะโฟลเดอร์ที่ถูกลบโดยตรง)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeDescendants?: boolean;
}

export class RecycleBinFileQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'กรองตามหน่วยงาน' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId?: number;
}

export class RestoreFolderDto {
  @ApiPropertyOptional({
    description:
      'โฟลเดอร์แม่ใหม่ (จำเป็นเมื่อโฟลเดอร์แม่เดิมไม่อยู่แล้ว) — ไม่ระบุ = กลับไปที่แม่เดิม',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  newParentFolderId?: number;
}

export class PurgeResultDto {
  @ApiProperty({ description: 'จำนวนโฟลเดอร์ที่ลบถาวร (รวมโฟลเดอร์ย่อย)' }) folders: number;
  @ApiProperty({ description: 'จำนวนแถวไฟล์ที่ลบถาวร' }) files: number;
  @ApiProperty({ description: 'จำนวนไฟล์กายภาพที่ลบสำเร็จ' }) physicalDeleted: number;
  @ApiProperty({ description: 'จำนวนไฟล์กายภาพที่ลบไม่สำเร็จ (ค้างบนที่จัดเก็บ — ดู log)' })
  physicalFailed: number;
}
