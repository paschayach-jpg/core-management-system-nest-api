import { CONFIDENTIALITY_ROOT_CODE } from '../../../../common/constants/enums';
import {
  BusinessException,
  ConflictBusinessException,
} from '../../../../common/exceptions/business.exception';

/**
 * กฎธุรกิจของโฟลเดอร์ที่เป็นฟังก์ชันล้วน (ไม่แตะ DB) — พอร์ตจาก FolderService.cs
 * แยกไว้เพื่อเทสต์ตรงๆ และใช้ซ้ำใน handler หลังอนุมัติ (CREATE_HC) กับการสร้างโฟลเดอร์ปกติ
 */

/** ความลึกสูงสุด (Root = ระดับ 1; DB CHECK อนุญาต 0–10) */
export const MAX_FOLDER_DEPTH = 10;
/** ระยะเวลาที่กู้คืนจากถังขยะได้ (RecycleBinRetentionDays เดิม) */
export const RECYCLE_BIN_RETENTION_DAYS = 30;
export const MAX_FOLDER_NAME_LENGTH = 255;
/** อักขระต้องห้ามในชื่อโฟลเดอร์ (InvalidFolderNameChars เดิม) */
export const INVALID_FOLDER_NAME_CHARS: readonly string[] = [
  '\\',
  '/',
  ':',
  '*',
  '?',
  '"',
  '<',
  '>',
  '|',
];

/** ตัดช่องว่าง + ตรวจชื่อ — โยน 422 ถ้าว่าง/ยาวเกิน/มีอักขระต้องห้าม */
export function validateFolderName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim();
  if (!name) throw new BusinessException('กรุณาระบุชื่อโฟลเดอร์', 'FOLDER_NAME_REQUIRED');
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw new BusinessException(
      `ชื่อโฟลเดอร์ยาวเกิน ${MAX_FOLDER_NAME_LENGTH} ตัวอักษร`,
      'FOLDER_NAME_TOO_LONG',
    );
  }
  const found = [...new Set([...name].filter((c) => INVALID_FOLDER_NAME_CHARS.includes(c)))];
  // eslint-disable-next-line no-control-regex
  const hasControl = /[\u0000-\u001f]/.test(name);
  if (found.length > 0 || hasControl || name === '.' || name === '..') {
    throw new BusinessException(
      `ชื่อโฟลเดอร์ไม่อนุญาตให้ใช้อักขระ: ${found.join(' ') || '(อักขระควบคุม/ชื่อพิเศษ)'}`,
      'FOLDER_NAME_INVALID',
      { invalidChars: found },
    );
  }
  return name;
}

/** ชื่อซ้ำกันหรือไม่ (ตัดช่องว่าง + ไม่สนตัวพิมพ์ — เหมือน OrdinalIgnoreCase เดิม) */
export function isSameFolderName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isMainRootLevel(level: number | null | undefined): level is 1 | 2 | 3 | 4 {
  return level === 1 || level === 2 || level === 3 || level === 4;
}

/** รหัสของ Root หลักตามชั้นความลับ ('1HC' …) หรือ '' ถ้าไม่ใช่ 1–4 */
export function mainRootCode(level: number | null | undefined): string {
  return isMainRootLevel(level) ? CONFIDENTIALITY_ROOT_CODE[level] : '';
}

export function rootNameMatchesLevel(name: string, level: number | null | undefined): boolean {
  const code = mainRootCode(level);
  if (!code || !name.trim()) return false;
  return name.trim().toLowerCase().startsWith(code.toLowerCase());
}

export interface RootFolderLike {
  confidentialityLevel: number;
  isDeleted?: boolean;
  isArchived?: boolean;
}

/**
 * ตรวจสิทธิ์ "สร้าง Root Folder" (EnsureRootCreationAllowed เดิม)
 * - ต้องเป็น 4 Root หลักเท่านั้น และชื่อขึ้นต้นด้วย 1HC/2SC/3NC/4PC ตรงกับชั้นความลับ
 * - 2SC/3NC/4PC มีได้อย่างละ 1 ต่อหน่วยงาน · 1HC ข้ามการตรวจซ้ำ (มีได้หลายอัน แต่ต้องผ่าน approval)
 */
