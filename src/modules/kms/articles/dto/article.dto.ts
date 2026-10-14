import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { csvToInts, dateInput, toBool, trim } from '../../kms-dto.util';

export const SEARCH_FIELDS = [
  'all',
  'title',
  'content',
  'tags',
  'summary',
  'titleCategory',
  'code',
] as const;
export type ArticleSearchField = (typeof SEARCH_FIELDS)[number];

export class ArticleListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'กรองตามหมวด (รวมหมวดย่อยทุกชั้นเมื่อ includeSubCategories=true)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeSubCategories?: boolean;

  @ApiPropertyOptional({ description: '1=Draft 2=Review 3=Published 4=Archived' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  status?: number;

  @ApiPropertyOptional({ description: '1=ขั้นตอนงาน 2=FAQ 3=แนวทางปฏิบัติ 4=แม่แบบ 5=กฎ/นโยบาย' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5])
  articleType?: number;

  @ApiPropertyOptional({
    enum: SEARCH_FIELDS,
    default: 'all',
    description:
      'ฟิลด์ที่ค้นด้วย q: all=ทุกฟิลด์ (รวมเนื้อหา) · ค้นแบบ "มีคำนี้อยู่" ไม่สนช่องว่าง/ขึ้นบรรทัดใหม่ · content=ค้นเนื้อหา HTML (ช้ากว่าฟิลด์อื่น)',
  })
  @IsOptional()
  @IsIn(SEARCH_FIELDS as unknown as string[])
  searchField?: ArticleSearchField;

  @ApiPropertyOptional({ description: 'Title ตรงทุกตัวอักษร (ใบของ KB tree)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({
    type: [Number],
    description: 'ArticleID คั่นด้วย , (ไม่เกิน 500) — ใช้แสดงกลุ่มบทความอ้างอิงข้าม',
  })
  @IsOptional()
  @Transform(csvToInts)
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids?: number[];
}

export class ArticleBaseDto {
  @ApiProperty() articleId: number;
  @ApiProperty() articleCode: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) titleCategory: string | null;
  @ApiProperty() categoryId: number;
  @ApiPropertyOptional({ nullable: true }) categoryName: string | null;
  @ApiProperty() articleType: number;
  @ApiProperty() status: number;
  @ApiProperty() confidentialityLevel: number;
  @ApiProperty() currentVersion: number;
  @ApiPropertyOptional({ nullable: true }) effectiveDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) publishedDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) expiryDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) reviewDueDate: Date | null;
  @ApiProperty() viewCount: number;
  @ApiProperty() likeCount: number;
  @ApiProperty() isOfficialPolicy: boolean;
  @ApiPropertyOptional({ nullable: true }) tags: string | null;
  @ApiProperty() createdBy: string;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
  @ApiPropertyOptional({ nullable: true }) updatedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedDate: Date | null;
}

export class ArticleListItemDto extends ArticleBaseDto {
  @ApiPropertyOptional({ nullable: true, description: '300 ตัวแรกของ Summary' }) summaryPreview:
    string | null;
  @ApiPropertyOptional({ nullable: true, description: '300 ตัวแรกของ ContentHTML (HTML ดิบ)' })
  contentPreview: string | null;
}

export class ArticleDetailDto extends ArticleBaseDto {
  @ApiProperty({ description: 'เนื้อหา HTML — ผู้แสดงผลต้อง sanitize ก่อน render' })
  contentHtml: string;
  @ApiPropertyOptional({ nullable: true }) summary: string | null;
  @ApiProperty({ description: 'true = ถูก soft delete (GetById เดิมไม่กรอง IsDelete)' })
  isDelete: boolean;
  @ApiProperty({ description: 'เส้นทางหมวด เช่น "กฎหมาย › พ.ร.บ. X"' }) categoryPath: string;
  @ApiPropertyOptional({ nullable: true }) reviewedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) reviewedDate: Date | null;
  @ApiProperty() attachmentCount: number;
  @ApiProperty({ description: 'จำนวนบทความที่เกี่ยวข้อง (link ชนิด Law)' }) relatedCount: number;
}

