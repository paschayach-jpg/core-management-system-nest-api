import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { KMS_ROLE } from '../kms.constants';
import {
  CreateImportBodyDto,
  ImportAttachmentStatusDto,
  ImportJobDto,
  ImportRowDto,
  ImportRowsQueryDto,
} from './dto/import.dto';
import { ImportsService } from './imports.service';

type UploadMap = { file?: Express.Multer.File[]; attachments?: Express.Multer.File[] };

/** Excel import ของ KMS — งานเบื้องหลัง (ตรวจก่อน → สั่งนำเข้า → ติดตามความคืบหน้า) ดูภาพรวมที่ ImportsService */
@ApiTags('KMS')
@ApiBearerAuth()
@MinRole(KMS_ROLE.import)
@Controller('kms/imports')
export class ImportsController {
  constructor(private readonly service: ImportsService) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'file', maxCount: 1 },
      { name: 'attachments', maxCount: 200 },
    ]),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'templateId'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'ไฟล์ Excel .xlsx (sheet แรก · แถว 1 = หัวตาราง · ข้อมูลเริ่มแถว 2)',
        },
        templateId: { type: 'integer' },
        dmsFolderId: {
          type: 'integer',
          description: 'โฟลเดอร์ DMS ปลายทางของไฟล์แนบ (เมื่อ Template map Attachment)',
        },
        attachments: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description:
            'ไฟล์แนบ (PDF ฯลฯ) ที่ชื่อตรงกับเซลล์ Attachment — ส่งเพิ่มภายหลังได้ที่ POST /kms/imports/:id/attachments',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'อัปโหลด Excel + เลือก Template → ตรวจชนิดไฟล์ (กฎหมาย/พระราชกฤษฎีกา/ไม่ใช่กฎหมาย) เทียบ Template, ตรวจ mapping และตรวจรายแถว (ไม่เขียน DB) แล้วคืน importId พร้อมผลตรวจ — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: ImportJobDto })
  create(
    @UploadedFiles() files: UploadMap,
    @Body() body: CreateImportBodyDto,
    @CurrentUser() user: UserContext,
  ): Promise<ImportJobDto> {
    return this.service.start(files?.file?.[0], body, files?.attachments ?? [], user);
  }

  @Get()
  @ApiOperation({
    summary: 'งานนำเข้าของฉัน (Admin เห็นทั้งหมด) — เก็บในหน่วยความจำ สูญเมื่อ restart',
  })
  @ApiOkResponse({ type: [ImportJobDto] })
  list(@CurrentUser() user: UserContext): ImportJobDto[] {
    return this.service.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'สถานะ/ความคืบหน้า/สรุปผลของงานนำเข้า' })
  @ApiOkResponse({ type: ImportJobDto })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: UserContext): ImportJobDto {
    return this.service.get(id, user);
  }

  @Get(':id/rows')
  @ApiOperation({
    summary:
      'ผลรายแถว (Valid/Skip/Warn/Error + หมายเหตุ + หมวดที่ต้องสร้าง) แบ่งหน้า กรอง status และค้น q',
  })
  @ApiPaginatedResponse(ImportRowDto)
  rows(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ImportRowsQueryDto,
    @CurrentUser() user: UserContext,
  ): Paginated<ImportRowDto> {
    return this.service.rows(id, q, user);
  }

  @Get(':id/attachments')
  @ApiOperation({
    summary:
      'ไฟล์แนบที่แถวต้องใช้: มีในไฟล์ที่อัปโหลด / มีใน DMS แล้ว / ยังขาด (ตรวจก่อนสั่งนำเข้า)',
  })
  @ApiOkResponse({ type: ImportAttachmentStatusDto })
  attachmentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<ImportAttachmentStatusDto> {
    return this.service.attachmentStatus(id, user);
  }

  @Post(':id/attachments')
  @UseInterceptors(FilesInterceptor('attachments', 200))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['attachments'],
      properties: { attachments: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOperation({
    summary:
      'เพิ่มไฟล์แนบให้งานที่ตรวจแล้ว (ทยอยส่งได้หลายครั้ง · สูงสุด 200 ไฟล์/คำขอ · ชื่อซ้ำ = ทับ) — เหมาะกับไฟล์จำนวนมากที่ส่งทีเดียวไม่ไหว',
  })
  @ApiOkResponse({ type: ImportJobDto })
  addAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: UserContext,
  ): Promise<ImportJobDto> {
    if (!files || files.length === 0)
      throw new BusinessException('ไม่พบไฟล์ที่อัปโหลด', 'NO_FILES');
    return this.service.addAttachments(id, files, user);
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'สั่งนำเข้า (รันเบื้องหลัง ตอบทันที 202) — นำเข้าได้ครั้งเดียวต่องาน · รันได้ทีละงาน · ติดตามที่ GET /kms/imports/:id',
  })
  @ApiAcceptedResponse({ type: ImportJobDto })
  execute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<ImportJobDto> {
    return this.service.execute(id, user);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'ยกเลิกงาน: ยังไม่นำเข้า = ทิ้งงาน · กำลังนำเข้า = หยุดก่อนแถวถัดไป' })
  @ApiOkResponse({ type: ImportJobDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<ImportJobDto> {
    return this.service.cancel(id, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบงาน (และไฟล์ชั่วคราว) ออกจากทะเบียน — ลบไม่ได้ขณะกำลังนำเข้า' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.remove(id, user);
  }
}
