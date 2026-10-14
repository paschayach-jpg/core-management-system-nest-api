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
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../../common/interfaces/user-context';
import {
  ApprovalRefDto,
  ChangeConfidentialityDto,
  CopyFolderStructureDto,
  CopyStructureResultDto,
  CreateFolderDto,
  CreateFolderResultDto,
  FolderDetailDto,
  FolderDto,
  FolderListQueryDto,
  FolderStatsDto,
  MoveFolderDto,
  RenameFolderDto,
  RequestFolderDeleteDto,
} from './dto/folder.dto';
import { FoldersService } from './folders.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms/folders')
export class FoldersController {
  constructor(private readonly service: FoldersService) {}

  @Get()
  @ApiOperation({
    summary:
      'รายการโฟลเดอร์ (flat) ที่ฉันมองเห็นและมีสิทธิ์ดู — กรองตามการมองเห็นหน่วยงาน (UserOrgVisibility) + สิทธิ์ดู (Authority/ACL)',
  })
  @ApiOkResponse({ type: [FolderDto] })
  list(@Query() q: FolderListQueryDto, @CurrentUser() user: UserContext): Promise<FolderDto[]> {
    return this.service.listAccessible(user, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดโฟลเดอร์ พร้อมเส้นทางจาก Root' })
  @ApiOkResponse({ type: FolderDetailDto })
  get(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<FolderDetailDto> {
    return this.service.get(user, id);
  }

  @Get(':id/children')
  @ApiOperation({ summary: 'โฟลเดอร์ย่อยชั้นถัดไป (เฉพาะที่ฉันเห็นได้)' })
  @ApiOkResponse({ type: [FolderDto] })
  children(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<FolderDto[]> {
    return this.service.children(user, id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'สถิติโฟลเดอร์ (จำนวนไฟล์/ขนาด นับสดจากไฟล์ที่ยังใช้งาน)' })
  @ApiOkResponse({ type: FolderStatsDto })
  stats(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<FolderStatsDto> {
    return this.service.stats(user, id);
  }

  @Post()
  @ApiOperation({
    summary:
      'สร้างโฟลเดอร์ — สร้างเสร็จ 201 · Root 1HC ต้องผ่านอนุมัติ CREATE_HC จึงตอบ 202 พร้อมเลขคำขอ (created=false)',
  })
  @ApiCreatedResponse({ type: CreateFolderResultDto })
  @ApiAcceptedResponse({ type: CreateFolderResultDto, description: 'ส่งคำขออนุมัติแล้ว (1HC)' })
  async create(
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: UserContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateFolderResultDto> {
    const result = await this.service.create(user, dto);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.ACCEPTED);
    return result;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'เปลี่ยนชื่อโฟลเดอร์ (เปลี่ยนชื่อ Root หลักไม่ได้)' })
  @ApiOkResponse({ type: FolderDto })
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenameFolderDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderDto> {
    return this.service.rename(user, id, dto.name);
  }

  @Put(':id/parent')
  @MinRole(AppRole.SrOfficer)
  @ApiOperation({
    summary:
      'ย้ายโฟลเดอร์ไปไว้ใต้โฟลเดอร์ปลายทาง — SrOfficer ขึ้นไป (ต้องมีสิทธิ์ทั้งต้นทาง/ปลายทาง, ลึกไม่เกิน 10, ชื่อไม่ซ้ำ)',
  })
  @ApiOkResponse({ type: FolderDto })
  move(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveFolderDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderDto> {
    return this.service.move(user, id, dto.destinationParentFolderId);
  }

  @Post(':id/copy-structure')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'คัดลอกโครงสร้างโฟลเดอร์ (เฉพาะโฟลเดอร์ ไม่รวมไฟล์) — Manager ขึ้นไป' })
  @ApiCreatedResponse({ type: CopyStructureResultDto })
  copyStructure(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CopyFolderStructureDto,
    @CurrentUser() user: UserContext,
  ): Promise<CopyStructureResultDto> {
    return this.service.copyStructure(user, id, dto.destinationParentFolderId);
  }

  @Put(':id/confidentiality')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary:
      'เปลี่ยนชั้นความลับ (BR-001-07: เฉพาะโฟลเดอร์ใต้ Conf-Root โดยตรง; ย้ายไปอยู่ใต้ Root ของชั้นใหม่) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: FolderDto })
  changeConfidentiality(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeConfidentialityDto,
    @CurrentUser() user: UserContext,
  ): Promise<FolderDto> {
    return this.service.changeConfidentiality(user, id, dto.confidentialityLevel);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ลบโฟลเดอร์ทั้งต้นไม้ย่อยลงถังขยะ (soft delete, กู้คืนได้ 30 วัน) — ถ้ามีไฟล์ตอบ 409 FOLDER_HAS_FILES ให้ยื่น POST /dms/folders/:id/delete-requests',
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.remove(user, id);
  }

  @Post(':id/delete-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'ยื่นคำขออนุมัติลบโฟลเดอร์ที่มีไฟล์ (DELETE_FOLDER) — ผู้อนุมัติคือ Admin',
  })
  @ApiAcceptedResponse({ type: ApprovalRefDto })
  requestDelete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequestFolderDeleteDto,
    @CurrentUser() user: UserContext,
  ): Promise<ApprovalRefDto> {
    return this.service.requestDelete(user, id, dto);
  }
}
