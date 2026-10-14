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
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  AddMemberDto,
  CreateRoleDto,
  MemberRoleDto,
  ProjectMemberDto,
  RoleListQueryDto,
  UpdateRoleDto,
} from './dto/member.dto';
import { MemberRolesService } from './member-roles.service';
import { ProjectMembersService } from './project-members.service';

// บุคคลที่เกี่ยวข้องของโครงการ: ทุกคนที่ login ใช้ได้ · บทบาท (ข้อมูลหลัก): อ่านได้ทุกคน เขียน/ลบ = Manager ขึ้นไป

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp')
export class ProjectMembersController {
  constructor(private readonly service: ProjectMembersService) {}

  @Get('projects/:projectId/members')
  @ApiOperation({ summary: 'บุคคลที่เกี่ยวข้องของโครงการ' })
  @ApiOkResponse({ type: [ProjectMemberDto] })
  list(@Param('projectId', ParseIntPipe) projectId: number): Promise<ProjectMemberDto[]> {
    return this.service.listByProject(projectId);
  }

  @Post('projects/:projectId/members')
  @ApiOperation({
    summary:
      'เพิ่มบุคคลที่เกี่ยวข้อง (คณะกรรมการ/ฝ่าย/แผนก/พนักงาน) พร้อมบทบาท — ชื่ออ่านจากฐานข้อมูล ไม่เชื่อค่าจาก client',
  })
  @ApiOkResponse({ type: ProjectMemberDto })
  add(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: UserContext,
  ): Promise<ProjectMemberDto> {
    return this.service.add(projectId, dto, user);
  }

  @Delete('project-members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบบุคคลที่เกี่ยวข้องออกจากโครงการ' })
  remove(@Param('memberId', ParseIntPipe) memberId: number): Promise<void> {
    return this.service.remove(memberId);
  }
}

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp/member-roles')
export class MemberRolesController {
  constructor(private readonly service: MemberRolesService) {}

  @Get()
  @ApiOperation({ summary: 'บทบาทของบุคคลที่เกี่ยวข้อง (activeOnly=true สำหรับ dropdown)' })
  @ApiOkResponse({ type: [MemberRoleDto] })
  list(@Query() q: RoleListQueryDto): Promise<MemberRoleDto[]> {
    return this.service.list(q.activeOnly ?? false);
  }

  @Post()
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'เพิ่มบทบาท — Manager ขึ้นไป' })
  @ApiOkResponse({ type: MemberRoleDto })
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: UserContext): Promise<MemberRoleDto> {
    return this.service.create(dto, user);
  }

  @Patch(':roleId')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'แก้ไขชื่อ/เปิด-ปิดบทบาท — Manager ขึ้นไป' })
  @ApiOkResponse({ type: MemberRoleDto })
  update(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: UserContext,
  ): Promise<MemberRoleDto> {
    return this.service.update(roleId, dto, user);
  }

  @Delete(':roleId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ลบบทบาท (ลบจริง — สมาชิกที่บันทึกไปแล้วเก็บชื่อบทบาทเป็นข้อความ จึงไม่กระทบ) — Manager ขึ้นไป',
  })
  remove(@Param('roleId', ParseIntPipe) roleId: number): Promise<void> {
    return this.service.remove(roleId);
  }
}
