import { AppRole } from '../../../src/common/constants/enums';
import {
  descendantsInclusive,
  type OrgUnitNode,
  resolveVisibleOrgUnitIds,
} from '../../../src/modules/dms/core/rules/org-visibility.rules';
import {
  planTemplateFolders,
  type TemplateItemLike,
} from '../../../src/modules/dms/core/rules/template.rules';

const node = (id: number, parent: number | null, over: Partial<OrgUnitNode> = {}): OrgUnitNode => ({
  orgUnitId: id,
  parentOrgUnitId: parent,
  isActive: true,
  isDeleted: false,
  ...over,
});
// SC(1) → DIV(2) → DEPT(3), DEPT(4) · DIV(5) → DEPT(6) · SC(9)
const tree = [
  node(1, null),
  node(2, 1),
  node(3, 2),
  node(4, 2),
  node(5, 1),
  node(6, 5),
  node(9, null),
  node(7, 2, { isActive: false }),
  node(8, 2, { isDeleted: true }),
];

describe('org-visibility.rules — การมองเห็นหน่วยงาน', () => {
  it('ไม่มี grant: Admin เห็นทุกหน่วยงานที่ใช้งานอยู่ (ไม่รวมปิดใช้งาน/ลบแล้ว)', () => {
    const r = resolveVisibleOrgUnitIds({
      user: { appRole: AppRole.Admin, orgUnitId: 1 },
      grantedOrgUnitIds: [],
      orgUnits: tree,
    });
    expect(r.mode).toBe('role');
    expect(r.orgUnitIds.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 9]);
  });

  it('ไม่มี grant: Manager เห็นหน่วยงานตัวเอง + ลูกหลานทุกชั้น', () => {
    const r = resolveVisibleOrgUnitIds({
      user: { appRole: AppRole.Manager, orgUnitId: 2 },
      grantedOrgUnitIds: [],
      orgUnits: tree,
    });
    expect(r.orgUnitIds.sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('ไม่มี grant: Officer/SrOfficer เห็นเฉพาะหน่วยงานตัวเอง', () => {
    for (const role of [AppRole.Officer, AppRole.SrOfficer]) {
      expect(
        resolveVisibleOrgUnitIds({
          user: { appRole: role, orgUnitId: 3 },
          grantedOrgUnitIds: [],
          orgUnits: tree,
        }).orgUnitIds,
      ).toEqual([3]);
    }
  });

  it('หน่วยงานของตัวเองปิดใช้งาน/ไม่พบ → ไม่เห็นอะไร', () => {
    expect(
      resolveVisibleOrgUnitIds({
        user: { appRole: AppRole.Officer, orgUnitId: 7 },
        grantedOrgUnitIds: [],
        orgUnits: tree,
      }).orgUnitIds,
    ).toEqual([]);
  });

  it('มี grant: ชัดแจ้งชนะทุกอย่าง — เห็นเฉพาะที่ grant (แม้เป็น Admin) และตัดที่ถูกลบ', () => {
    const r = resolveVisibleOrgUnitIds({
      user: { appRole: AppRole.Admin, orgUnitId: 1 },
      grantedOrgUnitIds: [3, 6, 8, 999],
      orgUnits: tree,
    });
    expect(r.mode).toBe('explicit');
    expect(r.orgUnitIds.sort((a, b) => a - b)).toEqual([3, 6]);
  });

  it('descendantsInclusive กันวงวน', () => {
    const cyc = [node(1, 2), node(2, 1)];
    expect(descendantsInclusive(1, cyc).sort()).toEqual([1, 2]);
  });
});

const item = (
  id: number,
  parent: number | null,
  name: string,
  over: Partial<TemplateItemLike> = {},
): TemplateItemLike => ({
  itemId: id,
  parentItemId: parent,
  folderName: name,
  confidentialityLevel: 4,
  sortOrder: id,
  inheritPermission: true,
  ...over,
});

describe('template.rules — แผนการสร้างโฟลเดอร์จากแม่แบบ', () => {
  it('เรียงแม่ก่อนลูกตาม SortOrder และนับความลึกต่อจากแม่', () => {
    const plan = planTemplateFolders(
      [
        item(3, 1, 'ลูก B', { sortOrder: 2 }),
        item(2, 1, 'ลูก A', { sortOrder: 1 }),
        item(1, null, 'แม่'),
      ],
      { parentDepth: 2, parentLevel: 3 },
    );
    expect(plan.map((p) => [p.folderName, p.depth, p.confidentialityLevel])).toEqual([
      ['แม่', 3, 3],
      ['ลูก A', 4, 3],
      ['ลูก B', 4, 3],
    ]);
    expect(plan[0].parentItemId).toBeNull();
  });

  it('ลึกเกิน 10 → ปฏิเสธทั้งชุด (ไม่ข้ามเงียบ)', () => {
    expect(() =>
      planTemplateFolders([item(1, null, 'a'), item(2, 1, 'b')], {
        parentDepth: 9,
        parentLevel: 4,
      }),
    ).toThrow(/ลึกเกิน/);
  });

  it('ชื่อซ้ำในระดับเดียวกันถูกปฏิเสธ', () => {
    expect(() =>
      planTemplateFolders([item(1, null, 'A'), item(2, null, ' a ')], {
        parentDepth: 1,
        parentLevel: 4,
      }),
    ).toThrow(/ซ้ำกัน/);
  });

  it('รายการที่ระบุชั้นความลับเองต้องตรงกับโฟลเดอร์ปลายทาง', () => {
    expect(() =>
      planTemplateFolders(
        [item(1, null, 'A', { inheritPermission: false, confidentialityLevel: 1 })],
        {
          parentDepth: 1,
          parentLevel: 3,
        },
      ),
    ).toThrow(/ไม่ตรงกับโฟลเดอร์ปลายทาง/);
    // เท่ากับของแม่ → ผ่าน และคง InheritPermission=false
    const ok = planTemplateFolders(
      [item(1, null, 'A', { inheritPermission: false, confidentialityLevel: 3 })],
      { parentDepth: 1, parentLevel: 3 },
    );
    expect(ok[0].inheritPermission).toBe(false);
  });

  it('รายการกำพร้า (แม่ไม่อยู่ในแม่แบบ) ไม่ถูกสร้าง · วงวนไม่ทำให้ค้าง', () => {
    expect(
      planTemplateFolders([item(5, 99, 'กำพร้า')], { parentDepth: 1, parentLevel: 4 }),
    ).toEqual([]);
    expect(
      planTemplateFolders([item(1, 2, 'a'), item(2, 1, 'b')], { parentDepth: 1, parentLevel: 4 }),
    ).toEqual([]);
  });
});
