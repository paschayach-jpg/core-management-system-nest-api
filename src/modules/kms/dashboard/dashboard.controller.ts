import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import {
  KbDashboardStatsDto,
  KbMonthlyArticleDto,
  KbTopArticleDto,
  MonthsQueryDto,
  TopQueryDto,
} from './dto/dashboard.dto';

@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'ตัวเลขสรุป KMS: จำนวนบทความตามสถานะ/ประเภท, ใกล้หมดอายุ, เลยกำหนดทบทวน, ยอดอ่านสะสม',
  })
  @ApiOkResponse({ type: KbDashboardStatsDto })
  stats(): Promise<KbDashboardStatsDto> {
    return this.service.stats();
  }

  @Get('monthly')
  @ApiOperation({
    summary: 'จำนวนบทความที่สร้างต่อเดือน (เติม 0 ให้เดือนที่ไม่มี) — ค่าเริ่มต้น 12 เดือน',
  })
  @ApiOkResponse({ type: [KbMonthlyArticleDto] })
  monthly(@Query() q: MonthsQueryDto): Promise<KbMonthlyArticleDto[]> {
    return this.service.monthly(q.months ?? 12);
  }

  @Get('top')
  @ApiOperation({ summary: 'บทความ Published ที่มียอดเปิดอ่านสูงสุด — ค่าเริ่มต้น 10 รายการ' })
  @ApiOkResponse({ type: [KbTopArticleDto] })
  top(@Query() q: TopQueryDto): Promise<KbTopArticleDto[]> {
    return this.service.top(q.limit ?? 10);
  }
}
