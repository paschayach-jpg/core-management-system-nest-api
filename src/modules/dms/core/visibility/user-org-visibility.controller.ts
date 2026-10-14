import {
  Body,
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
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../../common/interfaces/user-context';
import {
  HiddenOrgUnitsDto,
  OrgVisibilityDto,
  SaveHiddenOrgUnitsDto,
  UserOrgVisibilityDetailDto,
} from './dto/visibility.dto';
import { UserOrgVisibilityService } from './user-org-visibility.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms/org-visibility')
export class UserOrgVisibilityController {
  constructor(private readonly service: UserOrgVisibilityService) {}

  @Get('me')
  @ApiOperation({ summary: 'ผังหน่วยงานที่ฉันมองเห็น (พร้อมธงว่าฉันซ่อนหน่วยงานไหนไว้)' })
  @ApiOkResponse({ type: OrgVisibilityDto })
  mine(@CurrentUser() user: UserContext): Promise<OrgVisibilityDto> {
    return this.service.visibleHierarchy(user);
  }

  @Get('me/hidden')
  @ApiOperation({ summary: 'หน่วยงานที่ฉันซ่อนไว้ในมุมมองของตัวเอง' })
  @ApiOkResponse({ type: HiddenOrgUnitsDto })
  async myHidden(@CurrentUser() user: UserContext): Promise<HiddenOrgUnitsDto> {
    return { orgUnitIds: await this.service.getHiddenOrgUnitIds(user.userId) };
  }

  @Put('me/hidden')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'บันทึกรายการหน่วยงานที่ซ่อนในมุมมองของฉัน (แทนที่ทั้งชุด)' })
  saveMyHidden(
    @Body() dto: SaveHiddenOrgUnitsDto,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.service.saveHiddenOrgUnitIds(user.userId, dto.orgUnitIds, user);
  }

  @Get('users/:userId')
  @MinRole(AppRole.Admin)
  @ApiOperation({
    summary: 'รายละเอียดการมองเห็นหน่วยงานของผู้ใช้ (grant + ผังที่เห็นจริง) — Admin',
  })
  @ApiOkResponse({ type: UserOrgVisibilityDetailDto })
  detail(@Param('userId', ParseIntPipe) userId: number): Promise<UserOrgVisibilityDetailDto> {
    return this.service.detailFor(userId);
  }

  @Put('users/:userId/org-units/:orgUnitId')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Grant การมองเห็นหน่วยงานให้ผู้ใช้ — Admin (มี grant แล้วผู้ใช้เห็นเฉพาะหน่วยงานที่ grant ไม่ใช้กฎตามบทบาท)',
  })
  grant(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('orgUnitId', ParseIntPipe) orgUnitId: number,
    @CurrentUser() caller: UserContext,
  ): Promise<void> {
    return this.service.grant(userId, orgUnitId, caller);
  }

  @Delete('users/:userId/org-units/:orgUnitId')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'เพิกถอนการมองเห็นหน่วยงาน — Admin (ไม่มี grant เหลือ = กลับไปใช้กฎตามบทบาท)',
  })
  revoke(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('orgUnitId', ParseIntPipe) orgUnitId: number,
    @CurrentUser() caller: UserContext,
  ): Promise<void> {
    return this.service.revoke(userId, orgUnitId, caller);
  }

  @Get('users/:userId/hidden')
  @MinRole(AppRole.Admin)
  @ApiOperation({ summary: 'หน่วยงานที่ผู้ใช้ซ่อนไว้ — Admin' })
  @ApiOkResponse({ type: HiddenOrgUnitsDto })
  async hidden(@Param('userId', ParseIntPipe) userId: number): Promise<HiddenOrgUnitsDto> {
    return { orgUnitIds: await this.service.getHiddenOrgUnitIds(userId) };
  }

  @Put('users/:userId/hidden')
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ตั้งรายการหน่วยงานที่ซ่อนให้ผู้ใช้ (แทนที่ทั้งชุด) — Admin' })
  saveHidden(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: SaveHiddenOrgUnitsDto,
    @CurrentUser() caller: UserContext,
  ): Promise<void> {
    return this.service.saveHiddenOrgUnitIds(userId, dto.orgUnitIds, caller);
  }
}
