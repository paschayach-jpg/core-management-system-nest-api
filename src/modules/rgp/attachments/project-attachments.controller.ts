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
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  LinkAttachmentsDto,
  LinkAttachmentsResultDto,
  ProjectAttachmentDto,
  UploadAttachmentQueryDto,
} from './dto/attachment.dto';
import { ProjectAttachmentsService } from './project-attachments.service';
import { withUploadedBuffers, type TempUploadedFile } from './upload.util';

/** จำนวนไฟล์สูงสุดต่อการอัปโหลดหนึ่งครั้ง */
const MAX_FILES_PER_UPLOAD = 20;

// ไฟล์แนบโครงการ — ไฟล์เก็บใน DMS (ผ่าน port) สิทธิ์ต่อไฟล์ตรวจที่ DMS · ขนาดสูงสุดตั้งใน MulterModule ของ RgpModule (STORAGE_MAX_UPLOAD_MB)

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp/projects/:projectId/attachments')
export class ProjectAttachmentsController {
  constructor(private readonly service: ProjectAttachmentsService) {}

  @Get()
  @ApiOperation({ summary: 'ไฟล์แนบของโครงการ (ใหม่สุดก่อน)' })
  @ApiOkResponse({ type: [ProjectAttachmentDto] })
  list(@Param('projectId', ParseIntPipe) projectId: number): Promise<ProjectAttachmentDto[]> {
    return this.service.list(projectId);
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOperation({
    summary:
      'อัปโหลดไฟล์ใหม่เข้า DMS แล้วแนบกับโครงการ (folderId ไม่ระบุ = โฟลเดอร์ระดับ 4 ตาม config)',
  })
  @ApiOkResponse({ type: [ProjectAttachmentDto] })
  upload(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() q: UploadAttachmentQueryDto,
    @UploadedFiles() files: TempUploadedFile[] | undefined,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectAttachmentDto[]> {
    return withUploadedBuffers(files ?? [], (inputs) =>
      this.service.upload(projectId, inputs, q.folderId, user),
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'แนบไฟล์ที่มีอยู่แล้วใน DMS เข้ากับโครงการ (ต้องมีสิทธิ์อ่านไฟล์นั้น)' })
  @ApiOkResponse({ type: LinkAttachmentsResultDto })
  link(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: LinkAttachmentsDto,
    @CurrentUser() user: UserContext,
  ): Promise<LinkAttachmentsResultDto> {
    return this.service.link(projectId, dto.fileIds, user);
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: 'ดาวน์โหลดไฟล์แนบ (ตรวจสิทธิ์ผ่าน DMS)' })
  async download(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: UserContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const handle = await this.service.download(projectId, fileId, user);
    res.set({
      'Content-Type': handle.mimeType || 'application/octet-stream',
      'Content-Length': String(handle.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(handle.fileName)}`,
    });
    return new StreamableFile(handle.stream);
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ยกเลิกการแนบไฟล์กับโครงการ (ไฟล์ยังอยู่ใน DMS)' })
  unlink(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ): Promise<void> {
    return this.service.unlink(projectId, fileId);
  }
}
