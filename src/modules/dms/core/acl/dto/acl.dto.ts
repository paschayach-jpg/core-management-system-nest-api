import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PrincipalType } from '../../../../../common/constants/enums';
import { toBoolean, trim } from '../../dto-utils';
import type { PermissionRow } from '../acl.repository';

export class PermissionDto {
  @ApiProperty({ description: 'PermissionID (โฟลเดอร์) หรือ FilePermissionID (ไฟล์)' }) id: number;
  @ApiProperty({ description: 'FolderID หรือ FileID' }) targetId: number;
  @ApiProperty({
    enum: PrincipalType,
    description: '1=User, 2=Role(AppRole), 3=Department, 4=Division',
  })
  principalType: PrincipalType;
  @ApiProperty() principalId: number;
  @ApiPropertyOptional({ nullable: true, description: 'ชื่อผู้ใช้/แผนก/ฝ่าย (Role ไม่มีชื่อ)' })
  principalName: string | null;
  @ApiProperty() canRead: boolean;
  @ApiProperty() canWrite: boolean;
  @ApiProperty() canDelete: boolean;
  @ApiProperty() canModify: boolean;
  @ApiProperty() canFullControl: boolean;
  @ApiProperty({ description: 'เฉพาะสิทธิ์ระดับไฟล์: ให้ดาวน์โหลดได้โดยไม่ต้องขออนุมัติ' })
  canDownload: boolean;
  @ApiProperty() isDeny: boolean;
  @ApiPropertyOptional({ nullable: true }) expiryDate: Date | null;
  @ApiProperty() grantedBy: number;
  @ApiPropertyOptional({ nullable: true }) grantedByName: string | null;
  @ApiPropertyOptional({ nullable: true }) grantedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) revokedBy: number | null;
  @ApiPropertyOptional({ nullable: true }) revokedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) revokeReason: string | null;
  @ApiProperty({ description: 'ยังมีผล (ไม่ถูกเพิกถอน และยังไม่หมดอายุ)' }) isActive: boolean;
}

export function toPermissionDto(r: PermissionRow, now = new Date()): PermissionDto {
  return {
    ...r,
    isActive: r.revokedDate === null && (r.expiryDate === null || r.expiryDate > now),
  };
}

export class SetPermissionDto {
  @ApiProperty({
    enum: [1, 2, 3, 4],
    description: '1=User, 2=Role(AppRole 1–4), 3=Department, 4=Division',
  })
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  principalType: PrincipalType;

  @ApiProperty({ description: 'UserID / AppRole / DepartmentID / DivisionID ตามประเภท' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  principalId: number;

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() canRead?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() canWrite?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() canDelete?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() canModify?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() canFullControl?: boolean;

  @ApiPropertyOptional({ default: false, description: 'true = สิทธิ์ห้าม (Deny ชนะทุกอย่าง)' })
  @IsOptional()
  @IsBoolean()
  isDeny?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'วันหมดอายุของสิทธิ์ (ต้องเป็นอนาคต; ไม่ระบุ = ไม่หมดอายุ)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date | null;
}

export class SetFilePermissionDto extends SetPermissionDto {
  @ApiPropertyOptional({
    default: false,
    description: 'ให้ดาวน์โหลดได้โดยไม่ต้องขออนุมัติ (security.FilePermission.CanDownload)',
  })
  @IsOptional()
  @IsBoolean()
  canDownload?: boolean;
}

export class PermissionListQueryDto {
  @ApiPropertyOptional({ description: 'true = รวมรายการที่ถูกเพิกถอน/หมดอายุ (ประวัติ)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeHistory?: boolean;
}

export class RevokePermissionQueryDto {
  @ApiPropertyOptional({ description: 'เหตุผลที่เพิกถอน' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PropagateResultDto {
  @ApiProperty({ description: 'จำนวนไฟล์ที่ได้รับสิทธิ์ใหม่' }) files: number;
  @ApiProperty({ description: 'จำนวนรายการสิทธิ์ที่สร้างระดับไฟล์' }) entries: number;
}

export class MyFolderPermissionsDto {
  @ApiProperty() folderId: number;
  @ApiProperty({
    description: 'ACL Read (รวมสืบทอดจากโฟลเดอร์แม่; Manager/Admin ผ่านเว้นแต่ถูก Deny)',
  })
  read: boolean;
  @ApiProperty() write: boolean;
  @ApiProperty() delete: boolean;
  @ApiProperty() modify: boolean;
  @ApiProperty() fullControl: boolean;
  @ApiProperty({ description: 'เห็นโฟลเดอร์ได้ (Authority.CanView หรือ ACL Read)' })
  canView: boolean;
  @ApiProperty({ description: 'สร้างโฟลเดอร์ย่อย/อัปโหลดได้ (Authority.CanAdd หรือ ACL Write)' })
  canAdd: boolean;
  @ApiProperty({ description: 'เปลี่ยนชื่อ/แก้ไขได้ (Authority.CanEdit หรือ ACL Write)' })
  canEdit: boolean;
  @ApiProperty({ description: 'ลบโฟลเดอร์ได้ (Authority.CanEdit หรือ ACL Modify)' })
  canDeleteFolder: boolean;
  @ApiProperty({ description: 'ลบไฟล์ในโฟลเดอร์ได้ (Authority.CanEdit หรือ ACL Delete)' })
  canDeleteFile: boolean;
}
