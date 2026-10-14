import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { toBoolean, trim } from '../../dto-utils';
import type { FolderRow } from '../folder.types';

/** โฟลเดอร์ที่ส่งออก API (ไม่มี PhysicalPath · bigint เป็นสตริง) */
export class FolderDto {
  @ApiProperty() folderId: number;
  @ApiProperty() folderName: string;
  @ApiPropertyOptional({ nullable: true }) parentFolderId: number | null;
  @ApiProperty() orgUnitId: number;
  @ApiProperty({ description: '1=HC, 2=SC, 3=NC, 4=PC' }) confidentialityLevel: number;
  @ApiProperty({ description: 'Root = 1, สูงสุด 10' }) folderDepth: number;
  @ApiProperty({ description: 'จำนวนไฟล์ที่ยังใช้งานในโฟลเดอร์นี้ (นับสด)' }) fileCount: number;
  @ApiProperty({ description: 'ขนาดรวมของไฟล์ในโฟลเดอร์นี้ (ไบต์, bigint เป็นสตริง)' })
  folderSizeBytes: string;
  @ApiProperty() isArchived: boolean;
  @ApiProperty() isDeleted: boolean;
  @ApiProperty() inheritPermission: boolean;
  @ApiPropertyOptional({ nullable: true }) templateId: number | null;
  @ApiProperty() createdBy: number;
  @ApiPropertyOptional({ nullable: true }) createdByName: string | null;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) updatedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) deletedDate: Date | null;
  @ApiPropertyOptional({ nullable: true, description: 'วันหมดอายุในถังขยะ' })
  recycleBinExpiry: Date | null;
}

export class FolderPathItemDto {
  @ApiProperty() folderId: number;
  @ApiProperty() folderName: string;
}

export class FolderDetailDto extends FolderDto {
  @ApiProperty({ type: [FolderPathItemDto], description: 'เส้นทางจาก Root ถึงโฟลเดอร์นี้' })
  path: FolderPathItemDto[];
}

export class FolderStatsDto {
  @ApiProperty() folderId: number;
  @ApiProperty({ description: 'ไฟล์ที่ยังใช้งานในโฟลเดอร์นี้ (นับสด)' }) fileCount: number;
  @ApiProperty({ description: 'ขนาดรวมไฟล์ในโฟลเดอร์นี้ (ไบต์)' }) sizeBytes: string;
  @ApiProperty({ description: 'จำนวนโฟลเดอร์ย่อยทุกชั้น (ไม่รวมตัวเอง/ที่ถูกลบ)' })
  subfolderCount: number;
  @ApiProperty({ description: 'ไฟล์ที่ยังใช้งานทั้งต้นไม้ย่อย (รวมตัวเอง)' })
  subtreeFileCount: number;
  @ApiProperty({ description: 'ขนาดรวมไฟล์ทั้งต้นไม้ย่อย (ไบต์)' }) subtreeSizeBytes: string;
}

export function toFolderDto(r: FolderRow): FolderDto {
  return {
    folderId: r.folderId,
    folderName: r.folderName,
    parentFolderId: r.parentFolderId,
    orgUnitId: r.orgUnitId,
    confidentialityLevel: r.confidentialityLevel,
    folderDepth: r.folderDepth,
    fileCount: r.fileCount,
    folderSizeBytes: r.folderSizeBytes,
    isArchived: r.isArchived,
    isDeleted: r.isDeleted,
    inheritPermission: r.inheritPermission,
    templateId: r.templateId,
    createdBy: r.createdBy,
    createdByName: r.createdByName ?? null,
    createdDate: r.createdDate,
    updatedDate: r.updatedDate,
    deletedDate: r.deletedDate,
    recycleBinExpiry: r.recycleBinExpiry,
  };
}

export class FolderListQueryDto {
  @ApiPropertyOptional({ description: 'กรองตามหน่วยงาน (ไม่ระบุ = ทุกหน่วยงานที่มองเห็น)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId?: number;

  @ApiPropertyOptional({ description: 'ระบุ = ได้เฉพาะโฟลเดอร์ย่อยชั้นถัดไปของโฟลเดอร์นี้' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentFolderId?: number;

  @ApiPropertyOptional({ description: 'true = เฉพาะ Root หลัก (1HC/2SC/3NC/4PC)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  rootsOnly?: boolean;
}

export class CreateFolderDto {
  @ApiProperty({ example: '2SC - ฝ่ายบริหาร [2SC]' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description:
      'โฟลเดอร์แม่ (ไม่ระบุ = สร้าง Root หลัก ซึ่งต้องระบุ orgUnitId และ confidentialityLevel)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentFolderId?: number;

  @ApiPropertyOptional({
    description: 'หน่วยงาน — Root ต้องระบุ · โฟลเดอร์ย่อยใช้ของโฟลเดอร์แม่ (ถ้าระบุต้องตรงกัน)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgUnitId?: number;

  @ApiPropertyOptional({
    enum: [1, 2, 3, 4],
    description:
      'ชั้นความลับ 1=HC 2=SC 3=NC 4=PC · Root ต้องระบุ · โฟลเดอร์ย่อยไม่ระบุ = สืบทอดจากแม่ (ถ้าระบุต้องเท่ากับของแม่)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  confidentialityLevel?: number;

  @ApiPropertyOptional({ description: 'เหตุผลประกอบคำขออนุมัติ (ใช้เมื่อสร้าง 1HC)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ApprovalRefDto {
  @ApiProperty() requestId: number;
  @ApiProperty({ description: '1=Pending, 2=Approved, 3=Rejected, 4=Expired' })
  requestStatus: number;
}

export class CreateFolderResultDto {
  @ApiProperty({ description: 'true = สร้างโฟลเดอร์แล้ว · false = ส่งคำขออนุมัติแล้ว (HTTP 202)' })
  created: boolean;
  @ApiPropertyOptional({ type: FolderDto }) folder?: FolderDto;
  @ApiPropertyOptional({ type: ApprovalRefDto, description: 'มีเมื่อ created=false' })
  approval?: ApprovalRefDto;
}

export class RenameFolderDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;
}

export class MoveFolderDto {
  @ApiProperty({ description: 'โฟลเดอร์ปลายทาง (จะกลายเป็นแม่ใหม่)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  destinationParentFolderId: number;
}

export class CopyFolderStructureDto {
  @ApiProperty({ description: 'โฟลเดอร์แม่ที่จะวางโครงสร้างที่คัดลอก' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  destinationParentFolderId: number;
}

export class ChangeConfidentialityDto {
  @ApiProperty({ enum: [1, 2, 3, 4] })
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  confidentialityLevel: number;
}

export class RequestFolderDeleteDto {
  @ApiPropertyOptional({ description: 'เหตุผลที่ขอลบ' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CopyStructureResultDto {
  @ApiProperty({ description: 'โฟลเดอร์ใหม่ที่เป็นรากของโครงสร้างที่คัดลอก' }) folder: FolderDto;
  @ApiProperty() createdCount: number;
}
