import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import type { Paginated } from '../../../common/dto/pagination.dto';
import { ProjectAuditQueryDto, ProjectAuditRowDto } from './dto/project-audit.dto';
import { ProjectAuditService } from './project-audit.service';

// อ่าน audit ของ RGP (RGP.t_project_audit_log) — Manager ขึ้นไป (มีชื่อเครื่อง/ผู้ใช้ที่กระทำ)

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp')
export class ProjectAuditController {
  constructor(private readonly service: ProjectAuditService) {}

  @Get('audit')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'ค้นบันทึก audit ของ RGP (แบ่งหน้า ใหม่สุดก่อน) — Manager ขึ้นไป' })
  @ApiPaginatedResponse(ProjectAuditRowDto)
  query(@Query() q: ProjectAuditQueryDto): Promise<Paginated<ProjectAuditRowDto>> {
    return this.service.query(q);
  }

  @Get('projects/:projectId/audit')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'บันทึก audit ของโครงการ (รวมขั้นตอนและ Task ของโครงการ) — Manager ขึ้นไป',
  })
  @ApiPaginatedResponse(ProjectAuditRowDto)
  byProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() q: ProjectAuditQueryDto,
  ): Promise<Paginated<ProjectAuditRowDto>> {
    return this.service.query(Object.assign(new ProjectAuditQueryDto(), q, { projectId }));
  }
}
