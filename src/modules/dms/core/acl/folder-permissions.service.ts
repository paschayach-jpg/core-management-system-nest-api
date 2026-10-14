import { Injectable } from '@nestjs/common';
import { AppRole } from '../../../../common/constants/enums';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import {
  TransactionRunner,
  type TransactionScope,
} from '../../../../database/transaction-runner.service';
import { FolderAccess, isPrivilegedUser } from '../access/folder-access';
import { FoldersService } from '../folders/folders.service';
import type { ApprovalRecord } from '../../ports/dms-approval.port';
import {
  parseChangePermissionPayload,
  type ChangePermissionPayload,
} from '../rules/approval-payload';
import { AclRepository, type NewPermission } from './acl.repository';
import {
  MyFolderPermissionsDto,
  PermissionDto,
  PropagateResultDto,
  SetPermissionDto,
  toPermissionDto,
} from './dto/acl.dto';

/** ตรวจค่าที่ตั้งสิทธิ์: ต้องมีอย่างน้อยหนึ่งสิทธิ์, วันหมดอายุต้องเป็นอนาคต */
export function normalizePermission(
  dto: SetPermissionDto,
  grantedBy: number,
  now = new Date(),
): NewPermission {
  const p: NewPermission = {
    principalType: dto.principalType,
    principalId: dto.principalId,
    canRead: dto.canRead === true,
    canWrite: dto.canWrite === true,
    canDelete: dto.canDelete === true,
    canModify: dto.canModify === true,
    canFullControl: dto.canFullControl === true,
    isDeny: dto.isDeny === true,
    expiryDate: dto.expiryDate ?? null,
    grantedBy,
  };
  if (!(p.canRead || p.canWrite || p.canDelete || p.canModify || p.canFullControl)) {
    throw new BusinessException('ต้องเลือกอย่างน้อยหนึ่งสิทธิ์', 'PERMISSION_EMPTY');
  }
  if (p.expiryDate && p.expiryDate.getTime() <= now.getTime()) {
    throw new BusinessException('วันหมดอายุของสิทธิ์ต้องเป็นเวลาในอนาคต', 'PERMISSION_EXPIRY_PAST');
  }
  return p;
}

/**
 * สิทธิ์โฟลเดอร์ (ACL) — พอร์ตจาก PermissionService.SetFolderPermission / PropagatePermissionsToFiles
 *  - ตั้ง/เพิกถอน/กระจายสิทธิ์: Manager ขึ้นไป · ตั้งสิทธิ์ = เพิกถอนรายการเดิมของ principal+folder+IsDeny เดียวกันแล้วเพิ่มใหม่ (ใน transaction เดียว)
 *  - security.FolderPermission ใน DB จริงไม่มีคอลัมน์ InheritanceBroken จึงไม่มีการตัดการสืบทอด (สืบทอดจากโฟลเดอร์แม่เสมอ)
 */
