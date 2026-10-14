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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import { Paginated } from '../../../common/dto/pagination.dto';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import type { UserContext } from '../../../common/interfaces/user-context';
import { DelegateTaskDto, DelegationDto, DelegationListQueryDto } from './dto/delegation.dto';
import { WorkflowDelegationsService } from './delegation.service';

/** การมอบหมายงาน — ทุกคนที่ login (ตรวจความเป็นผู้รับผิดชอบ/ผู้มอบ/ผู้รับใน service) */
@ApiTags('WFE')
@ApiBearerAuth()
@Controller('wfe/delegations')
export class WorkflowDelegationsController {
  constructor(private readonly service: WorkflowDelegationsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'การมอบหมายของฉัน (ที่มอบให้ผู้อื่น / ที่ได้รับมอบ) แบ่งหน้า' })
  @ApiPaginatedResponse(DelegationDto)
  mine(
    @Query() q: DelegationListQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<Paginated<DelegationDto>> {
    return this.service.mine(q, user);
  }

  @Get('step-instances/:stepInstanceId')
  @ApiOperation({ summary: 'ประวัติการมอบหมายของงาน (step instance) เรียงตามระดับ' })
  @ApiOkResponse({ type: [DelegationDto] })
  history(
    @Param('stepInstanceId', ParseIntPipe) stepInstanceId: number,
    @CurrentUser() user: UserContext,
  ): Promise<DelegationDto[]> {
    return this.service.history(stepInstanceId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดการมอบหมาย' })
  @ApiOkResponse({ type: DelegationDto })
  get(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<DelegationDto> {
    return this.service.get(id, user);
  }

  @Post()
  @ApiOperation({
    summary:
      'มอบหมายงานต่อให้ผู้อื่น (สูงสุด 3 ระดับ, ห้ามมอบให้ตัวเอง/วนกลับ, step ต้องอนุญาตให้มอบหมาย)',
  })
  @ApiCreatedResponse({ type: DelegationDto })
  delegate(@Body() dto: DelegateTaskDto, @CurrentUser() user: UserContext): Promise<DelegationDto> {
    return this.service.delegate(dto, user);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'คืนงานให้ผู้มอบหมาย — เฉพาะผู้รับมอบ' })
  @ApiOkResponse({ type: DelegationDto })
  returnTask(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<DelegationDto> {
    return this.service.returnTask(id, user);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ยกเลิกการมอบหมาย งานกลับไปอยู่กับผู้มอบ — ผู้มอบหรือ Manager ขึ้นไป' })
  @ApiOkResponse({ type: DelegationDto })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<DelegationDto> {
    return this.service.deactivate(id, user);
  }
}
