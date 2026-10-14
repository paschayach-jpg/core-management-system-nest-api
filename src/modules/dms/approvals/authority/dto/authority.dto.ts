import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../../common/dto/pagination.dto';

// ── CRUD config ──────────────────────────────────────────────

export class SaveAuthorityConfigDto {
  @ApiProperty({
    maxLength: 200,
    description:
      'ชื่อกลุ่ม (ปกติเท่ากับชื่อตำแหน่ง) — แถวทุกชั้นความลับของกลุ่มเดียวกันใช้ชื่อเดียวกัน',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  configLabel: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  positionName?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  departmentCode?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  divisionCode?: string;

  @ApiPropertyOptional({
    maxLength: 10,
    description:
      'ไม่ระบุ = ระบบคำนวณเป็น 1HC/2SC/3NC/4PC ตาม confidentialityLevel · ระบุได้เป็น Level ของพนักงาน (เช่น 5C) สำหรับ config แบบจับคู่ด้วย Level',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  levelCode?: string;

  @ApiProperty({ minimum: 1, maximum: 4, description: '1=HC, 2=SC, 3=NC, 4=PC' })
  @IsInt()
  @Min(1)
  @Max(4)
  confidentialityLevel: number;

  @ApiProperty() @IsBoolean() canView: boolean;
  @ApiProperty() @IsBoolean() canAdd: boolean;
  @ApiProperty() @IsBoolean() canEdit: boolean;
  @ApiProperty() @IsBoolean() canApprove: boolean;

  @ApiPropertyOptional({
    description:
      'ดาวน์โหลดได้ — SP เดิมไม่รับค่านี้ (ค่าเริ่มต้น false) API ตั้งให้โดยตรง; ไม่ส่งตอนแก้ = คงค่าเดิม',
  })
  @IsOptional()
  @IsBoolean()
  canDownload?: boolean;
}

export class AuthorityListQueryDto extends PaginationQueryDto {}

export class DeleteGroupQueryDto {
  @ApiProperty({ description: 'ConfigLabel ที่จะลบ (soft delete ทุกชั้นความลับของกลุ่มนี้)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label: string;
}

export class ResolveQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) levelCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) positionName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) departmentCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) divisionCode?: string;
}

export class AuthorityConfigDto {
  @ApiProperty() configId: number;
  @ApiPropertyOptional({ nullable: true }) configLabel: string | null;
  @ApiPropertyOptional({ nullable: true }) positionName: string | null;
  @ApiPropertyOptional({ nullable: true }) departmentCode: string | null;
  @ApiPropertyOptional({ nullable: true }) divisionCode: string | null;
  @ApiPropertyOptional({ nullable: true }) levelCode: string | null;
  @ApiProperty() confidentialityLevel: number;
  @ApiProperty() canView: boolean;
  @ApiProperty() canAdd: boolean;
  @ApiProperty() canEdit: boolean;
  @ApiProperty() canApprove: boolean;
  @ApiProperty() canDownload: boolean;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ nullable: true }) updatedDate: Date | null;
}

export class ResolvedAuthorityDto {
  @ApiProperty({
    enum: ['LEVEL_DEPARTMENT', 'LEVEL', 'POSITION', 'DEPARTMENT', 'DIVISION', 'NONE'],
    description:
      'ลำดับที่ sp_ResolveFolderAuthority เลือกใช้ (0 Level+แผนก → 1 Level → 2 ตำแหน่ง → 3 แผนก → 4 ฝ่าย)',
  })
  matchedBy: string;
  @ApiProperty({ type: [AuthorityConfigDto], description: 'แถวต่อชั้นความลับที่ใช้จริง' })
  rows: AuthorityConfigDto[];
}

// ── นำเข้าจาก Excel ───────────────────────────────────────────

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === '1' || value === true
    ? true
    : value === 'false' || value === '0' || value === false
      ? false
      : value;

/** ฟิลด์ที่มากับ multipart (ค่าเป็นสตริงเสมอ จึงแปลง boolean เอง) */
export class AuthorityImportOptionsDto {
  @ApiPropertyOptional({ description: 'ชื่อ sheet (ไม่ระบุ = sheet แรก)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'อัปเดตสิทธิ์ 4 ชั้นความลับของตำแหน่งที่มี config อยู่แล้ว (ไม่สร้างตำแหน่งใหม่)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  importPositions?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'อัปเดต EMS.UserAccount.LevelCode ตามคอลัมน์ Level (จับคู่ด้วยรหัสพนักงาน)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  updateUserLevel?: boolean;
}

export class AuthorityImportFileDto extends AuthorityImportOptionsDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'ไฟล์ .xlsx ตาม template' })
  file: unknown;
}

export class ImportIssueDto {
  @ApiProperty({ description: 'แถวใน Excel (เริ่มที่ 1) · 0 = ระดับไฟล์' }) rowNumber: number;
  @ApiProperty({ enum: ['Warning', 'Error'] }) severity: string;
  @ApiProperty() code: string;
  @ApiProperty() message: string;
}

export class PositionPlanDto {
  @ApiProperty() label: string;
  @ApiProperty() positionName: string;
  @ApiPropertyOptional({ nullable: true }) departmentCode: string | null;
  @ApiPropertyOptional({ nullable: true }) divisionCode: string | null;
  @ApiProperty({ type: [Boolean], description: '16 ค่า: [HC,SC,NC,PC] x [ดู,เพิ่ม,แก้ไข,อนุมัติ]' })
  permissions: boolean[];
  @ApiProperty({ enum: ['New', 'Updated', 'Unchanged'] }) status: string;
}

export class LevelPlanDto {
  @ApiProperty() employeeCode: string;
  @ApiProperty() employeeName: string;
  @ApiPropertyOptional({ nullable: true }) userId: number | null;
  @ApiProperty() oldLevel: string;
  @ApiProperty() newLevel: string;
  @ApiProperty({ enum: ['Updated', 'Unchanged', 'NotFound'] }) status: string;
}

export class AuthorityImportPreviewDto {
  @ApiProperty() sheetName: string;
  @ApiProperty() rowCount: number;
  @ApiProperty({ type: [ImportIssueDto] }) issues: ImportIssueDto[];
  @ApiProperty({ type: [PositionPlanDto] }) positionPlans: PositionPlanDto[];
  @ApiProperty({ type: [LevelPlanDto] }) levelPlans: LevelPlanDto[];
  @ApiProperty({ description: 'true = มี Error นำเข้าไม่ได้จนกว่าจะแก้ไฟล์' }) hasErrors: boolean;
  @ApiProperty() hasChanges: boolean;
  @ApiProperty() positionsUpdated: number;
  @ApiProperty() positionsUnchanged: number;
  @ApiProperty() levelChanges: number;
}

export class AuthorityImportResultDto {
  @ApiProperty() configsUpdated: number;
  @ApiProperty() levelsChanged: number;
}
