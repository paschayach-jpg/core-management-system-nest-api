import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AppRole, PrincipalType } from '../../../../common/constants/enums';
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
import {
  type ApprovalRecord,
  type DmsApprovalPort,
  DMS_APPROVAL_PORT,
} from '../../ports/dms-approval.port';
import { type DmsQuotaPort, DMS_QUOTA_PORT } from '../../ports/dms-quota.port';
import { canAddToLevel } from '../../permissions/authority.util';
import { AclRepository } from '../acl/acl.repository';
import { FolderAccess, isPrivilegedUser } from '../access/folder-access';
import { buildCreateHcPayload, parseCreateHcPayload } from '../rules/approval-payload';
import {
  assertDepthWithinLimit,
  assertMoveAllowed,
  assertRootCreationAllowed,
  assertUnderMainRoot,
  isMainRoot,
  isMainRootLevel,
  isSameFolderName,
  projectedDepthAfterMove,
  resolveNewFolderAttributes,
  validateFolderName,
} from '../rules/folder.rules';
import { UserOrgVisibilityService } from '../visibility/user-org-visibility.service';
import {
  ApprovalRefDto,
  CopyStructureResultDto,
  CreateFolderDto,
  CreateFolderResultDto,
  FolderDetailDto,
  FolderDto,
  FolderListQueryDto,
  FolderStatsDto,
  RequestFolderDeleteDto,
  toFolderDto,
} from './dto/folder.dto';
import { FolderRepository } from './folder.repository';
import type { FolderRow } from './folder.types';

const serviceUnavailable = (message: string, code: string) =>
  new BusinessException(message, code, undefined, HttpStatus.SERVICE_UNAVAILABLE);

/**
 * โฟลเดอร์ DMS — พอร์ตจาก FolderService.cs
 * กฎหลัก: Root 4 อัน (1HC/2SC/3NC/4PC), 1HC ต้องอนุมัติ (CREATE_HC), ลึกสุด 10 ชั้น, ชื่อต้องห้าม/ซ้ำ, สืบทอดชั้นความลับ,
 * โควตา, ย้าย (SrOfficer+), คัดลอกโครงสร้าง/เปลี่ยนชั้นความลับ (Manager+), ลบ soft ทั้งต้นไม้ (ถ้ามีไฟล์ต้องขออนุมัติ)
 */
