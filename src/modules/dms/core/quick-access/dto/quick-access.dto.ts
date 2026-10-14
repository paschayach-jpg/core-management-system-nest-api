import { ApiProperty } from '@nestjs/swagger';
import { FolderDto } from '../../folders/dto/folder.dto';

export class QuickAccessItemDto {
  @ApiProperty() quickAccessId: number;
  @ApiProperty() folderId: number;
  @ApiProperty() addedDate: Date;
  @ApiProperty({
    type: FolderDto,
    description:
      'โฟลเดอร์ (ถ้าถูกลบ/เก็บถาวรจะยังแสดงพร้อมธง isDeleted/isArchived เพื่อให้ UI ทำเครื่องหมาย)',
  })
  folder: FolderDto;
}
