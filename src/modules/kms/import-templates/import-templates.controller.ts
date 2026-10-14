import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { KMS_ROLE } from '../kms.constants';
import {
  ImportTemplateDetailDto,
  ImportTemplateDto,
  SaveTemplateDto,
  TemplateColumnDto,
  TemplateListQueryDto,
  TemplateOptionsDto,
} from './dto/import-template.dto';
import { ImportTemplatesService } from './import-templates.service';

@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/import-templates')
export class ImportTemplatesController {
  constructor(private readonly service: ImportTemplatesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Import Template ทั้งหมด พร้อมประเภทไฟล์ (Law/Decree/NonLaw) และ ArticleType ที่ตั้งไว้',
  })
  @ApiOkResponse({ type: [ImportTemplateDto] })
  list(@Query() q: TemplateListQueryDto): Promise<ImportTemplateDto[]> {
    return this.service.list(q.activeOnly === true);
  }

  @Get('options')
  @ApiOperation({ summary: 'ตัวเลือกคงที่: ประเภทไฟล์ของ Template และ ArticleType (1-5)' })
  @ApiOkResponse({ type: TemplateOptionsDto })
  options(): TemplateOptionsDto {
    return this.service.options();
  }

  @Get('column-grid')
  @ApiOperation({
    summary: 'ตาราง mapping ว่าง (ทุกคอลัมน์เป้าหมายพร้อมคำอธิบาย) สำหรับสร้าง Template ใหม่',
  })
  @ApiOkResponse({ type: [TemplateColumnDto] })
  columnGrid(): TemplateColumnDto[] {
    return this.service.emptyGrid();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Template พร้อมตาราง mapping ครบทุกคอลัมน์ และข้อที่ยังตั้งค่าไม่ครบ (problems)',
  })
  @ApiOkResponse({ type: ImportTemplateDetailDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<ImportTemplateDetailDto> {
    return this.service.get(id);
  }

  @Post()
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({
    summary:
      'สร้าง Template — Manager ขึ้นไป · ต้องเลือกประเภทไฟล์ (LayoutType) + ArticleType และ map ArticleCode · NonLaw ต้อง map Title/ContentHTML/Attachment · Decree ต้อง map LawReference',
  })
  @ApiOkResponse({ type: ImportTemplateDetailDto })
  create(
    @Body() dto: SaveTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<ImportTemplateDetailDto> {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({ summary: 'แก้ Template (แทนที่ตาราง mapping ทั้งชุด) — Manager ขึ้นไป' })
  @ApiOkResponse({ type: ImportTemplateDetailDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<ImportTemplateDetailDto> {
    return this.service.update(id, dto, user);
  }

  @Post(':id/deactivate')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({ summary: 'ปิดใช้งาน Template (import ด้วย Template นี้ไม่ได้) — Manager ขึ้นไป' })
  @ApiOkResponse({ type: ImportTemplateDetailDto })
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext) {
    return this.service.deactivate(id, user);
  }

  @Post(':id/activate')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({ summary: 'เปิดใช้งาน Template อีกครั้ง — Manager ขึ้นไป' })
  @ApiOkResponse({ type: ImportTemplateDetailDto })
  activate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext) {
    return this.service.activate(id, user);
  }
}
