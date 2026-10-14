import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { QuickAccessItemDto } from './dto/quick-access.dto';
import { QuickAccessService } from './quick-access.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms/quick-access')
export class QuickAccessController {
  constructor(private readonly service: QuickAccessService) {}

  @Get()
  @ApiOperation({ summary: 'ทางลัดโฟลเดอร์ของฉัน (ใหม่สุดก่อน)' })
  @ApiOkResponse({ type: [QuickAccessItemDto] })
  list(@CurrentUser() user: UserContext): Promise<QuickAccessItemDto[]> {
    return this.service.list(user);
  }

  @Put(':folderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เพิ่มโฟลเดอร์เข้าทางลัดของฉัน (ซ้ำถือว่าสำเร็จ)' })
  add(
    @Param('folderId', ParseIntPipe) folderId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.add(user, folderId);
  }

  @Delete(':folderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เอาโฟลเดอร์ออกจากทางลัดของฉัน' })
  remove(
    @Param('folderId', ParseIntPipe) folderId: number,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.remove(user, folderId);
  }
}