export function assertRootCreationAllowed(args: {
  name: string;
  level: number | null | undefined;
  existingRoots: readonly RootFolderLike[];
}): void {
  const { name, level, existingRoots } = args;
  if (!isMainRootLevel(level)) {
    throw new BusinessException(
      'ไม่อนุญาตให้สร้าง Root Folder ใหม่โดยตรง ยกเว้น 4 Folder หลัก (1HC, 2SC, 3NC, 4PC)',
      'ROOT_FOLDER_NOT_ALLOWED',
    );
  }
  const code = mainRootCode(level);
  if (!rootNameMatchesLevel(name, level)) {
    throw new BusinessException(
      `Root Folder ระดับ ${code} ต้องมีชื่อขึ้นต้นด้วย '${code}'`,
      'ROOT_FOLDER_NAME_INVALID',
      { expectedPrefix: code },
    );
  }
  if (level !== 1) {
    const dup = existingRoots.some(
      (r) => !r.isDeleted && !r.isArchived && r.confidentialityLevel === level,
    );
    if (dup) {
      throw new ConflictBusinessException(
        `มี Root Folder หลักระดับ ${code} อยู่แล้ว`,
        'ROOT_FOLDER_EXISTS',
        { level },
      );
    }
  }
}

export interface MainRootCandidate {
  parentFolderId: number | null;
  confidentialityLevel: number;
  folderName: string;
}

/** โฟลเดอร์นี้เป็น Root หลัก (ไม่มีแม่, ชั้นความลับ 1–4, ชื่อขึ้นต้นตามรหัส) หรือไม่ */
export function isMainRoot(f: MainRootCandidate | null | undefined): boolean {
  return (
    !!f &&
    (f.parentFolderId === null || f.parentFolderId === 0) &&
    isMainRootLevel(f.confidentialityLevel) &&
    rootNameMatchesLevel(f.folderName, f.confidentialityLevel)
  );
}

/** ต้องสร้างใต้ Root หลักเท่านั้น (EnsureCreationUnderMainRoots เดิม) */
export function assertUnderMainRoot(root: MainRootCandidate | null | undefined): void {
  if (!isMainRoot(root)) {
    throw new BusinessException(
      'อนุญาตให้สร้าง Folder ภายใต้ 4 Folder หลัก (1HC, 2SC, 3NC, 4PC) เท่านั้น',
      'FOLDER_NOT_UNDER_MAIN_ROOT',
    );
  }
}

export interface NewFolderAttributes {
  depth: number;
  confidentialityLevel: number;
  inheritPermission: boolean;
}

export function assertDepthWithinLimit(depth: number): void {
  if (depth > MAX_FOLDER_DEPTH) {
    throw new BusinessException(
      `ความลึกของโฟลเดอร์เกินที่กำหนด (สูงสุด ${MAX_FOLDER_DEPTH} ระดับ)`,
      'FOLDER_DEPTH_EXCEEDED',
      { maxDepth: MAX_FOLDER_DEPTH, depth },
    );
  }
}

/**
 * คำนวณความลึก/ชั้นความลับ/InheritPermission ของโฟลเดอร์ใหม่
 *  - Root: depth 1 · ชั้นความลับ = ที่ระบุ (ค่าเริ่มต้น 4) · InheritPermission = ไม่ได้ระบุ
 *  - ลูก: depth = แม่+1 (≤10) · ไม่ระบุชั้น → สืบทอดจากแม่ + InheritPermission=1 · ระบุเอง → InheritPermission=0
 *    ต่างจากระบบเดิม: ชั้นที่ระบุต้องเท่ากับของแม่ (UI เดิมล็อกไว้เสมอ; API ไม่เชื่อ client) ใช้ "เปลี่ยนชั้นความลับ" แทน
 */
