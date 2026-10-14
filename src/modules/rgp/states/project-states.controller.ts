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
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  AddStateMemberDto,
  CreateStateDto,
  DeleteStateQueryDto,
  EstimatedDaysDto,
  EstimatedDaysQueryDto,
  NotifyResultDto,
  ProjectStateDto,
  ReorderStatesDto,
  StateMemberDto,
  UpdateStateDto,
} from './dto/state.dto';
import { ProjectStatesService } from './project-states.service';
import { StateMembersService } from './state-members.service';
import { StateNotifyService } from './state-notify.service';

// ขั้นตอนของโครงการและผู้เกี่ยวข้องของขั้นตอน — ทุกคนที่ login ใช้ได้ (ระบบเดิมไม่จำกัดสิทธิ์)

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp')
export class ProjectStatesController {
  constructor(
    private readonly states: ProjectStatesService,
    private readonly members: StateMembersService,
    private readonly notify: StateNotifyService,
  ) {}

  @Get('projects/:projectId/states')
  @ApiOperation({ summary: 'ขั้นตอนของโครงการ พร้อม % ล่าสุดและโครงการอ้างอิง (เรียงตามลำดับ)' })
  @ApiOkResponse({ type: [ProjectStateDto] })
  list(@Param('projectId', ParseIntPipe) projectId: number): Promise<ProjectStateDto[]> {
    return this.states.listByProject(projectId);
  }

  @Post('projects/:projectId/states')
  @ApiOperation({ summary: 'เพิ่มขั้นตอนต่อท้ายโครงการ (สถานะเริ่ม Pending)' })
  @ApiOkResponse({ type: ProjectStateDto })
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateStateDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectStateDto> {
    return this.states.create(projectId, dto, user);
  }

  @Put('projects/:projectId/states/order')
  @ApiOperation({ summary: 'จัดลำดับขั้นตอนใหม่ (ส่งคู่ stateId/seqNo ทั้งชุด)' })
  @ApiOkResponse({ type: [ProjectStateDto] })
  reorder(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: ReorderStatesDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectStateDto[]> {
    return this.states.reorder(projectId, dto, user);
  }

  @Get('projects/:projectId/estimated-days')
  @ApiOperation({
    summary: 'วันคาดการณ์ที่ใช้ไป/เหลือของโครงการ (ไม่นับขั้นตอนที่ระบุใน excludeStateId)',
  })
  @ApiOkResponse({ type: EstimatedDaysDto })
  estimatedDays(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() q: EstimatedDaysQueryDto,
  ): Promise<EstimatedDaysDto> {
    return this.states.estimatedDays(projectId, q.excludeStateId ?? 0);
  }

  @Get('states/:stateId')
  @ApiOperation({ summary: 'รายละเอียดขั้นตอน' })
  @ApiOkResponse({ type: ProjectStateDto })
  get(@Param('stateId', ParseIntPipe) stateId: number): Promise<ProjectStateDto> {
    return this.states.get(stateId);
  }

  @Patch('states/:stateId')
  @ApiOperation({ summary: 'แก้ไขขั้นตอน (ชื่อ/ลำดับ/จำเป็นหรือไม่/จำนวนวัน/โครงการอ้างอิง)' })
  @ApiOkResponse({ type: ProjectStateDto })
  update(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Body() dto: UpdateStateDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectStateDto> {
    return this.states.update(stateId, dto, user);
  }

  @Delete('states/:stateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบขั้นตอน (ลบจริง) — บล็อกถ้ามีประวัติความคืบหน้า/Task อ้างอิง' })
  remove(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Query() q: DeleteStateQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.states.remove(stateId, user, q.cascade ?? false);
  }

  // ── ผู้เกี่ยวข้องของขั้นตอน ────────────────────────────────

  @Get('states/:stateId/members')
  @ApiOperation({ summary: 'ผู้เกี่ยวข้องของขั้นตอน พร้อมจำนวนครั้งที่ส่งแจ้งเตือน' })
  @ApiOkResponse({ type: [StateMemberDto] })
  listMembers(@Param('stateId', ParseIntPipe) stateId: number): Promise<StateMemberDto[]> {
    return this.members.listByState(stateId);
  }

  @Post('states/:stateId/members')
  @ApiOperation({ summary: 'เพิ่มผู้เกี่ยวข้องของขั้นตอน (เลือกจากบุคคลในโครงการ ห้ามซ้ำ)' })
  @ApiOkResponse({ type: StateMemberDto })
  addMember(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Body() dto: AddStateMemberDto,
    @CurrentUser() user: UserContext,
  ): Promise<StateMemberDto> {
    return this.members.add(stateId, dto.projectMemberId, user);
  }

  @Delete('state-members/:stateMemberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบผู้เกี่ยวข้องออกจากขั้นตอน (ลบไม่ได้ถ้าเคยส่งแจ้งเตือนแล้ว)' })
  removeMember(@Param('stateMemberId', ParseIntPipe) stateMemberId: number): Promise<void> {
    return this.members.remove(stateMemberId);
  }

  @Post('state-members/:stateMemberId/notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ส่งแจ้งเตือนผู้เกี่ยวข้อง (เฉพาะประเภทพนักงาน) พร้อมสร้าง/ใช้ Task ติดตามของขั้นตอน',
  })
  @ApiOkResponse({ type: NotifyResultDto })
  notifyMember(
    @Param('stateMemberId', ParseIntPipe) stateMemberId: number,
    @CurrentUser() user: UserContext,
  ): Promise<NotifyResultDto> {
    return this.notify.notify(stateMemberId, user);
  }
}
