import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { csvToInts, toBool } from '../../kms-dto.util';

export const MAX_MOVE_ARTICLES = 20000;

export class MoveCandidatesQueryDto extends PaginationQueryDto {
  @ApiProperty({ type: [Number], description: 'CategoryID ต้นทางคั่นด้วย ,' })
  @Transform(csvToInts)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  categoryIds: number[];

  @ApiPropertyOptional({ default: true, description: 'รวมหมวดย่อยทุกชั้น' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeSubCategories?: boolean;
}

export class MoveCandidateDto {
  @ApiProperty() articleId: number;
  @ApiProperty() articleCode: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) titleCategory: string | null;
  @ApiProperty() categoryId: number;
  @ApiProperty({ nullable: true, type: String }) categoryName: string | null;
  @ApiProperty() articleType: number;
  @ApiProperty() status: number;
}

export class MovePreviewRequestDto {
  @ApiProperty({
    type: [Number],
    description: `ArticleID ที่จะย้าย (ไม่เกิน ${MAX_MOVE_ARTICLES})`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MOVE_ARTICLES)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  articleIds: number[];

  @ApiProperty({ description: 'หมวดปลายทาง (ต้องมีอยู่และเปิดใช้งาน)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toCategoryId: number;
}

export class MoveRequestDto extends MovePreviewRequestDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'true = ผู้ใช้เห็นคำเตือนจาก preview แล้วยืนยันให้ย้ายต่อ · ถ้าไม่ส่ง/false และมีคำเตือน API ตอบ 409 MOVE_WARNINGS_NOT_CONFIRMED พร้อมรายการคำเตือน',
  })
  @IsOptional()
  @IsBoolean()
  confirmWarnings?: boolean;
}

export class MovePreviewDto {
  @ApiProperty({ description: 'จำนวนที่จะถูกย้ายจริง (ไม่รวมที่อยู่หมวดปลายทางแล้ว/ถูกลบ/ไม่พบ)' })
  toMoveCount: number;
  @ApiProperty({ description: 'จำนวนที่ข้ามเพราะอยู่หมวดปลายทางอยู่แล้ว' })
  alreadyInDestinationCount: number;
  @ApiProperty({ type: [String], description: 'คำเตือน (ไม่บล็อก — ต้องยืนยันตอนย้าย)' })
  warnings: string[];
}

export class MoveResultDto {
  @ApiProperty() requestedCount: number;
  @ApiProperty() movedCount: number;
  @ApiProperty() skippedCount: number;
  @ApiProperty({ type: [String] }) warnings: string[];
}