@Injectable()
export class FoldersService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'Folder';
  private readonly logger = new Logger(FoldersService.name);

  constructor(
    crudLog: CrudLogService,
    private readonly repo: FolderRepository,
    private readonly access: FolderAccess,
    private readonly visibility: UserOrgVisibilityService,
    private readonly acl: AclRepository,
    private readonly tx: TransactionRunner,
    @Optional() @Inject(DMS_QUOTA_PORT) private readonly quota?: DmsQuotaPort,
    @Optional() @Inject(DMS_APPROVAL_PORT) private readonly approvals?: DmsApprovalPort,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** โหลดโฟลเดอร์หรือโยน 404 (รวมที่อยู่ในถังขยะ) */
  async require(folderId: number, scope?: TransactionScope): Promise<FolderRow> {
    const f = await this.repo.getById(folderId, scope);
    if (!f) throw new ResourceNotFoundException('Folder', folderId);
    return f;
  }

  /** โฟลเดอร์ที่ใช้งานได้ (ไม่ถูกลบ/เก็บถาวร) — ใช้เป็นแม่หรือปลายทาง */
  async requireUsable(
    folderId: number,
    what: string,
    scope?: TransactionScope,
  ): Promise<FolderRow> {
    const f = await this.require(folderId, scope);
    if (f.isDeleted) {
      throw new BusinessException(`${what}ถูกลบแล้ว (อยู่ในถังขยะ)`, 'FOLDER_DELETED', {
        folderId,
      });
    }
    if (f.isArchived) {
      throw new BusinessException(
        `${what}ถูกเก็บถาวร (Archive) ไม่สามารถใช้งานได้`,
        'FOLDER_ARCHIVED',
        {
          folderId,
        },
      );
    }
    return f;
  }

  /**
   * รายการโฟลเดอร์ (flat) ที่ผู้ใช้มองเห็นและมีสิทธิ์ดู: กรองตามการมองเห็นหน่วยงาน (UserOrgVisibility)
   * แล้วกรองตามสิทธิ์ดู (Authority หรือ ACL Read) — client ประกอบเป็นต้นไม้ด้วย parentFolderId
   */
  async listAccessible(user: UserContext, q: FolderListQueryDto): Promise<FolderDto[]> {
    const { ids: visible } = await this.visibility.visibleOrgUnitIds(user);
    if (q.orgUnitId !== undefined && !visible.has(q.orgUnitId)) return [];

    let rows: FolderRow[];
    if (q.parentFolderId !== undefined) rows = await this.repo.getChildren(q.parentFolderId);
    else if (q.orgUnitId !== undefined) {
      rows = q.rootsOnly
        ? await this.repo.getRootsByOrgUnit(q.orgUnitId)
        : await this.repo.getByOrgUnit(q.orgUnitId);
    } else rows = await this.repo.getAllActive();

    rows = rows.filter(
      (f) =>
        !f.isDeleted &&
        !f.isArchived &&
        visible.has(f.orgUnitId) &&
        (!q.rootsOnly || f.parentFolderId === null),
    );
    const ok = await this.access.viewableIds(user, rows);
    return rows.filter((f) => ok.has(f.folderId)).map(toFolderDto);
  }

  async get(user: UserContext, folderId: number): Promise<FolderDetailDto> {
    const f = await this.require(folderId);
    await this.access.assertView(user, f);
    const path = await this.repo.getPath(folderId);
    return { ...toFolderDto(f), path };
  }

  /** โฟลเดอร์ย่อยชั้นถัดไป (เฉพาะที่ผู้ใช้เห็นได้) */
  async children(user: UserContext, folderId: number): Promise<FolderDto[]> {
    const f = await this.requireUsable(folderId, 'Folder นี้');
    await this.access.assertView(user, f);
    const rows = (await this.repo.getChildren(folderId)).filter((c) => !c.isArchived);
    const ok = await this.access.viewableIds(user, rows);
    return rows.filter((c) => ok.has(c.folderId)).map(toFolderDto);
  }

  /** สถิติ: FileCount/ขนาด คำนวณสดจาก FileDocument (ไม่ใช้ค่าในคอลัมน์ที่ระบบเดิมไม่ได้ปรับปรุง) */
  async stats(user: UserContext, folderId: number): Promise<FolderStatsDto> {
    const f = await this.require(folderId);
    await this.access.assertView(user, f);
    const [direct, subtree] = await Promise.all([
      this.repo.directStats(folderId),
      this.repo.subtreeStats(folderId),
    ]);
    return {
      folderId,
      fileCount: direct.fileCount,
      sizeBytes: direct.sizeBytes,
      subfolderCount: Math.max(0, subtree.folderCount - 1),
      subtreeFileCount: subtree.fileCount,
      subtreeSizeBytes: subtree.sizeBytes,
    };
  }

  // ── สร้าง ──────────────────────────────────────────────────

  /**
   * สร้างโฟลเดอร์
   *  - มีแม่: ต้องมีสิทธิ์เพิ่ม (Authority.CanAdd หรือ ACL Write), แม่ต้องอยู่ใต้ Root หลัก, ลึกไม่เกิน 10
   *  - ไม่มีแม่ (Root): ต้องระบุหน่วยงาน+ชั้นความลับ, ชื่อขึ้นต้น 1HC/2SC/3NC/4PC, 2SC/3NC/4PC มีได้อย่างละ 1 ต่อหน่วยงาน,
   *    **1HC ต้องผ่านอนุมัติ CREATE_HC** (ตอบ created=false พร้อมเลขคำขอ)
   */
  create(user: UserContext, dto: CreateFolderDto): Promise<CreateFolderResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'CREATE_FOLDER',
        meta: { name: dto.name, parentFolderId: dto.parentFolderId ?? null },
      },
      async () => {
        const name = validateFolderName(dto.name);
        let parent: FolderRow | null = null;
        let orgUnitId: number;

        if (dto.parentFolderId !== undefined) {
          parent = await this.requireUsable(dto.parentFolderId, 'โฟลเดอร์แม่');
          if (dto.orgUnitId !== undefined && dto.orgUnitId !== parent.orgUnitId) {
            throw new BusinessException('หน่วยงานไม่ตรงกับโฟลเดอร์แม่', 'ORG_UNIT_MISMATCH', {
              parentOrgUnitId: parent.orgUnitId,
            });
          }
          orgUnitId = parent.orgUnitId;
          await this.access.assertAdd(
            user,
            parent,
            `ไม่มีสิทธิ์สร้าง Folder ใน '${parent.folderName}' (ต้องการสิทธิ์ Add)`,
          );
          assertUnderMainRoot(await this.repo.getRootAncestor(parent.folderId));
        } else {
          if (dto.orgUnitId === undefined) {
            throw new BusinessException(
              'ต้องระบุหน่วยงานเมื่อสร้าง Root Folder',
              'ORG_UNIT_REQUIRED',
            );
          }
          orgUnitId = dto.orgUnitId;
          if (!(await this.repo.orgUnitIsUsable(orgUnitId))) {
            throw new ResourceNotFoundException('OrgUnit', orgUnitId);
          }
          const level = dto.confidentialityLevel;
          if (!isPrivilegedUser(user) && !(isMainRootLevel(level) && canAddToLevel(user, level))) {
            throw new PermissionDeniedException(
              `ไม่มีสิทธิ์สร้าง Root Folder ระดับ ${level ?? '-'} (ต้องการสิทธิ์ Add)`,
              'ROOT_FOLDER_CREATE_DENIED',
            );
          }
          assertRootCreationAllowed({
            name,
            level,
            existingRoots: await this.repo.getRootsByOrgUnit(orgUnitId),
          });
        }

        const attrs = resolveNewFolderAttributes({
          parent,
          requestedLevel: dto.confidentialityLevel,
        });
        const isHcRoot = !parent && attrs.confidentialityLevel === 1;

        // ชื่อซ้ำ (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) — 1HC ข้ามเพราะมีได้หลายอัน
        if (!isHcRoot) {
          const siblings = await this.repo.getSiblings(parent?.folderId ?? null, orgUnitId);
          const dup = siblings.find((s) => isSameFolderName(s.folderName, name));
          if (dup) {
            throw new ConflictBusinessException(
              `มี Folder ชื่อ '${dup.folderName}' อยู่แล้วใน Parent เดียวกัน`,
              'FOLDER_NAME_DUPLICATE',
              { folderId: dup.folderId },
            );
          }
        }

        if (isHcRoot) return this.submitHcRequest(user, name, orgUnitId, dto.reason);

        await this.quota?.enforceQuota(orgUnitId);
        const id = await this.repo.insert({
          folderName: name,
          parentFolderId: parent?.folderId ?? null,
          orgUnitId,
          confidentialityLevel: attrs.confidentialityLevel,
          folderDepth: attrs.depth,
          inheritPermission: attrs.inheritPermission,
          createdBy: user.userId,
        });
        this.alertQuota(orgUnitId);
        return { created: true, folder: toFolderDto(await this.require(id)) };
      },
      (r) => ({
        recordId: r.folder?.folderId ?? r.approval?.requestId,
        operation: r.created ? 'CREATE_FOLDER' : 'REQUEST_CREATE_HC',
        after: r.folder ?? r.approval,
      }),
    );
  }

  private async submitHcRequest(
    user: UserContext,
    name: string,
    orgUnitId: number,
    reason?: string,
  ): Promise<CreateFolderResultDto> {
    if (!this.approvals) {
      throw serviceUnavailable(
        'ระบบอนุมัติยังไม่พร้อมใช้งาน จึงยังสร้าง Folder 1HC ไม่ได้',
        'APPROVAL_SERVICE_UNAVAILABLE',
      );
    }
    const ref = await this.approvals.submit(user, {
      requestType: 'CREATE_HC',
      subject: `ขออนุมัติสร้าง Folder 1HC: ${name}`,
      reason,
      payload: buildCreateHcPayload({
        parentFolderId: null,
        orgUnitId,
        folderName: name,
        confidentialityLevel: 1,
        inheritPermission: false,
      }),
    });
    return {
      created: false,
      approval: { requestId: ref.requestId, requestStatus: ref.requestStatus },
    };
  }

  /**
   * สร้าง 1HC หลังอนุมัติ (CREATE_HC) — เรียกจาก handler: ตรวจกฎซ้ำ (สถานะอาจเปลี่ยนระหว่างรออนุมัติ),
   * สร้างโฟลเดอร์ในนามผู้ขอ แล้วให้ผู้ขอเห็นโฟลเดอร์ทันทีด้วยสิทธิ์ Read (กัน default-deny)
   * @param scope transaction เดียวกับการอนุมัติ (ถ้ามี) — ไม่ระบุ = เปิด transaction ของตัวเอง
   */
  createAfterApproval(
    record: ApprovalRecord,
    approver: UserContext,
    scope?: TransactionScope,
  ): Promise<FolderDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'CREATE_HC_APPROVED',
        meta: { requestId: record.requestId, requestedBy: record.requestedBy },
      },
      async () => {
        const p = parseCreateHcPayload(record.payload);
        const name = validateFolderName(p.folderName);
        const work = async (s: TransactionScope): Promise<FolderDto> => {
          if (!(await this.repo.orgUnitIsUsable(p.orgUnitId, s))) {
            throw new ResourceNotFoundException('OrgUnit', p.orgUnitId);
          }
          let parent: FolderRow | null = null;
          if (p.parentFolderId !== null) {
            parent = await this.requireUsable(p.parentFolderId, 'โฟลเดอร์แม่', s);
            assertUnderMainRoot(await this.repo.getRootAncestor(parent.folderId, s));
          } else {
            assertRootCreationAllowed({
              name,
              level: p.confidentialityLevel,
              existingRoots: await this.repo.getRootsByOrgUnit(p.orgUnitId, s),
            });
          }
          const attrs = resolveNewFolderAttributes({
            parent,
            requestedLevel: p.confidentialityLevel,
          });
          const siblings = await this.repo.getSiblings(parent?.folderId ?? null, p.orgUnitId, s);
          const dup = siblings.find((x) => isSameFolderName(x.folderName, name));
          if (dup) {
            throw new ConflictBusinessException(
              `มี Folder ชื่อ '${dup.folderName}' อยู่แล้วใน Parent เดียวกัน`,
              'FOLDER_NAME_DUPLICATE',
              { folderId: dup.folderId },
            );
          }
          await this.quota?.enforceQuota(p.orgUnitId);
          const id = await this.repo.insert(
            {
              folderName: name,
              parentFolderId: parent?.folderId ?? null,
              orgUnitId: p.orgUnitId,
              confidentialityLevel: attrs.confidentialityLevel,
              folderDepth: attrs.depth,
              inheritPermission: attrs.inheritPermission,
              createdBy: record.requestedBy,
            },
            s,
          );
          if (record.requestedBy > 0) {
            await this.acl.insertFolderPermission(
              id,
              {
                principalType: PrincipalType.User,
                principalId: record.requestedBy,
                canRead: true,
                canWrite: false,
                canDelete: false,
                canModify: false,
                canFullControl: false,
                isDeny: false,
                expiryDate: null,
                grantedBy: approver.userId,
              },
              s,
            );
          }
          return toFolderDto(await this.require(id, s));
        };
        return scope ? work(scope) : this.tx.run(work);
      },
      (r) => ({ recordId: r.folderId, after: r }),
    );
  }

  // ── แก้ไข ──────────────────────────────────────────────────

  rename(user: UserContext, folderId: number, rawName: string): Promise<FolderDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'RENAME_FOLDER',
        recordId: folderId,
        captureBefore: () => this.repo.getById(folderId).then((r) => (r ? toFolderDto(r) : null)),
      },
      async () => {
        const name = validateFolderName(rawName);
        const f = await this.require(folderId);
        if (f.isDeleted) {
          throw new BusinessException('ไม่สามารถเปลี่ยนชื่อ Folder ที่ถูกลบ', 'FOLDER_DELETED');
        }
        if (f.parentFolderId === null) {
          throw new BusinessException(
            `ไม่อนุญาตให้เปลี่ยนชื่อ Root Folder หลัก '${f.folderName}'`,
            'ROOT_FOLDER_IMMUTABLE',
          );
        }
        await this.access.assertEdit(
          user,
          f,
          `ไม่มีสิทธิ์เปลี่ยนชื่อ Folder '${f.folderName}' (ต้องการสิทธิ์ Edit)`,
        );
        const siblings = await this.repo.getSiblings(f.parentFolderId, f.orgUnitId);
        const dup = siblings.find(
          (s) => s.folderId !== folderId && isSameFolderName(s.folderName, name),
        );
        if (dup) {
          throw new ConflictBusinessException(
            `มี Folder ชื่อ '${dup.folderName}' อยู่แล้วใน Parent เดียวกัน`,
            'FOLDER_NAME_DUPLICATE',
            { folderId: dup.folderId },
          );
        }
        await this.repo.rename(f, name, user.userId);
        return toFolderDto(await this.require(folderId));
      },
      (r) => ({ after: r }),
    );
  }

  /**
   * ย้ายโฟลเดอร์ (SrOfficer ขึ้นไป) — ต้องมีสิทธิ์ทั้งต้นทางและปลายทาง (Admin ข้าม) · ห้ามย้ายเข้าตัวเอง/ลูกหลาน · ลึกไม่เกิน 10 · ชื่อไม่ซ้ำ
   * ทั้งต้นไม้ย่อยรับ OrgUnit และชั้นความลับของปลายทาง · ไม่ย้ายไฟล์กายภาพ (ระบบหาไฟล์ได้จากที่เก็บเดิม)
   */
  move(user: UserContext, folderId: number, destParentId: number): Promise<FolderDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'MOVE_FOLDER',
        recordId: folderId,
        meta: { destinationParentFolderId: destParentId },
        captureBefore: () => this.repo.getById(folderId).then((r) => (r ? toFolderDto(r) : null)),
      },
      async () => {
        if (user.appRole < AppRole.SrOfficer) {
          throw new PermissionDeniedException(
            'ต้องมีสิทธิ์ระดับ SrOfficer ขึ้นไป',
            'ROLE_REQUIRED',
          );
        }
        const source = await this.require(folderId);
        const dest = await this.require(destParentId);
        if (source.isDeleted) {
          throw new BusinessException('ไม่สามารถย้าย Folder ที่ถูกลบ', 'FOLDER_DELETED');
        }
        await this.requireUsable(destParentId, 'Folder ปลายทาง');
        await this.access.assertMoveWithin(
          user,
          source,
          `ไม่มีสิทธิ์ย้ายจาก Folder ต้นทาง (ID: ${folderId})`,
        );
        await this.access.assertMoveWithin(user, dest, 'ไม่มีสิทธิ์ย้ายไปยัง Folder ปลายทาง');

        const subtree = await this.repo.getSubtree(folderId);
        const descendants = subtree.filter((x) => x.folderId !== folderId);
        assertMoveAllowed({
          sourceId: folderId,
          destId: destParentId,
          sourceName: source.folderName,
          sourceIsRoot: source.parentFolderId === null,
          destIsInsideSource: subtree.some((x) => x.folderId === destParentId),
          projectedDepth: projectedDepthAfterMove({
            destDepth: dest.folderDepth,
            sourceDepth: source.folderDepth,
            maxSubtreeDepth: Math.max(source.folderDepth, ...descendants.map((d) => d.folderDepth)),
          }),
          destChildNames: (await this.repo.getChildren(destParentId))
            .filter((c) => c.folderId !== folderId)
            .map((c) => c.folderName),
        });
        assertUnderMainRoot(await this.repo.getRootAncestor(destParentId));

        if (source.parentFolderId !== destParentId) {
          await this.tx.run((s) =>
            this.repo.reparent(
              {
                sourceId: folderId,
                newParentId: destParentId,
                depthDelta: dest.folderDepth + 1 - source.folderDepth,
                orgUnitId: dest.orgUnitId,
                confidentialityLevel: dest.confidentialityLevel,
                descendantIds: descendants.map((d) => d.folderId),
                updatedBy: user.userId,
              },
              s,
            ),
          );
        }
        return toFolderDto(await this.require(folderId));
      },
      (r) => ({ after: r }),
    );
  }

  /**
   * คัดลอกโครงสร้างโฟลเดอร์ (เฉพาะโฟลเดอร์ ไม่รวมไฟล์/สิทธิ์) — Manager ขึ้นไป
   * โฟลเดอร์ใหม่รับ OrgUnit/ชั้นความลับของปลายทาง · ทำใน transaction เดียว (ล้มกลางทาง = ไม่เหลือโฟลเดอร์ค้าง)
   */
  copyStructure(
    user: UserContext,
    sourceId: number,
    destParentId: number,
  ): Promise<CopyStructureResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'COPY_STRUCTURE',
        recordId: sourceId,
        meta: { destinationParentFolderId: destParentId },
      },
      async () => {
        if (user.appRole < AppRole.Manager) {
          throw new PermissionDeniedException(
            'ต้องมีสิทธิ์ Manager หรือ Admin เพื่อคัดลอกโครงสร้าง Folder',
            'ROLE_REQUIRED',
          );
        }
        const source = await this.requireUsable(sourceId, 'Folder ต้นทาง');
        const dest = await this.requireUsable(destParentId, 'Folder ปลายทาง');
        await this.access.assertView(user, source);
        await this.access.assertAdd(user, dest);
        assertUnderMainRoot(await this.repo.getRootAncestor(destParentId));

        const subtree = (await this.repo.getSubtree(sourceId))
          .filter((x) => !x.isDeleted && !x.isArchived)
          .sort((a, b) => a.folderDepth - b.folderDepth || a.folderId - b.folderId);
        if (subtree.some((x) => x.folderId === destParentId)) {
          throw new BusinessException(
            'ไม่สามารถคัดลอกโครงสร้างไปไว้ใต้ตัวเอง',
            'FOLDER_COPY_INTO_SELF',
          );
        }
        const maxDepth = Math.max(...subtree.map((x) => x.folderDepth));
        assertDepthWithinLimit(dest.folderDepth + 1 + (maxDepth - source.folderDepth));
        const siblings = await this.repo.getChildren(destParentId);
        if (siblings.some((s) => isSameFolderName(s.folderName, source.folderName))) {
          throw new ConflictBusinessException(
            `มี Folder ชื่อ '${source.folderName}' อยู่แล้วใน Folder ปลายทาง`,
            'FOLDER_NAME_DUPLICATE',
          );
        }
        await this.quota?.enforceQuota(dest.orgUnitId);

        const copied = await this.tx.run(async (s) => {
          const map = new Map<number, number>();
          const depthShift = dest.folderDepth + 1 - source.folderDepth;
          for (const f of subtree) {
            const isRoot = f.folderId === sourceId;
            const parentNew = isRoot ? destParentId : map.get(f.parentFolderId as number);
            if (parentNew === undefined) continue; // แม่ถูกข้าม (ลบ/เก็บถาวร) → ข้ามลูกด้วย
            const id = await this.repo.insert(
              {
                folderName: f.folderName,
                parentFolderId: parentNew,
                orgUnitId: dest.orgUnitId,
                confidentialityLevel: dest.confidentialityLevel,
                folderDepth: f.folderDepth + depthShift,
                inheritPermission: f.inheritPermission,
                createdBy: user.userId,
              },
              s,
            );
            map.set(f.folderId, id);
          }
          return { rootId: map.get(sourceId) as number, count: map.size };
        });
        return {
          folder: toFolderDto(await this.require(copied.rootId)),
          createdCount: copied.count,
        };
      },
      (r) => ({ after: { newFolderId: r.folder.folderId, createdCount: r.createdCount } }),
    );
  }

  /**
   * เปลี่ยนชั้นความลับ (Manager ขึ้นไป · BR-001-07): ทำได้เฉพาะโฟลเดอร์ที่อยู่ใต้ Conf-Root โดยตรง
   * — ย้ายโฟลเดอร์ไปอยู่ใต้ Root ของชั้นใหม่ในหน่วยงานเดียวกัน และให้ทั้งต้นไม้ย่อยเปลี่ยนชั้นตาม
   */
  changeConfidentiality(user: UserContext, folderId: number, newLevel: number): Promise<FolderDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'CHANGE_CONF_LEVEL',
        recordId: folderId,
        meta: { newLevel },
        captureBefore: () => this.repo.getById(folderId).then((r) => (r ? toFolderDto(r) : null)),
      },
      async () => {
        if (user.appRole < AppRole.Manager) {
          throw new PermissionDeniedException(
            'การเปลี่ยนชั้นความลับต้องมีสิทธิ์ Manager หรือ Admin',
            'ROLE_REQUIRED',
          );
        }
        if (!isMainRootLevel(newLevel)) {
          throw new BusinessException('ชั้นความลับต้องเป็น 1–4', 'CONFIDENTIALITY_INVALID');
        }
        const f = await this.require(folderId);
        if (f.isDeleted) {
          throw new BusinessException('ไม่สามารถแก้ Folder ที่ถูกลบ', 'FOLDER_DELETED');
        }
        await this.access.assertEdit(user, f);
        if (f.parentFolderId === null) {
          throw new BusinessException(
            'Conf-Root folder ระดับความลับถูก Lock ไม่สามารถเปลี่ยนได้',
            'CONF_ROOT_LOCKED',
          );
        }
        const parent = await this.require(f.parentFolderId);
        if (parent.parentFolderId !== null) {
          throw new BusinessException(
            'เปลี่ยนระดับความลับได้เฉพาะ Folder ที่อยู่ภายใต้ Conf-Root โดยตรงเท่านั้น',
            'CONF_CHANGE_NOT_DIRECT_CHILD',
          );
        }
        if (parent.confidentialityLevel === newLevel && f.confidentialityLevel === newLevel) {
          return toFolderDto(f); // ไม่มีอะไรต้องเปลี่ยน
        }
        const roots = (await this.repo.getRootsByOrgUnit(f.orgUnitId))
          .filter((r) => !r.isArchived && isMainRoot(r) && r.confidentialityLevel === newLevel)
          .sort((a, b) => a.folderId - b.folderId);
        const newRoot = roots[0];
        if (!newRoot) {
          throw new BusinessException(
            `ไม่พบ Conf-Root ระดับ ${newLevel} ใน OrgUnit นี้`,
            'CONF_ROOT_NOT_FOUND',
            { level: newLevel },
          );
        }
        const dup = (await this.repo.getChildren(newRoot.folderId)).find(
          (c) => c.folderId !== folderId && isSameFolderName(c.folderName, f.folderName),
        );
        if (dup) {
          throw new ConflictBusinessException(
            `มี Folder ชื่อ '${dup.folderName}' อยู่แล้วใน Root ปลายทาง`,
            'FOLDER_NAME_DUPLICATE',
            { folderId: dup.folderId },
          );
        }
        const descendants = (await this.repo.getSubtree(folderId)).filter(
          (x) => x.folderId !== folderId,
        );
        await this.tx.run((s) =>
          this.repo.changeConfidentiality(
            {
              folderId,
              newRootId: newRoot.folderId,
              newLevel,
              descendantIds: descendants.map((d) => d.folderId),
              updatedBy: user.userId,
            },
            s,
          ),
        );
        return toFolderDto(await this.require(folderId));
      },
      (r) => ({ after: r }),
    );
  }

  // ── ลบ ─────────────────────────────────────────────────────

  /**
   * ลบโฟลเดอร์แบบ soft ทั้งต้นไม้ย่อย (sp_SoftDeleteFolder → เข้าถังขยะ 30 วัน)
   * ถ้ามีไฟล์ที่ยังใช้งานอยู่ในต้นไม้ย่อย → 409 FOLDER_HAS_FILES (ต้องยื่นคำขอ DELETE_FOLDER แทน)
   */
  remove(user: UserContext, folderId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_FOLDER',
        recordId: folderId,
        captureBefore: () => this.repo.getById(folderId).then((r) => (r ? toFolderDto(r) : null)),
      },
      async () => {
        const f = await this.require(folderId);
        await this.assertDeletable(user, f);
        const files = await this.repo.countActiveFilesInSubtree(folderId);
        if (files > 0) {
          throw new ConflictBusinessException(
            `ไม่สามารถลบ Folder '${f.folderName}' ได้โดยตรง เนื่องจากมีไฟล์อยู่ ${files} รายการ กรุณายื่นคำขออนุมัติการลบ`,
            'FOLDER_HAS_FILES',
            { folderId, fileCount: files, directFileCount: f.fileCount },
          );
        }
        await this.repo.softDeleteTree(folderId, user.userId);
      },
    );
  }

  private async assertDeletable(user: UserContext, f: FolderRow): Promise<void> {
    if (f.isDeleted) {
      throw new ConflictBusinessException('Folder อยู่ในถังขยะแล้ว', 'FOLDER_ALREADY_DELETED');
    }
    if (f.parentFolderId === null && !isPrivilegedUser(user)) {
      throw new PermissionDeniedException(
        `ไม่อนุญาตให้ลบ Root Folder หลัก '${f.folderName}'`,
        'ROOT_FOLDER_DELETE_DENIED',
      );
    }
    await this.access.assertDeleteFolder(
      user,
      f,
      `ไม่มีสิทธิ์ลบ Folder '${f.folderName}' (ต้องการสิทธิ์ Modify)`,
    );
  }

  /** ยื่นคำขออนุมัติลบโฟลเดอร์ที่มีไฟล์ (DELETE_FOLDER) — ผู้อนุมัติคือ Admin ที่ใช้งานอยู่ */
  requestDelete(
    user: UserContext,
    folderId: number,
    dto: RequestFolderDeleteDto,
  ): Promise<ApprovalRefDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'REQUEST_DELETE_FOLDER', recordId: folderId },
      async () => {
        const f = await this.require(folderId);
        await this.assertDeletable(user, f);
        const files = await this.repo.countActiveFilesInSubtree(folderId);
        if (files === 0) {
          throw new BusinessException(
            'Folder ไม่มีไฟล์ สามารถลบได้โดยตรงโดยไม่ต้องขออนุมัติ',
            'FOLDER_HAS_NO_FILES',
          );
        }
        if (!this.approvals) {
          throw serviceUnavailable(
            'ระบบอนุมัติยังไม่พร้อมใช้งาน จึงยังยื่นคำขอลบไม่ได้',
            'APPROVAL_SERVICE_UNAVAILABLE',
          );
        }
        const admins = await this.repo.activeUserIdsByRole(AppRole.Admin);
        if (admins.length === 0) {
          throw new BusinessException(
            'ไม่พบ Admin ที่ Active ในระบบ ไม่สามารถส่งคำขออนุมัติได้',
            'NO_ACTIVE_ADMIN',
          );
        }
        // ส่งให้ Admin ทุกคน (ยกเว้นผู้ขอ) — ถ้ามี Admin คนเดียวและเป็นผู้ขอ ให้อนุมัติเองได้ (พฤติกรรมเดิม)
        const others = admins.filter((id) => id !== user.userId);
        const ref = await this.approvals.submit(user, {
          requestType: 'DELETE_FOLDER',
          subject: `ขออนุมัติลบ Folder: ${f.folderName}`,
          folderId,
          reason: dto.reason,
          approverUserIds: others.length > 0 ? others : admins,
        });
        return { requestId: ref.requestId, requestStatus: ref.requestStatus };
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบ (soft) หลังคำขอ DELETE_FOLDER ได้รับอนุมัติ — เรียกจาก handler (idempotent) */
  deleteAfterApproval(
    record: ApprovalRecord,
    approver: UserContext,
    scope?: TransactionScope,
  ): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_FOLDER_APPROVED',
        recordId: record.folderId ?? undefined,
        meta: { requestId: record.requestId },
      },
      async () => {
        if (!record.folderId) {
          throw new BusinessException('คำขอลบโฟลเดอร์ไม่ระบุโฟลเดอร์', 'APPROVAL_PAYLOAD_INVALID');
        }
        const f = await this.require(record.folderId, scope);
        if (f.isDeleted) return;
        await this.repo.softDeleteTree(record.folderId, approver.userId, scope);
      },
    );
  }

  private alertQuota(orgUnitId: number): void {
    if (!this.quota) return;
    this.quota.sendAlertIfNeeded(orgUnitId).catch((err: unknown) => {
      this.logger.warn(
        `ส่งแจ้งเตือนโควตาหน่วยงาน ${orgUnitId} ไม่สำเร็จ: ${(err as Error).message}`,
      );
    });
  }
}
