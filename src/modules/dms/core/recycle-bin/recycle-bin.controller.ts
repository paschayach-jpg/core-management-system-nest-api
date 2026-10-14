import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../../common/dto/paginated-response';
import type { Paginated } from '../../../../common/dto/pagination.dto';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { FileDto } from '../files/dto/file.dto';
import { FilesService } from '../files/files.service';
import { FolderDto } from '../folders/dto/folder.dto';
import {
  PurgeResultDto,
  RecycleBinFileQueryDto,
  RecycleBinFolderQueryDto,
  RestoreFolderDto,
} from './dto/recycle-bin.dto';
import { RecycleBinService } from './recycle-bin.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms/recycle-bin')
export class RecycleBinController {
  constructor(
    private readonly service: RecycleBinService,
    private readonly files: FilesService,
  ) {}

  @Get('folders')
  @ApiOperation({
    summary:
      'โฟลเดอร์ในถังขยะที่ยังกู้คืนได้ (ภายใน 30 วัน) — Manager+ เห็นทั้งหมดในหน่วยงานที่มองเห็น, อื่นๆ เห็นเฉพาะที่ตนลบ',
  })
  @ApiPaginatedResponse(FolderDto)
  listFolders(
    @Query() q: RecycleBinFolderQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<Paginated<FolderDto>> {
    return this.service.listFolders(user, q);
  }

  @Post('folders/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'กู้คืนโฟลเดอร์ทั้งต้นไม้ย่อย (ภายใน 30 วัน) — ถ้าแม่เดิมไม่อยู่แล้วต้องระบุ newParentFolderId',
  })
  @ApiOkResponse({ type: FolderDto })
  restoreFolder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RestoreFolderDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderDto> {
    return this.service.restoreFolder(user, id, dto.newParentFolderId);
  }

  @Delete('folders/:id')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'ลบโฟลเดอร์ในถังขยะถาวร (รวมไฟล์/สิทธิ์/ใบอนุมัติ/ไฟล์กายภาพ) — Manager+ · ย้อนไม่ได้',
  })
  @ApiOkResponse({ type: PurgeResultDto })
  purgeFolder(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<PurgeResultDto> {
    return this.service.purgeFolder(user, id);
  }

  @Get('files')
  @ApiOperation({
    summary:
      'ไฟล์ที่ถูกลบ (ในโฟลเดอร์ที่ยังไม่ถูกลบ) — Manager+ เห็นทั้งหมด, อื่นๆ เห็นเฉพาะที่ตนลบ',
  })
  @ApiPaginatedResponse(FileDto)
  listFiles(
    @Query() q: RecycleBinFileQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<Paginated<FileDto>> {
    return this.service.listFiles(user, q);
  }

  @Post('files/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'กู้คืนไฟล์จากถังขยะ (ชื่อชนกับไฟล์ที่ใช้งานอยู่จะตั้งเป็น copy(N))' })
  @ApiOkResponse({ type: FileDto })
  restoreFile(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<FileDto> {
    return this.files.restore(user, id);
  }
}
