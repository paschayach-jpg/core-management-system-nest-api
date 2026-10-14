import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppRole } from '../../../common/constants/enums';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { MenuItem } from '../entities/menu-item.entity';
import type { MenuNodeDto, MenuStatisticsDto, UpsertMenuDto } from './dto/menu.dto';

/**
 * เมนูของระบบ (EMS.MenuItem) — เมนูที่ผู้ใช้เห็นกรองตาม RequiredAppRole <= AppRole ของผู้ใช้ (null = ทุกคน)
 * API ส่งเป็นต้นไม้ให้ client ใหม่ (web) ใช้สร้างเมนู · `formClassName` คงไว้เพื่อ map กับหน้าจอเดิม
 */
@Injectable()
export class MenusService extends CrudLoggedService {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'MenuItem';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(MenuItem) private readonly repo: Repository<MenuItem>,
    private readonly sp: SpExecutor,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  /** เมนูที่ผู้ใช้คนนี้เห็น (เฉพาะ active + role พอ) เป็นต้นไม้ */
  async treeFor(user: UserContext): Promise<MenuNodeDto[]> {
    const all = await this.repo.find({ where: { isActive: true } });
    const visible = all.filter(
      (m) =>
        m.requiredAppRole === null ||
        m.requiredAppRole === undefined ||
        m.requiredAppRole <= user.appRole,
    );
    return buildTree(visible);
  }

  /** ทุกเมนูรวมที่ปิดอยู่ (หน้าจัดการ — Admin) */
  async treeForManagement(): Promise<MenuNodeDto[]> {
    return buildTree(await this.repo.find());
  }

  async isKeyUnique(menuKey: string, excludeId?: number): Promise<boolean> {
    const found = await this.repo.findOneBy({ menuKey });
    return !found || found.menuItemId === excludeId;
  }

  async statistics(): Promise<MenuStatisticsDto> {
    const all = await this.repo.find();
    const last = all.map((m) => m.modifiedDate ?? m.createdDate).filter((d): d is Date => !!d);
    return {
      totalMenuItems: all.length,
      activeMenuItems: all.filter((m) => m.isActive).length,
      adminOnlyMenus: all.filter((m) => m.requiredAppRole === AppRole.Admin).length,
      managerOnlyMenus: all.filter(
        (m) => m.requiredAppRole === AppRole.SrOfficer || m.requiredAppRole === AppRole.Manager,
      ).length,
      publicMenus: all.filter(
        (m) => m.requiredAppRole == null || m.requiredAppRole === AppRole.Officer,
      ).length,
      lastModified: last.length ? new Date(Math.max(...last.map((d) => d.getTime()))) : null,
    };
  }

  create(dto: UpsertMenuDto, admin: UserContext): Promise<MenuItem> {
    return this.logged(
      { action: 'CREATE', operation: 'CREATE_MENU', meta: { menuKey: dto.menuKey } },
      async () => {
        const id = await this.sp.call(Sp.ems.createMenuItem).scalar<number>({
          ParentMenuItemID: dto.parentMenuItemId ?? null,
          MenuName: dto.menuName,
          MenuKey: dto.menuKey,
          FormClassName: dto.formClassName ?? null,
          IconKey: dto.iconKey ?? null,
          DisplayOrder: dto.displayOrder ?? 0,
          IsActive: dto.isActive ?? true,
          RequiredAppRole: dto.requiredAppRole ?? null,
          Description: dto.description ?? null,
          ModuleCode: dto.moduleCode ?? null,
          Url: dto.url ?? null,
          CreatedByUserID: admin.userId,
        });
        return this.requireOne(Number(id));
      },
      (r) => ({ recordId: r.menuItemId, after: r }),
    );
  }

  update(id: number, dto: UpsertMenuDto, admin: UserContext): Promise<MenuItem> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_MENU',
        recordId: id,
        captureBefore: () => this.requireOne(id),
      },
      async () => {
        await this.requireOne(id);
        await this.sp.call(Sp.ems.updateMenuItem).exec({
          MenuItemID: id,
          ParentMenuItemID: dto.parentMenuItemId ?? null,
          MenuName: dto.menuName,
          MenuKey: dto.menuKey,
          FormClassName: dto.formClassName ?? null,
          IconKey: dto.iconKey ?? null,
          DisplayOrder: dto.displayOrder ?? 0,
          IsActive: dto.isActive ?? true,
          RequiredAppRole: dto.requiredAppRole ?? null,
          Description: dto.description ?? null,
          ModuleCode: dto.moduleCode ?? null,
          Url: dto.url ?? null,
          ModifiedByUserID: admin.userId,
        });
        return this.requireOne(id);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบเมนู (FK cascade ลบเมนูลูกด้วย) */
  remove(id: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_MENU',
        recordId: id,
        captureBefore: () => this.requireOne(id),
      },
      async () => {
        await this.requireOne(id);
        await this.sp.call(Sp.ems.deleteMenuItem).exec({ MenuItemID: id });
      },
    );
  }

  reorder(
    items: { menuItemId: number; displayOrder: number }[],
    admin: UserContext,
  ): Promise<void> {
    return this.logged(
      { action: 'UPDATE', operation: 'REORDER_MENUS', meta: { count: items.length } },
      () =>
        this.tx.run(async ({ manager }) => {
          for (const it of items) {
            await manager.update(
              MenuItem,
              { menuItemId: it.menuItemId },
              {
                displayOrder: it.displayOrder,
                modifiedDate: new Date(),
                modifiedByUserId: admin.userId,
              },
            );
          }
        }),
    );
  }

  private async requireOne(id: number): Promise<MenuItem> {
    const m = await this.repo.findOneBy({ menuItemId: id });
    if (!m) throw new ResourceNotFoundException('MenuItem', id);
    return m;
  }
}

export function buildTree(items: MenuItem[]): MenuNodeDto[] {
  const nodes = new Map<number, MenuNodeDto>();
  for (const m of items) {
    nodes.set(m.menuItemId, {
      menuItemId: m.menuItemId,
      parentMenuItemId: m.parentMenuItemId ?? null,
      menuName: m.menuName,
      menuKey: m.menuKey,
      formClassName: m.formClassName,
      iconKey: m.iconKey,
      displayOrder: m.displayOrder ?? 0,
      isActive: Boolean(m.isActive),
      requiredAppRole: m.requiredAppRole ?? null,
      moduleCode: m.moduleCode,
      url: m.url,
      description: m.description,
      children: [],
    });
  }
  const roots: MenuNodeDto[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentMenuItemId ? nodes.get(n.parentMenuItemId) : undefined;
    // เมนูลูกที่ parent ถูกกรองออก (ไม่มีสิทธิ์/ปิดอยู่) จะไม่แสดง
    if (parent) parent.children.push(n);
    else if (!n.parentMenuItemId) roots.push(n);
  }
  const sort = (list: MenuNodeDto[]): void => {
    list.sort(
      (a, b) => a.displayOrder - b.displayOrder || a.menuName.localeCompare(b.menuName, 'th'),
    );
    list.forEach((x) => sort(x.children));
  };
  sort(roots);
  return roots;
}
