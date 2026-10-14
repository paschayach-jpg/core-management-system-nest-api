import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/rgp-validators';

export class EmployeeLookupDto {
  @ApiProperty({ description: 'ชื่อผู้ใช้ AD' }) adUserName: string;
  @ApiPropertyOptional({ nullable: true }) fullNameTh?: string | null;
}

export class EmployeeLookupQueryDto {
  @ApiPropertyOptional({ description: 'ค้นชื่อผู้ใช้/ชื่อ-สกุล (contains)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** คณะกรรมการ / ฝ่าย / แผนก สำหรับเลือกเป็น "บุคคลที่เกี่ยวข้อง" */
export class OrgLookupDto {
  @ApiProperty({ description: 'SubCommitteeID / DivisionID / DepartmentID' }) id: number;
  @ApiProperty() name: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'DivisionCode / DepartmentCode (คณะกรรมการไม่มี)',
  })
  code?: string | null;
}

export class MasterDocumentDto {
  @ApiProperty() docId: number;
  @ApiPropertyOptional({ nullable: true }) docCode?: string | null;
  @ApiPropertyOptional({ nullable: true }) docName?: string | null;
  @ApiPropertyOptional({ nullable: true }) docTypeId?: number | null;
  @ApiProperty({ description: '"รหัส - ชื่อ"' }) displayName: string;
}

export class MasterDocumentQueryDto {
  @ApiPropertyOptional({ description: 'กรองตามประเภทเอกสาร' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  docTypeId?: number;
}

export class MasterDocumentTypeDto {
  @ApiProperty() docTypeId: number;
  @ApiPropertyOptional({ nullable: true }) docTypeName?: string | null;
}
