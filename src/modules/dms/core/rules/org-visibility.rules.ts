import { AppRole } from '../../../../common/constants/enums';

/** หน่วยงานในผัง (ย่อจาก EMS.OrgUnit) */
export interface OrgUnitNode {
  orgUnitId: number;
  parentOrgUnitId: number | null;
  isActive: boolean;
  isDeleted: boolean;
}

export type VisibilityMode = 'explicit' | 'role';

/**
 * หน่วยงานที่ผู้ใช้มองเห็น (UserOrgVisibilityService.GetVisibleOrgUnits เดิม — "Approach B")
 *  - ถ้าผู้ใช้มีแถวใน security.UserOrgVisibility อย่างน้อย 1 แถว → เห็นเฉพาะหน่วยงานที่ถูก grant (ชัดแจ้งชนะทุกอย่าง)
 *  - ถ้าไม่มีเลย → ตามบทบาท: Admin เห็นทุกหน่วยงานที่ใช้งานอยู่ · Manager เห็นหน่วยของตัวเอง + ลูกหลานทั้งหมด · Officer/SrOfficer เห็นเฉพาะหน่วยของตัวเอง
 */
export function resolveVisibleOrgUnitIds(args: {
  user: { appRole: number; orgUnitId: number };
  grantedOrgUnitIds: readonly number[];
  orgUnits: readonly OrgUnitNode[];
}): { mode: VisibilityMode; orgUnitIds: number[] } {
  const live = args.orgUnits.filter((o) => !o.isDeleted);

  if (args.grantedOrgUnitIds.length > 0) {
    const granted = new Set(args.grantedOrgUnitIds);
    return {
      mode: 'explicit',
      orgUnitIds: live.filter((o) => granted.has(o.orgUnitId)).map((o) => o.orgUnitId),
    };
  }

  const active = live.filter((o) => o.isActive);
  if (args.user.appRole >= AppRole.Admin) {
    return { mode: 'role', orgUnitIds: active.map((o) => o.orgUnitId) };
  }
  const own = active.find((o) => o.orgUnitId === args.user.orgUnitId);
  if (!own) return { mode: 'role', orgUnitIds: [] };
  if (args.user.appRole <= AppRole.SrOfficer) return { mode: 'role', orgUnitIds: [own.orgUnitId] };
  return { mode: 'role', orgUnitIds: descendantsInclusive(own.orgUnitId, active) };
}

/** ตัวมันเองและลูกหลานทั้งหมด (BFS, กันวงวน) */
export function descendantsInclusive(rootId: number, nodes: readonly OrgUnitNode[]): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parentOrgUnitId === null) continue;
    const list = childrenOf.get(n.parentOrgUnitId) ?? [];
    list.push(n.orgUnitId);
    childrenOf.set(n.parentOrgUnitId, list);
  }
  const seen = new Set<number>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as number;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return [...seen];
}
