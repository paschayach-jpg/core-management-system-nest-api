import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import { Paginated, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { CurrentUser } from '../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../common/interfaces/user-context';
import { Notification } from '../entities/notification.entity';
import { NotificationsService } from './notifications.service';

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'การแจ้งเตือนของฉัน (ใหม่สุดก่อน)' })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiPaginatedResponse(Notification)
  list(
    @CurrentUser() user: UserContext,
    @Query() query: PaginationQueryDto,
    @Query('unreadOnly') unreadOnly?: string,
  ): Promise<Paginated<Notification>> {
    return this.service.listMine(user.userId, query, unreadOnly === 'true' || unreadOnly === '1');
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'จำนวนที่ยังไม่ได้อ่าน' })
  async unreadCount(@CurrentUser() user: UserContext): Promise<{ count: number }> {
    return { count: await this.service.unreadCount(user.userId) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ทำเครื่องหมายอ่านทั้งหมด' })
  async readAll(@CurrentUser() user: UserContext): Promise<{ updated: number }> {
    return { updated: await this.service.markAllRead(user.userId) };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ทำเครื่องหมายอ่านแล้ว' })
  markRead(@CurrentUser() user: UserContext, @Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.markRead(user.userId, id);
  }
}
