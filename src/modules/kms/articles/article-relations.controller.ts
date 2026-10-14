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
  Put,
  Query,
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
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { ArticleAttachmentsService } from './article-attachments.service';
import { ArticleLinksService } from './article-links.service';
import {
  ArticleAttachmentDto,
  ArticleLinkDto,
  LinkTypeQueryDto,
  RelatedArticleDto,
  ReplaceAttachmentsDto,
  SetRelatedArticlesDto,
  UploadAttachmentsBodyDto,
} from './dto/article.dto';

/** link บทความที่เกี่ยวข้อง และไฟล์แนบของบทความ */
@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/articles/:id')
export class ArticleRelationsController {
  constructor(
    private readonly links: ArticleLinksService,
    private readonly attachments: ArticleAttachmentsService,
  ) {}

  // ── บทความที่เกี่ยวข้อง (Law = 4, สองทาง) ─────────────────────

  @Get('links')
  @ApiOperation({
    summary:
      'link ทั้งหมดของบทความ (กรองชนิดได้: 1=ไฟล์ 2=Task 3=Program 4=Law 5=Project 6=Department)',
  })
  @ApiOkResponse({ type: [ArticleLinkDto] })
  listLinks(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: LinkTypeQueryDto,
  ): Promise<ArticleLinkDto[]> {
    return this.links.list(id, q.entityType);
  }

  @Get('related')
  @ApiOperation({ summary: 'บทความที่เกี่ยวข้อง (link Law) พร้อมรหัส/ชื่อ/สถานะของบทความปลายทาง' })
  @ApiOkResponse({ type: [RelatedArticleDto] })
  related(@Param('id', ParseIntPipe) id: number): Promise<RelatedArticleDto[]> {
    return this.links.related(id);
  }

  @Put('related')
  @ApiOperation({
    summary:
      'กำหนดชุดบทความที่เกี่ยวข้องทั้งชุด (แทนที่ของเดิม · ตัวที่หายไปถูกยกเลิก link ทั้งสองทาง) — Archived แล้วแก้ไม่ได้',
  })
  @ApiOkResponse({ type: [RelatedArticleDto] })
  setRelated(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRelatedArticlesDto,
    @CurrentUser() user: UserContext,
  ): Promise<RelatedArticleDto[]> {
    return this.links.setRelated(id, dto.relatedArticleIds, user);
  }

  @Post('related/:otherId')
  @ApiOperation({ summary: 'ผูกบทความที่เกี่ยวข้อง 1 รายการ (สองทาง)' })
  @ApiOkResponse({ type: [RelatedArticleDto] })
  link(
    @Param('id', ParseIntPipe) id: number,
    @Param('otherId', ParseIntPipe) otherId: number,
    @CurrentUser() user: UserContext,
  ): Promise<RelatedArticleDto[]> {
    return this.links.link(id, otherId, user);
  }

  @Delete('related/:otherId')
  @ApiOperation({ summary: 'ยกเลิก link บทความที่เกี่ยวข้อง 1 รายการ (ทั้งสองทาง)' })
  @ApiOkResponse({ type: [RelatedArticleDto] })
  unlink(
    @Param('id', ParseIntPipe) id: number,
    @Param('otherId', ParseIntPipe) otherId: number,
  ): Promise<RelatedArticleDto[]> {
    return this.links.unlink(id, otherId);
  }

  // ── ไฟล์แนบ (ตัวไฟล์อยู่ใน DMS) ───────────────────────────────

  @Get('attachments')
  @ApiOperation({ summary: 'ไฟล์แนบของบทความ (พร้อมชื่อ/ขนาดจาก DMS)' })
  @ApiOkResponse({ type: [ArticleAttachmentDto] })
  listAttachments(@Param('id', ParseIntPipe) id: number): Promise<ArticleAttachmentDto[]> {
    return this.attachments.list(id);
  }

  @Post('attachments')
  @UseInterceptors(FilesInterceptor('files', 20))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        folderId: {
          type: 'integer',
          description:
            'โฟลเดอร์ DMS ปลายทาง (ไม่ระบุ = ค่าตั้งระบบ KMS_ARTICLE_ATTACHMENT_FOLDER_ID)',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'อัปโหลดไฟล์แนบเข้า DMS แล้วผูกกับบทความ (เพิ่ม ไม่ลบของเดิม · สูงสุด 20 ไฟล์/คำขอ) — 503 DMS_UNAVAILABLE ถ้า DMS ยังไม่พร้อม',
  })
  @ApiOkResponse({ type: [ArticleAttachmentDto] })
  uploadAttachments(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: UploadAttachmentsBodyDto,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleAttachmentDto[]> {
    return this.attachments.upload(id, files ?? [], body.folderId, user);
  }

  @Put('attachments')
  @ApiOperation({
    summary:
      'แทนที่ไฟล์แนบทั้งชุดด้วยไฟล์ DMS ที่ระบุ (ตัวที่หายไปถูกถอดออกจากบทความ ไฟล์ใน DMS ไม่ถูกลบ) — ระวัง: เป็นการแทนที่ทั้งชุด',
  })
  @ApiOkResponse({ type: [ArticleAttachmentDto] })
  replaceAttachments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplaceAttachmentsDto,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleAttachmentDto[]> {
    return this.attachments.replaceAll(id, dto.fileIds, user);
  }

  @Delete('attachments/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ถอดไฟล์แนบ 1 ไฟล์ออกจากบทความ (ไฟล์ใน DMS คงอยู่)' })
  removeAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ): Promise<void> {
    return this.attachments.remove(id, fileId);
  }

  @Get('attachments/:fileId/download')
  @ApiOperation({ summary: 'ดาวน์โหลดไฟล์แนบ (ตรวจสิทธิ์อ่านไฟล์โดย DMS)' })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: UserContext,
  ): Promise<StreamableFile> {
    const h = await this.attachments.openDownload(id, fileId, user);
    return new StreamableFile(h.stream, {
      type: h.mimeType,
      length: h.size,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(h.fileName)}`,
    });
  }
}
