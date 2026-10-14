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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../../common/interfaces/user-context';
import {
  ApplyTemplateDto,
  ApplyTemplateResultDto,
  ApplyTemplateToOrgUnitDto,
  CreateFolderTemplateDto,
  CreateTemplateItemDto,
  FolderTemplateDetailDto,
  FolderTemplateDto,
  FolderTemplateItemDto,
  TemplateListQueryDto,
  UpdateFolderTemplateDto,
  UpdateTemplateItemDto,
} from './dto/folder-template.dto';
import { FolderTemplatesService } from './folder-templates.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms')
export class FolderTemplatesController {
  constructor(private readonly service: FolderTemplatesService) {}

  @Get('folder-templates')
  @ApiOperation({
    summary: 'รายการแม่แบบโฟลเดอร์ที่ใช้งานอยู่ (includeInactive=true เฉพาะ Manager+)',
  })
  @ApiOkResponse({ type: [FolderTemplateDto] })
  list(
    @Query() q: TemplateListQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderTemplateDto[]> {
    return this.service.list(user, q.includeInactive === true);
  }

  @Get('folder-templates/:id')
  @ApiOperation({ summary: 'แม่แบบโฟลเดอร์พร้อมรายการโฟลเดอร์ย่อยทั้งหมด' })
  @ApiOkResponse({ type: FolderTemplateDetailDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<FolderTemplateDetailDto> {
    return this.service.get(id);
  }

  @Post('folder-templates')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'สร้างแม่แบบโฟลเดอร์ — Manager+' })
  @ApiCreatedResponse({ type: FolderTemplateDto })
  create(
    @Body() dto: CreateFolderTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderTemplateDto> {
    return this.service.create(user, dto);
  }

  @Patch('folder-templates/:id')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้แม่แบบโฟลเดอร์ (รวมเปิด/ปิดใช้งาน) — Manager+' })
  @ApiOkResponse({ type: FolderTemplateDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFolderTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderTemplateDto> {
    return this.service.update(user, id, dto);
  }

  @Delete('folder-templates/:id')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบแม่แบบพร้อมรายการทั้งหมด — Manager+ (มีโฟลเดอร์อ้างอิงอยู่ตอบ 409)' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.remove(user, id);
  }

  @Post('folder-templates/:id/items')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'เพิ่มโฟลเดอร์ย่อยในแม่แบบ — Manager+' })
  @ApiCreatedResponse({ type: FolderTemplateItemDto })
  createItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTemplateItemDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderTemplateItemDto> {
    return this.service.createItem(user, id, dto);
  }

  @Patch('folder-templates/:id/items/:itemId')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้รายการโฟลเดอร์ย่อยในแม่แบบ — Manager+' })
  @ApiOkResponse({ type: FolderTemplateItemDto })
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateTemplateItemDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderTemplateItemDto> {
    return this.service.updateItem(user, id, itemId, dto);
  }

  @Delete('folder-templates/:id/items/:itemId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบรายการโฟลเดอร์ย่อยพร้อมลูกหลานทุกชั้น — Manager+' })
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.removeItem(user, id, itemId);
  }

  @Post('folders/:id/apply-template')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'สร้างโฟลเดอร์ย่อยตามแม่แบบใต้โฟลเดอร์นี้ (ใน transaction เดียว) — Manager+',
  })
  @ApiCreatedResponse({ type: ApplyTemplateResultDto })
  applyToFolder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApplyTemplateResultDto> {
    return this.service.applyToFolder(user, id, dto.templateId);
  }

  @Post('folder-templates/:id/apply-to-org-unit')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'สร้าง Root (2SC/3NC/4PC) ใหม่ของหน่วยงานพร้อมโครงสร้างจากแม่แบบ — Manager+',
  })
  @ApiCreatedResponse({ type: ApplyTemplateResultDto })
  applyToOrgUnit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyTemplateToOrgUnitDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApplyTemplateResultDto> {
    return this.service.applyToOrgUnit(user, id, dto);
  }
}
