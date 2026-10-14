import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { toBoolean, trim } from '../../dto-utils';
import type { FileRow } from '../file.types';

/** ไฟล์ที่ส่งออก API (ไม่มี PhysicalPath/StoredFileName — เป็นข้อมูลภายในของที่เก็บไฟล์) */
export class FileDto {
  @ApiProperty() fileId: number;
  @ApiProperty() folderId: number;
  @ApiPropertyOptional({ nullable: true }) folderName: string | null;
  @ApiProperty() originalFileName: string;
  @ApiProperty({ example: '.pdf' }) fileExtension: string;
  @ApiProperty() mimeType: string;
  @ApiProperty({ description: 'ขนาดไบต์ (bigint เป็นสตริง)' }) fileSizeBytes: string;
  @ApiProperty({ description: 'SHA-256 (hex)' }) checksum: string;
  @ApiProperty() version: number;
  @ApiProperty({ description: '1=Active, 2=Archived, 3=Deleted' }) fileStatus: number;
  @ApiProperty({
    description: '0=Pending, 1=Clean, 2=Infected, 3=Error (ยังไม่มีการสแกนไวรัส จึงเป็น 0)',
  })
  virusScanStatus: number;
  @ApiProperty() uploadedBy: number;
  @ApiPropertyOptional({ nullable: true }) uploadedByName: string | null;
  @ApiPropertyOptional({ nullable: true }) uploadedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) deletedBy: number | null;
  @ApiPropertyOptional({ nullable: true }) deletedDate: Date | null;
}

export class FileVersionDto extends FileDto {
  @ApiProperty({ description: 'true = เวอร์ชันปัจจุบันที่ใช้งานอยู่' }) isCurrent: boolean;
}

export function toFileDto(r: FileRow): FileDto {
  return {
    fileId: r.fileId,
    folderId: r.folderId,
    folderName: r.folderName ?? null,
    originalFileName: r.originalFileName,
    fileExtension: r.fileExtension,
    mimeType: r.mimeType,
    fileSizeBytes: r.fileSizeBytes,
    checksum: r.checksum,
    version: r.version,
    fileStatus: r.fileStatus,
    virusScanStatus: r.virusScanStatus,
    uploadedBy: r.uploadedBy,
    uploadedByName: r.uploadedByName ?? null,
    uploadedDate: r.uploadedDate,
    deletedBy: r.deletedBy,
    deletedDate: r.deletedDate,
  };
}

export class UploadFilesBodyDto {
  @ApiPropertyOptional({
    description:
      'true = ชื่อซ้ำให้แทนที่ (เพิ่ม Version, ไฟล์เดิมเข้าถังขยะ) · false/ไม่ระบุ = ตั้งชื่อ `name copy(N).ext`',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overwriteExisting?: boolean;
}

export class UploadItemResultDto {
  @ApiProperty() originalName: string;
  @ApiProperty() success: boolean;
  @ApiPropertyOptional() fileId?: number;
  @ApiPropertyOptional({ description: 'ชื่อที่บันทึกจริง (อาจเป็น copy(N))' }) actualName?: string;
  @ApiPropertyOptional() isDuplicate?: boolean;
  @ApiPropertyOptional() version?: number;
  @ApiPropertyOptional({ description: 'รหัสความผิดพลาด เช่น FILE_EXTENSION_NOT_ALLOWED' })
  errorCode?: string;
  @ApiPropertyOptional() error?: string;
}

export class UploadResultDto {
  @ApiProperty({ type: [UploadItemResultDto] }) items: UploadItemResultDto[];
  @ApiProperty() successCount: number;
  @ApiProperty() failureCount: number;
}

export class RenameFileDto {
  @ApiProperty({ description: 'ชื่อใหม่ (ต้องมีนามสกุลเดิม)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(260)
  name: string;
}

export class MoveFilesDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileIds: number[];

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) destinationFolderId: number;
}

export class MoveItemResultDto {
  @ApiProperty() fileId: number;
  @ApiProperty() success: boolean;
  @ApiPropertyOptional({ description: 'ชื่อไฟล์ใหม่ถ้าชื่อชนกับไฟล์ในปลายทาง' }) renamedTo?: string;
  @ApiPropertyOptional() errorCode?: string;
  @ApiPropertyOptional() error?: string;
}

export class MoveFilesResultDto {
  @ApiProperty({ type: [MoveItemResultDto] }) items: MoveItemResultDto[];
  @ApiProperty() successCount: number;
  @ApiProperty() failureCount: number;
}

export class CopyFileDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) destinationFolderId: number;

  @ApiPropertyOptional({
    description: 'true = แทนที่ไฟล์ชื่อเดียวกันในปลายทาง · ไม่ระบุ = ตั้งชื่อ copy(N)',
    default: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overwrite?: boolean;
}

export class CheckDuplicatesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(260, { each: true })
  fileNames: string[];
}

export class DuplicateNamesDto {
  @ApiProperty({ type: [String], description: 'ชื่อที่ซ้ำกับไฟล์ที่ใช้งานอยู่ในโฟลเดอร์' })
  duplicates: string[];
}

export class DownloadAccessDto {
  @ApiProperty({ description: 'ดาวน์โหลดได้ทันที' }) canDownload: boolean;
  @ApiProperty({ description: 'ต้องขออนุมัติก่อน (DMS_APPROVAL: DOWNLOAD_FILE)' })
  requiresApproval: boolean;
  @ApiPropertyOptional({
    description: 'วิธีที่ได้สิทธิ์: PRIVILEGED | AUTHORITY | FILE_SHARE | APPROVAL',
  })
  via?: string;
  @ApiPropertyOptional({ description: 'เลขคำขอที่อนุมัติแล้วและยังไม่ถูกใช้' })
  approvedRequestId?: number;
  @ApiPropertyOptional({ description: 'ถ้าดาวน์โหลดไม่ได้และขออนุมัติไม่ได้ จะมีเหตุผล' })
  reason?: string;
}
