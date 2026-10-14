import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { CurrentUser } from '../../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../../common/dto/paginated-response';
import { Paginated, PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { contentDisposition } from '../rules/file.rules';
import {
  CheckDuplicatesDto,
  CopyFileDto,
  DownloadAccessDto,
  DuplicateNamesDto,
  FileDto,
  FileVersionDto,
  MoveFilesDto,
  MoveFilesResultDto,
  RenameFileDto,
  UploadFilesBodyDto,
  UploadResultDto,
} from './dto/file.dto';
import { FilesService, type UploadSource } from './files.service';

/** จำนวนไฟล์สูงสุดต่อคำขออัปโหลด */
export const MAX_FILES_PER_UPLOAD = 20;

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms')
export class FilesController {
  constructor(private readonly service: FilesService) {}

  @Post('folders/:folderId/files')
  @ApiOperation({
    summary:
      'อัปโหลดไฟล์เข้าโฟลเดอร์ (multipart ฟิลด์ files) — ชนิด .pdf .doc(x) .xls(x) .ppt(x) .jpg .png .gif .zip ไม่เกิน 100 MB/ไฟล์; ชื่อซ้ำตั้ง copy(N) หรือ overwriteExisting=true เพื่อแทนที่ (Version+1)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        overwriteExisting: { type: 'boolean' },
      },
    },
  })
  @ApiCreatedResponse({ type: UploadResultDto })
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD))
  async upload(
    @Param('folderId', ParseIntPipe) folderId: number,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: UploadFilesBodyDto,
    @CurrentUser() user: UserContext,
  ): Promise<UploadResultDto> {
    const list = files ?? [];
    const sources: UploadSource[] = list.map((f) => ({
      originalName: f.originalname,
      sizeBytes: f.size,
      mimeType: f.mimetype,
      open: () => createReadStream(f.path),
      dispose: () => rm(f.path, { force: true }),
    }));
    if (sources.length === 0) {
      throw new BusinessException('ไม่พบไฟล์ที่อัปโหลด (ฟิลด์ files)', 'NO_FILES');
    }
    const result = await this.service.upload(user, folderId, sources, {
      overwriteExisting: body.overwriteExisting === true,
    });
    if (result.successCount === 0) {
      throw new BusinessException('อัปโหลดไม่สำเร็จทุกไฟล์', 'UPLOAD_ALL_FAILED', result);
    }
    return result;
  }

  @Get('folders/:folderId/files')
  @ApiOperation({
    summary: 'รายการไฟล์ในโฟลเดอร์ (แบ่งหน้า; sortBy: name|size|uploadedDate|version|extension)',
  })
  @ApiPaginatedResponse(FileDto)
  list(
    @Param('folderId', ParseIntPipe) folderId: number,
    @Query() q: PaginationQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<Paginated<FileDto>> {
    return this.service.listByFolder(user, folderId, q);
  }

  @Post('folders/:folderId/files/check-duplicates')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ตรวจว่าชื่อไฟล์ใดซ้ำกับไฟล์ที่ใช้งานอยู่ในโฟลเดอร์ (ก่อนอัปโหลด)' })
  @ApiOkResponse({ type: DuplicateNamesDto })
  checkDuplicates(
    @Param('folderId', ParseIntPipe) folderId: number,
    @Body() dto: CheckDuplicatesDto,
    @CurrentUser() user: UserContext,
  ): Promise<DuplicateNamesDto> {
    return this.service.checkDuplicates(user, folderId, dto.fileNames);
  }

  @Post('files/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ย้ายไฟล์ (หลายไฟล์) ไปโฟลเดอร์ปลายทาง — ตอบผลรายไฟล์' })
  @ApiOkResponse({ type: MoveFilesResultDto })
  move(@Body() dto: MoveFilesDto, @CurrentUser() user: UserContext): Promise<MoveFilesResultDto> {
    return this.service.moveMany(user, dto.fileIds, dto.destinationFolderId);
  }

  @Get('files/:id')
  @ApiOperation({ summary: 'รายละเอียดไฟล์' })
  @ApiOkResponse({ type: FileDto })
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext): Promise<FileDto> {
    return this.service.get(user, id);
  }

  @Get('files/:id/versions')
  @ApiOperation({ summary: 'ประวัติเวอร์ชันของไฟล์ (ไฟล์ชื่อเดียวกันในโฟลเดอร์เดียวกัน)' })
  @ApiOkResponse({ type: [FileVersionDto] })
  versions(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<FileVersionDto[]> {
    return this.service.versions(user, id);
  }

  @Get('files/:id/download-access')
  @ApiOperation({ summary: 'ฉันดาวน์โหลดไฟล์นี้ได้ทันทีหรือต้องขออนุมัติก่อน' })
  @ApiOkResponse({ type: DownloadAccessDto })
  downloadAccess(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<DownloadAccessDto> {
    return this.service.downloadAccess(user, id);
  }

  @Get('files/:id/download')
  @ApiOperation({
    summary:
      'ดาวน์โหลดไฟล์ (stream) — Manager/Admin หรือมี Authority.CanDownload/สิทธิ์ไฟล์ หรือมีใบอนุมัติ; ไม่มีสิทธิ์ตอบ 403 (DOWNLOAD_APPROVAL_REQUIRED เมื่อขออนุมัติได้)',
  })
  @ApiProduces('application/octet-stream')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const h = await this.service.openDownload(user, id);
    // ผู้ใช้ปิดการเชื่อมต่อกลางทาง → ปิดไฟล์ที่เปิดค้าง
    res.once('close', () => {
      if (!h.stream.destroyed) h.stream.destroy();
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(h.stream, {
      type: h.mimeType,
      disposition: contentDisposition(h.fileName),
      length: h.sizeBytes,
    });
  }

  @Patch('files/:id')
  @ApiOperation({ summary: 'เปลี่ยนชื่อไฟล์ (ต้องคงนามสกุลเดิม, ชื่อต้องไม่ซ้ำในโฟลเดอร์)' })
  @ApiOkResponse({ type: FileDto })
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenameFileDto,
    @CurrentUser() user: UserContext,
  ): Promise<FileDto> {
    return this.service.rename(user, id, dto.name);
  }

  @Post('files/:id/copy')
  @ApiOperation({
    summary: 'คัดลอกไฟล์ไปโฟลเดอร์อื่น (ชื่อซ้ำ copy(N) หรือ overwrite=true เพื่อแทนที่)',
  })
  @ApiCreatedResponse({ type: FileDto })
  copy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CopyFileDto,
    @CurrentUser() user: UserContext,
  ): Promise<FileDto> {
    return this.service.copy(user, id, dto);
  }

  @Delete('files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบไฟล์ลงถังขยะ (soft delete)' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.remove(user, id);
  }
}
