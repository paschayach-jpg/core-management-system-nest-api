import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../../common/dto/pagination.dto';

// ── แชร์ภายใน ────────────────────────────────────────────────

export class CreateInternalShareDto {
  @ApiProperty() @IsInt() @Min(1) fileId: number;

  @ApiProperty({ minimum: 1, maximum: 4, description: '1=User, 2=Role, 3=Department, 4=Division' })
  @IsInt()
  @Min(1)
  @Max(4)
  principalType: number;

  @ApiProperty({
    description: 'UserID / AppRole(1–4) / DepartmentID / DivisionID ตาม principalType',
  })
  @IsInt()
  @Min(1)
  principalId: number;

  @ApiProperty() @IsBoolean() canRead: boolean;
  @ApiProperty() @IsBoolean() canWrite: boolean;
  @ApiProperty() @IsBoolean() canDelete: boolean;

  @ApiPropertyOptional({
    description: 'วันหมดอายุ (ห้ามย้อนหลัง ไม่เกิน 1 ปี) — ไม่ระบุ = ไม่หมดอายุ',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;
}

export class RequestFolderShareDto {
  @ApiProperty() @IsInt() @Min(1) folderId: number;

  @ApiProperty({ minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  principalType: number;

  @ApiProperty() @IsInt() @Min(1) principalId: number;
  @ApiProperty() @IsBoolean() canRead: boolean;
  @ApiProperty() @IsBoolean() canWrite: boolean;
  @ApiProperty() @IsBoolean() canDelete: boolean;
  @ApiProperty() @IsBoolean() canModify: boolean;
  @ApiProperty() @IsBoolean() canFullControl: boolean;
  @ApiProperty() @IsBoolean() isDeny: boolean;
}

export class InternalShareResultDto {
  @ApiProperty({ description: 'true = ส่งคำขออนุมัติแล้ว (ยังไม่มีสิทธิ์จนกว่าจะอนุมัติ)' })
  requiresApproval: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'เลขสิทธิ์ที่สร้างทันที (กรณีไม่ต้องอนุมัติ)',
  })
  filePermissionId: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'เลขคำขออนุมัติ (กรณีต้องอนุมัติ)' })
  approvalRequestId: number | null;
}

export class FolderShareRequestResultDto {
  @ApiProperty() approvalRequestId: number;
}

export class InternalShareDto {
  @ApiProperty() filePermissionId: number;
  @ApiProperty() fileId: number;
  @ApiPropertyOptional({ nullable: true }) fileName: string | null;
  @ApiProperty() principalType: number;
  @ApiProperty() principalId: number;
  @ApiProperty() canRead: boolean;
  @ApiProperty() canWrite: boolean;
  @ApiProperty() canDelete: boolean;
  @ApiPropertyOptional({ nullable: true }) expiryDate: Date | null;
  @ApiProperty() grantedBy: number;
  @ApiPropertyOptional({ nullable: true }) grantedByName: string | null;
  @ApiProperty() grantedDate: Date;
}

// ── แชร์ภายนอก ───────────────────────────────────────────────

export class CreateExternalShareDto {
  @ApiPropertyOptional({ description: 'ระบุ fileId หรือ folderId อย่างใดอย่างหนึ่ง (ไม่ทั้งคู่)' })
  @ValidateIf((o: CreateExternalShareDto) => o.fileId !== undefined || o.folderId === undefined)
  @IsInt()
  @Min(1)
  fileId?: number;

  @ApiPropertyOptional()
  @ValidateIf((o: CreateExternalShareDto) => o.folderId !== undefined || o.fileId === undefined)
  @IsInt()
  @Min(1)
  folderId?: number;

