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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import {
  CreateUserDto,
  UpdateUserDto,
  UserListQueryDto,
  UserLookupDto,
  UserLookupQueryDto,
  UserSummaryDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('lookup')
  @ApiOperation({ summary: 'ค้นผู้ใช้เพื่อเลือก (หน้าแชร์/อนุมัติ) — ทุกคนที่ login ใช้ได้' })
  @ApiOkResponse({ type: [UserLookupDto] })
  lookup(@Query() q: UserLookupQueryDto): Promise<UserLookupDto[]> {
    return this.service.lookup(q.q, q.limit);
  }

  @Get('positions')
  @ApiOperation({ summary: 'ตำแหน่งที่มีผู้ใช้อยู่ในแผนก' })
  @ApiQuery({ name: 'departmentCode', required: true })
  @MinRole(AppRole.Manager)
  positions(@Query('departmentCode') departmentCode: string): Promise<string[]> {
    return this.service.positionsByDepartment(departmentCode);
  }

  @Get()
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary: 'รายการผู้ใช้ (Manager/Admin) — กรองตาม role/หน่วยงาน/สถานะ, ค้นด้วย q',
  })
  @ApiPaginatedResponse(UserSummaryDto)
  list(@Query() q: UserListQueryDto): Promise<Paginated<UserSummaryDto>> {
    return this.service.list(q);
  }

  @Get(':id')
  @MinRole(AppRole.Manager)
  @ApiOkResponse({ type: UserSummaryDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<UserSummaryDto> {
    return this.service.get(id);
  }

  @Post()
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'เพิ่มบัญชีผู้ใช้ — Admin' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: UserContext): Promise<UserSummaryDto> {
    return this.service.create(dto, actor);
  }

  @Patch(':id')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'แก้ชื่อ/อีเมล/บทบาท/หน่วยงาน/สถานะ — Admin' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: UserContext,
  ): Promise<UserSummaryDto> {
    return this.service.update(id, dto, actor);
  }

  @Delete(':id')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ปิดการใช้งานบัญชี (ไม่ลบข้อมูล) — Admin' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: UserContext,
  ): Promise<void> {
    return this.service.deactivate(id, actor);
  }
}
