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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CreateDocDto, ProjectDocDto, UpdateDocDto, UpdateDocStatusDto } from './dto/document.dto';
import { ProjectDocumentsService } from './project-documents.service';

// เอกสารใน workflow ของโครงการ — ทุกคนที่ login ใช้ได้ (ระบบเดิมไม่จำกัดสิทธิ์)

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp')
export class ProjectDocumentsController {
  constructor(private readonly service: ProjectDocumentsService) {}

  @Get('projects/:projectId/documents')
  @ApiOperation({ summary: 'เอกสารของโครงการทุกขั้นตอน (เรียงตามลำดับขั้นตอน/เอกสาร)' })
  @ApiOkResponse({ type: [ProjectDocDto] })
  listByProject(@Param('projectId', ParseIntPipe) projectId: number): Promise<ProjectDocDto[]> {
    return this.service.listByProject(projectId);
  }

  @Get('states/:stateId/documents')
  @ApiOperation({ summary: 'เอกสารของขั้นตอน' })
  @ApiOkResponse({ type: [ProjectDocDto] })
  listByState(@Param('stateId', ParseIntPipe) stateId: number): Promise<ProjectDocDto[]> {
    return this.service.listByState(stateId);
  }

  @Post('states/:stateId/documents')
  @ApiOperation({ summary: 'เพิ่มเอกสารต่อท้ายขั้นตอน (สถานะเริ่ม Pending)' })
  @ApiOkResponse({ type: ProjectDocDto })
  create(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Body() dto: CreateDocDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectDocDto> {
    return this.service.create(stateId, dto, user);
  }

  @Get('documents/:docWfId')
  @ApiOperation({ summary: 'รายละเอียดเอกสารใน workflow' })
  @ApiOkResponse({ type: ProjectDocDto })
  get(@Param('docWfId', ParseIntPipe) docWfId: number): Promise<ProjectDocDto> {
    return this.service.get(docWfId);
  }

  @Patch('documents/:docWfId')
  @ApiOperation({ summary: 'แก้ไขเอกสาร (ชื่อ/ประเภท/จำเป็น/สถานะ/หมายเหตุ/ลำดับ/ย้ายขั้นตอน)' })
  @ApiOkResponse({ type: ProjectDocDto })
  update(
    @Param('docWfId', ParseIntPipe) docWfId: number,
    @Body() dto: UpdateDocDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectDocDto> {
    return this.service.update(docWfId, dto, user);
  }

  @Patch('documents/:docWfId/status')
  @ApiOperation({ summary: 'เปลี่ยนสถานะเอกสาร (Pending/Received/Verified/Rejected)' })
  @ApiOkResponse({ type: ProjectDocDto })
  updateStatus(
    @Param('docWfId', ParseIntPipe) docWfId: number,
    @Body() dto: UpdateDocStatusDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectDocDto> {
    return this.service.updateStatus(docWfId, dto, user);
  }

  @Delete('documents/:docWfId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบเอกสารออกจาก workflow (ลบจริง)' })
  remove(@Param('docWfId', ParseIntPipe) docWfId: number): Promise<void> {
    return this.service.remove(docWfId);
  }
}
