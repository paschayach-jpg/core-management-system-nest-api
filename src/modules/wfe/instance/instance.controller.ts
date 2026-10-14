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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  CancelInstanceDto,
  CompleteStepDto,
  CompleteStepResultDto,
  CreateInstanceDto,
  DeleteInstanceQueryDto,
  InstanceDetailDto,
  InstanceHistoryDto,
  InstanceListQueryDto,
  InstanceSummaryDto,
  MyTasksQueryDto,
  RejectStepDto,
  StepInstanceDto,
  TaskDto,
} from './dto/instance.dto';
import { WorkflowInstancesService } from './instance.service';

/**
 * Workflow instance — ทุกคนที่ login สร้างจาก template ที่ Active ได้ · เห็นเฉพาะ instance ที่ตนเริ่ม/มี step (Manager ขึ้นไปเห็นทั้งหมด)
 * ระงับ/ทำต่อ/ยกเลิก: ผู้เริ่มหรือ Manager ขึ้นไป · ลบ (soft): Manager ขึ้นไป
 */
@ApiTags('WFE')
@ApiBearerAuth()
@Controller('wfe/instances')
export class WorkflowInstancesController {
  constructor(private readonly service: WorkflowInstancesService) {}

  @Get()
  @ApiOperation({
    summary: 'รายการ workflow instance (แบ่งหน้า, กรองตามสถานะ/template/ผู้เริ่ม/ช่วงวันที่)',
  })
  list(
    @Query() q: InstanceListQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<Paginated<InstanceSummaryDto>> {
    return this.service.list(q, user);
  }

  @Post()
  @ApiOperation({
    summary: 'เริ่ม workflow ใหม่จาก Template ที่ Active (สร้าง instance + step แรก)',
  })
  @ApiCreatedResponse({ type: InstanceDetailDto })
  create(
    @Body() dto: CreateInstanceDto,
    @CurrentUser() user: UserContext,
  ): Promise<InstanceDetailDto> {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียด instance พร้อมประวัติ step และการกระทำที่ทำได้' })
  @ApiOkResponse({ type: InstanceDetailDto })
  get(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<InstanceDetailDto> {
    return this.service.get(id, user);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'ประวัติ step ทั้งหมด + บันทึก audit ของ instance' })
  @ApiOkResponse({ type: InstanceHistoryDto })
  history(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<InstanceHistoryDto> {
    return this.service.history(id, user);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ระงับ workflow ที่กำลังดำเนินการ — ผู้เริ่มหรือ Manager ขึ้นไป' })
  @ApiOkResponse({ type: InstanceDetailDto })
  suspend(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<InstanceDetailDto> {
    return this.service.suspend(id, user);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ทำ workflow ที่ถูกระงับต่อ — ผู้เริ่มหรือ Manager ขึ้นไป' })
  @ApiOkResponse({ type: InstanceDetailDto })
  resume(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<InstanceDetailDto> {
    return this.service.resume(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ยกเลิก workflow (ปิด step ที่ค้างอยู่ทั้งหมด) — ผู้เริ่มหรือ Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: InstanceDetailDto })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelInstanceDto,
    @CurrentUser() user: UserContext,
  ): Promise<InstanceDetailDto> {
    return this.service.cancel(id, dto, user);
  }

  @Delete(':id')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบ workflow (soft delete) ที่จบแล้ว ต้องระบุเหตุผล — Manager ขึ้นไป' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: DeleteInstanceQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.remove(id, q.reason, user);
  }
}

@ApiTags('WFE')
@ApiBearerAuth()
@Controller('wfe/tasks')
export class WorkflowTasksController {
  constructor(private readonly service: WorkflowInstancesService) {}

  @Get('mine')
  @ApiOperation({
    summary:
      'งานของฉัน (แบ่งหน้า) — หนึ่งแถวต่อ workflow เลือกขั้นตอนที่ต้องทำก่อน เรียงตามกำหนดส่ง',
  })
  mine(@Query() q: MyTasksQueryDto, @CurrentUser() user: UserContext): Promise<Paginated<TaskDto>> {
    return this.service.myTasks(q, user);
  }
}

@ApiTags('WFE')
@ApiBearerAuth()
@Controller('wfe/step-instances')
export class WorkflowStepInstancesController {
  constructor(private readonly service: WorkflowInstancesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียด step instance (id = WFStepInstanceId)' })
  @ApiOkResponse({ type: StepInstanceDto })
  get(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<StepInstanceDto> {
    return this.service.getStepInstance(id, user);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'เริ่มทำงานในขั้นตอนที่ได้รับมอบหมาย (Pending → InProgress) — ผู้รับผิดชอบ',
  })
  @ApiOkResponse({ type: StepInstanceDto })
  start(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<StepInstanceDto> {
    return this.service.startStep(id, user);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ทำขั้นตอนให้เสร็จ แล้วไปขั้นตอนถัดไปตามเส้นเชื่อม/ปิด workflow — ผู้รับผิดชอบ',
  })
  @ApiOkResponse({ type: CompleteStepResultDto })
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteStepDto,
    @CurrentUser() user: UserContext,
  ): Promise<CompleteStepResultDto> {
    return this.service.completeStep(id, dto, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ปฏิเสธขั้นตอน — workflow ทั้งก้อนจบเป็น Rejected — ผู้รับผิดชอบ' })
  @ApiOkResponse({ type: StepInstanceDto })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectStepDto,
    @CurrentUser() user: UserContext,
  ): Promise<StepInstanceDto> {
    return this.service.rejectStep(id, dto, user);
  }
}
