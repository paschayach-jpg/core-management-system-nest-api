import { Injectable } from '@nestjs/common';
import { AppRole } from '../../../../common/constants/enums';
import {
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../../database/transaction-runner.service';
import { FolderAccess } from '../access/folder-access';
import { FilesService } from '../files/files.service';
import { FoldersService } from '../folders/folders.service';
import { AclRepository } from './acl.repository';
import { PermissionDto, SetFilePermissionDto, toPermissionDto } from './dto/acl.dto';
import { normalizePermission } from './folder-permissions.service';

/**
 * สิทธิ์ระดับไฟล์ (security.FilePermission) — พอร์ตจาก FilePermissionService
 * Manager ขึ้นไปเท่านั้นที่ตั้ง/เพิกถอน · ตั้งสิทธิ์ = เพิกถอนรายการเดิมของ principal+file+IsDeny เดียวกันแล้วเพิ่มใหม่
 * สิทธิ์ระดับไฟล์ "ทับ" สิทธิ์โฟลเดอร์สำหรับผู้ที่มี entry ตรงกับตน (ดู rules/file-acl.rules.ts)
 */
@Injectable()
export class FilePermissionsService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'FilePermission';

  constructor(
    crudLog: CrudLogService,
    private readonly acl: AclRepository,
    private readonly files: FilesService,
    private readonly folders: FoldersService,
    private readonly access: FolderAccess,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  private assertManager(user: UserContext, what: string): void {
    if (user.appRole < AppRole.Manager) {
      throw new PermissionDeniedException(
        `${what}ต้องมีสิทธิ์ Manager หรือ Admin`,
        'ROLE_REQUIRED',
      );
    }
  }

  async list(user: UserContext, fileId: number, includeHistory: boolean): Promise<PermissionDto[]> {
    this.assertManager(user, 'การดูสิทธิ์ระดับไฟล์');
    const file = await this.files.requireActive(fileId);
    await this.access.assertView(user, await this.folders.require(file.folderId));
    const rows = await this.acl.listFilePermissions(fileId, includeHistory);
    return rows.map((r) => toPermissionDto(r));
  }

  set(user: UserContext, fileId: number, dto: SetFilePermissionDto): Promise<PermissionDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'SET_FILE_PERMISSION',
        recordId: fileId,
        meta: {
          principalType: dto.principalType,
          principalId: dto.principalId,
          isDeny: dto.isDeny === true,
        },
      },
      async () => {
        this.assertManager(user, 'การตั้งสิทธิ์ระดับไฟล์');
        const file = await this.files.requireActive(fileId);
        await this.access.assertView(user, await this.folders.require(file.folderId));
        const perm = {
          ...normalizePermission(dto, user.userId),
          canDownload: dto.canDownload === true,
        };
        if (!(await this.acl.principalExists(perm.principalType, perm.principalId))) {
          throw new ResourceNotFoundException(
            `ผู้ถือสิทธิ์ (ประเภท ${perm.principalType})`,
            perm.principalId,
          );
        }
        return this.tx.run(async (s) => {
          const old = await this.acl.findActiveFileEntryIds(
            fileId,
            perm.principalType,
            perm.principalId,
            perm.isDeny,
            s,
          );
          for (const id of old) {
            await this.acl.revokeFilePermission(id, user.userId, 'แทนที่ด้วยรายการสิทธิ์ใหม่', s);
          }
          const newId = await this.acl.insertFilePermission(fileId, perm, s);
          const row = await this.acl.getFilePermission(newId);
          if (!row) throw new ResourceNotFoundException('FilePermission', newId);
          return toPermissionDto(row);
        });
      },
      (r) => ({ after: r }),
    );
  }

  revoke(
    user: UserContext,
    fileId: number,
    filePermissionId: number,
    reason?: string,
  ): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'REVOKE_FILE_PERMISSION',
        recordId: filePermissionId,
        meta: { fileId },
        captureBefore: () => this.acl.getFilePermission(filePermissionId),
      },
      async () => {
        this.assertManager(user, 'การเพิกถอนสิทธิ์ระดับไฟล์');
        const row = await this.acl.getFilePermission(filePermissionId);
        if (!row || row.targetId !== fileId) {
          throw new ResourceNotFoundException('FilePermission', filePermissionId);
        }
        if (row.revokedDate) {
          throw new ConflictBusinessException(
            'สิทธิ์นี้ถูกเพิกถอนไปแล้ว',
            'PERMISSION_ALREADY_REVOKED',
          );
        }
        await this.acl.revokeFilePermission(
          filePermissionId,
          user.userId,
          reason?.trim() || 'ยกเลิกโดยผู้ดูแลระบบ',
        );
      },
    );
  }
}
