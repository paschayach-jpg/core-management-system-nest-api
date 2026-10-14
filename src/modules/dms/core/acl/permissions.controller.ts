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
import { AppRole } from '../../../../common/constants/enums';
import { CurrentUser, MinRole } from '../../../../common/decorators/auth.decorators';
import type { UserContext } from '../../../../common/interfaces/user-context';
import {
  MyFolderPermissionsDto,
  PermissionDto,
  PermissionListQueryDto,
  PropagateResultDto,
  RevokePermissionQueryDto,
  SetFilePermissionDto,
  SetPermissionDto,
} from './dto/acl.dto';
import { FilePermissionsService } from './file-permissions.service';
import { FolderPermissionsService } from './folder-permissions.service';

@ApiTags('DMS')
@ApiBearerAuth()
@Controller('dms')
export class PermissionsController {
  constructor(
    private readonly folderPerms: FolderPermissionsService,
    private readonly filePerms: FilePermissionsService,
  ) {}

  // ── โฟลเดอร์ ───────────────────────────────────────────────

  @Get('folders/:id/permissions')
  @ApiOperation({
    summary:
      'ดู ACL ของโฟลเดอร์ (Manager+ หรือผู้มีสิทธิ์ Modify) — includeHistory=true รวมรายการที่ถูกเพิกถอน',
  })
  @ApiOkResponse({ type: [PermissionDto] })
  listFolder(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: PermissionListQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<PermissionDto[]> {
    return this.folderPerms.list(user, id, q.includeHistory === true);
  }

  @Get('folders/:id/my-permissions')
  @ApiOperation({ summary: 'สิทธิ์ของฉันบนโฟลเดอร์นี้ (ACL + Authority)' })
  @ApiOkResponse({ type: MyFolderPermissionsDto })
  mine(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<MyFolderPermissionsDto> {
    return this.folderPerms.mine(user, id);
  }

  @Put('folders/:id/permissions')
  @MinRole(AppRole.Manager)
  @ApiOperation({
    summary:
      'ตั้งสิทธิ์โฟลเดอร์ให้ User/Role/แผนก/ฝ่าย — Manager+ (รายการเดิมของ principal+IsDeny เดียวกันถูกเพิกถอนแล้วสร้างใหม่)',
  })
  @ApiOkResponse({ type: PermissionDto })
  setFolder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetPermissionDto,
    @CurrentUser() user: UserContext,
  ): Promise<PermissionDto> {
    return this.folderPerms.set(user, id, dto);
  }

  @Delete('folders/:id/permissions/:permissionId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เพิกถอนสิทธิ์โฟลเดอร์ — Manager+' })
  revokeFolder(
    @Param('id', ParseIntPipe) id: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
    @Query() q: RevokePermissionQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.folderPerms.revoke(user, id, permissionId, q.reason);
  }

  @Post('folders/:id/permissions/propagate')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'กระจายสิทธิ์ของโฟลเดอร์ลงไฟล์ทุกไฟล์ในโฟลเดอร์ (เพิกถอนสิทธิ์ระดับไฟล์เดิมก่อน) — Manager+',
  })
  @ApiOkResponse({ type: PropagateResultDto })
  propagate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UserContext,
  ): Promise<PropagateResultDto> {
    return this.folderPerms.propagateToFiles(user, id);
  }

  // ── ไฟล์ ───────────────────────────────────────────────────

  @Get('files/:id/permissions')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'ดูสิทธิ์ระดับไฟล์ — Manager+' })
  @ApiOkResponse({ type: [PermissionDto] })
  listFile(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: PermissionListQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<PermissionDto[]> {
    return this.filePerms.list(user, id, q.includeHistory === true);
  }

  @Put('files/:id/permissions')
  @MinRole(AppRole.Manager)
  @ApiOperation({ summary: 'ตั้งสิทธิ์ระดับไฟล์ (รวม canDownload) — Manager+' })
  @ApiOkResponse({ type: PermissionDto })
  setFile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetFilePermissionDto,
    @CurrentUser() user: UserContext,
  ): Promise<PermissionDto> {
    return this.filePerms.set(user, id, dto);
  }

  @Delete('files/:id/permissions/:permissionId')
  @MinRole(AppRole.Manager)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เพิกถอนสิทธิ์ระดับไฟล์ — Manager+' })
  revokeFile(
    @Param('id', ParseIntPipe) id: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
    @Query() q: RevokePermissionQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    return this.filePerms.revoke(user, id, permissionId, q.reason);
  }
}
