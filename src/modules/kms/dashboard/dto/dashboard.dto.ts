import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class KbStatusCountDto {
  @ApiProperty({ description: '1=Draft 2=Review 3=Published 4=Archived' }) status: number;
  @ApiProperty() statusName: string;
  @ApiProperty() count: number;
}

export class KbTypeCountDto {
  @ApiProperty({ description: '1=ขั้นตอนงาน 2=FAQ 3=แนวทางปฏิบัติ 4=แม่แบบ 5=กฎ/นโยบาย' })
  articleType: number;
  @ApiProperty() articleTypeName: string;
  @ApiProperty() count: number;
}

export class KbDashboardStatsDto {
  @ApiProperty({ description: 'บทความทั้งหมด (ไม่รวมที่ถูกลบ)' }) totalArticles: number;
  @ApiProperty() draftArticles: number;
  @ApiProperty() reviewArticles: number;
  @ApiProperty() publishedArticles: number;
  @ApiProperty() archivedArticles: number;
  @ApiProperty({ description: 'รอการอนุมัติ = บทความสถานะ Review' }) pendingApprovals: number;
  @ApiProperty({ description: 'Published ที่จะหมดอายุภายใน 30 วัน' }) expiringArticles: number;
  @ApiProperty({ description: 'Published ที่หมดอายุแล้ว (ExpiryDate ผ่านมาแล้ว)' })
  expiredArticles: number;
  @ApiProperty({ description: 'Published ที่เลยกำหนดทบทวน (ReviewDueDate ผ่านมาแล้ว)' })
  overdueReviews: number;
  @ApiProperty({
    description: 'ยอดเปิดอ่านสะสมทั้งหมด (ระบบไม่เก็บประวัติรายวัน จึงแยก "รายเดือน" ไม่ได้)',
  })
  totalViews: string;
  @ApiProperty({ description: 'ยอดถูกใจสะสมทั้งหมด' }) totalLikes: string;
  @ApiProperty({
    description: 'ค่าเฉลี่ย LikeCount ของบทความ Published (แทน "คะแนนเฉลี่ย" ของ mock เดิม)',
  })
  averageLikesPublished: number;
  @ApiProperty({ type: [KbStatusCountDto] }) byStatus: KbStatusCountDto[];
  @ApiProperty({ type: [KbTypeCountDto] }) byType: KbTypeCountDto[];
  @ApiProperty() lastUpdated: Date;
}

export class KbMonthlyArticleDto {
  @ApiProperty() year: number;
  @ApiProperty() month: number;
  @ApiProperty({ example: 'ต.ค. 2569' }) monthName: string;
  @ApiProperty({ description: 'จำนวนบทความที่สร้างในเดือนนั้น' }) articleCount: number;
}

export class KbTopArticleDto {
  @ApiProperty() articleId: number;
  @ApiProperty() articleCode: string;
  @ApiProperty() title: string;
  @ApiProperty() articleType: number;
  @ApiProperty() articleTypeName: string;
  @ApiProperty({ nullable: true, type: String }) categoryName: string | null;
  @ApiProperty() viewCount: number;
  @ApiProperty() likeCount: number;
}

export class MonthsQueryDto {
  @ApiProperty({ required: false, default: 12, minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  months?: number;
}

export class TopQueryDto {
  @ApiProperty({ required: false, default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
