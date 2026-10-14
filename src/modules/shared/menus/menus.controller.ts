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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuNodeDto, MenuStatisticsDto, ReorderMenusDto, UpsertMenuDto } from './dto/menu.dto';
import { MenusService } from './menus.service';

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('menus')
export class MenusController {
  constructor(private readonly service: MenusService) {}

  @Get()
  @ApiOperation({ summary: 'เมนูที่ฉันเห็น (ต้นไม้ กรองตามบทบาท)' })
  @ApiOkResponse({ type: [MenuNodeDto] })
  mine(@CurrentUser() user: UserContext): Promise<MenuNodeDto[]> {
    return this.service.treeFor(user);
  }

  @Get('manage')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'เมนูทั้งหมดรวมที่ปิดอยู่ (หน้าจัดการ) — Admin' })
  @ApiOkResponse({ type: [MenuNodeDto] })
  manage(): Promise<MenuNodeDto[]> {
    return this.service.treeForManagement();
  }

  @Get('statistics')
  @ApiOperation({ summary: 'สถิติเมนู (จำนวนทั้งหมด/ใช้งาน/ตามบทบาท) — Admin' })
  @MinRole(AppRole.Admin)
  @ApiOkResponse({ type: MenuStatisticsDto })
  statistics(): Promise<MenuStatisticsDto> {
    return this.service.statistics();
  }

  @Get('key-available')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'ตรวจว่า menuKey ยังไม่ถูกใช้' })
  async keyAvailable(
    @Query('menuKey') menuKey: string,
    @Query('excludeId') excludeId?: string,
  ): Promise<{ available: boolean }> {
    return {
      available: await this.service.isKeyUnique(menuKey, excludeId ? Number(excludeId) : undefined),
    };
  }

  @Post()
  @ApiOperation({ summary: 'สร้างเมนู — Admin' })
  @MinRole(AppRole.Admin)
  create(@Body() dto: UpsertMenuDto, @CurrentUser() admin: UserContext): Promise<MenuItem> {
    return this.service.create(dto, admin);
  }

  @Post('reorder')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'จัดลำดับเมนูหลายรายการพร้อมกัน' })
  reorder(@Body() dto: ReorderMenusDto, @CurrentUser() admin: UserContext): Promise<void> {
    return this.service.reorder(dto.items, admin);
  }

  @Put(':id')
  @ApiOperation({ summary: 'แก้ไขเมนู (ส่งค่าทั้งก้อน) — Admin' })
  @MinRole(AppRole.Admin)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertMenuDto,
    @CurrentUser() admin: UserContext,
  ): Promise<MenuItem> {
    return this.service.update(id, dto, admin);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบเมนู — Admin' })
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }
}
