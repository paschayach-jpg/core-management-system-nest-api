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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  CopyTemplateStatesDto,
  CopyTemplateStatesResultDto,
  CreateTemplateDocDto,
  CreateTemplateDto,
  CreateTemplateStateDto,
  TemplateBlueprintDto,
  TemplateDetailDto,
  TemplateDocDto,
  TemplateListItemDto,
  TemplateListQueryDto,
  TemplateStateDto,
  UpdateTemplateDocDto,
  UpdateTemplateDto,
  UpdateTemplateStateDto,
} from './dto/template.dto';
import { ProjectTemplatesService } from './project-templates.service';

// Template ประเภทโครงการ (ข้อมูลหลัก): อ่านได้ทุกคนที่ login · เขียน/ลบ = Manager ขึ้นไป (ระบบเดิมไม่จำกัด — เลือกทางที่ปลอดภัยกว่า, ดู docs)

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp/templates')
export class ProjectTemplatesController {
  constructor(private readonly service: ProjectTemplatesService) {}

  @Get()
  @ApiOperation({
    summary: 'Template ประเภทโครงการ พร้อมจำนวนขั้นตอน/โครงการ (activeOnly=true สำหรับ dropdown)',
  })
  @ApiOkResponse({ type: [TemplateListItemDto] })
  list(@Query() q: TemplateListQueryDto): Promise<TemplateListItemDto[]> {
    return this.service.list(q.activeOnly ?? false);
  }

  @Post()
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'สร้าง Template — Manager ขึ้นไป' })
  @ApiOkResponse({ type: TemplateDetailDto })
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.create(dto, user);
  }

  @Get(':templateId')
  @ApiOperation({ summary: 'รายละเอียด Template พร้อมขั้นตอนและเอกสาร' })
  @ApiOkResponse({ type: TemplateDetailDto })
  get(@Param('templateId', ParseIntPipe) templateId: number): Promise<TemplateDetailDto> {
    return this.service.get(templateId);
  }

  @Get(':templateId/blueprint')
  @ApiOperation({
    summary:
      'ขั้นตอน+เอกสารของ Template ในรูปแบบเดียวกับ body สร้างโครงการ (ดึงไปแก้ก่อนบันทึกได้)',
  })
  @ApiOkResponse({ type: TemplateBlueprintDto })
  blueprint(@Param('templateId', ParseIntPipe) templateId: number): Promise<TemplateBlueprintDto> {
    return this.service.blueprint(templateId);
  }

  @Get(':templateId/states')
  @ApiOperation({ summary: 'ขั้นตอนของ Template (เรียงตามลำดับ)' })
  @ApiOkResponse({ type: [TemplateStateDto] })
  listStates(@Param('templateId', ParseIntPipe) templateId: number): Promise<TemplateStateDto[]> {
    return this.service.listStates(templateId);
  }

  @Patch(':templateId')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้ไข Template (รหัสต้องไม่ซ้ำ) — Manager ขึ้นไป' })
  @ApiOkResponse({ type: TemplateDetailDto })
  update(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.update(templateId, dto, user);
  }

  @Delete(':templateId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ลบ Template พร้อมขั้นตอนและเอกสาร — บล็อกถ้ามีโครงการใช้อยู่ — Manager ขึ้นไป',
  })
  remove(@Param('templateId', ParseIntPipe) templateId: number): Promise<void> {
    return this.service.remove(templateId);
  }

  @Post(':templateId/copy-states')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'คัดลอกขั้นตอนจาก Template อื่นมาแทนที่ขั้นตอนเดิมทั้งหมด (เอกสารของ Template นี้ถูกลบ) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: CopyTemplateStatesResultDto })
  async copyStates(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: CopyTemplateStatesDto,
    @CurrentUser() user: UserContext,
  ): Promise<CopyTemplateStatesResultDto> {
    return {
      copiedStates: await this.service.copyStatesFrom(templateId, dto.sourceTemplateId, user),
    };
  }

  @Post(':templateId/states')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'เพิ่มขั้นตอนใน Template — Manager ขึ้นไป' })
  @ApiOkResponse({ type: TemplateStateDto })
  createState(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: CreateTemplateStateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateStateDto> {
    return this.service.createState(templateId, dto, user);
  }
}

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp/template-states')
export class TemplateStatesController {
  constructor(private readonly service: ProjectTemplatesService) {}

  @Patch(':stateId')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้ไขขั้นตอนของ Template — Manager ขึ้นไป' })
  @ApiOkResponse({ type: TemplateStateDto })
  update(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Body() dto: UpdateTemplateStateDto,
  ): Promise<TemplateStateDto> {
    return this.service.updateState(stateId, dto);
  }

  @Delete(':stateId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบขั้นตอนของ Template (ต้องไม่มีเอกสารผูกอยู่) — Manager ขึ้นไป' })
  remove(@Param('stateId', ParseIntPipe) stateId: number): Promise<void> {
    return this.service.removeState(stateId);
  }

  @Get(':stateId/docs')
  @ApiOperation({ summary: 'เอกสารของขั้นตอนใน Template' })
  @ApiOkResponse({ type: [TemplateDocDto] })
  listDocs(@Param('stateId', ParseIntPipe) stateId: number): Promise<TemplateDocDto[]> {
    return this.service.listDocsByState(stateId);
  }

  @Post(':stateId/docs')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'ผูกเอกสารมาสเตอร์เข้ากับขั้นตอนของ Template (ห้ามซ้ำ) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: TemplateDocDto })
  createDoc(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Body() dto: CreateTemplateDocDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDocDto> {
    return this.service.createDoc(stateId, dto, user);
  }
}

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp/template-docs')
export class TemplateDocsController {
  constructor(private readonly service: ProjectTemplatesService) {}

  @Patch(':templateDocId')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้ไขเอกสารของ Template — Manager ขึ้นไป' })
  @ApiOkResponse({ type: TemplateDocDto })
  update(
    @Param('templateDocId', ParseIntPipe) templateDocId: number,
    @Body() dto: UpdateTemplateDocDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDocDto> {
    return this.service.updateDoc(templateDocId, dto, user);
  }

  @Delete(':templateDocId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบเอกสารออกจากขั้นตอนของ Template — Manager ขึ้นไป' })
  remove(@Param('templateDocId', ParseIntPipe) templateDocId: number): Promise<void> {
    return this.service.removeDoc(templateDocId);
  }
}
