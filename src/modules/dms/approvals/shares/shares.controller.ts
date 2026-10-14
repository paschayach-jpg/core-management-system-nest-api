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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../../common/dto/paginated-response';
import { Paginated, PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import type { UserContext } from '../../../../common/interfaces/user-context';
import {
  CreateExternalShareDto,
  CreateInternalShareDto,
  ExternalShareDto,
  ExternalShareListQueryDto,
  ExternalShareReasonDto,
  FolderShareRequestResultDto,
  InternalShareDto,
  InternalShareListQueryDto,
  InternalShareResultDto,
  RequestFolderShareDto,
  ShareAccessLogDto,
} from './dto/shares.dto';
import { SharesService } from './shares.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms/shares')
export class SharesController {
  constructor(private readonly service: SharesService) {}

  // ── แชร์ภายใน ───────────────────────────────────────────

  @Post('internal')
  @ApiOperation({
    summary:
      'แชร์ไฟล์ภายใน — ผู้แชร์ Officer/SrOfficer หรือแชร์ให้แผนกต้องผ่านอนุมัติ, นอกนั้นมีผลทันที (อายุไม่เกิน 1 ปี)',
  })
  @ApiOkResponse({ type: InternalShareResultDto })
  createInternal(
    @Body() dto: CreateInternalShareDto,
    @CurrentUser() user: UserContext,
  ): Promise<InternalShareResultDto> {
    return this.service.createInternalShare(dto, user);
  }

  @Post('internal/folders')
  @ApiOperation({
    summary: 'ขออนุมัติแชร์สิทธิ์โฟลเดอร์ให้ผู้อื่น (ส่งคำขอ CHANGE_PERMISSION ให้ Manager)',
  })
  @ApiOkResponse({ type: FolderShareRequestResultDto })
  requestFolderShare(
    @Body() dto: RequestFolderShareDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderShareRequestResultDto> {
    return this.service.requestFolderShareApproval(dto, user);
  }

  @Get('internal/mine')
  @ApiOperation({ summary: 'รายการแชร์ภายในที่ฉันเป็นผู้ให้สิทธิ์ (ที่ยังไม่ถูกยกเลิก)' })
  @ApiPaginatedResponse(InternalShareDto)
  myInternal(
    @CurrentUser() user: UserContext,
    @Query() q: PaginationQueryDto,
  ): Promise<Paginated<InternalShareDto>> {
    return this.service.listMyInternal(user, q);
  }

  @Get('internal')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'รายการแชร์ภายในทั้งหมด — Admin' })
  @ApiPaginatedResponse(InternalShareDto)
  allInternal(
    @CurrentUser() user: UserContext,
    @Query() q: InternalShareListQueryDto,
  ): Promise<Paginated<InternalShareDto>> {
    return this.service.listAllInternal(user, q);
  }

  @Delete('internal/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ยกเลิกการแชร์ภายใน — ผู้แชร์เดิมหรือ Admin' })
  revokeInternal(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.revokeInternalShare(id, user);
  }

  // ── แชร์ภายนอก ──────────────────────────────────────────

  @Post('external')
  @ApiOperation({
    summary:
      'สร้างลิงก์แชร์ภายนอก (ไฟล์หรือโฟลเดอร์; ห้าม HC; ไม่เกิน 90 วัน) — สถานะ Pending จนกว่า Manager อนุมัติ',
  })
  @ApiOkResponse({ type: ExternalShareDto })
  createExternal(
    @Body() dto: CreateExternalShareDto,
    @CurrentUser() user: UserContext,
  ): Promise<ExternalShareDto> {
    return this.service.createExternalShare(dto, user);
  }

  @Get('external/mine')
  @ApiOperation({ summary: 'ลิงก์แชร์ภายนอกของฉัน' })
  @ApiPaginatedResponse(ExternalShareDto)
  myExternal(
    @CurrentUser() user: UserContext,
    @Query() q: ExternalShareListQueryDto,
  ): Promise<Paginated<ExternalShareDto>> {
    return this.service.listMyExternal(user, q);
  }

  @Get('external')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'ลิงก์แชร์ภายนอกทั้งหมด — Admin (token เห็นเฉพาะของตัวเอง)' })
  @ApiPaginatedResponse(ExternalShareDto)
  allExternal(
    @CurrentUser() user: UserContext,
    @Query() q: ExternalShareListQueryDto,
  ): Promise<Paginated<ExternalShareDto>> {
    return this.service.listAllExternal(user, q);
  }

  @Get('external/:id')
  @ApiOperation({ summary: 'รายละเอียดลิงก์แชร์ภายนอก — เจ้าของหรือ Manager ขึ้นไป' })
  @ApiOkResponse({ type: ExternalShareDto })
  getExternal(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ExternalShareDto> {
    return this.service.getExternal(id, user);
  }

  @Post('external/:id/approve')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'อนุมัติลิงก์แชร์ภายนอกที่ Pending (ผู้แชร์อนุมัติของตัวเองไม่ได้ ยกเว้น Admin)',
  })
  @ApiOkResponse({ type: ExternalShareDto })
  approveExternal(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ExternalShareDto> {
    return this.service.approveExternalShare(id, user);
  }

  @Post('external/:id/reject')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ปฏิเสธลิงก์แชร์ภายนอกที่ Pending (ต้องมีเหตุผล)' })
  @ApiOkResponse({ type: ExternalShareDto })
  rejectExternal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExternalShareReasonDto,
    @CurrentUser() user: UserContext,
  ): Promise<ExternalShareDto> {
    return this.service.rejectExternalShare(id, dto.reason, user);
  }

  @Post('external/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ยกเลิกลิงก์แชร์ภายนอกถาวร — เจ้าของลิงก์หรือ Admin (ต้องมีเหตุผล)' })
  @ApiOkResponse({ type: ExternalShareDto })
  revokeExternal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExternalShareReasonDto,
    @CurrentUser() user: UserContext,
  ): Promise<ExternalShareDto> {
    return this.service.revokeExternalShare(id, dto.reason, user);
  }

  @Post('external/:id/toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'เปิด/ปิดชั่วคราว (Active ↔ Disabled) — เจ้าของลิงก์หรือ Admin' })
  @ApiOkResponse({ type: ExternalShareDto })
  toggleExternal(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<ExternalShareDto> {
    return this.service.toggleExternalShare(id, user);
  }

  @Get('external/:id/access-log')
  @ApiOperation({ summary: 'ประวัติการเข้าถึงลิงก์ — เจ้าของลิงก์หรือ Admin' })
  @ApiPaginatedResponse(ShareAccessLogDto)
  accessLog(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
    @Query() q: PaginationQueryDto,
  ): Promise<Paginated<ShareAccessLogDto>> {
    return this.service.listAccessLog(id, user, q);
  }
}
