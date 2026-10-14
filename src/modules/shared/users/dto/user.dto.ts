import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AppRole } from '../../../../common/constants/enums';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === '1' || value === true
    ? true
    : value === 'false' || value === '0' || value === false
      ? false
      : undefined;

export class UserListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AppRole })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  role?: AppRole;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() orgUnitId?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() isActive?: boolean;
}

export class UserLookupQueryDto {
  @ApiProperty({ description: 'ชื่อ/ชื่อผู้ใช้/รหัสพนักงาน (อย่างน้อย 2 ตัวอักษร)' })
  @IsString()
  @MaxLength(100)
  q: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class UserLookupDto {
  @ApiProperty() userId: number;
  @ApiProperty() displayName: string;
  @ApiProperty() adUserName: string;
  @ApiPropertyOptional() employeeCode?: string | null;
  @ApiPropertyOptional() departmentName?: string | null;
  @ApiPropertyOptional() positionName?: string | null;
}

export class UserSummaryDto extends UserLookupDto {
  @ApiPropertyOptional() email?: string | null;
  @ApiProperty({ enum: AppRole, enumName: 'AppRole' }) appRole: AppRole;
  @ApiProperty() orgUnitId: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() consentGiven: boolean;
  @ApiPropertyOptional() levelCode?: string | null;
  @ApiPropertyOptional() divisionName?: string | null;
  @ApiPropertyOptional() lastLoginDate?: Date | null;
}

export class CreateUserDto {
  @ApiProperty({ example: 'DOMAIN\\username' }) @IsString() @MaxLength(100) adUserName: string;
  @ApiProperty() @IsString() @MaxLength(200) displayName: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ enum: AppRole, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  appRole?: AppRole;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) orgUnitId: number;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ enum: AppRole })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  appRole?: AppRole;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) orgUnitId?: number;
  @ApiPropertyOptional({ description: 'รหัสระดับตำแหน่ง (EMS.m_Position)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  levelCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
