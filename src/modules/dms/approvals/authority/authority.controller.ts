import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../../common/dto/paginated-response';
import type { Paginated } from '../../../../common/dto/pagination.dto';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { attachmentDisposition } from '../common/content-disposition';
import { AuthorityImportService } from './authority-import.service';
import { FolderAuthorityService } from './authority.service';
import {
  AuthorityConfigDto,
  AuthorityImportFileDto,
  AuthorityImportOptionsDto,
  AuthorityImportPreviewDto,
  AuthorityImportResultDto,
  AuthorityListQueryDto,
  DeleteGroupQueryDto,
  ResolvedAuthorityDto,
  ResolveQueryDto,
  SaveAuthorityConfigDto,
} from './dto/authority.dto';

/** ไฟล์ matrix สิทธิ์เป็น .xlsx ขนาดเล็ก → รับเข้าหน่วยความจำได้ (จำกัด 5 MB) ต่างจากไฟล์ DMS ที่ใช้ diskStorage */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const importUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
});

function requireFile(file: Express.Multer.File | undefined): Buffer {
  if (!file) throw new BadRequestException('ต้องแนบไฟล์ .xlsx (ฟิลด์ file)');
  if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
    throw new BadRequestException('รองรับเฉพาะไฟล์ .xlsx');
  }
  return file.buffer;
}

@ApiTags('DMS')
@ApiBearerAuth()
@MinRole(AppRole.Admin)
@Controller('dms/authority')
export class AuthorityController {
  constructor(
    private readonly service: FolderAuthorityService,
    private readonly importer: AuthorityImportService,
  ) {}

  // ── config ──────────────────────────────────────────────

  @Get('configs')
  @ApiOperation({
    summary:
      'รายการระดับสิทธิ์ตามชั้นความลับที่ใช้งานอยู่ (ค้นด้วย q = กลุ่ม/ตำแหน่ง/รหัสแผนก/รหัสฝ่าย) — Admin',
  })
  @ApiPaginatedResponse(AuthorityConfigDto)
  list(@Query() q: AuthorityListQueryDto): Promise<Paginated<AuthorityConfigDto>> {
    return this.service.list(q);
  }

  @Get('configs/:id')
  @ApiOperation({ summary: 'รายละเอียด config หนึ่งแถว — Admin' })
  @ApiOkResponse({ type: AuthorityConfigDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<AuthorityConfigDto> {
    return this.service.get(id);
  }

  @Post('configs')
  @ApiOperation({ summary: 'เพิ่ม config 1 แถว (1 ชั้นความลับของกลุ่ม) — Admin' })
  @ApiOkResponse({ type: AuthorityConfigDto })
  create(
    @Body() dto: SaveAuthorityConfigDto,
    @CurrentUser() user: UserContext,
  ): Promise<AuthorityConfigDto> {
    return this.service.create(dto, user);
  }

  @Put('configs/:id')
  @ApiOperation({ summary: 'แก้ config 1 แถว (แทนที่ทั้งแถว) — Admin' })
  @ApiOkResponse({ type: AuthorityConfigDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveAuthorityConfigDto,
    @CurrentUser() user: UserContext,
  ): Promise<AuthorityConfigDto> {
    return this.service.update(id, dto, user);
  }

  @Delete('groups')
  @ApiOperation({ summary: 'ลบทั้งกลุ่มตาม ConfigLabel (soft delete ทุกชั้นความลับ) — Admin' })
  removeGroup(
    @Query() q: DeleteGroupQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<{ deletedRows: number }> {
    return this.service.removeGroup(q.label, user);
  }

  @Get('resolve')
  @ApiOperation({
    summary:
      'ดูตัวอย่างสิทธิ์ที่พนักงานจะได้ตามตำแหน่ง/แผนก/ฝ่าย/Level (ลำดับ: Level+แผนก → Level → ตำแหน่ง → แผนก → ฝ่าย) — Admin',
  })
  @ApiOkResponse({ type: ResolvedAuthorityDto })
  resolve(@Query() q: ResolveQueryDto): Promise<ResolvedAuthorityDto> {
    return this.service.resolve(q);
  }

  // ── นำเข้า Excel ─────────────────────────────────────────

  @Get('import/template')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ดาวน์โหลดไฟล์ template matrix สิทธิ์ (.xlsx) — Admin' })
  async template(
    @CurrentUser() user: UserContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buf = await this.importer.template(user);
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': attachmentDisposition('authority-template.xlsx'),
    });
    return new StreamableFile(buf);
  }

  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(importUpload)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: AuthorityImportFileDto })
  @ApiOperation({
    summary: 'ตรวจไฟล์นำเข้าสิทธิ์และแสดงสิ่งที่จะเปลี่ยน (ยังไม่เขียนอะไร) — Admin',
  })
  @ApiOkResponse({ type: AuthorityImportPreviewDto })
  preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() opts: AuthorityImportOptionsDto,
    @CurrentUser() user: UserContext,
  ): Promise<AuthorityImportPreviewDto> {
    return this.importer.preview(requireFile(file), opts, user);
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(importUpload)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: AuthorityImportFileDto })
  @ApiOperation({
    summary:
      'นำเข้าสิทธิ์จริงจากไฟล์ (ส่งไฟล์เดิมซ้ำ; ระบบคำนวณใหม่และทำใน transaction เดียว) — Admin',
  })
  @ApiOkResponse({ type: AuthorityImportResultDto })
  commit(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() opts: AuthorityImportOptionsDto,
    @CurrentUser() user: UserContext,
  ): Promise<AuthorityImportResultDto> {
    return this.importer.commit(requireFile(file), opts, user);
  }
}