@Injectable()
export class FolderPermissionsService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'FolderPermission';

  constructor(
    crudLog: CrudLogService,
    private readonly acl: AclRepository,
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

  /** ดู ACL ได้: Manager ขึ้นไป หรือผู้ที่มีสิทธิ์ Modify บนโฟลเดอร์นั้น */
  async list(
    user: UserContext,
    folderId: number,
    includeHistory: boolean,
  ): Promise<PermissionDto[]> {
    await this.folders.require(folderId);
    if (!isPrivilegedUser(user) && !(await this.access.evaluator.check(user, folderId, 'Modify'))) {
      throw new PermissionDeniedException('ไม่มีสิทธิ์ดูสิทธิ์ของโฟลเดอร์นี้', 'ACL_VIEW_DENIED', {
        folderId,
      });
    }
    const rows = await this.acl.listFolderPermissions(folderId, includeHistory);
    return rows.map((r) => toPermissionDto(r));
  }

  /** สิทธิ์ของฉันบนโฟลเดอร์ (ใช้ PermissionEvaluator เดียวกับที่บังคับสิทธิ์จริง) */
  async mine(user: UserContext, folderId: number): Promise<MyFolderPermissionsDto> {
    const folder = await this.folders.require(folderId);
    const ev = this.access.evaluator;
    const [
      read,
      write,
      del,
      modify,
      full,
      canView,
      canAdd,
      canEdit,
      canDeleteFolder,
      canDeleteFile,
    ] = await Promise.all([
      ev.check(user, folderId, 'Read'),
      ev.check(user, folderId, 'Write'),
      ev.check(user, folderId, 'Delete'),
      ev.check(user, folderId, 'Modify'),
      ev.check(user, folderId, 'FullControl'),
      this.access.canView(user, folder),
      this.access.canAdd(user, folder),
      this.access.canEdit(user, folder),
      this.access.canDeleteFolder(user, folder),
      this.access.canDeleteFile(user, folder),
    ]);
    return {
      folderId,
      read,
      write,
      delete: del,
      modify,
      fullControl: full,
      canView,
      canAdd,
      canEdit,
      canDeleteFolder,
      canDeleteFile,
    };
  }

  /** ตั้งสิทธิ์โฟลเดอร์ (Manager+) */
  set(user: UserContext, folderId: number, dto: SetPermissionDto): Promise<PermissionDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: dto.isDeny ? 'DENY_FOLDER_PERMISSION' : 'GRANT_FOLDER_PERMISSION',
        recordId: folderId,
        meta: { principalType: dto.principalType, principalId: dto.principalId },
      },
      async () => {
        this.assertManager(user, 'การตั้งสิทธิ์โฟลเดอร์');
        return this.apply(user, folderId, normalizePermission(dto, user.userId));
      },
      (r) => ({ after: r }),
    );
  }

  /** ตั้งสิทธิ์ตามคำขอ CHANGE_PERMISSION ที่อนุมัติแล้ว (ผู้ลงมือ = ผู้อนุมัติ ซึ่งต้องเป็น Manager+) */
  setAfterApproval(
    record: ApprovalRecord,
    approver: UserContext,
    scope?: TransactionScope,
  ): Promise<PermissionDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'APPLY_PERMISSION_APPROVED',
        recordId: record.folderId ?? undefined,
        meta: { requestId: record.requestId },
      },
      async () => {
        this.assertManager(approver, 'การตั้งสิทธิ์โฟลเดอร์');
        if (!record.folderId) {
          throw new BusinessException(
            'คำขอเปลี่ยนสิทธิ์ไม่ระบุโฟลเดอร์',
            'APPROVAL_PAYLOAD_INVALID',
          );
        }
        const p: ChangePermissionPayload = parseChangePermissionPayload(record.payload);
        const perm = normalizePermission(
          {
            principalType: p.principalType,
            principalId: p.principalId,
            canRead: p.canRead,
            canWrite: p.canWrite,
            canDelete: p.canDelete,
            canModify: p.canModify,
            canFullControl: p.canFullControl,
            isDeny: p.isDeny,
            expiryDate: p.expiryDate,
          },
          approver.userId,
        );
        return this.apply(approver, record.folderId, perm, scope);
      },
      (r) => ({ after: r }),
    );
  }

  private async apply(
    actor: UserContext,
    folderId: number,
    perm: NewPermission,
    scope?: TransactionScope,
  ): Promise<PermissionDto> {
    const folder = await this.folders.require(folderId, scope);
    if (folder.isDeleted) {
      throw new BusinessException('ไม่สามารถตั้งสิทธิ์ Folder ที่ถูกลบ', 'FOLDER_DELETED', {
        folderId,
      });
    }
    if (!(await this.acl.principalExists(perm.principalType, perm.principalId, scope))) {
      throw new ResourceNotFoundException(
        `ผู้ถือสิทธิ์ (ประเภท ${perm.principalType})`,
        perm.principalId,
      );
    }
    const work = async (s: TransactionScope): Promise<PermissionDto> => {
      const old = await this.acl.findActiveFolderEntries(
        folderId,
        perm.principalType,
        perm.principalId,
        perm.isDeny,
        s,
      );
      for (const id of old) {
        await this.acl.revokeFolderPermission(
          id,
          actor.userId,
          'Replaced by new permission entry',
          s,
        );
      }
      const newId = await this.acl.insertFolderPermission(folderId, perm, s);
      const row = await this.acl.getFolderPermission(newId, s);
      if (!row) throw new ResourceNotFoundException('FolderPermission', newId);
      return toPermissionDto(row);
    };
    return scope ? work(scope) : this.tx.run(work);
  }

  /** เพิกถอนสิทธิ์ (Manager+) */
  revoke(
    user: UserContext,
    folderId: number,
    permissionId: number,
    reason?: string,
  ): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'REVOKE_FOLDER_PERMISSION',
        recordId: permissionId,
        meta: { folderId },
        captureBefore: () => this.acl.getFolderPermission(permissionId),
      },
      async () => {
        this.assertManager(user, 'การเพิกถอนสิทธิ์โฟลเดอร์');
        const row = await this.acl.getFolderPermission(permissionId);
        if (!row || row.targetId !== folderId) {
          throw new ResourceNotFoundException('FolderPermission', permissionId);
        }
        if (row.revokedDate) {
          throw new ConflictBusinessException(
            'สิทธิ์นี้ถูกเพิกถอนไปแล้ว',
            'PERMISSION_ALREADY_REVOKED',
          );
        }
        await this.acl.revokeFolderPermission(
          permissionId,
          user.userId,
          reason?.trim() || 'ยกเลิกโดยผู้ดูแลระบบ',
        );
      },
    );
  }

  /**
   * กระจายสิทธิ์ของโฟลเดอร์ลงไฟล์ทุกไฟล์ที่ยังใช้งานในโฟลเดอร์ (Manager+)
   * เพิกถอนสิทธิ์ระดับไฟล์เดิมทั้งหมดแล้วคัดลอกสิทธิ์โฟลเดอร์ (ที่ยังไม่ถูกเพิกถอน/หมดอายุ) ลงไฟล์
   */
  propagateToFiles(user: UserContext, folderId: number): Promise<PropagateResultDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        operation: 'PROPAGATE_TO_FILES',
        entity: 'FilePermission',
        recordId: folderId,
      },
      async () => {
        this.assertManager(user, 'การกระจายสิทธิ์ลงไฟล์');
        const folder = await this.folders.require(folderId);
        if (folder.isDeleted) {
          throw new BusinessException('ไม่สามารถแก้ Folder ที่ถูกลบ', 'FOLDER_DELETED', {
            folderId,
          });
        }
        await this.access.assertEdit(user, folder);
        return this.tx.run((s) => this.acl.propagateFolderToFiles(folderId, user.userId, s));
      },
      (r) => ({ after: r }),
    );
  }
}
