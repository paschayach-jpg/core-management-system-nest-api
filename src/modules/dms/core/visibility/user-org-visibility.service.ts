import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AppRole } from '../../../../common/constants/enums';
import {
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import {
  OrgUnitNode,
  resolveVisibleOrgUnitIds,
  VisibilityMode,
} from '../rules/org-visibility.rules';
import type {
  OrgVisibilityDto,
  OrgVisibilityGrantDto,
  UserOrgVisibilityDetailDto,
  VisibleOrgUnitDto,
} from './dto/visibility.dto';

type Raw = Record<string, unknown>;

interface OrgUnitRow extends OrgUnitNode {
  orgUnitCode: string;
  orgUnitNameTh: string;
  orgUnitType: number;
}

/**
 * การมองเห็นหน่วยงานรายผู้ใช้ (security.UserOrgVisibility) — พอร์ตจาก UserOrgVisibilityService
 *  - Admin เท่านั้นที่ grant/revoke (บังคับที่ controller ด้วย @MinRole และซ้ำใน service)
 *  - ซ่อน/แสดงหน่วยงานในมุมมองของตัวเองใช้ EMS.sp_GetHiddenOrgUnitIds / sp_SaveHiddenOrgUnitIds
 */
@Injectable()
export class UserOrgVisibilityService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'UserOrgVisibility';

  constructor(
    crudLog: CrudLogService,
    private readonly sp: SpExecutor,
    @InjectDataSource() private readonly ds: DataSource,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  private async loadOrgUnits(): Promise<OrgUnitRow[]> {
    const rows = await this.sp.call(Sp.ems.getOrgUnitHierarchy).rows<Raw>({});
    return rows.map((r) => ({
      orgUnitId: Number(r.OrgUnitID),
      orgUnitCode: String(r.OrgUnitCode ?? ''),
      orgUnitNameTh: String(r.OrgUnitNameTH ?? ''),
      orgUnitType: Number(r.OrgUnitType),
      parentOrgUnitId:
        r.ParentOrgUnitID === null || r.ParentOrgUnitID === undefined
          ? null
          : Number(r.ParentOrgUnitID),
      isActive: Boolean(r.IsActive),
      isDeleted: Boolean(r.IsDeleted),
    }));
  }

  private async grantedIds(userId: number): Promise<number[]> {
    const rows: { OrgUnitID: number }[] = await this.ds.query(
      'SELECT OrgUnitID FROM security.UserOrgVisibility WHERE UserID = @0',
      [userId],
    );
    return rows.map((r) => Number(r.OrgUnitID));
  }

  /** รหัสหน่วยงานที่ผู้ใช้มองเห็น (ใช้กรองรายการโฟลเดอร์) */
  async visibleOrgUnitIds(
    user: Pick<UserContext, 'userId' | 'appRole' | 'orgUnitId'>,
  ): Promise<{ mode: VisibilityMode; ids: Set<number> }> {
    const [granted, orgUnits] = await Promise.all([
      this.grantedIds(user.userId),
      this.loadOrgUnits(),
    ]);
    const r = resolveVisibleOrgUnitIds({ user, grantedOrgUnitIds: granted, orgUnits });
    return { mode: r.mode, ids: new Set(r.orgUnitIds) };
  }

  async getHiddenOrgUnitIds(userId: number): Promise<number[]> {
    const rows = await this.sp.call(Sp.ems.getHiddenOrgUnitIds).rows<Raw>({ UserId: userId });
    return rows.map((r) => Number(r.OrgUnitId ?? r.OrgUnitID));
  }

  /** ผังหน่วยงานที่ผู้ใช้เห็น พร้อมธงว่าซ่อนไว้หรือไม่ */
  async visibleHierarchy(
    target: Pick<UserContext, 'userId' | 'appRole' | 'orgUnitId'>,
  ): Promise<OrgVisibilityDto> {
    const [granted, orgUnits, hidden] = await Promise.all([
      this.grantedIds(target.userId),
      this.loadOrgUnits(),
      this.getHiddenOrgUnitIds(target.userId).catch(() => [] as number[]),
    ]);
    const r = resolveVisibleOrgUnitIds({ user: target, grantedOrgUnitIds: granted, orgUnits });
    const visible = new Set(r.orgUnitIds);
    const hiddenSet = new Set(hidden);
    const list: VisibleOrgUnitDto[] = orgUnits
      .filter((o) => visible.has(o.orgUnitId))
      .sort(
        (a, b) =>
          a.orgUnitType - b.orgUnitType || a.orgUnitNameTh.localeCompare(b.orgUnitNameTh, 'th'),
      )
      .map((o) => ({
        orgUnitId: o.orgUnitId,
        orgUnitCode: o.orgUnitCode,
        orgUnitNameTh: o.orgUnitNameTh,
        orgUnitType: o.orgUnitType,
        parentOrgUnitId: o.parentOrgUnitId,
        isHidden: hiddenSet.has(o.orgUnitId),
      }));
    return { mode: r.mode, orgUnits: list };
  }

  async explicitGrants(userId: number): Promise<OrgVisibilityGrantDto[]> {
    const rows: Raw[] = await this.ds.query(
      `SELECT v.UserID, v.OrgUnitID, ou.OrgUnitNameTH, v.GrantedBy,
              ISNULL(gu.DisplayName, gu.ADUserName) AS GrantedByName, v.GrantedDate
         FROM security.UserOrgVisibility v
         LEFT JOIN EMS.OrgUnit ou ON ou.OrgUnitID = v.OrgUnitID
         LEFT JOIN EMS.UserAccount gu ON gu.UserID = v.GrantedBy
        WHERE v.UserID = @0 ORDER BY ou.OrgUnitNameTH`,
      [userId],
    );
    return rows.map((r) => ({
      userId: Number(r.UserID),
      orgUnitId: Number(r.OrgUnitID),
      orgUnitNameTh: (r.OrgUnitNameTH as string | null) ?? null,
      grantedBy: Number(r.GrantedBy),
      grantedByName: (r.GrantedByName as string | null) ?? null,
      grantedDate: (r.GrantedDate as Date | null) ?? null,
    }));
  }

  private async loadTargetUser(
    userId: number,
  ): Promise<Pick<UserContext, 'userId' | 'appRole' | 'orgUnitId'>> {
    const rows: { AppRole: number; OrgUnitID: number }[] = await this.ds.query(
      'SELECT AppRole, OrgUnitID FROM EMS.UserAccount WHERE UserID = @0',
      [userId],
    );
    if (rows.length === 0) throw new ResourceNotFoundException('UserAccount', userId);
    return { userId, appRole: Number(rows[0].AppRole), orgUnitId: Number(rows[0].OrgUnitID) };
  }

  /** รายละเอียดการมองเห็นของผู้ใช้คนหนึ่ง (สำหรับหน้าจัดการของ Admin) */
  async detailFor(userId: number): Promise<UserOrgVisibilityDetailDto> {
    const target = await this.loadTargetUser(userId);
    const [view, grants] = await Promise.all([
      this.visibleHierarchy(target),
      this.explicitGrants(userId),
    ]);
    return { ...view, grants };
  }

  // ── เขียน (Admin) ──────────────────────────────────────────

  grant(userId: number, orgUnitId: number, caller: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'GRANT_VISIBILITY',
        recordId: userId,
        meta: { orgUnitId },
      },
      async () => {
        this.assertAdmin(caller, 'กำหนดการมองเห็นหน่วยงาน');
        await this.loadTargetUser(userId);
        const org: { C: number }[] = await this.ds.query(
          'SELECT COUNT(*) AS C FROM EMS.OrgUnit WHERE OrgUnitID = @0 AND IsDeleted = 0',
          [orgUnitId],
        );
        if (Number(org[0]?.C) === 0) throw new ResourceNotFoundException('OrgUnit', orgUnitId);
        await this.ds.query(
          `UPDATE security.UserOrgVisibility SET GrantedBy = @2, GrantedDate = GETDATE()
            WHERE UserID = @0 AND OrgUnitID = @1;
           IF @@ROWCOUNT = 0
             INSERT INTO security.UserOrgVisibility (UserID, OrgUnitID, GrantedBy, GrantedDate)
             VALUES (@0, @1, @2, GETDATE());`,
          [userId, orgUnitId, caller.userId],
        );
      },
    );
  }

  revoke(userId: number, orgUnitId: number, caller: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'REVOKE_VISIBILITY',
        recordId: userId,
        meta: { orgUnitId },
      },
      async () => {
        this.assertAdmin(caller, 'เพิกถอนการมองเห็นหน่วยงาน');
        await this.ds.query(
          'DELETE FROM security.UserOrgVisibility WHERE UserID = @0 AND OrgUnitID = @1',
          [userId, orgUnitId],
        );
      },
    );
  }

  /** บันทึกรายการหน่วยงานที่ซ่อน (แทนที่ทั้งชุด) — สร้าง XML จากตัวเลขล้วน */
  saveHiddenOrgUnitIds(
    userId: number,
    orgUnitIds: readonly number[],
    caller: UserContext,
  ): Promise<void> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'SAVE_HIDDEN_ORG_UNITS',
        recordId: userId,
        meta: { count: orgUnitIds.length, by: caller.userId },
      },
      async () => {
        if (caller.userId !== userId && caller.appRole < AppRole.Admin) {
          throw new PermissionDeniedException(
            'ตั้งค่าการซ่อนหน่วยงานได้เฉพาะของตัวเอง (หรือ Admin)',
            'HIDDEN_ORG_FORBIDDEN',
          );
        }
        const ids = [...new Set(orgUnitIds)].filter((n) => Number.isInteger(n) && n > 0);
        const xml =
          ids.length === 0 ? null : `<ids>${ids.map((n) => `<id>${n}</id>`).join('')}</ids>`;
        await this.sp.call(Sp.ems.saveHiddenOrgUnitIds).exec({ UserId: userId, XmlIds: xml });
      },
    );
  }

  private assertAdmin(caller: UserContext, what: string): void {
    if (caller.appRole < AppRole.Admin) {
      throw new PermissionDeniedException(`ต้องเป็น Admin เพื่อ${what}`, 'ADMIN_REQUIRED');
    }
  }
}
