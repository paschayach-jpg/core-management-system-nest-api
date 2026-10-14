import { Injectable, Logger } from '@nestjs/common';
import { AppRole } from '../../../../common/constants/enums';
import { paginated, type Paginated } from '../../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../../database/transaction-runner.service';
import { FolderAccess, isPrivilegedUser } from '../access/folder-access';
import { FileRepository } from '../files/file.repository';
import { FileDto, toFileDto } from '../files/dto/file.dto';
import { FolderRepository } from '../folders/folder.repository';
import { FolderDto, toFolderDto } from '../folders/dto/folder.dto';
import { FoldersService } from '../folders/folders.service';
import {
  assertDepthWithinLimit,
  assertUnderMainRoot,
  isSameFolderName,
  isWithinRecycleRetention,
  projectedDepthAfterMove,
  RECYCLE_BIN_RETENTION_DAYS,
} from '../rules/folder.rules';
import { FileStorageService } from '../storage/file-storage.service';
import { UserOrgVisibilityService } from '../visibility/user-org-visibility.service';
import type {
  PurgeResultDto,
  RecycleBinFileQueryDto,
  RecycleBinFolderQueryDto,
} from './dto/recycle-bin.dto';

export interface PurgeExpiredSummary {
  attempted: number;
  purged: number;
  failed: { folderId: number; reason: string }[];
}

/**
 * ถังขยะ — โฟลเดอร์: รายการ / กู้คืนภายใน 30 วัน / ลบถาวร (Manager+) · ไฟล์: รายการ (กู้คืนที่ FilesService.restore)
 * ลบถาวร: ลบแถวข้อมูลใน transaction เดียว (ใบอนุมัติ → สิทธิ์ → ทางลัด → ไฟล์ → โฟลเดอร์) แล้วค่อยลบไฟล์กายภาพหลัง commit
 * (ต่างจากระบบเดิมที่ลบไฟล์จริงก่อนและกลืนข้อผิดพลาดทีละขั้น) · ถ้ายังมี KMS/โครงการ/ลิงก์แชร์ภายนอกอ้างอิงอยู่ → 409 FOLDER_IN_USE
 */
