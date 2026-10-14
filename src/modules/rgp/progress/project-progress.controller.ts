import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  ProgressHistoryDto,
  ProgressResultDto,
  ProjectProgressOverviewDto,
  UpdateProgressDto,
} from './dto/progress.dto';
import { ProjectProgressService } from './project-progress.service';

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp')
export class ProjectProgressController {
  constructor(private readonly service: ProjectProgressService) {}

  @Get('projects/:projectId/progress')
  @ApiOperation({ summary: 'ความคืบหน้าล่าสุดต่อขั้นตอน + % รวมของโครงการ' })
  @ApiOkResponse({ type: ProjectProgressOverviewDto })
  overview(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<ProjectProgressOverviewDto> {
    return this.service.overview(projectId);
  }

  @Get('states/:stateId/progress')
  @ApiOperation({ summary: 'ประวัติความคืบหน้าของขั้นตอน (ใหม่สุดก่อน)' })
  @ApiOkResponse({ type: [ProgressHistoryDto] })
  history(@Param('stateId', ParseIntPipe) stateId: number): Promise<ProgressHistoryDto[]> {
    return this.service.history(stateId);
  }

  @Post('states/:stateId/progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'บันทึกความคืบหน้าของขั้นตอน → ตั้งสถานะขั้นตอนตาม % → คำนวณสถานะโครงการใหม่',
  })
  @ApiOkResponse({ type: ProgressResultDto })
  update(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Body() dto: UpdateProgressDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProgressResultDto> {
    return this.service.update(stateId, dto, user);
  }
}