export function resolveNewFolderAttributes(args: {
  parent: { folderDepth: number; confidentialityLevel: number } | null;
  requestedLevel?: number | null;
}): NewFolderAttributes {
  const { parent, requestedLevel } = args;
  const hasRequested = requestedLevel !== undefined && requestedLevel !== null;
  if (!parent) {
    return {
      depth: 1,
      confidentialityLevel: hasRequested ? requestedLevel : 4,
      inheritPermission: !hasRequested,
    };
  }
  const depth = parent.folderDepth + 1;
  assertDepthWithinLimit(depth);
  if (hasRequested && requestedLevel !== parent.confidentialityLevel) {
    throw new BusinessException(
      'ชั้นความลับของโฟลเดอร์ย่อยต้องตรงกับโฟลเดอร์แม่ (ถ้าต้องการเปลี่ยนให้ใช้การเปลี่ยนชั้นความลับ)',
      'FOLDER_LEVEL_MISMATCH',
      { parentLevel: parent.confidentialityLevel, requestedLevel },
    );
  }
  return {
    depth,
    confidentialityLevel: hasRequested ? requestedLevel : parent.confidentialityLevel,
    inheritPermission: !hasRequested,
  };
}

/** ความลึกของโฟลเดอร์ต้นทางหลังย้ายไปใต้ปลายทาง (รวมความสูงของต้นไม้ย่อย) */
export function projectedDepthAfterMove(args: {
  destDepth: number;
  sourceDepth: number;
  maxSubtreeDepth: number;
}): number {
  return args.destDepth + 1 + Math.max(0, args.maxSubtreeDepth - args.sourceDepth);
}

/** ตรวจกฎการย้ายโฟลเดอร์ตามลำดับเดียวกับ FolderService.MoveFolder */
export function assertMoveAllowed(args: {
  sourceId: number;
  destId: number;
  sourceName: string;
  sourceIsRoot: boolean;
  destIsInsideSource: boolean;
  projectedDepth: number;
  destChildNames: readonly string[];
}): void {
  if (args.sourceIsRoot) {
    throw new BusinessException('ไม่อนุญาตให้ย้าย Root Folder หลัก', 'ROOT_FOLDER_IMMUTABLE', {
      folderId: args.sourceId,
    });
  }
  if (args.sourceId === args.destId) {
    throw new BusinessException('ไม่สามารถย้าย Folder ไปยังตัวเองได้', 'FOLDER_MOVE_SELF');
  }
  if (args.destIsInsideSource) {
    throw new BusinessException(
      'ไม่สามารถย้าย Folder ไปยัง Folder ย่อยของตัวเองได้',
      'FOLDER_MOVE_INTO_DESCENDANT',
    );
  }
  if (args.projectedDepth > MAX_FOLDER_DEPTH) {
    throw new BusinessException(
      `การย้ายจะทำให้ความลึกเป็น ${args.projectedDepth} ซึ่งเกินกำหนด (${MAX_FOLDER_DEPTH})`,
      'FOLDER_DEPTH_EXCEEDED',
      { maxDepth: MAX_FOLDER_DEPTH, depth: args.projectedDepth },
    );
  }
  if (args.destChildNames.some((n) => isSameFolderName(n, args.sourceName))) {
    throw new ConflictBusinessException(
      `มี Folder ชื่อ '${args.sourceName}' อยู่แล้วใน Folder ปลายทาง`,
      'FOLDER_NAME_DUPLICATE',
    );
  }
}

/** วันหมดอายุในถังขยะ (sp_SoftDeleteFolder ตั้ง +30 วัน) */
export function recycleBinExpiryOf(deletedAt: Date, days = RECYCLE_BIN_RETENTION_DAYS): Date {
  return new Date(deletedAt.getTime() + days * 24 * 3600 * 1000);
}

/** ยังกู้คืนได้หรือไม่ — ถูกลบไม่เกิน 30 วัน (เดิม: DeletedAt < now-30d = เกินกำหนด) */
export function isWithinRecycleRetention(
  deletedDate: Date | null | undefined,
  now: Date,
  days = RECYCLE_BIN_RETENTION_DAYS,
): boolean {
  if (!deletedDate) return true;
  return deletedDate.getTime() >= now.getTime() - days * 24 * 3600 * 1000;
}

/** Folder.PhysicalPath ที่ระบบเดิมใส่ตอนสร้าง: {OrgUnitID}\{GUID} (ไม่ได้ใช้อ่านไฟล์ — ไฟล์อ้างด้วย OrgUnit/FolderID/StoredFileName) */
export function buildFolderPhysicalPath(orgUnitId: number, guidHex: string): string {
  return `${orgUnitId}\\${guidHex}`;
}
