import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { TransactionRunner } from '../../../../database/transaction-runner.service';
import { type DmsQuotaPort, DMS_QUOTA_PORT } from '../../ports/dms-quota.port';
import { FolderAccess } from '../access/folder-access';
import { toFolderDto } from '../folders/dto/folder.dto';
import { FolderRepository } from '../folders/folder.repository';
import { FoldersService } from '../folders/folders.service';
import {
  assertRootCreationAllowed,
  assertUnderMainRoot,
  isMainRootLevel,
  isSameFolderName,
  validateFolderName,
} from '../rules/folder.rules';
import { planTemplateFolders, type TemplateItemLike } from '../rules/template.rules';
import {
  ApplyTemplateResultDto,
  ApplyTemplateToOrgUnitDto,
  CreateFolderTemplateDto,
  CreateTemplateItemDto,
  FolderTemplateDetailDto,
  FolderTemplateDto,
  FolderTemplateItemDto,
  UpdateFolderTemplateDto,
  UpdateTemplateItemDto,
} from './dto/folder-template.dto';
import { FolderTemplateRepository } from './folder-template.repository';

/**
 * แม่แบบโฟลเดอร์ (storage.FolderTemplate / FolderTemplateItem) — พอร์ตจาก FolderTemplateRepository + FolderService.ApplyTemplate*
 * อ่านได้ทุกคนที่ login · จัดการแม่แบบและสร้างโฟลเดอร์จากแม่แบบ: Manager ขึ้นไป
 */
