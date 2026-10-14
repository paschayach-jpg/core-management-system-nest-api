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
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  ConnectionDto,
  CopyTemplateDto,
  CreateConnectionDto,
  CreateStepDto,
  CreateTemplateDto,
  DisableTemplateDto,
  GraphValidationDto,
  ImportTemplateDto,
  RejectTemplateDto,
  StepDto,
  TemplateDetailDto,
  TemplateExportDto,
  TemplateListQueryDto,
  TemplateStructureDto,
  TemplateSummaryDto,
  TemplateVersionDto,
  UpdateConnectionDto,
  UpdateStepDto,
  UpdateTemplateDto,
} from './dto/template.dto';
import { TemplateStructureService } from './template-structure.service';
import { WorkflowTemplatesService } from './template.service';

/**
 * Template ของ workflow — อ่านได้ทุกคนที่ login · แก้/ส่งอนุมัติ/ปิดใช้งาน = Manager ขึ้นไป · อนุมัติ/ปฏิเสธ/เผยแพร่ตรง/ยกเลิกเวอร์ชัน = Admin
 * (สิทธิ์เหล่านี้ระบบเดิมไม่ได้ตรวจใน service — กำหนดใหม่ ดู docs/modules/wfe.md)
 */
@ApiTags('WFE')
@ApiBearerAuth()
@Controller('wfe/templates')
export class WorkflowTemplatesController {
  constructor(
    private readonly service: WorkflowTemplatesService,
    private readonly structure: TemplateStructureService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'รายการ Template ของ workflow (แบ่งหน้า, กรองตามสถานะ/หมวด/คำค้น)' })
  list(@Query() q: TemplateListQueryDto): Promise<Paginated<TemplateSummaryDto>> {
    return this.service.list(q);
  }

  @Post('import')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'นำเข้า Template จากข้อมูลที่ export ไว้ — สร้างเป็น Draft' })
  @ApiCreatedResponse({ type: TemplateDetailDto })
  import(
    @Body() dto: ImportTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.import(dto, user);
  }

  @Post()
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'สร้าง Template ใหม่ (เป็น Draft เสมอ)' })
  @ApiCreatedResponse({ type: TemplateDetailDto })
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'รายละเอียด Template พร้อมขั้นตอน/เส้นเชื่อม และผลตรวจความถูกต้องของผัง',
  })
  @ApiOkResponse({ type: TemplateDetailDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<TemplateDetailDto> {
    return this.service.get(id);
  }

  @Get(':id/versions')
  @ApiOperation({
    summary: 'เวอร์ชันของ Template (ระบบเดิมมีแถวเดียวต่อ template — Version เพิ่มทุกครั้งที่แก้)',
  })
  @ApiOkResponse({ type: [TemplateVersionDto] })
  versions(@Param('id', ParseIntPipe) id: number): Promise<TemplateVersionDto[]> {
    return this.service.versions(id);
  }

  @Get(':id/export')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'ส่งออก Template เป็น JSON (นำไป import ที่อื่นได้) — Manager' })
  @ApiOkResponse({ type: TemplateExportDto })
  export(@Param('id', ParseIntPipe) id: number): Promise<TemplateExportDto> {
    return this.service.export(id);
  }

  @Patch(':id')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'แก้ไข Template (Version เพิ่มขึ้นทุกครั้ง) — ทำได้ตอน Draft/Active/Inactive',
  })
  @ApiOkResponse({ type: TemplateDetailDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบ Template (soft delete) — ลบไม่ได้ถ้ายังมี workflow ที่ทำงานอยู่' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.remove(id, user);
  }

  @Post(':id/copy')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'คัดลอก Template เป็น Draft ใหม่ (รวมขั้นตอนและเส้นเชื่อม)' })
  @ApiCreatedResponse({ type: TemplateDetailDto })
  copy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CopyTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.copy(id, dto, user);
  }

  // ── วงจรสถานะ ─────────────────────────────────────────────

  @Post(':id/submit')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ส่ง Template (Draft) เข้าสู่การอนุมัติ — ต้องผ่านการตรวจผัง' })
  @ApiOkResponse({ type: TemplateDetailDto })
  submit(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.submitForApproval(id, user);
  }

  @Post(':id/approve')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'อนุมัติ Template ที่รออนุมัติ → Active — Admin' })
  @ApiOkResponse({ type: TemplateDetailDto })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ปฏิเสธ Template ที่รออนุมัติ → กลับเป็น Draft พร้อมเหตุผล — Admin' })
  @ApiOkResponse({ type: TemplateDetailDto })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.reject(id, dto, user);
  }

  @Post(':id/publish')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'เผยแพร่ Template ตรง (ข้ามการอนุมัติ) จาก Draft/Inactive → Active — Admin',
  })
  @ApiOkResponse({ type: TemplateDetailDto })
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.publish(id, user);
  }

  @Post(':id/deactivate')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ปิดใช้งาน Template (Active → Inactive) — ไม่กระทบ workflow ที่ทำงานอยู่',
  })
  @ApiOkResponse({ type: TemplateDetailDto })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DisableTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.deactivate(id, dto, user);
  }

  @Post(':id/deprecate')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ยกเลิกเวอร์ชัน Template (Active/Inactive → Deprecated, สิ้นสุด) — Admin',
  })
  @ApiOkResponse({ type: TemplateDetailDto })
  deprecate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DisableTemplateDto,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.service.deprecate(id, dto, user);
  }

  // ── ผัง: step / connection ────────────────────────────────

  @Get(':id/validation')
  @ApiOperation({
    summary:
      'ตรวจผังของ Template (มี Start/End, ไม่มีขั้นตอนลอย, เดินจาก Start ถึง End ได้, ผู้รับผิดชอบใช้ได้)',
  })
  @ApiOkResponse({ type: GraphValidationDto })
  validate(@Param('id', ParseIntPipe) id: number): Promise<GraphValidationDto> {
    return this.structure.validateById(id);
  }

  @Post(':id/sync-steps')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'สร้างแถวขั้นตอน/เส้นเชื่อมใหม่ทั้งชุดจาก TemplateDefinition (เฉพาะ Draft)',
  })
  @ApiOkResponse({ type: TemplateStructureDto })
  sync(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<TemplateStructureDto> {
    return this.structure.syncFromDefinition(id, user);
  }

  @Get(':id/steps')
  @ApiOperation({ summary: 'ขั้นตอน (step) ของ Template' })
  @ApiOkResponse({ type: [StepDto] })
  steps(@Param('id', ParseIntPipe) id: number): Promise<StepDto[]> {
    return this.structure.listSteps(id);
  }

  @Post(':id/steps')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'เพิ่มขั้นตอน (เฉพาะ Template ที่เป็น Draft)' })
  @ApiCreatedResponse({ type: StepDto })
  createStep(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStepDto,
    @CurrentUser() user: UserContext,
  ): Promise<StepDto> {
    return this.structure.createStep(id, dto, user);
  }

  @Patch(':id/steps/:stepId')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้ขั้นตอน (เฉพาะ Template ที่เป็น Draft)' })
  @ApiOkResponse({ type: StepDto })
  updateStep(
    @Param('id', ParseIntPipe) id: number,
    @Param('stepId', ParseIntPipe) stepId: number,
    @Body() dto: UpdateStepDto,
    @CurrentUser() user: UserContext,
  ): Promise<StepDto> {
    return this.structure.updateStep(id, stepId, dto, user);
  }

  @Delete(':id/steps/:stepId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบขั้นตอนพร้อมเส้นเชื่อมที่เกี่ยวข้อง (soft delete, เฉพาะ Draft)' })
  deleteStep(
    @Param('id', ParseIntPipe) id: number,
    @Param('stepId', ParseIntPipe) stepId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.structure.deleteStep(id, stepId, user);
  }

  @Get(':id/connections')
  @ApiOperation({ summary: 'เส้นเชื่อม (connection) ระหว่างขั้นตอนของ Template' })
  @ApiOkResponse({ type: [ConnectionDto] })
  connections(@Param('id', ParseIntPipe) id: number): Promise<ConnectionDto[]> {
    return this.structure.listConnections(id);
  }

  @Post(':id/connections')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'เพิ่มเส้นเชื่อม (เฉพาะ Template ที่เป็น Draft)' })
  @ApiCreatedResponse({ type: ConnectionDto })
  createConnection(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateConnectionDto,
    @CurrentUser() user: UserContext,
  ): Promise<ConnectionDto> {
    return this.structure.createConnection(id, dto, user);
  }

  @Patch(':id/connections/:connectionId')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้เส้นเชื่อม (เฉพาะ Template ที่เป็น Draft)' })
  @ApiOkResponse({ type: ConnectionDto })
  updateConnection(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectionId', ParseIntPipe) connectionId: number,
    @Body() dto: UpdateConnectionDto,
    @CurrentUser() user: UserContext,
  ): Promise<ConnectionDto> {
    return this.structure.updateConnection(id, connectionId, dto, user);
  }

  @Delete(':id/connections/:connectionId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบเส้นเชื่อม (soft delete, เฉพาะ Draft)' })
  deleteConnection(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectionId', ParseIntPipe) connectionId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.structure.deleteConnection(id, connectionId, user);
  }
}
