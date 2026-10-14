import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

export class VisibleOrgUnitDto {
  @ApiProperty() orgUnitId: number;
  @ApiProperty() orgUnitCode: string;
  @ApiProperty() orgUnitNameTh: string;
  @ApiProperty({ description: '1=SubCommittee, 2=Division, 3=Department' }) orgUnitType: number;
  @ApiPropertyOptional({ nullable: true }) parentOrgUnitId: number | null;
  @ApiProperty({
    description: 'ผู้ใช้เลือกซ่อนหน่วยงานนี้ไว้ในมุมมองของตัวเอง (EMS.UserOrgUnitHiddenView)',
  })
  isHidden: boolean;
}

export class OrgVisibilityDto {
  @ApiProperty({
    enum: ['explicit', 'role'],
    description:
      'explicit = มีรายการ grant ใน security.UserOrgVisibility (เห็นเฉพาะที่ grant) · role = ไม่มี grant ใช้กฎตามบทบาท',
  })
  mode: 'explicit' | 'role';
  @ApiProperty({ type: [VisibleOrgUnitDto] }) orgUnits: VisibleOrgUnitDto[];
}

export class OrgVisibilityGrantDto {
  @ApiProperty() userId: number;
  @ApiProperty() orgUnitId: number;
  @ApiPropertyOptional({ nullable: true }) orgUnitNameTh: string | null;
  @ApiProperty() grantedBy: number;
  @ApiPropertyOptional({ nullable: true }) grantedByName: string | null;
  @ApiPropertyOptional({ nullable: true }) grantedDate: Date | null;
}

export class UserOrgVisibilityDetailDto extends OrgVisibilityDto {
  @ApiProperty({ type: [OrgVisibilityGrantDto], description: 'รายการ grant ชัดแจ้งของผู้ใช้' })
  grants: OrgVisibilityGrantDto[];
}

export class HiddenOrgUnitsDto {
  @ApiProperty({ type: [Number] }) orgUnitIds: number[];
}

export class SaveHiddenOrgUnitsDto {
  @ApiProperty({ type: [Number], description: 'รายการหน่วยงานที่ซ่อน (ว่าง = แสดงทั้งหมด)' })
  @IsArray()
  @ArrayMaxSize(2000)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  orgUnitIds: number[];
}
