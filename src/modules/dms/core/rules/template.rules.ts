import { BusinessException } from '../../../../common/exceptions/business.exception';
import { isMainRootLevel, isSameFolderName, MAX_FOLDER_DEPTH } from './folder.rules';

/** รายการโฟลเดอร์ในแม่แบบ (storage.FolderTemplateItem) */
export interface TemplateItemLike {
  itemId: number;
  parentItemId: number | null;
  folderName: string;
  confidentialityLevel: number;
  sortOrder: number;
  inheritPermission: boolean;
}

/** โฟลเดอร์ที่จะสร้างจากแม่แบบ เรียงแม่ก่อนลูก */
export interface PlannedFolder {
  itemId: number;
  parentItemId: number | null;
  folderName: string;
  depth: number;
  confidentialityLevel: number;
  inheritPermission: boolean;
}

/**
 * วางแผนการสร้างโฟลเดอร์จากแม่แบบ (CreateFoldersFromItems เดิม) — เรียงตาม SortOrder, ลูกซ้อนผ่าน ParentItemID
 *  - ลึกเกิน 10 → ปฏิเสธทั้งชุด (ระบบเดิมข้ามรายการที่ลึกเกินเงียบๆ ทำให้ได้โครงสร้างไม่ครบ)
 *  - ชื่อซ้ำในระดับเดียวกันของแม่แบบ → ปฏิเสธ
 *  - รายการที่ InheritPermission หรือชั้นความลับไม่อยู่ใน 1–4 รับชั้นจากแม่; รายการที่ระบุชั้นเองต้องเท่ากับของแม่
 *    (ต่างจากเดิมที่ปล่อยให้ชั้นของลูกต่างจากแม่ได้ ซึ่งทำให้ลูกหลุดจากการควบคุมของ Root)
 * รายการที่แม่ไม่อยู่ในแม่แบบ (กำพร้า) จะไม่ถูกสร้าง
 */
export function planTemplateFolders(
  items: readonly TemplateItemLike[],
  base: { parentDepth: number; parentLevel: number },
): PlannedFolder[] {
  const byParent = new Map<number | null, TemplateItemLike[]>();
  for (const it of items) {
    const list = byParent.get(it.parentItemId) ?? [];
    list.push(it);
    byParent.set(it.parentItemId, list);
  }
  const out: PlannedFolder[] = [];
  const visited = new Set<number>();

  const visit = (parentItemId: number | null, parentDepth: number, parentLevel: number): void => {
    const children = (byParent.get(parentItemId) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.itemId - b.itemId);
    for (let i = 0; i < children.length; i++) {
      const it = children[i];
      if (children.slice(0, i).some((x) => isSameFolderName(x.folderName, it.folderName))) {
        throw new BusinessException(
          `แม่แบบมีโฟลเดอร์ชื่อ '${it.folderName}' ซ้ำกันในระดับเดียวกัน`,
          'TEMPLATE_DUPLICATE_NAMES',
          { itemId: it.itemId },
        );
      }
      if (visited.has(it.itemId)) continue; // กันวงวน
      visited.add(it.itemId);
      const depth = parentDepth + 1;
      if (depth > MAX_FOLDER_DEPTH) {
        throw new BusinessException(
          `แม่แบบลึกเกินกำหนด: '${it.folderName}' จะอยู่ที่ระดับ ${depth} (สูงสุด ${MAX_FOLDER_DEPTH})`,
          'FOLDER_DEPTH_EXCEEDED',
          { itemId: it.itemId, depth, maxDepth: MAX_FOLDER_DEPTH },
        );
      }
      const explicit = !it.inheritPermission && isMainRootLevel(it.confidentialityLevel);
      if (explicit && it.confidentialityLevel !== parentLevel) {
        throw new BusinessException(
          `'${it.folderName}' ในแม่แบบกำหนดชั้นความลับ ${it.confidentialityLevel} ไม่ตรงกับโฟลเดอร์ปลายทาง (${parentLevel})`,
          'TEMPLATE_LEVEL_MISMATCH',
          { itemId: it.itemId },
        );
      }
      out.push({
        itemId: it.itemId,
        parentItemId,
        folderName: it.folderName,
        depth,
        confidentialityLevel: parentLevel,
        inheritPermission: it.inheritPermission,
      });
      visit(it.itemId, depth, parentLevel);
    }
  };
  visit(null, base.parentDepth, base.parentLevel);
  return out;
}
