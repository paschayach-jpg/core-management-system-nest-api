import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AppRole } from '../../../common/constants/enums';

export class LoginDto {
  @ApiProperty({ example: 'DOMAIN\\username', description: 'ชื่อผู้ใช้ AD' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

export class ExchangeTokenDto {
  @ApiProperty({ description: 'access token ที่ AD Auth API ออกให้ (กรณี SSO จากพอร์ทัล)' })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  accessToken: string;
}

export class ConsentDto {
  @ApiPropertyOptional({ description: 'อีเมลติดต่อ (ถ้าไม่ส่ง ใช้ค่าที่มีอยู่)' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ description: 'true = ยินยอม PDPA' })
  @IsBoolean()
  consentGiven: boolean;
}

export class UserProfileDto {
  @ApiProperty() userId: number;
  @ApiProperty() adUserName: string;
  @ApiProperty() displayName: string;
  @ApiProperty({ enum: AppRole, enumName: 'AppRole' }) appRole: AppRole;
  @ApiProperty() orgUnitId: number;
  @ApiPropertyOptional() employeeCode?: string | null;
  @ApiPropertyOptional() departmentCode?: string | null;
  @ApiPropertyOptional() divisionCode?: string | null;
  @ApiPropertyOptional() positionName?: string | null;
  @ApiProperty() consentGiven: boolean;
  @ApiProperty({
    description: 'สิทธิ์ตามชั้นความลับ 1–4 (HC/SC/NC/PC)',
    type: 'object',
    additionalProperties: true,
  })
  authority: Record<number, unknown>;
}

export class AuthTokenResponseDto {
  @ApiProperty({ description: 'JWT สำหรับส่งเป็น Authorization: Bearer' }) accessToken: string;
  @ApiProperty({ example: 'Bearer' }) tokenType: 'Bearer';
  @ApiProperty({ description: 'อายุ token เป็นวินาที' }) expiresIn: number;
  @ApiProperty({
    description: 'true = ผู้ใช้ยังไม่ให้ความยินยอม PDPA → client ต้องเรียก POST /auth/consent',
  })
  requiresConsent: boolean;
  @ApiProperty({ type: UserProfileDto }) user: UserProfileDto;
}
