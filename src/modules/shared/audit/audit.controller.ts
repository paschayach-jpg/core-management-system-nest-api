import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { MinRole } from '../../../common/decorators/auth.decorators';
import { Paginated } from '../../../common/dto/pagination.dto';
import { AuditLogRow, AuditLogsService } from './audit.service';
import { AuditQueryDto } from './dto/audit.dto';

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly service: AuditLogsService) {}

  @Get()
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'ค้นบันทึก audit (Manager/Admin) — แบ่งหน้า ใหม่สุดก่อน' })
  query(@Query() q: AuditQueryDto): Promise<Paginated<AuditLogRow>> {
    return this.service.query(q);
  }

  @Get('workflow-instances/:instanceId')
  @ApiOperation({ summary: 'ประวัติ audit ของ workflow instance (สำหรับหน้ารายละเอียด workflow)' })
  byWorkflowInstance(
    @Param('instanceId', ParseIntPipe) instanceId: number,
  ): Promise<AuditLogRow[]> {
    return this.service.byWorkflowInstance(instanceId);
  }
}
