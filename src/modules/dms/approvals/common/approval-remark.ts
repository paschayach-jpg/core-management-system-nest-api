import type { ApprovalRequestType } from '../../../../common/constants/enums';

/**
 * Remark ของ workflow.ApprovalRequest (nvarchar(MAX)) ถูกระบบเดิมใช้เป็น "ที่เก็บ payload" ที่ต้องใช้ตอนอนุมัติ
 * (OPEN_QUESTIONS C7) — ไฟล์นี้เป็นฟังก์ชันล้วน (ไม่แตะ DB) ทำ 2 อย่าง:
 *
 *  1) เขียน payload ใหม่เป็น JSON ที่มี prefix ชัดเจน:  `CMS-PAYLOAD/1:{"reason":"…","payload":{…}}`
 *  2) อ่านรูปแบบเก่าได้ครบ (มี 40 คำขอในฐานข้อมูลจริง):
 *       EXTERNAL_SHARE    `ExternalShareID:<n>`
 *       INTERNAL_SHARE    `InternalShareFile FileID:1 PrincipalType:1 PrincipalID:5 Read:True Write:False Delete:False Expiry:2026-12-31`
 *       CHANGE_PERMISSION `FolderID:1 PrincipalType:1 PrincipalID:5 Read:True Write:True Delete:False Modify:False FullControl:False IsDeny:False`
 *       CREATE_HC         `ParentFolderId=1|OrgUnitId=2|FolderName=ชื่อ|FolderDepth=1|ConfidentialityLevel=1|InheritPermission=False`
 *       DELETE_FOLDER / DOWNLOAD_FILE  ข้อความเหตุผลล้วน
 *
 * ผลที่ได้จากการอ่าน (payload) ใช้ชื่อ key แบบ camelCase เดียวกันทั้งรูปแบบเก่าและใหม่ —
 * ดูสัญญาของ payload แต่ละชนิดที่ `approval-payloads.ts`
 */

export const REMARK_JSON_PREFIX = 'CMS-PAYLOAD/1:';

export type RemarkFormat = 'empty' | 'json' | 'legacy' | 'text';

export interface DecodedRemark {
  format: RemarkFormat;
  /** เหตุผลของผู้ขอ (ข้อความล้วนในรูปแบบเก่าของ DELETE_FOLDER / DOWNLOAD_FILE ก็อยู่ที่นี่) */
  reason: string | null;
  /** payload ที่ normalize แล้ว (null = ไม่มี payload) */
  payload: Record<string, unknown> | null;
  /** ชนิดที่ตีความได้จากตัว Remark เอง (ใช้แก้กรณี DB รุ่นเก่าที่ไม่รองรับ EXTERNAL_SHARE แล้วบันทึกเป็น CHANGE_PERMISSION) */
  inferredType: ApprovalRequestType | null;
}

/** รวมเหตุผล + payload เป็นข้อความสำหรับคอลัมน์ Remark (ไม่มีทั้งสองอย่าง → null) */
export function encodeRemark(input: {
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}): string | null {
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  const hasPayload = input.payload && Object.keys(input.payload).length > 0;
  if (!hasPayload) return reason; // ไม่มี payload → ข้อความล้วนเหมือนระบบเดิม
  return `${REMARK_JSON_PREFIX}${JSON.stringify({ reason, payload: input.payload })}`;
}

