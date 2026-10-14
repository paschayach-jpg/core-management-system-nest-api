import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, Min } from 'class-validator';

export class ProjectAttachmentDto {
  @ApiProperty() attachId: number;
  @ApiProperty() projectId: number;
  @ApiProperty({ description: 'FileID ใน DMS (storage.FileDocument)' }) fileId: number;
  @ApiProperty() fileName: string;
  @ApiPropertyOptional({ nullable: true }) fileExt?: string | null;
  @ApiProperty({ description: 'ขนาดไฟล์ (bytes) เป็นสตริงเพราะเป็น bigint' }) fileSizeBytes: string;
  @ApiPropertyOptional({ nullable: true, description: 'UserID ผู้อัปโหลดเข้า DMS' }) uploadedBy?:
    number | null;
  @ApiPropertyOptional({ nullable: true }) uploadedDate?: Date | null;
  @ApiProperty({ description: 'ชั้นความลับของโฟลเดอร์ (1=HC … 4=PC, 0=ไม่ทราบ)' })
  confidentialityLevel: number;
  @ApiPropertyOptional({ nullable: true }) folderName?: string | null;
  @ApiProperty({ description: 'ผู้แนบ' }) createUser: string;
  @ApiProperty() createDate: Date;
}

export class LinkAttachmentsDto {
  @ApiProperty({
    type: [Number],
    description: 'FileID ของไฟล์ที่มีอยู่แล้วใน DMS (ผู้ใช้ต้องมีสิทธิ์อ่านไฟล์)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileIds: number[];
}

export class UploadAttachmentQueryDto {
  @ApiPropertyOptional({
    description:
      'โฟลเดอร์ DMS ปลายทาง — ไม่ระบุใช้ค่า config ExternalUpload.FolderId.Level4 (ค่าเริ่มต้น 437 เหมือนระบบเดิม)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  folderId?: number;
}

export class LinkAttachmentsResultDto {
  @ApiProperty({ type: [Number], description: 'fileId ที่เพิ่งผูกใหม่' }) linked: number[];
  @ApiProperty({ type: [Number], description: 'fileId ที่ผูกกับโครงการนี้อยู่แล้ว (ข้าม)' })
  alreadyLinked: number[];
}
