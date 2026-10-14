import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AppRole } from '../../../../common/constants/enums';

export class MenuNodeDto {
  @ApiProperty() menuItemId: number;
  @ApiPropertyOptional() parentMenuItemId?: number | null;
  @ApiProperty() menuName: string;
  @ApiProperty() menuKey: string;
  @ApiPropertyOptional({ description: 'ชื่อ Form เดิมใน WinForms (ใช้ map เมนูของ client ใหม่)' })
  formClassName?: string | null;
  @ApiPropertyOptional() iconKey?: string | null;
  @ApiProperty() displayOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ description: 'AppRole ขั้นต่ำที่เห็นเมนูนี้ (null = ทุกคน)' })
  requiredAppRole?: number | null;
  @ApiPropertyOptional() moduleCode?: string | null;
  @ApiPropertyOptional() url?: string | null;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty({ type: () => [MenuNodeDto] }) children: MenuNodeDto[];
}

export class UpsertMenuDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentMenuItemId?: number | null;
  @ApiProperty() @IsString() @MaxLength(255) menuName: string;
  @ApiProperty() @IsString() @MaxLength(100) menuKey: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) formClassName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) iconKey?: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  displayOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ enum: AppRole, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  requiredAppRole?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) moduleCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) url?: string;
}

class ReorderItemDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) menuItemId: number;
  @ApiProperty() @Type(() => Number) @IsInt() displayOrder: number;
}

export class ReorderMenusDto {
  @ApiProperty({ type: [ReorderItemDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

export class MenuStatisticsDto {
  @ApiProperty() totalMenuItems: number;
  @ApiProperty() activeMenuItems: number;
  @ApiProperty() adminOnlyMenus: number;
  @ApiProperty() managerOnlyMenus: number;
  @ApiProperty() publicMenus: number;
  @ApiPropertyOptional() lastModified?: Date | null;
}
