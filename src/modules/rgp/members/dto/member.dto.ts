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
import { toBool, trim } from '../../common/rgp-validators';
import { MEMBER_TYPES } from '../../common/member-resolver';

export class ProjectMemberDto {
  @ApiProperty() memberId: number;
  @ApiProperty() projectId: number;
  @ApiProperty({ description: 'ชื่อ (พนักงาน = ชื่อผู้ใช้ AD)' }) name: string;
  @ApiPropertyOptional({
    nullable: true,
    enum: MEMBER_TYPES,
    description: 'null = ข้อความประเภทเดิมที่ระบบไม่รู้จัก',
  })
  memberType?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'ข้อความประเภทตามที่เก็บในฐานข้อมูล (คณะกรรมการ/ฝ่าย/แผนก/พนักงาน)',
  })
  memberTypeName?: string | null;
  @ApiProperty() role: string;
  @ApiPropertyOptional({ nullable: true, description: 'DivisionCode / DepartmentCode' })
  departmentCode?: string | null;
  @ApiPropertyOptional({ nullable: true }) createUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) createDate?: Date | null;
}

/** ข้อมูลที่ client เลือก — ชื่อ/รหัสถูกอ่านจากฐานข้อมูลอีกครั้ง ไม่เชื่อค่าที่ส่งมา */
export class MemberInputDto {
  @ApiProperty({ enum: MEMBER_TYPES })
  @IsIn(MEMBER_TYPES)
  memberType: (typeof MEMBER_TYPES)[number];

  @ApiPropertyOptional({
    description:
      'SubCommitteeID / DivisionID / DepartmentID (ใช้กับ SubCommittee, Division, Department)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orgId?: number;

  @ApiPropertyOptional({ description: 'ชื่อผู้ใช้ AD (ใช้กับ Employee)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  adUserName?: string;

  @ApiProperty({ description: 'ชื่อบทบาท (ต้องเป็นบทบาทที่เปิดใช้งานใน /rgp/member-roles)' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  role: string;
}

export class AddMemberDto extends MemberInputDto {}

// ───────────── บทบาท ─────────────

export class MemberRoleDto {
  @ApiProperty() roleId: number;
  @ApiProperty() name: string;
  @ApiProperty() active: boolean;
  @ApiPropertyOptional({ nullable: true }) createUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) createDate?: Date | null;
  @ApiPropertyOptional({ nullable: true }) updateUser?: string | null;
  @ApiPropertyOptional({ nullable: true }) updateDate?: Date | null;
}

export class RoleListQueryDto {
  @ApiPropertyOptional({ description: 'true = เฉพาะบทบาทที่เปิดใช้งาน (สำหรับ dropdown)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'ผู้ประสานงาน' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
