import { isApplicable, matchesFlag } from '../../permissions/acl.evaluator';
import type { AclEntry, AclSubject, PermissionType } from '../../permissions/permission.types';

/**
 * สิทธิ์ระดับไฟล์ (security.FilePermission) — ฟังก์ชันล้วน
 * ใช้ตัวจับคู่ผู้ถือสิทธิ์/ธงสิทธิ์ตัวเดียวกับสิทธิ์โฟลเดอร์ (acl.evaluator) เพื่อให้กติกาตรงกัน
 */
export interface FileAclEntry {
  filePermissionId?: number;
  fileId: number;
  principalType: AclEntry['principalType'];
  principalId: number;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModify: boolean;
  canFullControl: boolean;
  canDownload: boolean;
  isDeny: boolean;
}

const asAcl = (e: FileAclEntry): AclEntry => ({
  folderId: e.fileId,
  principalType: e.principalType,
  principalId: e.principalId,
  canRead: e.canRead,
  canWrite: e.canWrite,
  canDelete: e.canDelete,
  canModify: e.canModify,
  canFullControl: e.canFullControl,
  isDeny: e.isDeny,
});

export interface FileAclDecision {
  /** จำนวน entry ที่ใช้กับผู้ใช้คนนี้ (ตรงตัวบุคคล/บทบาท/แผนก/ฝ่าย) */
  applicable: number;
  /** มี Deny ชัดแจ้งที่ตรงกับสิทธิ์ที่ขอ */
  denied: boolean;
  /** มี Allow ที่ตรงกับสิทธิ์ที่ขอ */
  allowed: boolean;
}

export function fileAclDecision(args: {
  subject: AclSubject;
  perm: PermissionType;
  entries: readonly FileAclEntry[];
}): FileAclDecision {
  const mine = args.entries.filter((e) => isApplicable(asAcl(e), args.subject));
  return {
    applicable: mine.length,
    denied: mine.some((e) => e.isDeny && matchesFlag(asAcl(e), args.perm)),
    allowed: mine.some((e) => !e.isDeny && matchesFlag(asAcl(e), args.perm)),
  };
}

/**
 * สิทธิ์ระดับไฟล์ "ทับ" สิทธิ์โฟลเดอร์เมื่อมี entry ที่ใช้กับผู้ใช้ (FileService.DeleteFile เดิม):
 *  - มี Deny → บล็อก (รวมถึง Manager/Admin)
 *  - มี entry แต่ไม่มีใครให้สิทธิ์ที่ขอ → บล็อก
 *  - ไม่มี entry ที่ใช้กับผู้ใช้เลย → ไม่ยุ่ง (ให้สิทธิ์โฟลเดอร์ตัดสิน)
 */
export function fileOverrideBlocks(d: FileAclDecision): boolean {
  return d.applicable > 0 && (d.denied || !d.allowed);
}

export type DownloadVerdict =
  | { allowed: true; via: 'PRIVILEGED' | 'AUTHORITY' | 'FILE_SHARE' }
  | { allowed: false; reason: 'FILE_DENIED' | 'NO_READ' | 'NEED_APPROVAL' };

/**
 * ตัดสินสิทธิ์ดาวน์โหลด (ไม่รวมใบอนุมัติ — ผู้เรียกตรวจ DMS_APPROVAL_PORT เมื่อได้ NEED_APPROVAL)
 *  1. ถูก Deny อ่านระดับไฟล์ → ปฏิเสธ
 *  2. ต้องอ่านได้: สิทธิ์อ่านโฟลเดอร์ หรือไฟล์ถูกแชร์ให้ตรงๆ (FilePermission CanRead)
 *  3. ต้องดาวน์โหลดได้: Manager/Admin · Authority.CanDownload ของชั้นความลับ · FilePermission.CanDownload (หรือ FullControl)
 *     ไม่เข้าข้อใด → ต้องขออนุมัติ (NEED_APPROVAL)
 */
export function decideDownload(args: {
  isPrivileged: boolean;
  folderCanRead: boolean;
  authorityCanDownload: boolean;
  subject: AclSubject;
  entries: readonly FileAclEntry[];
}): DownloadVerdict {
  const read = fileAclDecision({ subject: args.subject, perm: 'Read', entries: args.entries });
  if (read.denied) return { allowed: false, reason: 'FILE_DENIED' };
  const directShare = read.allowed;
  if (!args.folderCanRead && !directShare) return { allowed: false, reason: 'NO_READ' };

  if (args.isPrivileged) return { allowed: true, via: 'PRIVILEGED' };
  if (args.authorityCanDownload) return { allowed: true, via: 'AUTHORITY' };
  const shareDownload = args.entries.some(
    (e) => isApplicable(asAcl(e), args.subject) && !e.isDeny && (e.canDownload || e.canFullControl),
  );
  if (shareDownload) return { allowed: true, via: 'FILE_SHARE' };
  return { allowed: false, reason: 'NEED_APPROVAL' };
}
