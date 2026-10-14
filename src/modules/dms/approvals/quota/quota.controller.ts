import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../../common/dto/paginated-response';
import type { Paginated } from '../../../../common/dto/pagination.dto';
import type { UserContext } from '../../../../common/interfaces/user-context';
import {
  OrgQuotaUsageDto,
  QuotaRemarkDto,
  QuotaRequestDto,
  QuotaRequestListQueryDto,
  QuotaUnitDto,
  QuotaUnitParamDto,
  SetQuotaDto,
  SubmitQuotaRequestDto,
} from './dto/quota.dto';
import { QuotaService } from './quota.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms/quota')
export class QuotaController {
  constructor(private readonly service: QuotaService) {}

  @Get()
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary:
      'โควตาและการใช้พื้นที่ของทุกหน่วยงาน (SubCommittee/Division/Department; ขนาดรวมลำดับชั้น) พร้อมระดับ Normal/Warning/Critical/Full',
  })
  @ApiOkResponse({ type: [QuotaUnitDto] })
  list(): Promise<QuotaUnitDto[]> {
    return this.service.list();
  }

  @Get('org-units/:orgUnitId/usage')
  @ApiOperation({
    summary: 'การใช้พื้นที่ของหน่วยงาน (EMS.OrgUnit) ตามที่ใช้บังคับโควตาตอนสร้างโฟลเดอร์/อัปโหลด',
  })
  @ApiOkResponse({ type: OrgQuotaUsageDto })
  usage(@Param('orgUnitId', ParseIntPipe) orgUnitId: number): Promise<OrgQuotaUsageDto> {
    return this.service.usageForOrgUnit(orgUnitId);
  }

  // ── คำขอเพิ่มโควตา (ต้องมาก่อน :unitType/:unitId) ───────────

  @Post('requests')
  @ApiOperation({ summary: 'ยื่นคำขอเพิ่มโควตา (ต้องมากกว่าปัจจุบัน และต้องมีเหตุผล)' })
  @ApiOkResponse({ type: QuotaRequestDto })
  submit(
    @Body() dto: SubmitQuotaRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<QuotaRequestDto> {
    return this.service.submitRequest(dto, user);
  }

  @Get('requests/mine')
  @ApiOperation({ summary: 'คำขอเพิ่มโควตาของฉัน' })
  @ApiPaginatedResponse(QuotaRequestDto)
  mine(
    @CurrentUser() user: UserContext,
    @Query() q: QuotaRequestListQueryDto,
  ): Promise<Paginated<QuotaRequestDto>> {
    return this.service.listMyRequests(user, q);
  }

  @Get('requests')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'คำขอเพิ่มโควตาทั้งหมด (กรองสถานะ/หน่วยงานได้) — Manager ขึ้นไป' })
  @ApiPaginatedResponse(QuotaRequestDto)
  requests(@Query() q: QuotaRequestListQueryDto): Promise<Paginated<QuotaRequestDto>> {
    return this.service.listRequests(q);
  }

  @Post('requests/:id/approve')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'อนุมัติคำขอเพิ่มโควตา — Admin (ตั้ง quota_size ในครั้งเดียวกัน)' })
  @ApiOkResponse({ type: QuotaRequestDto })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuotaRemarkDto,
    @CurrentUser() user: UserContext,
  ): Promise<QuotaRequestDto> {
    return this.service.approveRequest(id, dto.remark, user);
  }

  @Post('requests/:id/reject')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ปฏิเสธคำขอเพิ่มโควตา (ต้องมีเหตุผล) — Admin' })
  @ApiOkResponse({ type: QuotaRequestDto })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuotaRemarkDto,
    @CurrentUser() user: UserContext,
  ): Promise<QuotaRequestDto> {
    return this.service.rejectRequest(id, dto.remark, user);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ยกเลิกคำขอของตนเองที่ยังรออนุมัติ' })
  @ApiOkResponse({ type: QuotaRequestDto })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<QuotaRequestDto> {
    return this.service.cancelRequest(id, user);
  }

  // ── ตั้งค่าโควตา (Admin) ─────────────────────────────────

  @Put(':unitType/:unitId')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'ตั้งโควตา (quota_size) ของหน่วยงานหลัก — Admin' })
  @ApiOkResponse({ type: QuotaUnitDto })
  set(
    @Param() p: QuotaUnitParamDto,
    @Body() dto: SetQuotaDto,
    @CurrentUser() user: UserContext,
  ): Promise<QuotaUnitDto> {
    return this.service.setQuota(p.unitType, p.unitId, dto.quotaBytes, user);
  }

  @Delete(':unitType/:unitId')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'ลบการตั้งโควตา (ตั้งเป็น 0 = ไม่จำกัด) — Admin' })
  @ApiOkResponse({ type: QuotaUnitDto })
  clear(@Param() p: QuotaUnitParamDto, @CurrentUser() user: UserContext): Promise<QuotaUnitDto> {
    return this.service.clearQuota(p.unitType, p.unitId, user);
  }
}