export class CreateArticleDto {
  @ApiProperty({
    description:
      'Code รวม 29 ตัว (กฎหมาย/พระราชกฤษฎีกา/ไม่ใช่กฎหมาย) — ตรวจด้วยกฎเดียวกับ import · กฎหมาย/พระราชกฤษฎีกาเก็บ 24 ตัวแรก, ไม่ใช่กฎหมายเก็บเต็ม 29 ตัว',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  articleCode: string;

  @ApiPropertyOptional({
    description:
      'กฎหมาย/พระราชกฤษฎีกา: ระบบคำนวณ "มาตรา N" จาก Code (ค่าที่ส่งมาถูกละเลย) · ไม่ใช่กฎหมาย: บังคับกรอก',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({
    description: 'พระราชกฤษฎีกา: หมวดกลุ่ม (หมวดย่อยของ DDD00) ที่เลือก — บังคับเฉพาะชนิดนี้',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupCategoryId?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  titleCategory?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() summary?: string | null;

  @ApiProperty({ description: 'เนื้อหา HTML' })
  @IsString()
  contentHtml: string;

  @ApiProperty({ description: '1-5' })
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5])
  articleType: number;

  @ApiPropertyOptional({
    default: 1,
    description: '1=HC 2=SC 3=NC 4=PC (ไม่ระบุ = HC ตามค่าเริ่มต้นของหน้าจอเดิม)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  confidentialityLevel?: number;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) tags?:
    string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(dateInput)
  @IsDate()
  publishedDate?: Date | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(dateInput)
  @IsDate()
  effectiveDate?: Date | null;
  @ApiPropertyOptional({ nullable: true, description: 'null/ไม่ส่ง = ไม่มีวันหมดอายุ' })
  @IsOptional()
  @Transform(dateInput)
  @IsDate()
  expiryDate?: Date | null;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'บทความที่เกี่ยวข้อง (link ชนิด Law สองทาง) · พระราชกฤษฎีกาต้องผูกมาตราของกฎหมายที่อ้างอิงอย่างน้อย 1',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  relatedArticleIds?: number[];
}

/** แก้บางส่วน — ไม่ส่ง = คงเดิม · แก้ไม่ได้: ArticleCode, หมวด (ใช้ย้ายบทความ), สถานะ (ใช้ submit-review/publish/archive), ReviewDueDate, IsOfficialPolicy */
export class UpdateArticleDto {
  @ApiPropertyOptional({
    description:
      'กฎหมาย/พระราชกฤษฎีกา (ArticleCode 24 ตัว) แก้ชื่อไม่ได้ — ชื่อคือ "มาตรา N" ที่คำนวณจาก Code',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  titleCategory?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() summary?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() contentHtml?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3, 4, 5])
  articleType?: number;

  @ApiPropertyOptional({ description: '0-4 (บทความที่ import เข้ามามีค่า 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1, 2, 3, 4])
  confidentialityLevel?: number;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) tags?:
    string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(dateInput)
  @IsDate()
  publishedDate?: Date | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(dateInput)
  @IsDate()
  effectiveDate?: Date | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(dateInput)
  @IsDate()
  expiryDate?: Date | null;

  @ApiPropertyOptional({
    description: 'คำอธิบายการแก้ไข เก็บใน version เมื่อเนื้อหา (contentHtml) เปลี่ยน',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeDescription?: string;
}

export class ExpiryDateDto {
  @ApiProperty({ nullable: true, description: 'null = ไม่มีวันหมดอายุ' })
  @Transform(dateInput)
  @IsDate()
  @IsOptional()
  expiryDate: Date | null;
}

export class CodeAnalysisQueryDto {
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(100) code: string;

  @ApiPropertyOptional({ description: 'พระราชกฤษฎีกา: หมวดกลุ่มที่เลือก' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupCategoryId?: number;
}

export class CodeAnalysisDto {
  @ApiPropertyOptional({ nullable: true, enum: ['Law', 'Decree', 'NonLaw'] }) layout: string | null;
  @ApiProperty({ description: 'กฎหมาย / พระราชกฤษฎีกา / ที่ไม่ใช่กฎหมาย' }) layoutLabel: string;
  @ApiPropertyOptional({ nullable: true }) storedCode: string | null;
  @ApiPropertyOptional({ nullable: true }) title: string | null;
  @ApiPropertyOptional({ nullable: true }) categoryId: number | null;
  @ApiPropertyOptional({ nullable: true }) categoryName: string | null;
  @ApiProperty({ description: 'true = หมวดคำนวณจาก Code ผู้ใช้เลือกเองไม่ได้' })
  categoryFromCode: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Code มาตราของกฎหมายแม่ (24 ตัวแรก) ของบทความที่ไม่ใช่กฎหมาย',
  })
  parentCode: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'ArticleID ของกฎหมายแม่ที่พบในระบบ' })
  parentArticleId: number | null;
  @ApiProperty({ description: 'มี ArticleCode นี้ในระบบแล้ว (รวมที่ถูกลบ)' }) codeExists: boolean;
  @ApiPropertyOptional({ nullable: true }) error: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'หมวดที่ต้องสร้างก่อน' })
  missingCategory: {
    categoryCode: string;
    parentCategoryCode?: string | null;
    parentCategoryName?: string | null;
  } | null;
  @ApiProperty() isValid: boolean;
}

export class ArticleVersionDto {
  @ApiProperty() versionId: number;
  @ApiProperty() articleId: number;
  @ApiProperty() versionNumber: number;
  @ApiPropertyOptional({ nullable: true }) changeDescription: string | null;
  @ApiProperty() createdBy: string;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
  @ApiProperty({ description: 'ความยาวของ ContentSnapshot (ตัวอักษร)' }) contentLength: number;
}

export class ArticleVersionDetailDto extends ArticleVersionDto {
  @ApiProperty() contentSnapshot: string;
}

export class SetRelatedArticlesDto {
  @ApiProperty({
    type: [Number],
    description:
      'ชุดบทความที่เกี่ยวข้องทั้งหมด (แทนที่ชุดเดิม · ตัวที่หายไปถูกยกเลิก link ทั้งสองทาง)',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  relatedArticleIds: number[];
}

export class ArticleLinkDto {
  @ApiProperty() linkId: number;
  @ApiProperty() articleId: number;
  @ApiProperty({ description: '1=Folder/File 2=Task 3=Program 4=Law 5=Project 6=Department' })
  entityType: number;
  @ApiProperty() entityId: string;
  @ApiProperty() createdBy: string;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
}

export class RelatedArticleDto {
  @ApiProperty() linkId: number;
  @ApiProperty() articleId: number;
  @ApiProperty() articleCode: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) titleCategory: string | null;
  @ApiProperty() categoryId: number;
  @ApiProperty() status: number;
  @ApiProperty({ description: 'true = บทความปลายทางถูกลบแล้ว' }) isDelete: boolean;
}

export class ArticleAttachmentDto {
  @ApiProperty() attachmentId: number;
  @ApiProperty() fileId: number;
  @ApiPropertyOptional({ nullable: true }) originalFileName: string | null;
  @ApiPropertyOptional({ nullable: true }) fileExtension: string | null;
  @ApiPropertyOptional({ nullable: true }) mimeType: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'bigint ส่งเป็นสตริง' }) fileSizeBytes:
    string | null;
  @ApiProperty({ description: 'true = ไม่พบไฟล์ใน DMS หรือถูกลบแล้ว' }) fileMissing: boolean;
  @ApiProperty() createdBy: string;
  @ApiPropertyOptional({ nullable: true }) createdDate: Date | null;
}

export class ReplaceAttachmentsDto {
  @ApiProperty({
    type: [Number],
    description:
      'FileID ใน DMS ทั้งชุดที่ต้องการให้บทความมี (แทนที่ชุดเดิม — ตัวที่หายไปถูกถอดออกจากบทความ แต่ไฟล์ใน DMS ไม่ถูกลบ)',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileIds: number[];
}

export class UploadAttachmentsBodyDto {
  @ApiPropertyOptional({
    description: 'โฟลเดอร์ DMS ปลายทาง (ไม่ระบุ = ค่าตั้งระบบ KMS_ARTICLE_ATTACHMENT_FOLDER_ID)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  folderId?: number;
}

export class IdPairParamDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) id: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) otherId: number;
}

export class LinkTypeQueryDto {
  @ApiPropertyOptional({ description: '1=ไฟล์ 2=Task 3=Program 4=Law 5=Project 6=Department' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3, 4, 5, 6])
  entityType?: number;
}