  @ApiPropertyOptional({
    description: 'วันหมดอายุ (ต้องอยู่ในอนาคต ไม่เกิน 90 วัน) — ไม่ระบุ = 90 วันนับจากวันนี้',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;

  @ApiPropertyOptional({
    minLength: 4,
    maxLength: 100,
    description: 'รหัสผ่านของลิงก์ (เก็บเป็น hash)',
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'จำนวนครั้งที่ดาวน์โหลดได้ — ไม่ระบุ = ไม่จำกัด',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  downloadLimit?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  sharePurpose?: string;

  @ApiPropertyOptional({ default: true, description: 'แจ้งเจ้าของเมื่อมีคนเข้าถึงลิงก์' })
  @IsOptional()
  @IsBoolean()
  notifyOnAccess?: boolean;
}

export class ExternalShareReasonDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class ExternalShareListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['Pending', 'Active', 'Disabled', 'Expired', 'Revoked'] })
  @IsOptional()
  @IsIn(['Pending', 'Active', 'Disabled', 'Expired', 'Revoked'])
  status?: string;

  @ApiPropertyOptional({ description: 'เฉพาะ Admin: กรองตามเจ้าของ' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sharerUserId?: number;
}

export class InternalShareListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'เฉพาะ Admin: กรองตามผู้ให้สิทธิ์' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  grantedBy?: number;
}

export class ExternalShareDto {
  @ApiProperty() externalShareId: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'token ของลิงก์ — แสดงเฉพาะเจ้าของลิงก์ (ผู้อื่นรวมถึง Admin ไม่เห็น)',
  })
  shareToken: string | null;
  @ApiPropertyOptional({ nullable: true }) fileId: number | null;
  @ApiPropertyOptional({ nullable: true }) fileName: string | null;
  @ApiPropertyOptional({ nullable: true }) folderId: number | null;
  @ApiPropertyOptional({ nullable: true }) folderName: string | null;
  @ApiProperty() sharerUserId: number;
  @ApiPropertyOptional({ nullable: true }) sharerName: string | null;
  @ApiPropertyOptional({ nullable: true }) approverUserId: number | null;
  @ApiProperty({ description: 'มีรหัสผ่านหรือไม่ (ไม่ส่ง hash ออก)' }) hasPassword: boolean;
  @ApiPropertyOptional({ nullable: true }) expiryDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) downloadLimit: number | null;
  @ApiProperty() currentDownloadCount: number;
  @ApiProperty({ enum: ['Pending', 'Active', 'Disabled', 'Expired', 'Revoked'] }) status: string;
  @ApiProperty({
    description: 'สถานะที่ใช้งานจริง: Active ที่เลยวันหมดอายุจะแสดงเป็น Expired',
  })
  effectiveStatus: string;
  @ApiProperty() createdDate: Date;
  @ApiPropertyOptional({ nullable: true }) approvedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) disabledDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) disabledReason: string | null;
  @ApiPropertyOptional({ nullable: true }) revokedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) revocationReason: string | null;
  @ApiPropertyOptional({ nullable: true }) sharePurpose: string | null;
  @ApiProperty() notifyOnAccess: boolean;
}

export class ShareAccessLogDto {
  @ApiProperty({ description: 'bigint ส่งเป็นสตริง' }) accessLogId: string;
  @ApiProperty() externalShareId: number;
  @ApiPropertyOptional({ nullable: true }) recipientIdentifier: string | null;
  @ApiProperty({ enum: ['View', 'Download'] }) accessType: string;
  @ApiProperty() isSuccessful: boolean;
  @ApiPropertyOptional({ nullable: true }) failureReason: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'bigint ส่งเป็นสตริง' })
  fileSizeBytes: string | null;
  @ApiProperty() accessTimestamp: Date;
  @ApiPropertyOptional({ nullable: true }) ipAddress: string | null;
  @ApiPropertyOptional({ nullable: true }) userAgent: string | null;
}

// ── Public (ผู้ใช้ภายนอก) ────────────────────────────────────

export const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PublicTokenParamDto {
  @ApiProperty({ description: 'token ของลิงก์แชร์ (GUID)' })
  @IsString()
  @Matches(GUID_PATTERN)
  token: string;
}

export class PublicShareAccessDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description: 'รหัสผ่านของลิงก์ (ถ้ามี) — ส่งใน body ไม่ใส่ใน URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  password?: string;

  @ApiPropertyOptional({ description: 'ลิงก์แบบโฟลเดอร์: ไฟล์ที่ต้องการดาวน์โหลด' })
  @IsOptional()
  @IsInt()
  @Min(1)
  fileId?: number;
}

export class PublicShareFileDto {
  @ApiProperty() fileId: number;
  @ApiProperty() fileName: string;
  @ApiProperty({ description: 'ขนาดไฟล์ (ไบต์)' }) sizeBytes: number;
}

export class PublicShareInfoDto {
  @ApiProperty({ enum: ['file', 'folder'] }) kind: 'file' | 'folder';
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) sizeBytes: number | null;
  @ApiProperty({
    type: [PublicShareFileDto],
    description: 'ลิงก์แบบโฟลเดอร์: รายชื่อไฟล์ที่ดาวน์โหลดได้',
  })
  files: PublicShareFileDto[];
  @ApiPropertyOptional({ nullable: true }) expiryDate: Date | null;
  @ApiProperty({ description: 'จำนวนดาวน์โหลดที่เหลือ (-1 = ไม่จำกัด)' })
  remainingDownloads: number;
}
