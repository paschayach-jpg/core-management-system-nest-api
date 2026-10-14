import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class CreateImportBodyDto {
  @ApiProperty({
    description:
      'Import Template (ต้องเปิดใช้งาน) — กำหนดประเภทไฟล์ Law/Decree/NonLaw, ArticleType และการ map คอลัมน์',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  templateId: number;

  @ApiPropertyOptional({
    description:
      'โฟลเดอร์ DMS ปลายทางของไฟล์แนบ — จำเป็นเมื่อ Template map Attachment (ไม่ระบุ = ค่าตั้งระบบ KMS_IMPORT_ATTACHMENT_FOLDER_ID) · ผู้ใช้ต้องมีสิทธิ์เพิ่มไฟล์ในโฟลเดอร์นี้',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dmsFolderId?: number;
}

export class ImportProgressDto {
  @ApiProperty() done: number;
  @ApiProperty() total: number;
  @ApiProperty({ description: '0-100' }) percent: number;
}

export class ImportValidationCountsDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'แถวที่จะสร้างบทความใหม่' }) newCount: number;
  @ApiProperty({ description: 'แถวที่ ArticleCode มีอยู่แล้ว → จะอัปเดตบทความเดิม' })
  updateCount: number;
  @ApiProperty({ description: 'ข้าม (Code ว่าง/ซ้ำในไฟล์)' }) skipCount: number;
  @ApiProperty({ description: 'ไม่ผ่านการตรวจ (จะไม่ถูกนำเข้า)' }) errorCount: number;
}

export class MissingCategoryDto {
  @ApiProperty({ example: 'PLI002551' }) categoryCode: string;
  @ApiPropertyOptional({ nullable: true, example: 'PLI00' }) parentCategoryCode?: string | null;
  @ApiPropertyOptional({ nullable: true }) parentCategoryName?: string | null;
  @ApiProperty({ description: 'จำนวนแถวที่ต้องใช้หมวดนี้' }) rowCount: number;
}

export class ImportResultDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'บทความใหม่ที่สร้าง' }) inserted: number;
  @ApiProperty({ description: 'บทความเดิมที่อัปเดต (re-upload)' }) updated: number;
  @ApiProperty({ description: 'ข้ามระหว่างนำเข้า (เช่น บทความเดิมยังไม่มีไฟล์แนบและหาไฟล์ไม่ได้)' })
  skipped: number;
  @ApiProperty({ description: 'สำเร็จแต่มีข้อสังเกต (Warn) เช่น ข้ามลิงก์กฎหมายแม่ที่ไม่พบ' })
  warned: number;
  @ApiProperty({ description: 'ล้มเหลวรายแถว' }) failed: number;
  @ApiProperty({ description: 'ไม่ได้ทำเพราะผู้ใช้ยกเลิกกลางคัน' }) cancelled: number;
}

export class StagedFilesDto {
  @ApiProperty({ description: 'จำนวนไฟล์แนบที่อัปโหลดไว้กับงานนี้' }) count: number;
}

export class ImportJobDto {
  @ApiProperty({
    description: 'รหัสงาน (UUID) — เก็บในหน่วยความจำของ API instance เดียว สูญเมื่อ restart',
  })
  importId: string;
  @ApiProperty({ enum: ['Validated', 'Running', 'Completed', 'Cancelled', 'Failed'] })
  status: string;
  @ApiProperty() fileName: string;
  @ApiProperty() templateId: number;
  @ApiProperty() templateName: string;
  @ApiProperty({
    enum: ['Law', 'Decree', 'NonLaw'],
    description: 'ชนิดไฟล์ที่ตรวจพบ (ตรงกับ Template)',
  })
  layoutType: string;
  @ApiProperty() articleType: number;
  @ApiProperty({
    description:
      'Template map Attachment: ต้องมีไฟล์แนบ (อัปโหลดมากับงานหรือมีใน DMS โฟลเดอร์ปลายทางอยู่แล้ว)',
  })
  requiresAttachment: boolean;
  @ApiPropertyOptional({ nullable: true }) dmsFolderId: number | null;
  @ApiProperty() createdBy: string;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ nullable: true }) startedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) finishedAt: Date | null;
  @ApiProperty({ type: ImportProgressDto }) progress: ImportProgressDto;
  @ApiProperty({ type: ImportValidationCountsDto, description: 'ผลการตรวจก่อนนำเข้า' })
  validation: ImportValidationCountsDto;
  @ApiProperty({
    type: [MissingCategoryDto],
    description: 'หมวดที่ต้องสร้างก่อน (แถวที่ต้องใช้จะเป็น Error)',
  })
  missingCategories: MissingCategoryDto[];
  @ApiPropertyOptional({
    type: ImportResultDto,
    nullable: true,
    description: 'ผลการนำเข้า (เมื่อจบงาน)',
  })
  result: ImportResultDto | null;
  @ApiPropertyOptional({ nullable: true }) errorMessage: string | null;
  @ApiProperty({ type: StagedFilesDto }) stagedFiles: StagedFilesDto;
  @ApiPropertyOptional({
    type: [String],
    description: 'ชื่อไฟล์แนบที่ถูกปฏิเสธตอนอัปโหลด (ชื่อไม่ถูกต้อง)',
  })
  rejectedFiles?: string[];
}

