import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../../common/dto/paginated-response';
import { Paginated, PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalDetailDto,
  ApprovalRequestDto,
  ApprovalResultDto,
  ApprovalStepDto,
  ApproveDto,
  DownloadApprovalDto,
  DownloadLookupQueryDto,
  MyRequestsQueryDto,
  RejectDto,
  SubmitDownloadRequestDto,
  SubmitPermissionRequestDto,
} from './dto/approvals.dto';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms/approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  // ── รายการ ──────────────────────────────────────────────

  @Get('pending')
  @ApiOperation({
    summary:
      'คำขอที่รอฉันอนุมัติ (แบ่งหน้า) — มี step ของฉัน, Admin เห็น CREATE_HC ทั้งหมด, Manager/Admin เห็น DELETE_FOLDER ที่ยังค้าง',
  })
  @ApiPaginatedResponse(ApprovalRequestDto)
  pending(
    @CurrentUser() user: UserContext,
    @Query() q: PaginationQueryDto,
  ): Promise<Paginated<ApprovalRequestDto>> {
    return this.service.listPending(user, q);
  }

  @Get('mine')
  @ApiOperation({ summary: 'คำขอที่ฉันยื่น (กรองตามสถานะได้)' })
  @ApiPaginatedResponse(ApprovalRequestDto)
  mine(
    @CurrentUser() user: UserContext,
    @Query() q: MyRequestsQueryDto,
  ): Promise<Paginated<ApprovalRequestDto>> {
    return this.service.listMine(user, q);
  }

  @Get('by-folder/:folderId')
  @ApiOperation({ summary: 'คำขอทุกสถานะที่ผูกกับโฟลเดอร์ (ต้องมีสิทธิ์ Read บนโฟลเดอร์)' })
  @ApiPaginatedResponse(ApprovalRequestDto)
  byFolder(
    @Param('folderId', ParseIntPipe) folderId: number,
    @CurrentUser() user: UserContext,
    @Query() q: PaginationQueryDto,
  ): Promise<Paginated<ApprovalRequestDto>> {
    return this.service.listByFolder(folderId, user, q);
  }

  // ── คำขอดาวน์โหลด ───────────────────────────────────────

  @Post('download-requests')
  @ApiOperation({ summary: 'ขออนุมัติดาวน์โหลดไฟล์ (ทุก role; ต้องมีเหตุผลและผู้อนุมัติ)' })
  @ApiOkResponse({ type: ApprovalRequestDto })
  submitDownload(
    @Body() dto: SubmitDownloadRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalRequestDto> {
    return this.service.submitDownloadRequest(dto, user);
  }

  @Get('download-requests/approved')
  @ApiOperation({ summary: 'มีคำขอดาวน์โหลดไฟล์นี้ที่อนุมัติแล้วและยังไม่ได้ใช้สิทธิ์หรือไม่' })
  @ApiOkResponse({ type: DownloadApprovalDto })
  async findApprovedDownload(
    @Query() q: DownloadLookupQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<DownloadApprovalDto> {
    const ref = await this.service.findApprovedDownload(user, q.fileId);
    return {
      available: ref !== null,
      requestId: ref?.requestId ?? null,
      requestStatus: ref?.requestStatus ?? null,
    };
  }

  @Post('download-requests/:id/consume')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ใช้สิทธิ์ดาวน์โหลดจากคำขอที่อนุมัติแล้ว (ใช้ได้ครั้งเดียว เฉพาะผู้ขอ)',
  })
  consume(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.consumeDownload(user, id);
  }

  // ── ยื่น / ถอน ─────────────────────────────────────────

  @Post()
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'ยื่นคำขอเปลี่ยนสิทธิ์โฟลเดอร์ HC/SC พร้อมผู้อนุมัติเรียงตามลำดับ — Manager/Admin',
  })
  @ApiOkResponse({ type: ApprovalRequestDto })
  submit(
    @Body() dto: SubmitPermissionRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalRequestDto> {
    return this.service.submitPermissionRequest(dto, user);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ถอนคำขอของตนเองที่ยัง Pending (สถานะ 4 เหมือนระบบเดิม)' })
  @ApiOkResponse({ type: ApprovalResultDto })
  withdraw(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalResultDto> {
    return this.service.withdraw(id, user);
  }

  // ── ลงมติ ──────────────────────────────────────────────

  @Post('steps/:stepId/approve')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'อนุมัติ step — ผลข้างเคียงตามชนิดคำขอทำใน transaction เดียว ล้มเหลว = rollback ทั้งก้อน',
  })
  @ApiOkResponse({ type: ApprovalResultDto })
  approveStep(
    @Param('stepId', ParseIntPipe) stepId: number,
    @Body() dto: ApproveDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalResultDto> {
    return this.service.approveStep(stepId, dto.remark, user);
  }

  @Post('steps/:stepId/reject')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ปฏิเสธ step (ต้องมีเหตุผล) — คำขอเป็น Rejected ทันที' })
  @ApiOkResponse({ type: ApprovalResultDto })
  rejectStep(
    @Param('stepId', ParseIntPipe) stepId: number,
    @Body() dto: RejectDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalResultDto> {
    return this.service.rejectStep(stepId, dto.reason, user);
  }

  @Post(':id/approve')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'อนุมัติคำขอ (ระบบเลือก step ของผู้ใช้ให้ตามลำดับเดียวกับ Approval Inbox เดิม)',
  })
  @ApiOkResponse({ type: ApprovalResultDto })
  approveRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalResultDto> {
    return this.service.approveRequest(id, dto.remark, user);
  }

  @Post(':id/reject')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ปฏิเสธคำขอ (ระบบเลือก step ของผู้ใช้ให้; ต้องมีเหตุผล)' })
  @ApiOkResponse({ type: ApprovalResultDto })
  rejectRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalResultDto> {
    return this.service.rejectRequest(id, dto.reason, user);
  }

  // ── รายละเอียด ─────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'รายละเอียดคำขอ + step ล่าสุด (ผู้ขอ, Manager ขึ้นไป หรือผู้ที่มี step)',
  })
  @ApiOkResponse({ type: ApprovalDetailDto })
  detail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalDetailDto> {
    return this.service.get(id, user);
  }

  @Get(':id/steps')
  @ApiOperation({
    summary: 'step ของคำขอ (แบ่งหน้า เรียงตามลำดับ — คำขอเก่าบางรายการมี step นับพัน)',
  })
  @ApiPaginatedResponse(ApprovalStepDto)
  steps(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
    @Query() q: PaginationQueryDto,
  ): Promise<Paginated<ApprovalStepDto>> {
    return this.service.listSteps(id, user, q);
  }
}
