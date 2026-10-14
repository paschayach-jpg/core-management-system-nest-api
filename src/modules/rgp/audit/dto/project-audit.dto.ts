import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** แถว `RGP.t_project_audit_log` */
export class ProjectAuditRowDto {
  @ApiProperty() auditId: number;
  @ApiProperty({ description: 'ชื่อผู้ใช้ AD ที่กระทำ' }) userId: string;
  @ApiProperty({ example: 'Project' }) module: string;
  @ApiProperty({ example: 'CREATE_PROJECT' }) action: string;
  @ApiPropertyOptional({ nullable: true, example: 't_project' }) tableName?: string | null;
  @ApiPropertyOptional({ nullable: true }) recordId?: number | null;
  @ApiProperty({ description: '1 = สำเร็จ, 2 = ล้มเหลว' }) result: number;
  @ApiPropertyOptional({ nullable: true }) message?: string | null;
  @ApiPropertyOptional({ nullable: true }) machineName?: string | null;
  @ApiProperty() actionDate: Date;
}

export class ProjectAuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'เฉพาะโครงการนี้ (รวม state/task ของโครงการ)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId?: number;

  @ApiPropertyOptional({ example: 'DELETE_PROJECT' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ description: 'ชื่อผู้ใช้ (ตรงตัว)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  userId?: string;

  @ApiPropertyOptional({ description: '1 = สำเร็จ, 2 = ล้มเหลว', enum: [1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  result?: number;

  @ApiPropertyOptional({ description: 'ตั้งแต่ (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'ถึง (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