@Injectable()
export class RecycleBinService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'RecycleBin';
  private readonly logger = new Logger(RecycleBinService.name);

  constructor(
    crudLog: CrudLogService,
    private readonly folderRepo: FolderRepository,
    private readonly fileRepo: FileRepository,
    private readonly folders: FoldersService,
    private readonly access: FolderAccess,
    private readonly visibility: UserOrgVisibilityService,
    private readonly storage: FileStorageService,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  // ── รายการ ─────────────────────────────────────────────────

  private async orgScope(user: UserContext, orgUnitId?: number): Promise<number[]> {
    const { ids } = await this.visibility.visibleOrgUnitIds(user);
    return orgUnitId === undefined ? [...ids] : ids.has(orgUnitId) ? [orgUnitId] : [];
  }

  /**
   * โฟลเดอร์ในถังขยะที่ยังกู้คืนได้ (≤30 วัน) ในหน่วยงานที่ผู้ใช้เห็น
   * Manager+ เห็นทั้งหมด · ผู้ใช้อื่นเห็นเฉพาะที่ตนลบเอง
   */
  async listFolders(
    user: UserContext,
    q: RecycleBinFolderQueryDto,
    now = new Date(),
  ): Promise<Paginated<FolderDto>> {
    const orgUnitIds = await this.orgScope(user, q.orgUnitId);
    const { items, total } = await this.folderRepo.listDeleted({
      orgUnitIds,
      deletedBy: isPrivilegedUser(user) ? undefined : user.userId,
      topLevelOnly: q.includeDescendants !== true,
      deletedSince: new Date(now.getTime() - RECYCLE_BIN_RETENTION_DAYS * 24 * 3600 * 1000),
      page: q.page,
      pageSize: q.pageSize,
    });
    return paginated(items.map(toFolderDto), total, q);
  }

  async listFiles(user: UserContext, q: RecycleBinFileQueryDto): Promise<Paginated<FileDto>> {
    const orgUnitIds = await this.orgScope(user, q.orgUnitId);
    const { items, total } = await this.fileRepo.listDeleted({
      orgUnitIds,
      deletedBy: isPrivilegedUser(user) ? undefined : user.userId,
      page: q.page,
      pageSize: q.pageSize,
    });
    return paginated(items.map(toFileDto), total, q);
  }

  // ── กู้คืน ─────────────────────────────────────────────────

  /**
   * กู้คืนโฟลเดอร์ทั้งต้นไม้ย่อย — ต้องอยู่ในถังขยะไม่เกิน 30 วัน
   * กลับไปที่แม่เดิมได้เมื่อแม่เดิมยังอยู่ ไม่งั้นต้องระบุแม่ใหม่ (ทั้งต้นไม้รับ OrgUnit/ชั้นความลับ/ความลึกของแม่ใหม่)
   */
  restoreFolder(
    user: UserContext,
    folderId: number,
    newParentFolderId?: number,
    now = new Date(),
  ): Promise<FolderDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'RESTORE_FOLDER',
        recordId: folderId,
        meta: { newParentFolderId: newParentFolderId ?? null },
      },
      async () => {
        const f = await this.folders.require(folderId);
        if (!f.isDeleted) {
          throw new ConflictBusinessException('Folder นี้ไม่ได้อยู่ในถังขยะ', 'FOLDER_NOT_DELETED');
        }
        await this.access.assertDeleteFolder(
          user,
          f,
          `ไม่มีสิทธิ์กู้คืน Folder '${f.folderName}' (ต้องการสิทธิ์เดียวกับการลบ)`,
        );
        if (!isWithinRecycleRetention(f.deletedDate, now)) {
          const days = f.deletedDate
            ? Math.floor((now.getTime() - f.deletedDate.getTime()) / 86_400_000)
            : 0;
          throw new BusinessException(
            `Folder '${f.folderName}' ถูกลบเมื่อ ${days} วันที่แล้ว เกินระยะเวลากู้คืน ${RECYCLE_BIN_RETENTION_DAYS} วัน`,
            'RECYCLE_BIN_EXPIRED',
            { deletedDate: f.deletedDate },
          );
        }

        const subtree = await this.folderRepo.getSubtree(folderId);
        const descendants = subtree.filter((x) => x.folderId !== folderId);

        if (newParentFolderId === undefined) {
          if (f.parentFolderId !== null) {
            const parent = await this.folderRepo.getById(f.parentFolderId);
            if (!parent || parent.isDeleted) {
              throw new BusinessException(
                'ไม่พบ Folder แม่เดิม กรุณาเลือก Folder แม่ใหม่ (newParentFolderId)',
                'PARENT_FOLDER_MISSING',
              );
            }
            this.assertNoDuplicate(
              await this.folderRepo.getChildren(parent.folderId),
              f.folderName,
              folderId,
            );
          } else if (f.confidentialityLevel !== 1) {
            const roots = await this.folderRepo.getRootsByOrgUnit(f.orgUnitId);
            if (
              roots.some(
                (r) => r.folderId !== folderId && r.confidentialityLevel === f.confidentialityLevel,
              )
            ) {
              throw new ConflictBusinessException(
                'มี Root Folder ระดับเดียวกันอยู่แล้ว จึงกู้คืนไม่ได้',
                'ROOT_FOLDER_EXISTS',
              );
            }
          }
          await this.tx.run((s) => this.folderRepo.restoreTree(folderId, s));
        } else {
          const dest = await this.folders.requireUsable(newParentFolderId, 'Folder แม่ใหม่');
          if (subtree.some((x) => x.folderId === newParentFolderId)) {
            throw new BusinessException(
              'ไม่สามารถกู้คืนไปไว้ใต้ Folder ย่อยของตัวเอง',
              'FOLDER_MOVE_INTO_DESCENDANT',
            );
          }
          await this.access.assertAdd(user, dest, 'ไม่มีสิทธิ์เพิ่มข้อมูลใน Folder แม่ใหม่');
          assertUnderMainRoot(await this.folderRepo.getRootAncestor(newParentFolderId));
          assertDepthWithinLimit(
            projectedDepthAfterMove({
              destDepth: dest.folderDepth,
              sourceDepth: f.folderDepth,
              maxSubtreeDepth: Math.max(f.folderDepth, ...descendants.map((d) => d.folderDepth)),
            }),
          );
          this.assertNoDuplicate(
            await this.folderRepo.getChildren(newParentFolderId),
            f.folderName,
            folderId,
          );
          await this.tx.run(async (s) => {
            await this.folderRepo.reparent(
              {
                sourceId: folderId,
                newParentId: newParentFolderId,
                depthDelta: dest.folderDepth + 1 - f.folderDepth,
                orgUnitId: dest.orgUnitId,
                confidentialityLevel: dest.confidentialityLevel,
                descendantIds: descendants.map((d) => d.folderId),
                updatedBy: user.userId,
              },
              s,
            );
            await this.folderRepo.restoreTree(folderId, s);
          });
        }
        return toFolderDto(await this.folders.require(folderId));
      },
      (r) => ({ after: r }),
    );
  }

  private assertNoDuplicate(
    siblings: readonly { folderId: number; folderName: string }[],
    name: string,
    selfId: number,
  ): void {
    const dup = siblings.find((s) => s.folderId !== selfId && isSameFolderName(s.folderName, name));
    if (dup) {
      throw new ConflictBusinessException(
        `มี Folder ชื่อ '${dup.folderName}' อยู่แล้ว กรุณาเลือก Folder แม่อื่นหรือเปลี่ยนชื่อก่อน`,
        'FOLDER_NAME_DUPLICATE',
        { folderId: dup.folderId },
      );
    }
  }

  // ── ลบถาวร ─────────────────────────────────────────────────

  /** ลบโฟลเดอร์ในถังขยะถาวร (Manager+) — ลบทั้งต้นไม้ย่อย ไฟล์ สิทธิ์ ใบอนุมัติ และไฟล์กายภาพ */
  purgeFolder(user: UserContext, folderId: number): Promise<PurgeResultDto> {
    return this.logged(
      { action: 'DELETE', operation: 'PURGE_FOLDER', recordId: folderId },
      async () => {
        if (user.appRole < AppRole.Manager) {
          throw new PermissionDeniedException(
            'การลบ Folder ถาวรต้องมีสิทธิ์ Manager หรือ Admin',
            'ROLE_REQUIRED',
          );
        }
        const f = await this.folders.require(folderId);
        if (!f.isDeleted) {
          throw new BusinessException(
            'Folder ต้องอยู่ในถังขยะก่อนจึงจะลบถาวรได้',
            'FOLDER_NOT_IN_RECYCLE_BIN',
          );
        }
        await this.access.assertDeleteFolder(user, f);
        return this.purgeTree(folderId);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบถาวรทั้งต้นไม้ (ไม่ตรวจผู้ใช้ — ผู้เรียกตรวจสิทธิ์/การหมดอายุมาแล้ว) */
  private async purgeTree(folderId: number): Promise<PurgeResultDto> {
    const folderIds = await this.folderRepo.getSubtreeIds(folderId);
    const subtree = await this.folderRepo.getSubtree(folderId);
    const live = subtree.filter((x) => !x.isDeleted);
    if (live.length > 0) {
      // กันลบข้อมูลที่ยังใช้งานอยู่ (ไม่ควรเกิด เพราะ sp_SoftDeleteFolder ลบทั้งต้นไม้)
      throw new ConflictBusinessException(
        'พบ Folder ย่อยที่ยังไม่ได้อยู่ในถังขยะ จึงไม่ลบถาวร',
        'FOLDER_SUBTREE_NOT_DELETED',
        { folderIds: live.map((x) => x.folderId) },
      );
    }
    const locations = await this.fileRepo.locationsInFolders(folderIds);
    const fileIds = locations.map((l) => l.fileId);
    const blockers = await this.fileRepo.blockers(folderIds, fileIds);
    if (blockers.kmsAttachments + blockers.projectAttachments + blockers.externalShares > 0) {
      throw new ConflictBusinessException(
        'ลบถาวรไม่ได้ เพราะยังมีไฟล์/โฟลเดอร์ที่ถูกอ้างอิงโดยบทความ KMS, ไฟล์แนบโครงการ หรือลิงก์แชร์ภายนอก',
        'FOLDER_IN_USE',
        blockers,
      );
    }

    await this.tx.run((s) => this.fileRepo.hardDeleteTree(folderIds, fileIds, s));

    // หลัง commit: ลบไฟล์กายภาพ (ล้มเหลวไม่ย้อนการลบข้อมูล — บันทึกไว้ให้ตามเก็บ)
    const physical = await this.storage.deleteFiles(
      locations.map((l) =>
        this.storage.candidatePaths({
          orgUnitId: l.orgUnitId,
          folderId: l.folderId,
          storedFileName: l.storedFileName,
          physicalPath: l.physicalPath,
        }),
      ),
      { rootFolderId: folderId },
    );
    return {
      folders: folderIds.length,
      files: locations.length,
      physicalDeleted: physical.deleted,
      physicalFailed: physical.failed.length,
    };
  }

  /**
   * ลบถาวรโฟลเดอร์ที่หมดอายุในถังขยะ (RecycleBinExpiry < ตอนนี้) — เรียกจากงานเบื้องหลัง (ปิดเป็นค่าเริ่มต้น)
   * ทำทีละโฟลเดอร์ ล้มเหลวรายการหนึ่งไม่กระทบรายการอื่น
   */
  async purgeExpired(limit: number): Promise<PurgeExpiredSummary> {
    const ids = await this.folderRepo.findExpiredDeletedRoots(limit);
    const summary: PurgeExpiredSummary = { attempted: ids.length, purged: 0, failed: [] };
    for (const id of ids) {
      try {
        await this.logged(
          {
            action: 'DELETE',
            operation: 'PURGE_FOLDER_EXPIRED',
            recordId: id,
            meta: { auto: true },
          },
          () => this.purgeTree(id),
          (r) => ({ after: r }),
        );
        summary.purged++;
      } catch (err) {
        const reason = err instanceof BusinessException ? err.message : (err as Error).message;
        this.logger.warn(`ลบถาวร Folder ${id} (หมดอายุ) ไม่สำเร็จ: ${reason}`);
        summary.failed.push({ folderId: id, reason });
      }
    }
    return summary;
  }
}