export class ImportRowsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['Valid', 'Skip', 'Warn', 'Error'] })
  @IsOptional()
  @IsIn(['Valid', 'Skip', 'Warn', 'Error'])
  status?: 'Valid' | 'Skip' | 'Warn' | 'Error';
  // q (จาก PaginationQueryDto) = ค้นใน ArticleCode / ชื่อ / หมายเหตุ
}

export class ImportRowDto {
  @ApiProperty({ description: 'เลขแถวใน Excel' }) rowNumber: number;
  @ApiProperty({ description: 'NonLaw: ลำดับของ Code ในเซลล์เดียวกัน' }) codeIndex: number;
  @ApiProperty() codeCount: number;
  @ApiProperty({ enum: ['Valid', 'Skip', 'Warn', 'Error'] }) status: string;
  @ApiPropertyOptional({ nullable: true }) statusNote: string | null;
  @ApiPropertyOptional({ nullable: true }) articleCode: string | null;
  @ApiPropertyOptional({ nullable: true }) title: string | null;
  @ApiProperty() resolvedCategoryId: number;
  @ApiPropertyOptional({ nullable: true }) resolvedCategoryName: string | null;
  @ApiPropertyOptional({ nullable: true }) documentTypeCode: string | null;
  @ApiPropertyOptional({ nullable: true }) documentTypeLabel: string | null;
  @ApiProperty({ description: 'true = ArticleCode มีอยู่แล้ว จะอัปเดตบทความเดิม' })
  willUpdate: boolean;
  @ApiProperty({ description: 'ArticleID ของบทความที่มีอยู่/ที่นำเข้า (0 = ยัง)' })
  existingArticleId: number;
  @ApiProperty() importedArticleId: number;
  @ApiPropertyOptional({ nullable: true }) attachmentFileName: string | null;
  @ApiPropertyOptional({ nullable: true }) uploadedFileId: number | null;
  @ApiPropertyOptional({ nullable: true, type: MissingCategoryDto }) missingCategory: Omit<
    MissingCategoryDto,
    'rowCount'
  > | null;
}

export class ImportAttachmentStatusDto {
  @ApiProperty({ description: 'ชื่อไฟล์ที่แถวที่ผ่านการตรวจอ้างถึง (ไม่ซ้ำ ไม่สนตัวพิมพ์)' })
  referenced: number;
  @ApiProperty({ description: 'มีในไฟล์ที่อัปโหลดมากับงาน' }) staged: number;
  @ApiProperty({ description: 'มีใน DMS โฟลเดอร์ปลายทางอยู่แล้ว (ใช้ FileID เดิม ไม่อัปโหลดซ้ำ)' })
  inDms: number;
  @ApiProperty({
    type: [String],
    description:
      'ยังไม่มีทั้งสองที่ — แถวใหม่ที่ใช้ไฟล์เหล่านี้จะล้มเหลวตอนนำเข้า (บทความเดิมที่มีไฟล์แนบแล้วไม่ต้องใช้)',
  })
  missing: string[];
  @ApiPropertyOptional({
    nullable: true,
    description: 'ถ้าตรวจรายการใน DMS ไม่ได้ (เช่น ไม่มีสิทธิ์ดูโฟลเดอร์)',
  })
  dmsError: string | null;
}
