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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  CreateCommentDto,
  CreateTaskDto,
  TaskCommentDto,
  TaskDto,
  TaskListQueryDto,
  TaskStatusLogDto,
  TaskStatusResultDto,
  TaskTreeItemDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';
import { ProjectTasksService } from './project-tasks.service';

// Task และ comment — ทุกคนที่ login ใช้ได้ (ระบบเดิมไม่จำกัดสิทธิ์) · ลบ comment ได้เฉพาะของตัวเอง (ตรวจใน service)

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp')
export class ProjectTasksController {
  constructor(private readonly service: ProjectTasksService) {}

  @Get('projects/:projectId/tasks')
  @ApiOperation({
    summary: 'Task ทั้งหมดของโครงการแบบต้นไม้ (รวม sub task ทุกระดับ) สำหรับ Kanban/Dashboard',
  })
  @ApiOkResponse({ type: [TaskTreeItemDto] })
  listByProject(@Param('projectId', ParseIntPipe) projectId: number): Promise<TaskTreeItemDto[]> {
    return this.service.listByProject(projectId);
  }

  @Get('states/:stateId/tasks')
  @ApiOperation({
    summary: 'Task หลักของขั้นตอน (ไม่รวม sub task) · includeDeleted=true รวมที่ถูกลบ',
  })
  @ApiOkResponse({ type: [TaskDto] })
  listByState(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Query() q: TaskListQueryDto,
  ): Promise<TaskDto[]> {
    return this.service.listByState(stateId, q.includeDeleted ?? false);
  }

  @Post('states/:stateId/tasks')
  @ApiOperation({
    summary:
      'สร้าง Task ในขั้นตอน (ส่ง parentTaskId = สร้าง sub task) — รหัส Task ออกอัตโนมัติ (TK)',
  })
  @ApiOkResponse({ type: TaskDto })
  create(
    @Param('stateId', ParseIntPipe) stateId: number,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: UserContext,
  ): Promise<TaskDto> {
    return this.service.create(stateId, dto, user);
  }

  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'รายละเอียด Task' })
  @ApiOkResponse({ type: TaskDto })
  get(@Param('taskId', ParseIntPipe) taskId: number): Promise<TaskDto> {
    return this.service.get(taskId);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({ summary: 'แก้ไขรายละเอียด Task (ไม่รวมสถานะ/%)' })
  @ApiOkResponse({ type: TaskDto })
  update(
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: UserContext,
  ): Promise<TaskDto> {
    return this.service.update(taskId, dto, user);
  }

  @Patch('tasks/:taskId/status')
  @ApiOperation({
    summary:
      'เปลี่ยนสถานะ/% ของ Task (OnHold ตรึง % เดิม) → sync % ของขั้นตอนจากค่าเฉลี่ย Task → คำนวณสถานะโครงการ',
  })
  @ApiOkResponse({ type: TaskStatusResultDto })
  updateStatus(
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: UserContext,
  ): Promise<TaskStatusResultDto> {
    return this.service.updateStatus(taskId, dto, user);
  }

  @Delete('tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบ Task (soft delete → ถังขยะ 30 วัน)' })
  remove(
    @Param('taskId', ParseIntPipe) taskId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.remove(taskId, user);
  }

  @Get('tasks/:taskId/status-log')
  @ApiOperation({ summary: 'ประวัติการเปลี่ยนสถานะของ Task (ใหม่สุดก่อน)' })
  @ApiOkResponse({ type: [TaskStatusLogDto] })
  statusLog(@Param('taskId', ParseIntPipe) taskId: number): Promise<TaskStatusLogDto[]> {
    return this.service.statusLog(taskId);
  }

  // ── Comment ────────────────────────────────────────────────

  @Get('tasks/:taskId/comments')
  @ApiOperation({ summary: 'Comment ของ Task (เก่าสุดก่อน, ตอบกลับซ้อนได้ 3 ระดับ)' })
  @ApiOkResponse({ type: [TaskCommentDto] })
  listComments(@Param('taskId', ParseIntPipe) taskId: number): Promise<TaskCommentDto[]> {
    return this.service.listComments(taskId);
  }

  @Post('tasks/:taskId/comments')
  @ApiOperation({ summary: 'เพิ่ม comment หรือตอบกลับ comment เดิม' })
  @ApiOkResponse({ type: TaskCommentDto })
  addComment(
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: UserContext,
  ): Promise<TaskCommentDto> {
    return this.service.addComment(taskId, dto, user);
  }

  @Delete('task-comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบ comment (soft delete) — เฉพาะ comment ของตัวเอง' })
  deleteComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.deleteComment(commentId, user);
  }
}
