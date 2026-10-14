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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole, Confidentiality } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { OrgUnitRelationship } from '../entities/org-unit-relationship.entity';
import {
  CreateOrgUnitDto,
  DeleteOrgUnitQueryDto,
  LinkDivisionDto,
  MoveOrgUnitDto,
  OrgUnitDto,
  OrgUnitListQueryDto,
  UpdateOrgUnitDto,
} from './dto/org-unit.dto';
import { OrgUnitsService } from './org-units.service';

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('org-units')
export class OrgUnitsController {
  constructor(private readonly service: OrgUnitsService) {}

  @Get()
  @ApiOperation({
    summary:
      'ผังหน่วยงานทั้งหมด (flat เรียงตามประเภท/ลำดับ) — client ประกอบเป็นต้นไม้ด้วย parentOrgUnitId',
  })
  @ApiOkResponse({ type: [OrgUnitDto] })
  list(@Query() q: OrgUnitListQueryDto): Promise<OrgUnitDto[]> {
    return this.service.list(q);
  }

  @Get('relationships')
  @ApiOperation({ summary: 'ความสัมพันธ์ SubCommittee ↔ Division ที่ใช้งานอยู่' })
  relationships(): Promise<OrgUnitRelationship[]> {
    return this.service.relationships();
  }

  @Post('relationships')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เชื่อม Division เข้ากับ SubCommittee — Admin' })
  link(@Body() dto: LinkDivisionDto, @CurrentUser() user: UserContext): Promise<void> {
    return this.service.linkDivision(dto.divisionOrgUnitId, dto.subCommitteeOrgUnitId, user);
  }

  @Delete('relationships/:subCommitteeId/:divisionId')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ยกเลิกการเชื่อม Division กับ SubCommittee — Admin' })
  unlink(
    @Param('subCommitteeId', ParseIntPipe) subCommitteeId: number,
    @Param('divisionId', ParseIntPipe) divisionId: number,
  ): Promise<void> {
    return this.service.unlinkDivision(divisionId, subCommitteeId);
  }

  @Get('by-confidentiality/:level')
  @ApiOperation({ summary: 'หน่วยงานที่มีโฟลเดอร์ในระดับความลับที่ระบุ (1=HC … 4=PC)' })
  byConfidentiality(@Param('level', ParseIntPipe) level: Confidentiality): Promise<OrgUnitDto[]> {
    return this.service.byConfidentiality(level);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดหน่วยงาน' })
  @ApiOkResponse({ type: OrgUnitDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<OrgUnitDto> {
    return this.service.get(id);
  }

  @Get(':id/dependents')
  @ApiOperation({ summary: 'ยังมีโฟลเดอร์/ผู้ใช้ที่ใช้งานอยู่ภายใต้หน่วยงานนี้หรือไม่' })
  async dependents(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ hasActiveDependents: boolean }> {
    return { hasActiveDependents: await this.service.hasActiveDependents(id) };
  }

  @Post()
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'สร้างหน่วยงาน — Admin' })
  @ApiOkResponse({ type: OrgUnitDto })
  create(@Body() dto: CreateOrgUnitDto, @CurrentUser() user: UserContext): Promise<OrgUnitDto> {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'แก้ชื่อ/ลำดับหน่วยงาน — Admin' })
  @ApiOkResponse({ type: OrgUnitDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrgUnitDto,
  ): Promise<OrgUnitDto> {
    return this.service.update(id, dto);
  }

  @Put(':id/parent')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'ย้ายหน่วยงานไปอยู่ใต้ parent ใหม่ (ตรวจกฎระดับ) — Admin' })
  @ApiOkResponse({ type: OrgUnitDto })
  move(@Param('id', ParseIntPipe) id: number, @Body() dto: MoveOrgUnitDto): Promise<OrgUnitDto> {
    return this.service.move(id, dto.parentOrgUnitId ?? null);
  }

  @Delete(':id')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบหน่วยงาน (soft delete) — Admin · มี dependents ต้องใช้ ?force=true' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: DeleteOrgUnitQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.remove(id, user, q.force === true);
  }
}