@Injectable()
export class FolderTemplatesService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'FolderTemplate';

  constructor(
    crudLog: CrudLogService,
    private readonly repo: FolderTemplateRepository,
    private readonly folderRepo: FolderRepository,
    private readonly folders: FoldersService,
    private readonly access: FolderAccess,
    private readonly tx: TransactionRunner,
    @Optional() @Inject(DMS_QUOTA_PORT) private readonly quota?: DmsQuotaPort,
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

  // ── อ่าน ───────────────────────────────────────────────────

  list(user: UserContext, includeInactive = false): Promise<FolderTemplateDto[]> {
    return this.repo.list(includeInactive && user.appRole >= AppRole.Manager);
  }

  async get(templateId: number): Promise<FolderTemplateDetailDto> {
    const t = await this.requireTemplate(templateId);
    return { ...t, items: await this.repo.items(templateId) };
  }

  private async requireTemplate(templateId: number): Promise<FolderTemplateDto> {
    const t = await this.repo.getById(templateId);
    if (!t) throw new ResourceNotFoundException('FolderTemplate', templateId);
    return t;
  }

  // ── แม่แบบ ─────────────────────────────────────────────────

  create(user: UserContext, dto: CreateFolderTemplateDto): Promise<FolderTemplateDto> {
    return this.logged(
      { action: 'CREATE', operation: 'CREATE_FOLDER_TEMPLATE', meta: { code: dto.templateCode } },
      async () => {
        this.assertManager(user, 'การสร้างแม่แบบโฟลเดอร์');
        if (await this.repo.codeExists(dto.templateCode)) {
          throw new ConflictBusinessException(
            `รหัสแม่แบบ '${dto.templateCode}' มีอยู่แล้ว`,
            'TEMPLATE_CODE_DUPLICATE',
          );
        }
        const id = await this.repo.insert({
          templateCode: dto.templateCode,
          templateName: dto.templateName,
          targetType: dto.targetType,
          description: dto.description ?? null,
          orgUnitId: dto.orgUnitId ?? null,
          createdBy: user.userId,
        });
        return this.requireTemplate(id);
      },
      (r) => ({ recordId: r.templateId, after: r }),
    );
  }

  update(
    user: UserContext,
    templateId: number,
    dto: UpdateFolderTemplateDto,
  ): Promise<FolderTemplateDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_FOLDER_TEMPLATE',
        recordId: templateId,
        captureBefore: () => this.repo.getById(templateId),
      },
      async () => {
        this.assertManager(user, 'การแก้แม่แบบโฟลเดอร์');
        const cur = await this.requireTemplate(templateId);
        const code = dto.templateCode ?? cur.templateCode;
        if (code !== cur.templateCode && (await this.repo.codeExists(code, templateId))) {
          throw new ConflictBusinessException(
            `รหัสแม่แบบ '${code}' มีอยู่แล้ว`,
            'TEMPLATE_CODE_DUPLICATE',
          );
        }
        await this.repo.update(templateId, {
          templateCode: code,
          templateName: dto.templateName ?? cur.templateName,
          targetType: dto.targetType ?? cur.targetType,
          description: dto.description === undefined ? cur.description : dto.description,
          orgUnitId: dto.orgUnitId === undefined ? cur.orgUnitId : dto.orgUnitId,
          isActive: dto.isActive ?? cur.isActive,
        });
        return this.requireTemplate(templateId);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบแม่แบบพร้อมรายการทั้งหมด — ถ้ายังมีโฟลเดอร์อ้างอิงแม่แบบนี้ (Folder.TemplateID) ลบไม่ได้ ให้ปิดใช้งานแทน */
  remove(user: UserContext, templateId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_FOLDER_TEMPLATE',
        recordId: templateId,
        captureBefore: () => this.get(templateId),
      },
      async () => {
        this.assertManager(user, 'การลบแม่แบบโฟลเดอร์');
        await this.requireTemplate(templateId);
        const used = await this.repo.foldersUsing(templateId);
        if (used > 0) {
          throw new ConflictBusinessException(
            `ลบแม่แบบไม่ได้ เพราะมีโฟลเดอร์ ${used} รายการอ้างอิงอยู่ (ปิดใช้งานแทนได้)`,
            'TEMPLATE_IN_USE',
            { folderCount: used },
          );
        }
        await this.tx.run((s) => this.repo.delete(templateId, s));
      },
    );
  }

  // ── รายการในแม่แบบ ─────────────────────────────────────────

  createItem(
    user: UserContext,
    templateId: number,
    dto: CreateTemplateItemDto,
  ): Promise<FolderTemplateItemDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'FolderTemplateItem',
        operation: 'CREATE_TEMPLATE_ITEM',
        meta: { templateId, name: dto.folderName },
      },
      async () => {
        this.assertManager(user, 'การแก้รายการในแม่แบบ');
        await this.requireTemplate(templateId);
        const name = validateFolderName(dto.folderName);
        const items = await this.repo.items(templateId);
        const parentId = dto.parentItemId ?? null;
        if (parentId !== null && !items.some((i) => i.itemId === parentId)) {
          throw new BusinessException('รายการแม่ไม่อยู่ในแม่แบบนี้', 'TEMPLATE_PARENT_NOT_FOUND', {
            parentItemId: parentId,
          });
        }
        this.assertNameFree(items, parentId, name, null);
        const id = await this.repo.insertItem({
          templateId,
          parentItemId: parentId,
          folderName: name,
          confidentialityLevel: dto.confidentialityLevel ?? 4,
          sortOrder: dto.sortOrder ?? 0,
          inheritPermission: dto.inheritPermission ?? true,
        });
        return this.requireItem(templateId, id);
      },
      (r) => ({ recordId: r.itemId, after: r }),
    );
  }

  updateItem(
    user: UserContext,
    templateId: number,
    itemId: number,
    dto: UpdateTemplateItemDto,
  ): Promise<FolderTemplateItemDto> {
    return this.logged(
      {
        action: 'UPDATE',
        entity: 'FolderTemplateItem',
        operation: 'UPDATE_TEMPLATE_ITEM',
        recordId: itemId,
        captureBefore: () => this.repo.getItem(itemId),
      },
      async () => {
        this.assertManager(user, 'การแก้รายการในแม่แบบ');
        const cur = await this.requireItem(templateId, itemId);
        const name =
          dto.folderName !== undefined ? validateFolderName(dto.folderName) : cur.folderName;
        if (name !== cur.folderName) {
          this.assertNameFree(await this.repo.items(templateId), cur.parentItemId, name, itemId);
        }
        await this.repo.updateItem(itemId, {
          folderName: name,
          confidentialityLevel: dto.confidentialityLevel ?? cur.confidentialityLevel,
          sortOrder: dto.sortOrder ?? cur.sortOrder,
          inheritPermission: dto.inheritPermission ?? cur.inheritPermission,
        });
        return this.requireItem(templateId, itemId);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบรายการพร้อมลูกหลานทุกชั้น */
  removeItem(user: UserContext, templateId: number, itemId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        entity: 'FolderTemplateItem',
        operation: 'DELETE_TEMPLATE_ITEM',
        recordId: itemId,
        captureBefore: () => this.repo.getItem(itemId),
      },
      async () => {
        this.assertManager(user, 'การลบรายการในแม่แบบ');
        await this.requireItem(templateId, itemId);
        await this.tx.run((s) => this.repo.deleteItemTree(itemId, s));
      },
    );
  }

  private async requireItem(templateId: number, itemId: number) {
    const item = await this.repo.getItem(itemId);
    if (!item || item.templateId !== templateId) {
      throw new ResourceNotFoundException('FolderTemplateItem', itemId);
    }
    return item;
  }

  private assertNameFree(
    items: readonly TemplateItemLike[],
    parentItemId: number | null,
    name: string,
    selfId: number | null,
  ): void {
    const dup = items.find(
      (i) =>
        i.parentItemId === parentItemId &&
        i.itemId !== selfId &&
        isSameFolderName(i.folderName, name),
    );
    if (dup) {
      throw new ConflictBusinessException(
        `มีรายการชื่อ '${dup.folderName}' อยู่แล้วในระดับเดียวกัน`,
        'TEMPLATE_ITEM_DUPLICATE',
        { itemId: dup.itemId },
      );
    }
  }

  // ── ใช้แม่แบบสร้างโฟลเดอร์ ─────────────────────────────────

  /**
   * สร้างโฟลเดอร์ย่อยตามแม่แบบใต้โฟลเดอร์ที่ระบุ (Manager+) — ใน transaction เดียว (ล้มกลางทาง = ไม่เหลือโฟลเดอร์ค้าง)
   * ตรวจ: โฟลเดอร์แม่ใช้งานได้/อยู่ใต้ Root หลัก/มีสิทธิ์เพิ่ม, ลึกไม่เกิน 10, ชื่อชั้นบนสุดไม่ซ้ำกับของเดิม, โควตา
   */
  applyToFolder(
    user: UserContext,
    parentFolderId: number,
    templateId: number,
  ): Promise<ApplyTemplateResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'Folder',
        operation: 'APPLY_TEMPLATE',
        recordId: parentFolderId,
        meta: { templateId },
      },
      async () => {
        this.assertManager(user, 'การสร้างโฟลเดอร์จากแม่แบบ');
        const parent = await this.folders.requireUsable(parentFolderId, 'โฟลเดอร์ปลายทาง');
        await this.access.assertAdd(
          user,
          parent,
          `ไม่มีสิทธิ์สร้าง Folder ใน '${parent.folderName}' (ต้องการสิทธิ์ Add)`,
        );
        assertUnderMainRoot(await this.folderRepo.getRootAncestor(parentFolderId));
        const items = await this.loadUsableItems(templateId);
        const plan = planTemplateFolders(items, {
          parentDepth: parent.folderDepth,
          parentLevel: parent.confidentialityLevel,
        });
        const existing = await this.folderRepo.getChildren(parentFolderId);
        const clash = plan
          .filter((p) => p.parentItemId === null)
          .find((p) => existing.some((e) => isSameFolderName(e.folderName, p.folderName)));
        if (clash) {
          throw new ConflictBusinessException(
            `มี Folder ชื่อ '${clash.folderName}' อยู่แล้วใน '${parent.folderName}'`,
            'FOLDER_NAME_DUPLICATE',
          );
        }
        await this.quota?.enforceQuota(parent.orgUnitId);
        return this.tx.run(async (s) => {
          const map = new Map<number, number>();
          const topIds: number[] = [];
          for (const p of plan) {
            const parentId =
              p.parentItemId === null ? parentFolderId : (map.get(p.parentItemId) as number);
            const id = await this.folderRepo.insert(
              {
                folderName: p.folderName,
                parentFolderId: parentId,
                orgUnitId: parent.orgUnitId,
                confidentialityLevel: p.confidentialityLevel,
                folderDepth: p.depth,
                inheritPermission: p.inheritPermission,
                createdBy: user.userId,
              },
              s,
            );
            map.set(p.itemId, id);
            if (p.parentItemId === null) topIds.push(id);
          }
          const created = await Promise.all(topIds.map((id) => this.folders.require(id, s)));
          return { createdCount: plan.length, folders: created.map(toFolderDto) };
        });
      },
      (r) => ({ after: { createdCount: r.createdCount } }),
    );
  }

  /**
   * สร้าง Root ใหม่ของหน่วยงานพร้อมโครงสร้างจากแม่แบบ (ApplyTemplateToOrgUnit) — Manager+
   * Root 2SC/3NC/4PC เท่านั้น (1HC ต้องขออนุมัติผ่าน POST /dms/folders แล้วใช้ applyToFolder ใต้โฟลเดอร์นั้น)
   */
  applyToOrgUnit(
    user: UserContext,
    templateId: number,
    dto: ApplyTemplateToOrgUnitDto,
  ): Promise<ApplyTemplateResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'Folder',
        operation: 'APPLY_TEMPLATE_TO_ORG_UNIT',
        recordId: dto.orgUnitId,
        meta: { templateId, level: dto.confidentialityLevel },
      },
      async () => {
        this.assertManager(user, 'การสร้างโฟลเดอร์จากแม่แบบ');
        const level = dto.confidentialityLevel;
        if (!isMainRootLevel(level) || level === 1) {
          throw new BusinessException(
            'สร้าง Root ระดับ 1HC จากแม่แบบโดยตรงไม่ได้ (ต้องขออนุมัติ) — ให้สร้าง 1HC ผ่าน POST /dms/folders แล้วใช้แม่แบบใต้โฟลเดอร์นั้น',
            'HC_ROOT_REQUIRES_APPROVAL',
          );
        }
        const name = validateFolderName(dto.rootFolderName);
        if (!(await this.folderRepo.orgUnitIsUsable(dto.orgUnitId))) {
          throw new ResourceNotFoundException('OrgUnit', dto.orgUnitId);
        }
        const items = await this.loadUsableItems(templateId);
        if (items.length === 0) {
          throw new BusinessException('แม่แบบนี้ไม่มี Sub-Folder กำหนดไว้', 'TEMPLATE_EMPTY');
        }
        assertRootCreationAllowed({
          name,
          level,
          existingRoots: await this.folderRepo.getRootsByOrgUnit(dto.orgUnitId),
        });
        const plan = planTemplateFolders(items, { parentDepth: 1, parentLevel: level });
        await this.quota?.enforceQuota(dto.orgUnitId);
        return this.tx.run(async (s) => {
          const rootId = await this.folderRepo.insert(
            {
              folderName: name,
              parentFolderId: null,
              orgUnitId: dto.orgUnitId,
              confidentialityLevel: level,
              folderDepth: 1,
              inheritPermission: false,
              createdBy: user.userId,
            },
            s,
          );
          const map = new Map<number, number>();
          for (const p of plan) {
            const parentId = p.parentItemId === null ? rootId : (map.get(p.parentItemId) as number);
            map.set(
              p.itemId,
              await this.folderRepo.insert(
                {
                  folderName: p.folderName,
                  parentFolderId: parentId,
                  orgUnitId: dto.orgUnitId,
                  confidentialityLevel: p.confidentialityLevel,
                  folderDepth: p.depth,
                  inheritPermission: p.inheritPermission,
                  createdBy: user.userId,
                },
                s,
              ),
            );
          }
          return {
            createdCount: plan.length + 1,
            folders: [toFolderDto(await this.folders.require(rootId, s))],
          };
        });
      },
      (r) => ({ after: { createdCount: r.createdCount, rootFolderId: r.folders[0]?.folderId } }),
    );
  }

  private async loadUsableItems(templateId: number) {
    const t = await this.requireTemplate(templateId);
    if (!t.isActive) {
      throw new BusinessException('แม่แบบนี้ถูกปิดใช้งาน', 'TEMPLATE_INACTIVE', { templateId });
    }
    const items = await this.repo.items(templateId);
    if (items.length === 0) {
      throw new BusinessException('Template นี้ไม่มี Sub-Folder กำหนดไว้', 'TEMPLATE_EMPTY');
    }
    return items;
  }
}
