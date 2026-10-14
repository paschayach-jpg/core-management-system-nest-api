import { Injectable } from '@nestjs/common';
import { AppRole } from '../../../../common/constants/enums';
import { PermissionDeniedException } from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { canAddToLevel, canEditLevel, canViewLevel } from '../../permissions/authority.util';
import { PermissionEvaluator } from '../../permissions/permission-evaluator';
import type { PermissionType } from '../../permissions/permission.types';

/** ข้อมูลขั้นต่ำของโฟลเดอร์ที่ใช้ตัดสินสิทธิ์ */
export interface FolderRef {
  folderId: number;
  confidentialityLevel: number;
}

export const isPrivilegedUser = (user: UserContext): boolean => user.appRole >= AppRole.Manager;

/**
 * ตัวรวมกติกา "สิทธิ์ 2 ชั้น" ของระบบเดิม (ใช้ซ้ำใน folders/files/templates):
 *   ชั้นที่ 1 Authority (FolderAuthorityConfig ตามชั้นความลับ) · ชั้นที่ 2 ACL (FolderPermission, สืบทอดจากแม่)
 *  - Manager/Admin: ข้ามชั้น Authority แต่ยังถูก Explicit Deny ของ ACL บล็อก (PermissionEvaluator จัดการ)
 *  - อื่นๆ: ผ่านถ้า Authority อนุญาต **หรือ** ACL อนุญาต
 * ไม่ใช่ service (ไม่มี state/ไม่เขียนข้อมูล) จึงไม่ extend CrudLoggedService
 */
@Injectable()
export class FolderAccess {
  constructor(private readonly perm: PermissionEvaluator) {}

  private async either(
    user: UserContext,
    f: FolderRef,
    authority: (u: UserContext, level: number) => boolean,
    acl: PermissionType,
  ): Promise<boolean> {
    if (isPrivilegedUser(user)) return this.perm.check(user, f.folderId, acl);
    if (authority(user, f.confidentialityLevel)) return true;
    return this.perm.check(user, f.folderId, acl);
  }

  /** เห็นโฟลเดอร์/อ่านได้ */
  canView(user: UserContext, f: FolderRef): Promise<boolean> {
    return this.either(user, f, canViewLevel, 'Read');
  }

  /** เพิ่มของเข้าโฟลเดอร์ (สร้างโฟลเดอร์ย่อย/อัปโหลด) */
  canAdd(user: UserContext, f: FolderRef): Promise<boolean> {
    return this.perm.canAdd(user, f.folderId, f.confidentialityLevel);
  }

  /** แก้ไข (เปลี่ยนชื่อโฟลเดอร์/ไฟล์) */
  canEdit(user: UserContext, f: FolderRef): Promise<boolean> {
    return this.either(user, f, canEditLevel, 'Write');
  }

  /** ลบโฟลเดอร์ (ต้อง Modify) */
  canDeleteFolder(user: UserContext, f: FolderRef): Promise<boolean> {
    return this.either(user, f, canEditLevel, 'Modify');
  }

  /** ลบไฟล์ในโฟลเดอร์ (ต้อง Delete) */
  canDeleteFile(user: UserContext, f: FolderRef): Promise<boolean> {
    return this.either(user, f, canEditLevel, 'Delete');
  }

  /** ต้นทาง/ปลายทางของการย้าย: มีสิทธิ์เพิ่ม/แก้ไขด้วย Authority หรือ ACL Write/Modify (Admin ข้าม) */
  async canMoveWithin(user: UserContext, f: FolderRef): Promise<boolean> {
    if (user.appRole >= AppRole.Admin) return true;
    if (canAddToLevel(user, f.confidentialityLevel) || canEditLevel(user, f.confidentialityLevel)) {
      return true;
    }
    return (
      (await this.perm.check(user, f.folderId, 'Write')) ||
      (await this.perm.check(user, f.folderId, 'Modify'))
    );
  }

  /** ตรวจหลายโฟลเดอร์ในครั้งเดียว (2 query) — คืนรหัสโฟลเดอร์ที่ "เห็นได้" */
  async viewableIds(user: UserContext, folders: readonly FolderRef[]): Promise<Set<number>> {
    const out = new Set<number>();
    const needAcl: number[] = [];
    for (const f of folders) {
      if (!isPrivilegedUser(user) && canViewLevel(user, f.confidentialityLevel))
        out.add(f.folderId);
      else needAcl.push(f.folderId);
    }
    if (needAcl.length > 0) {
      const res = await this.perm.checkMany(user, needAcl, 'Read');
      for (const [id, ok] of res) if (ok) out.add(id);
    }
    return out;
  }

  // ── assert (โยน 403) ───────────────────────────────────────

  async assertView(
    user: UserContext,
    f: FolderRef,
    message = 'ไม่มีสิทธิ์ดูโฟลเดอร์นี้',
  ): Promise<void> {
    if (!(await this.canView(user, f))) {
      throw new PermissionDeniedException(message, 'FOLDER_VIEW_DENIED', { folderId: f.folderId });
    }
  }

  async assertAdd(
    user: UserContext,
    f: FolderRef,
    message = 'ไม่มีสิทธิ์เพิ่มข้อมูลในโฟลเดอร์นี้',
  ): Promise<void> {
    if (!(await this.canAdd(user, f))) {
      throw new PermissionDeniedException(message, 'FOLDER_ADD_DENIED', { folderId: f.folderId });
    }
  }

  async assertEdit(
    user: UserContext,
    f: FolderRef,
    message = 'ไม่มีสิทธิ์แก้ไขโฟลเดอร์นี้',
  ): Promise<void> {
    if (!(await this.canEdit(user, f))) {
      throw new PermissionDeniedException(message, 'FOLDER_EDIT_DENIED', { folderId: f.folderId });
    }
  }

  async assertDeleteFolder(
    user: UserContext,
    f: FolderRef,
    message = 'ไม่มีสิทธิ์ลบโฟลเดอร์นี้ (ต้องการสิทธิ์ Modify)',
  ): Promise<void> {
    if (!(await this.canDeleteFolder(user, f))) {
      throw new PermissionDeniedException(message, 'FOLDER_DELETE_DENIED', {
        folderId: f.folderId,
      });
    }
  }

  async assertDeleteFile(
    user: UserContext,
    f: FolderRef,
    message = 'ไม่มีสิทธิ์ลบไฟล์ในโฟลเดอร์นี้',
  ): Promise<void> {
    if (!(await this.canDeleteFile(user, f))) {
      throw new PermissionDeniedException(message, 'FILE_DELETE_DENIED', { folderId: f.folderId });
    }
  }

  async assertMoveWithin(user: UserContext, f: FolderRef, message: string): Promise<void> {
    if (!(await this.canMoveWithin(user, f))) {
      throw new PermissionDeniedException(message, 'FOLDER_MOVE_DENIED', { folderId: f.folderId });
    }
  }

  /** เข้าถึงสิทธิ์ตรง (ใช้กับสิทธิ์ที่ service เฉพาะทางกำหนดเอง) */
  get evaluator(): PermissionEvaluator {
    return this.perm;
  }
}
