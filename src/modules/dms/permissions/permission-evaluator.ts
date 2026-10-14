import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AppRole } from '../../../common/constants/enums';
import {
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { evaluateAcl } from './acl.evaluator';
import { canAddToLevel } from './authority.util';
import type { AclEntry, AclSubject, FolderLink, PermissionType } from './permission.types';

const subjectOf = (u: UserContext): AclSubject => ({
  userId: u.userId,
  appRole: u.appRole,
  departmentId: u.departmentId,
  divisionId: u.divisionId,
});

interface ChainRow {
  StartId: number;
  FolderID: number;
  ParentFolderID: number | null;
  Lvl: number;
}
interface AclRow {
  FolderID: number;
  PrincipalType: number;
  PrincipalID: number;
  CanRead: boolean;
  CanWrite: boolean;
  CanDelete: boolean;
  CanModify: boolean;
  CanFullControl: boolean;
  IsDeny: boolean;
}

/**
 * ตัวประเมินสิทธิ์โฟลเดอร์ (ACL + Authority) — provider กลางที่ DMS/KMS/RGP ใช้ร่วมกัน
 * ไม่เก็บ cache ข้ามคำขอ (โปรแกรมเดิมแคชต่อ session ซึ่งทำให้สิทธิ์เก่าค้าง): แต่ละการตรวจใช้ 2 query (สายเลือดโฟลเดอร์ + ACL) แล้วคำนวณในหน่วยความจำ
 */
@Injectable()
export class PermissionEvaluator {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** ผู้ใช้มีสิทธิ์ `perm` บนโฟลเดอร์หรือไม่ */
  async check(user: UserContext, folderId: number, perm: PermissionType): Promise<boolean> {
    const result = await this.checkMany(user, [folderId], perm);
    return result.get(folderId) === true;
  }

  /** ตรวจหลายโฟลเดอร์พร้อมกันด้วย 2 query (ใช้กับรายการ/ต้นไม้โฟลเดอร์) */
  async checkMany(
    user: UserContext,
    folderIds: number[],
    perm: PermissionType,
  ): Promise<Map<number, boolean>> {
    const ids = [...new Set(folderIds)];
    const out = new Map<number, boolean>(ids.map((id) => [id, false]));
    if (ids.length === 0) return out;

    const chains = await this.loadChains(ids);
    const aclByFolder = await this.loadAcl([
      ...new Set([...chains.values()].flat().map((l) => l.folderId)),
    ]);
    const subject = subjectOf(user);
    for (const id of ids) {
      out.set(id, evaluateAcl({ subject, perm, chain: chains.get(id) ?? [], aclByFolder }));
    }
    return out;
  }

  /** เหมือน check() แต่โยน 403 พร้อมข้อความเมื่อไม่ผ่าน */
  async assert(
    user: UserContext,
    folderId: number,
    perm: PermissionType,
    message?: string,
  ): Promise<void> {
    if (!(await this.check(user, folderId, perm))) {
      throw new PermissionDeniedException(
        message ?? `ไม่มีสิทธิ์ ${perm} บนโฟลเดอร์นี้`,
        'FOLDER_PERMISSION_DENIED',
        { folderId, permission: perm },
      );
    }
  }

  /**
   * สิทธิ์ "เพิ่มของเข้าโฟลเดอร์" (อัปโหลด/สร้างโฟลเดอร์ย่อย) แบบ 2 ชั้นของโปรแกรมเดิม:
   * Manager/Admin ผ่าน (ยกเว้น Deny) · อื่นๆ ผ่านถ้า Authority.CanAdd ของชั้นความลับนั้น **หรือ** ACL Write
   */
  async canAdd(
    user: UserContext,
    folderId: number,
    confidentialityLevel: number,
  ): Promise<boolean> {
    if (user.appRole >= AppRole.Manager) return this.check(user, folderId, 'Write');
    if (canAddToLevel(user, confidentialityLevel)) return true;
    return this.check(user, folderId, 'Write');
  }

  async assertCanAdd(
    user: UserContext,
    folderId: number,
    confidentialityLevel: number,
  ): Promise<void> {
    if (!(await this.canAdd(user, folderId, confidentialityLevel))) {
      throw new PermissionDeniedException(
        'ไม่มีสิทธิ์เพิ่มข้อมูลในโฟลเดอร์นี้',
        'FOLDER_ADD_DENIED',
        { folderId },
      );
    }
  }

  /** สายเลือดของโฟลเดอร์ (ตัวเอง → ราก) เรียงตามลำดับ — คืน [] ถ้าไม่พบโฟลเดอร์ */
  async getChain(folderId: number): Promise<FolderLink[]> {
    const chains = await this.loadChains([folderId]);
    const chain = chains.get(folderId) ?? [];
    if (chain.length === 0) throw new ResourceNotFoundException('Folder', folderId);
    return chain;
  }

  // ── query ──────────────────────────────────────────────────

  /** recursive CTE ไล่ parent ของทุกโฟลเดอร์ที่ขอในครั้งเดียว (ไม่กรอง IsDeleted: ยังต้องรู้สิทธิ์ของโฟลเดอร์ในถังขยะเพื่อกู้คืน) */
  private async loadChains(ids: number[]): Promise<Map<number, FolderLink[]>> {
    const placeholders = ids.map((_, i) => `@${i}`).join(',');
    const rows: ChainRow[] = await this.ds.query(
      `WITH chain AS (
         SELECT f.FolderID AS StartId, f.FolderID, f.ParentFolderID, 0 AS Lvl
           FROM storage.Folder f WHERE f.FolderID IN (${placeholders})
         UNION ALL
         SELECT c.StartId, p.FolderID, p.ParentFolderID, c.Lvl + 1
           FROM storage.Folder p JOIN chain c ON p.FolderID = c.ParentFolderID
          WHERE c.Lvl < 20
       )
       SELECT StartId, FolderID, ParentFolderID, Lvl FROM chain ORDER BY StartId, Lvl`,
      ids,
    );
    const map = new Map<number, FolderLink[]>();
    for (const r of rows) {
      const list = map.get(r.StartId) ?? [];
      list.push({ folderId: r.FolderID, parentFolderId: r.ParentFolderID });
      map.set(r.StartId, list);
    }
    return map;
  }

  /** ACL ที่ยังใช้งาน (ไม่ถูกเพิกถอน และยังไม่หมดอายุ) ของโฟลเดอร์ที่ระบุ */
  private async loadAcl(folderIds: number[]): Promise<Map<number, AclEntry[]>> {
    const map = new Map<number, AclEntry[]>();
    // SQL Server จำกัด 2100 parameter — แบ่งเป็นก้อน
    for (let i = 0; i < folderIds.length; i += 1000) {
      const slice = folderIds.slice(i, i + 1000);
      if (slice.length === 0) continue;
      const placeholders = slice.map((_, k) => `@${k}`).join(',');
      const rows: AclRow[] = await this.ds.query(
        `SELECT FolderID, PrincipalType, PrincipalID, CanRead, CanWrite, CanDelete, CanModify, CanFullControl, IsDeny
           FROM security.FolderPermission
          WHERE FolderID IN (${placeholders})
            AND RevokedDate IS NULL
            AND (ExpiryDate IS NULL OR ExpiryDate > GETDATE())`,
        slice,
      );
      for (const r of rows) {
        const list = map.get(r.FolderID) ?? [];
        list.push({
          folderId: r.FolderID,
          principalType: r.PrincipalType,
          principalId: r.PrincipalID,
          canRead: Boolean(r.CanRead),
          canWrite: Boolean(r.CanWrite),
          canDelete: Boolean(r.CanDelete),
          canModify: Boolean(r.CanModify),
          canFullControl: Boolean(r.CanFullControl),
          isDeny: Boolean(r.IsDeny),
        });
        map.set(r.FolderID, list);
      }
    }
    return map;
  }
}
