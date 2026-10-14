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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import { KB_STATUS, KMS_ROLE } from '../kms.constants';
import { ArticlesService } from './articles.service';
import {
  ArticleDetailDto,
  ArticleListItemDto,
  ArticleListQueryDto,
  ArticleVersionDetailDto,
  ArticleVersionDto,
  CodeAnalysisDto,
  CodeAnalysisQueryDto,
  CreateArticleDto,
  ExpiryDateDto,
  UpdateArticleDto,
} from './dto/article.dto';

@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/articles')
export class ArticlesController {
  constructor(private readonly service: ArticlesService) {}

  @Get()
  @ApiOperation({
    summary:
      'รายการบทความแบบแบ่งหน้า (ไม่รวมที่ถูกลบ · ไม่คืนเนื้อหาเต็ม) — กรองหมวด(+ลูก)/สถานะ/ประเภท/Title/ids และค้นข้อความด้วย q + searchField',
  })
  @ApiPaginatedResponse(ArticleListItemDto)
  list(@Query() q: ArticleListQueryDto): Promise<Paginated<ArticleListItemDto>> {
    return this.service.list(q);
  }

  @Get('code-analysis')
  @ApiOperation({
    summary:
      'ตรวจ Code รวม 29 ตัวก่อนสร้างบทความ (ชนิด Law/Decree/NonLaw, ชื่อ "มาตรา N", หมวดที่คำนวณได้, ซ้ำหรือไม่, กฎหมายแม่) — กฎเดียวกับ import',
  })
  @ApiOkResponse({ type: CodeAnalysisDto })
  codeAnalysis(@Query() q: CodeAnalysisQueryDto): Promise<CodeAnalysisDto> {
    return this.service.analyzeCode(q);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'บทความตาม ArticleCode (ไม่รวมที่ถูกลบ)' })
  @ApiOkResponse({ type: ArticleDetailDto })
  getByCode(@Param('code') code: string): Promise<ArticleDetailDto> {
    return this.service.getByCode(code);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดบทความ (รวมเนื้อหา · isDelete=true ถ้าถูกลบ)' })
  @ApiOkResponse({ type: ArticleDetailDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<ArticleDetailDto> {
    return this.service.get(id);
  }

  @Post()
  @ApiOperation({
    summary:
      'สร้างบทความ (สถานะ Draft + version 1) — Code รวมต้องผ่านกฎเดียวกับ import · กฎหมาย/พระราชกฤษฎีกาเก็บ 24 ตัวและชื่อ "มาตรา N" คำนวณจาก Code · Code ซ้ำ (รวมที่ถูกลบ) = 409',
  })
  @ApiOkResponse({ type: ArticleDetailDto })
  create(
    @Body() dto: CreateArticleDto,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleDetailDto> {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'แก้ไขบทความ (whitelist: Title/เนื้อหา/สรุป/TitleCategory/ประเภท/วันที่/Tags/ชั้นความลับ) — เพิ่ม version เมื่อเนื้อหาเปลี่ยน · แก้ Code/หมวด/สถานะไม่ได้ · Archived แล้วแก้ไม่ได้',
  })
  @ApiOkResponse({ type: ArticleDetailDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArticleDto,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleDetailDto> {
    return this.service.update(id, dto, user);
  }

  @Post(':id/submit-review')
  @ApiOperation({ summary: 'ส่งขอ Review (Draft → Review) — ทุกคนที่ login' })
  @ApiOkResponse({ type: ArticleDetailDto })
  submitReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleDetailDto> {
    return this.service.changeStatus(id, KB_STATUS.review, user);
  }

  @Post(':id/publish')
  @MinRole(KMS_ROLE.publish)
  @ApiOperation({ summary: 'เผยแพร่ (Review → Published) — Manager ขึ้นไป' })
  @ApiOkResponse({ type: ArticleDetailDto })
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleDetailDto> {
    return this.service.changeStatus(id, KB_STATUS.published, user);
  }

  @Post(':id/archive')
  @MinRole(KMS_ROLE.publish)
  @ApiOperation({ summary: 'Archive (Published → Archived, เปลี่ยนกลับไม่ได้) — Manager ขึ้นไป' })
  @ApiOkResponse({ type: ArticleDetailDto })
  archive(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleDetailDto> {
    return this.service.changeStatus(id, KB_STATUS.archived, user);
  }

  @Delete(':id')
  @MinRole(KMS_ROLE.deleteArticle)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ลบบทความ (soft delete) พร้อมลบ link บทความที่เกี่ยวข้องทั้งสองทาง — Manager ขึ้นไป',
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.softDelete(id, user);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'นับการเปิดอ่านบทความ (+1)' })
  view(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.incrementView(id);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'กดถูกใจบทความ (+1)' })
  like(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.incrementLike(id);
  }

  @Put(':id/expiry')
  @ApiOperation({ summary: 'ตั้ง/ล้างวันหมดอายุของบทความ (null = ไม่มีวันหมดอายุ)' })
  @ApiOkResponse({ type: ArticleDetailDto })
  setExpiry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExpiryDateDto,
    @CurrentUser() user: UserContext,
  ): Promise<ArticleDetailDto> {
    return this.service.setExpiryDate(id, dto.expiryDate ?? null, user);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'ประวัติ version ของบทความ (ใหม่สุดก่อน · ไม่รวมเนื้อหา)' })
  @ApiOkResponse({ type: [ArticleVersionDto] })
  versions(@Param('id', ParseIntPipe) id: number): Promise<ArticleVersionDto[]> {
    return this.service.listVersions(id);
  }

  @Get(':id/versions/:versionNumber')
  @ApiOperation({ summary: 'เนื้อหาของ version ที่ระบุ' })
  @ApiOkResponse({ type: ArticleVersionDetailDto })
  version(
    @Param('id', ParseIntPipe) id: number,
    @Param('versionNumber', ParseIntPipe) versionNumber: number,
  ): Promise<ArticleVersionDetailDto> {
    return this.service.getVersion(id, versionNumber);
  }
}
