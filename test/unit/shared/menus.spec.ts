import { buildTree } from '../../../src/modules/shared/menus/menus.service';
import type { MenuItem } from '../../../src/modules/shared/entities/menu-item.entity';

const m = (
  id: number,
  parent: number | null,
  name: string,
  order: number,
  role: number | null = null,
): MenuItem =>
  ({
    menuItemId: id,
    parentMenuItemId: parent,
    menuName: name,
    menuKey: `k${id}`,
    displayOrder: order,
    isActive: true,
    requiredAppRole: role,
  }) as MenuItem;

describe('menu buildTree', () => {
  it('จัดเป็นต้นไม้และเรียงตาม displayOrder', () => {
    const tree = buildTree([
      m(3, 1, 'ลูก B', 2),
      m(2, 1, 'ลูก A', 1),
      m(1, null, 'แม่', 1),
      m(4, null, 'แม่ 2', 0),
    ]);
    expect(tree.map((n) => n.menuName)).toEqual(['แม่ 2', 'แม่']);
    expect(tree[1].children.map((n) => n.menuName)).toEqual(['ลูก A', 'ลูก B']);
  });

  it('เมนูลูกที่ parent ถูกกรองออก (ไม่มีสิทธิ์) จะไม่โผล่เป็น root', () => {
    const tree = buildTree([m(2, 1, 'ลูกของเมนูที่ซ่อน', 1)]);
    expect(tree).toEqual([]);
  });
});
