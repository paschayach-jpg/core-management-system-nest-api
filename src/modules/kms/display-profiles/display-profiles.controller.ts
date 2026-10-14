import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { KMS_ROLE } from '../kms.constants';
import { DisplayProfilesService } from './display-profiles.service';
import {
  AssignProfileDto,
  DisplayProfileDetailDto,
  DisplayProfileDto,
  EffectiveDisplayDto,
  ProfileColumnDto,
  SaveProfileDto,
} from './dto/display-profile.dto';

@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/display-profiles')
export class DisplayProfilesController {
  constructor(private readonly service: DisplayProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Display Profile ทั้งหมด' })
  @ApiOkResponse({ type: [DisplayProfileDto] })
  list(): Promise<DisplayProfileDto[]> {
    return this.service.list();
  }

  @Get('slots')
  @ApiOperation({
    summary:
      'จุดแสดงผล (slot) คงที่ พร้อมป้ายและคำอธิบายเริ่มต้น — ใช้เป็นแบบฟอร์มสร้าง profile ใหม่',
  })
  @ApiOkResponse({ type: [ProfileColumnDto] })
  slots(): ProfileColumnDto[] {
    return this.service.slotCatalog();
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียด profile พร้อม grid ครบทุก slot' })
  @ApiOkResponse({ type: DisplayProfileDetailDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<DisplayProfileDetailDto> {
    return this.service.get(id);
  }

  @Get(':id/categories')
  @ApiOperation({ summary: 'หมวดที่ผูก profile นี้อยู่' })
  categories(@Param('id', ParseIntPipe) id: number) {
    return this.service.categoriesUsing(id);
  }

  @Post()
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({ summary: 'สร้าง profile พร้อมค่าของแต่ละ slot — Manager ขึ้นไป · ชื่อห้ามซ้ำ' })
  @ApiOkResponse({ type: DisplayProfileDetailDto })
  create(
    @Body() dto: SaveProfileDto,
    @CurrentUser() user: UserContext,
  ): Promise<DisplayProfileDetailDto> {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({ summary: 'แก้ profile (แทนที่ค่าของ slot ทั้งชุด) — Manager ขึ้นไป' })
  @ApiOkResponse({ type: DisplayProfileDetailDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveProfileDto,
    @CurrentUser() user: UserContext,
  ): Promise<DisplayProfileDetailDto> {
    return this.service.update(id, dto, user);
  }

  @Post(':id/deactivate')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({
    summary: 'ปิดใช้งาน profile (หมวดที่ผูกอยู่จะข้ามไปใช้ของหมวดแม่/ค่าเริ่มต้น) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: DisplayProfileDto })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<DisplayProfileDto> {
    return this.service.deactivate(id);
  }

  @Post(':id/activate')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({ summary: 'เปิดใช้งาน profile อีกครั้ง — Manager ขึ้นไป' })
  @ApiOkResponse({ type: DisplayProfileDto })
  activate(@Param('id', ParseIntPipe) id: number): Promise<DisplayProfileDto> {
    return this.service.activate(id);
  }
}

/** ผูก/ดูค่า Display Profile ของหมวด (อยู่ใต้ /kms/categories/:id) */
@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/categories/:id')
export class CategoryDisplayController {
  constructor(private readonly service: DisplayProfilesService) {}

  @Get('display-settings')
  @ApiOperation({
    summary:
      'ค่าแสดงผลที่มีผลจริงของหมวด (ป้ายหัวคอลัมน์/ซ่อน-แสดง ของแต่ละ slot) — สืบจากหมวดแม่ ข้าม profile ที่ปิดใช้งาน',
  })
  @ApiOkResponse({ type: EffectiveDisplayDto })
  effective(@Param('id', ParseIntPipe) id: number): Promise<EffectiveDisplayDto> {
    return this.service.effective(id);
  }

  @Put('display-profile')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({
    summary:
      'ผูก/ยกเลิกผูก Display Profile กับหมวด (profileId = null เพื่อยกเลิก) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: EffectiveDisplayDto })
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignProfileDto,
    @CurrentUser() user: UserContext,
  ): Promise<EffectiveDisplayDto> {
    return this.service.assignToCategory(id, dto.profileId ?? null, user);
  }
}
