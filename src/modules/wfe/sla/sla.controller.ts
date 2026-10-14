import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { MinRole } from '../../../common/decorators/auth.decorators';
import { Paginated } from '../../../common/dto/pagination.dto';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import {
  SlaComplianceReportDto,
  SlaOverdueQueryDto,
  SlaOverdueRowDto,
  SlaRefreshResultDto,
  SlaReportQueryDto,
  SlaTaskDistributionQueryDto,
  SlaUserRowDto,
} from './dto/sla.dto';
import { WorkflowSlaService } from './sla.service';

/** รายงาน SLA ของ workflow — Manager ขึ้นไป · สั่งอัปเดตสถานะ SLA ทันที = Admin */
@ApiTags('WFE')
@ApiBearerAuth()
@Controller('wfe/sla')
export class WorkflowSlaController {
  constructor(private readonly service: WorkflowSlaService) {}

  @Get('compliance')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary:
      'รายงาน SLA ภาพรวม (สรุป, ตาม template, ผู้ที่เกินกำหนดมากสุด, แนวโน้มรายสัปดาห์, การกระจายระยะเวลา) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: SlaComplianceReportDto })
  compliance(@Query() q: SlaReportQueryDto): Promise<SlaComplianceReportDto> {
    return this.service.compliance(q);
  }

  @Get('task-distribution')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'การกระจายงานต่อผู้รับผิดชอบ (แบ่งหน้า) — Manager ขึ้นไป' })
  @ApiPaginatedResponse(SlaUserRowDto)
  taskDistribution(@Query() q: SlaTaskDistributionQueryDto): Promise<Paginated<SlaUserRowDto>> {
    return this.service.taskDistribution(q);
  }

  @Get('overdue')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary:
      'รายงานงานที่เลยกำหนด SLA แบบสด (step ที่ยังเปิดอยู่ของ workflow ที่กำลังดำเนินการ) — Manager ขึ้นไป',
  })
  @ApiPaginatedResponse(SlaOverdueRowDto)
  overdue(@Query() q: SlaOverdueQueryDto): Promise<Paginated<SlaOverdueRowDto>> {
    return this.service.overdue(q);
  }

  @Post('refresh')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'สั่งอัปเดตสถานะ SLA ของงานที่เปิดอยู่ทันที (escalation ทำเมื่อเปิด WorkflowEscalationEnabled) — Admin',
  })
  @ApiOkResponse({ type: SlaRefreshResultDto })
  refresh(): Promise<SlaRefreshResultDto> {
    return this.service.refreshNow();
  }
}