export function decodeRemark(
  requestType: string | null | undefined,
  remark: string | null | undefined,
): DecodedRemark {
  if (remark === null || remark === undefined || remark.trim() === '') {
    return { format: 'empty', reason: null, payload: null, inferredType: null };
  }

  if (remark.startsWith(REMARK_JSON_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(remark.slice(REMARK_JSON_PREFIX.length));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as { reason?: unknown; payload?: unknown };
        const payload =
          obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)
            ? (obj.payload as Record<string, unknown>)
            : null;
        return {
          format: 'json',
          reason: typeof obj.reason === 'string' && obj.reason !== '' ? obj.reason : null,
          payload,
          inferredType: null,
        };
      }
    } catch {
      // JSON เสีย → ปล่อยให้ตกไปเป็นข้อความล้วนด้านล่าง (ไม่ทำให้ทั้งคำขออ่านไม่ได้)
    }
    return { format: 'text', reason: remark, payload: null, inferredType: null };
  }

  const type = (requestType ?? '').trim().toUpperCase();

  // รูปแบบเก่า: ตรวจจากเนื้อหา Remark ก่อนชนิดคำขอ (DB รุ่นเก่าอาจเก็บ EXTERNAL_SHARE เป็น CHANGE_PERMISSION)
  const externalShareId = parseLegacyExternalShareId(remark);
  if (externalShareId > 0) {
    return {
      format: 'legacy',
      reason: null,
      payload: { externalShareId },
      inferredType: 'EXTERNAL_SHARE',
    };
  }

  if (remark.toUpperCase().startsWith('INTERNALSHAREFILE')) {
    const t = tokens(remark, ' ', ':');
    return {
      format: 'legacy',
      reason: null,
      payload: {
        fileId: toInt(t.fileid),
        principalType: toInt(t.principaltype),
        principalId: toInt(t.principalid),
        canRead: toBool(t.read),
        canWrite: toBool(t.write),
        canDelete: toBool(t.delete),
        expiryDate: t.expiry ? t.expiry : null,
      },
      inferredType: 'INTERNAL_SHARE',
    };
  }

  if (type === 'CHANGE_PERMISSION' && /PrincipalType:/i.test(remark)) {
    const t = tokens(remark, ' ', ':');
    return {
      format: 'legacy',
      reason: null,
      payload: {
        folderId: t.folderid ? toInt(t.folderid) : null,
        principalType: toInt(t.principaltype),
        principalId: toInt(t.principalid),
        canRead: toBool(t.read),
        canWrite: toBool(t.write),
        canDelete: toBool(t.delete),
        canModify: toBool(t.modify),
        canFullControl: toBool(t.fullcontrol),
        isDeny: toBool(t.isdeny),
      },
      inferredType: null,
    };
  }

  if (type === 'CREATE_HC' && remark.includes('|') && remark.includes('=')) {
    const t = tokens(remark, '|', '=');
    const parent = toInt(t.parentfolderid);
    return {
      format: 'legacy',
      reason: null,
      payload: {
        parentFolderId: parent > 0 ? parent : null,
        orgUnitId: toInt(t.orgunitid),
        folderName: t.foldername ?? '',
        folderDepth: t.folderdepth ? toInt(t.folderdepth) : 1,
        confidentialityLevel: t.confidentialitylevel ? toInt(t.confidentialitylevel) : 1,
        inheritPermission: toBool(t.inheritpermission),
      },
      inferredType: null,
    };
  }

  // DELETE_FOLDER / DOWNLOAD_FILE (เหตุผลล้วน) และข้อความอื่นๆ
  return { format: 'text', reason: remark, payload: null, inferredType: null };
}

/**
 * ชนิดคำขอที่ใช้ตัดสินผลข้างเคียงตอนอนุมัติ — พฤติกรรมเดิมของ ApprovalService.ApproveStep:
 * Remark ที่บอกว่าเป็นแชร์ภายนอก/ภายในชนะชนิดที่บันทึกในคอลัมน์ (กรณีสำรอง CHANGE_PERMISSION ของ ShareService)
 */
export function effectiveRequestType(
  requestType: string,
  decoded: Pick<DecodedRemark, 'inferredType'>,
): ApprovalRequestType {
  return (decoded.inferredType ?? requestType.trim().toUpperCase()) as ApprovalRequestType;
}

/** `ExternalShareID:<n>` (รูปแบบเก่า) → n, ไม่พบ → 0 */
export function parseLegacyExternalShareId(remark: string | null | undefined): number {
  if (!remark) return 0;
  for (const token of remark.split(' ')) {
    if (token.toUpperCase().startsWith('EXTERNALSHAREID:')) {
      const n = Number.parseInt(token.slice('ExternalShareID:'.length), 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return 0;
}

// ── ตัวช่วยภายใน ─────────────────────────────────────────────

/** แยก `key<kv>value` คั่นด้วย sep → map ที่ key เป็นตัวพิมพ์เล็ก (เหมือน OrdinalIgnoreCase เดิม) */
function tokens(text: string, sep: string, kv: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of text.split(sep)) {
    const idx = token.indexOf(kv);
    if (idx > 0) out[token.slice(0, idx).trim().toLowerCase()] = token.slice(idx + 1);
  }
  return out;
}

function toInt(v: string | undefined): number {
  if (v === undefined) return 0;
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? n : 0;
}

function toBool(v: string | undefined): boolean {
  return v !== undefined && v.trim().toLowerCase() === 'true';
}
