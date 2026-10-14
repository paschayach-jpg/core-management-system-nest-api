import { PrincipalType } from '../../../../common/constants/enums';
import { BusinessException } from '../../../../common/exceptions/business.exception';

/**
 * payload ของคำขออนุมัติที่ DMS core เป็นผู้ยื่น/ผู้ลงมือหลังอนุมัติ (CREATE_HC, CHANGE_PERMISSION)
 *
 * ระบบเดิมเก็บ payload เป็นข้อความใน ApprovalRequest.Remark:
 *   CREATE_HC         `ParentFolderId=X|OrgUnitId=Y|FolderName=Z|FolderDepth=1|ConfidentialityLevel=1|InheritPermission=False`
 *   CHANGE_PERMISSION `PrincipalType:1 PrincipalID:5 Read:True Write:False Delete:False Modify:False FullControl:False IsDeny:False`
 * API ใหม่ส่ง payload เป็น JSON object (ดู dms-approval.port.ts) แต่ parser ที่นี่รับได้ทั้ง
 *   (ก) JSON object ที่คีย์เป็น camelCase/PascalCase  (ข) object ที่มีข้อความเดิมอยู่ในคีย์ `remark` / `raw` / `text`
 */

type Payload = Record<string, unknown> | null | undefined;

const RAW_KEYS = ['remark', 'raw', 'text', 'legacyRemark'];

/** หาค่าจากหลายชื่อคีย์ (ไม่สนตัวพิมพ์) */
function pick(p: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = names.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(p)) {
    if (wanted.includes(k.toLowerCase()) && v !== undefined) return v;
  }
  return undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', '1', 'yes'].includes(v.trim().toLowerCase());
  return undefined;
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : undefined;
}

/** แปลงข้อความ `k=v|k=v` หรือ `k:v k:v` เป็น object */
export function parseLegacyRemark(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pipe = text.includes('|');
  const tokens = pipe ? text.split('|') : text.split(/\s+/);
  for (const t of tokens) {
    const sep = pipe ? t.indexOf('=') : t.indexOf(':');
    if (sep > 0) out[t.slice(0, sep).trim()] = t.slice(sep + 1).trim();
  }
  return out;
}

/** รวมคีย์โครงสร้างกับข้อความเดิม (ถ้ามี) เป็น object เดียว */
function flatten(payload: Payload): Record<string, unknown> {
  if (!payload) return {};
  const raw = RAW_KEYS.map((k) => pick(payload, k)).find((v) => typeof v === 'string') as
    string | undefined;
  return raw ? { ...parseLegacyRemark(raw), ...payload } : { ...payload };
}

function invalid(what: string, detail: string): never {
  throw new BusinessException(
    `ข้อมูลคำขอ ${what} ไม่ถูกต้อง: ${detail}`,
    'APPROVAL_PAYLOAD_INVALID',
    { requestType: what },
  );
}

// ── CREATE_HC ────────────────────────────────────────────────

export interface CreateHcPayload {
  parentFolderId: number | null;
  orgUnitId: number;
  folderName: string;
  confidentialityLevel: number;
  inheritPermission: boolean;
}

/** payload ที่ใช้ยื่นคำขอ CREATE_HC (JSON) */
export function buildCreateHcPayload(p: CreateHcPayload): Record<string, unknown> {
  return {
    parentFolderId: p.parentFolderId,
    orgUnitId: p.orgUnitId,
    folderName: p.folderName,
    confidentialityLevel: p.confidentialityLevel,
    inheritPermission: p.inheritPermission,
  };
}

export function parseCreateHcPayload(payload: Payload): CreateHcPayload {
  const p = flatten(payload);
  const orgUnitId = toInt(pick(p, 'orgUnitId'));
  const folderName = String(pick(p, 'folderName', 'name') ?? '').trim();
  if (!orgUnitId || orgUnitId <= 0) invalid('CREATE_HC', 'ไม่พบ OrgUnitId');
  if (!folderName) invalid('CREATE_HC', 'ไม่พบชื่อโฟลเดอร์');
  const parent = toInt(pick(p, 'parentFolderId', 'parentId'));
  return {
    parentFolderId: parent && parent > 0 ? parent : null,
    orgUnitId,
    folderName,
    confidentialityLevel: toInt(pick(p, 'confidentialityLevel', 'level')) ?? 1,
    inheritPermission: toBool(pick(p, 'inheritPermission')) ?? false,
  };
}

// ── CHANGE_PERMISSION ────────────────────────────────────────

export interface ChangePermissionPayload {
  principalType: PrincipalType;
  principalId: number;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModify: boolean;
  canFullControl: boolean;
  isDeny: boolean;
  expiryDate: Date | null;
}

export function buildChangePermissionPayload(p: ChangePermissionPayload): Record<string, unknown> {
  return {
    principalType: p.principalType,
    principalId: p.principalId,
    canRead: p.canRead,
    canWrite: p.canWrite,
    canDelete: p.canDelete,
    canModify: p.canModify,
    canFullControl: p.canFullControl,
    isDeny: p.isDeny,
    expiryDate: p.expiryDate ? p.expiryDate.toISOString() : null,
  };
}

export function parseChangePermissionPayload(payload: Payload): ChangePermissionPayload {
  const p = flatten(payload);
  const principalType = toInt(pick(p, 'principalType'));
  const principalId = toInt(pick(p, 'principalId'));
  if (principalType === undefined || !(principalType in PrincipalType)) {
    invalid('CHANGE_PERMISSION', 'ไม่พบหรือไม่รู้จักประเภทผู้ถือสิทธิ์ (PrincipalType)');
  }
  if (!principalId || principalId <= 0)
    invalid('CHANGE_PERMISSION', 'ไม่พบผู้ถือสิทธิ์ (PrincipalID)');
  const expiryRaw = pick(p, 'expiryDate');
  const expiry =
    typeof expiryRaw === 'string' || expiryRaw instanceof Date ? new Date(expiryRaw) : null;
  return {
    principalType: principalType as PrincipalType,
    principalId,
    canRead: toBool(pick(p, 'canRead', 'read')) ?? false,
    canWrite: toBool(pick(p, 'canWrite', 'write')) ?? false,
    canDelete: toBool(pick(p, 'canDelete', 'delete')) ?? false,
    canModify: toBool(pick(p, 'canModify', 'modify')) ?? false,
    canFullControl: toBool(pick(p, 'canFullControl', 'fullControl')) ?? false,
    isDeny: toBool(pick(p, 'isDeny', 'deny')) ?? false,
    expiryDate: expiry && !Number.isNaN(expiry.getTime()) ? expiry : null,
  };
}
