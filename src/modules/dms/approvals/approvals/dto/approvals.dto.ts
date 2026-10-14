import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../../common/dto/pagination.dto';

// ── คำขอยื่น ──────────────────────────────────────────────────

/** ยื่นคำขอเปลี่ยนสิทธิ์โฟลเดอร์ HC/SC (SubmitPermissionRequest) — Manager/Admin */
export class SubmitPermissionRequestDto {
  @ApiProperty({ description: 'โฟลเดอร์ที่ขอเปลี่ยนสิทธิ์ (ต้องเป็นระดับ HC/SC)' })
  @IsInt()
  @Min(1)
  folderId: number;

  @ApiProperty({ maxLength: 500, description: 'หัวข้อคำขอ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  subject: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'เหตุผลของผู้ขอ' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiProperty({ minimum: 1, maximum: 4, description: '1=User, 2=Role, 3=Department, 4=Division' })
  @IsInt()
  @Min(1)
  @Max(4)
  principalType: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  principalId: number;

  @ApiProperty()
  @IsBoolean()
  canRead: boolean;

  @ApiProperty()
  @IsBoolean()
  canWrite: boolean;

  @ApiProperty()
  @IsBoolean()
  canDelete: boolean;

  @ApiProperty()
  @IsBoolean()
  canModify: boolean;

  @ApiProperty()
  @IsBoolean()
  canFullControl: boolean;

  @ApiProperty({ description: 'true = สิทธิ์แบบห้าม (Deny)' })
  @IsBoolean()
  isDeny: boolean;

  @ApiProperty({
    type: [Number],
    description: 'ผู้อนุมัติ (Manager/Admin ที่ใช้งานอยู่) ตามลำดับ step 1..n',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  approverUserIds: number[];

  @ApiPropertyOptional({ description: 'วันหมดอายุของคำขอ (ค่าเริ่มต้น: พรุ่งนี้) ต้องอยู่ในอนาคต' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;
}

/** ขอดาวน์โหลดไฟล์ (SubmitDownloadRequest) — ทุก role */
export class SubmitDownloadRequestDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  fileId: number;

  @ApiProperty({ maxLength: 1000, description: 'เหตุผลที่ต้องการดาวน์โหลด (บังคับ)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @ApiProperty({ description: 'ผู้อนุมัติ (ต้องเป็น Manager/Admin ที่ใช้งานอยู่ และไม่ใช่ตัวเอง)' })
  @IsInt()
  @Min(1)
  approverId: number;
}

// ── ลงมติ ────────────────────────────────────────────────────

export class ApproveDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class RejectDto {
  @ApiProperty({ maxLength: 500, description: 'เหตุผลในการปฏิเสธ (บังคับ)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// ── query ────────────────────────────────────────────────────

export class MyRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '1=Pending, 2=Approved, 3=Rejected, 4=Expired/ถอน, 5=ใช้สิทธิ์ดาวน์โหลดแล้ว',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  status?: number;
}

export class DownloadLookupQueryDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileId: number;
}

// ── ตอบกลับ ──────────────────────────────────────────────────

export class ApprovalRequestDto {
  @ApiProperty() requestId: number;
  @ApiProperty({ description: 'ชนิดที่บันทึกในคอลัมน์ RequestType' }) requestType: string;
  @ApiProperty({
    description:
      'ชนิดที่ใช้ตัดสินผลหลังอนุมัติ (ต่างจาก requestType เมื่อคำขอเก่าบันทึกแชร์ภายนอก/ภายในเป็น CHANGE_PERMISSION)',
  })
  effectiveType: string;
  @ApiPropertyOptional({ nullable: true }) folderId: number | null;
  @ApiPropertyOptional({ nullable: true }) folderName: string | null;
  @ApiPropertyOptional({ nullable: true }) fileId: number | null;
  @ApiPropertyOptional({ nullable: true }) fileName: string | null;
  @ApiProperty() requestedBy: number;
  @ApiPropertyOptional({ nullable: true }) requestedByName: string | null;
  @ApiProperty() requestedDate: Date;
  @ApiProperty({
    description: '1=Pending, 2=Approved, 3=Rejected, 4=Expired/ถอน, 5=ใช้สิทธิ์ดาวน์โหลดแล้ว',
  })
  requestStatus: number;
  @ApiPropertyOptional({ nullable: true }) subject: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'เหตุผลของผู้ขอ (ถอดจาก Remark)' })
  reason: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'payload ที่ถอดจาก Remark (key camelCase เหมือนกันทั้งรูปแบบเก่า/ใหม่)',
  })
  payload: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) expiryDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) resolvedBy: number | null;
  @ApiPropertyOptional({ nullable: true }) resolvedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) resolveRemark: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'step ของผู้เรียกที่ลงมติได้ (null = ไม่มี step ของตัวเอง ให้ใช้ POST /dms/approvals/:id/approve)',
  })
  myStepId: number | null;
}

export class ApprovalStepDto {
  @ApiProperty() stepId: number;
  @ApiProperty() requestId: number;
  @ApiProperty() stepOrder: number;
  @ApiProperty() approverId: number;
  @ApiProperty({
    description: '1=Pending, 2=Approved, 3=Rejected, 4=Delegated (รวม ยกระดับ/ปิดอัตโนมัติ)',
  })
  stepStatus: number;
  @ApiPropertyOptional({ nullable: true }) actionDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) actionRemark: string | null;
  @ApiPropertyOptional({ nullable: true }) delegatedTo: number | null;
  @ApiPropertyOptional({ nullable: true }) notifiedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) escalatedDate: Date | null;
}

export class ApprovalDetailDto extends ApprovalRequestDto {
  @ApiProperty({
    type: [ApprovalStepDto],
    description: 'step ล่าสุดไม่เกิน 50 รายการ (ดูทั้งหมดที่ /steps)',
  })
  steps: ApprovalStepDto[];
  @ApiProperty() totalSteps: number;
}

export class ApprovalResultDto {
  @ApiProperty() requestId: number;
  @ApiProperty() requestStatus: number;
  @ApiProperty({ description: 'true = คำขอจบแล้ว (ไม่มีผู้อนุมัติลำดับถัดไป)' }) finalized: boolean;
  @ApiPropertyOptional({ nullable: true }) nextApproverId: number | null;
}

export class DownloadApprovalDto {
  @ApiProperty({ description: 'true = มีคำขอดาวน์โหลดที่อนุมัติแล้วและยังไม่ได้ใช้สิทธิ์' })
  available: boolean;
  @ApiPropertyOptional({ nullable: true }) requestId: number | null;
  @ApiPropertyOptional({ nullable: true }) requestStatus: number | null;
}
