import { Body, Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { SetSystemConfigDto } from './dto/system-config.dto';
import { SystemConfigItem, SystemConfigService } from './system-config.service';

@ApiTags('Shared')
@ApiBearerAuth()
@MinRole(AppRole.Admin)
@Controller('system-config')
export class SystemConfigController {
  constructor(private readonly service: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: 'รายการค่าตั้งระบบ (ค่าที่เป็นความลับถูกปกปิด) — Admin' })
  list(): Promise<SystemConfigItem[]> {
    return this.service.list();
  }

  @Get(':key')
  @ApiOperation({ summary: 'ค่าตั้งระบบตาม key — Admin' })
  async get(@Param('key') key: string): Promise<SystemConfigItem> {
    const item = await this.service.getItem(key);
    if (!item) throw new NotFoundException(`ไม่พบค่าตั้ง ${key}`);
    return item;
  }

  @Put(':key')
  @ApiOperation({ summary: 'สร้าง/แก้ค่าตั้งระบบ (upsert) — Admin' })
  set(
    @Param('key') key: string,
    @Body() dto: SetSystemConfigDto,
    @CurrentUser() user: UserContext,
  ): Promise<SystemConfigItem> {
    return this.service.set(key, dto.value, user);
  }
}
