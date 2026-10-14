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
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import type { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  CheckProjectNoQueryDto,
  CreateProjectDto,
  ProjectDetailDto,
  ProjectListQueryDto,
  ProjectNoCheckDto,
  ProjectStatusResultDto,
  ProjectSummaryDto,
  ReferenceCandidateDto,
  ReferenceCandidatesQueryDto,
  UpdateLegalDictDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { ProjectsService } from './projects.service';

// โครงการ: อ่าน/สร้าง/แก้ไขได้ทุกคนที่ login (ระบบเดิมไม่จำกัดสิทธิ์ใน RGP) · ลบ = ผู้สร้างหรือ Manager ขึ้นไป (ตรวจใน service) · ปิดโครงการ = Manager ขึ้นไป

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp/projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'ค้นหาโครงการ (แบ่งหน้า) พร้อมสรุปความคืบหน้า' })
  @ApiPaginatedResponse(ProjectSummaryDto)
  list(@Query() q: ProjectListQueryDto): Promise<Paginated<ProjectSummaryDto>> {
    return this.service.list(q);
  }

  @Get('check-no')
  @ApiOperation({ summary: 'ตรวจว่าเลขที่โครงการนี้มีผู้ใช้แล้วหรือไม่' })
  @ApiOkResponse({ type: ProjectNoCheckDto })
  checkNo(@Query() q: CheckProjectNoQueryDto): Promise<ProjectNoCheckDto> {
    return this.service.checkProjectNo(q.projectNo);
  }

  @Get('reference-candidates')
  @ApiOperation({ summary: 'โครงการที่เลือกเป็นโครงการอ้างอิงของขั้นตอนได้ (ยังไม่ Completed)' })
  @ApiOkResponse({ type: [ReferenceCandidateDto] })
  referenceCandidates(@Query() q: ReferenceCandidatesQueryDto): Promise<ReferenceCandidateDto[]> {
    return this.service.referenceCandidates(q.excludeProjectId ?? 0);
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'รายละเอียดโครงการ พร้อมขั้นตอน เอกสาร และบุคคลที่เกี่ยวข้อง' })
  @ApiOkResponse({ type: ProjectDetailDto })
  get(@Param('projectId', ParseIntPipe) projectId: number): Promise<ProjectDetailDto> {
    return this.service.getDetail(projectId);
  }

  @Post()
  @ApiOperation({
    summary:
      'สร้างโครงการ (สถานะ Open) พร้อมขั้นตอน/เอกสาร/บุคคลใน transaction เดียว — ไม่ระบุเลขที่ = ออกเลขอัตโนมัติ',
  })
  @ApiOkResponse({ type: ProjectDetailDto })
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectDetailDto> {
    return this.service.create(dto, user);
  }

  @Patch(':projectId')
  @ApiOperation({ summary: 'แก้ไขข้อมูลหัวโครงการ (ชื่อ/ประเภท/รายละเอียด/วันที่)' })
  @ApiOkResponse({ type: ProjectDetailDto })
  update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectDetailDto> {
    return this.service.update(projectId, dto, user);
  }

  @Put(':projectId/legal-dict')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'บันทึก JSON พจนานุกรมกฎหมาย (เฉพาะโครงการประเภทพจนานุกรมกฎหมาย)' })
  updateLegalDict(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateLegalDictDto,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.updateLegalDict(projectId, dto, user);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ลบโครงการ (soft delete) — บล็อกถ้ามีความคืบหน้าแล้ว · ผู้สร้างหรือ Manager ขึ้นไป',
  })
  remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.remove(projectId, user);
  }

  @Post(':projectId/close')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ปิดโครงการ → Completed (ต้องไม่มีขั้นตอนที่จำเป็นค้างอยู่) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: ProjectStatusResultDto })
  close(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectStatusResultDto> {
    return this.service.close(projectId, user);
  }

  @Post(':projectId/recalculate-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'คำนวณสถานะโครงการใหม่จากสถานะขั้นตอน (Open/InProgress/Completed)' })
  @ApiOkResponse({ type: ProjectStatusResultDto })
  recalculate(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectStatusResultDto> {
    return this.service.recalculateStatus(projectId, user);
  }
}
