import { Injectable } from '@nestjs/common';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import type { InternalSharePayload } from '../common/approval-payloads';
import type { Tx } from '../common/db.types';
import { isFileActive, LookupStore } from '../common/lookup.store';
import { canDecideShare, SHARE_STATUS } from '../common/share-rules';
import { ExternalShareRow, SharesStore } from '../shares/shares.store';

/**
 * ผลข้างเคียงของคำขอแชร์เมื่อได้รับอนุมัติ/ปฏิเสธ — ทำงานใน transaction ของผู้เรียก (ApprovalsService / SharesService)
 * แยกเป็น provider เล็กๆ เพื่อให้ทั้งสอง service ใช้ร่วมกันโดยไม่พึ่งกันเป็นวงกลม
 * ล้มเหลว = โยน error ให้ transaction ของผู้เรียก rollback (ระบบเดิมกลืน error แล้วยังตั้งคำขอเป็น Approved)
 */
@Injectable()
export class ShareApprovalOutcomes {
  constructor(
    private readonly shares: SharesStore,
    private readonly lookup: LookupStore,
  ) {}

  /** Pending → Active (+ token ทุกตัว) · แชร์ที่ไม่อยู่ในสถานะ Pending ถือเป็นข้อผิดพลาด (ไม่ตั้ง Approved เงียบๆ) */
  async activateExternal(
    tx: Tx,
    externalShareId: number,
    approver: UserContext,
  ): Promise<ExternalShareRow> {
    const share = await this.shares.getExternal(externalShareId, tx, true);
    if (!share) throw new ResourceNotFoundException('ExternalShare', externalShareId);
    if (
      !canDecideShare(share.status) ||
      !(await this.shares.activate(tx, externalShareId, approver.userId))
    ) {
      throw new BusinessException(
        `แชร์ภายนอก ${externalShareId} ไม่อยู่ในสถานะรออนุมัติ (ปัจจุบัน: ${share.status})`,
        'SHARE_NOT_PENDING',
      );
    }
    return { ...share, status: SHARE_STATUS.Active, approverUserId: approver.userId };
  }

  /** Pending → Revoked (ปฏิเสธ) · คืน share เดิมถ้าเปลี่ยนจริง, null ถ้าไม่อยู่ในสถานะ Pending แล้ว */
  async rejectExternal(
    tx: Tx,
    externalShareId: number,
    rejecter: UserContext,
    reason: string | null,
  ): Promise<ExternalShareRow | null> {
    const share = await this.shares.getExternal(externalShareId, tx, true);
    if (!share || !canDecideShare(share.status)) return null;
    const ok = await this.shares.revoke(tx, externalShareId, rejecter.userId, reason, [
      SHARE_STATUS.Pending,
    ]);
    return ok ? share : null;
  }

  /** อนุมัติแชร์ไฟล์ภายใน: สร้าง security.FilePermission (GrantedBy = ผู้ขอ) · คืน FilePermissionID */
  async grantInternal(
    tx: Tx,
    requestedBy: number,
    p: Partial<InternalSharePayload> | null,
    now = new Date(),
  ): Promise<number> {
    if (!p || !p.fileId || p.fileId <= 0 || !p.principalType || !p.principalId) {
      throw new BusinessException(
        'ข้อมูลคำขอแชร์ภายในไม่ครบถ้วน (ไม่พบไฟล์หรือผู้รับ)',
        'APPROVAL_PAYLOAD_INVALID',
      );
    }
    const file = await this.lookup.getFile(p.fileId, tx);
    if (!file || !isFileActive(file)) {
      throw new BusinessException('ไฟล์ที่ขอแชร์ถูกลบหรือไม่พบแล้ว', 'FILE_NOT_FOUND');
    }
    if (!(await this.lookup.principalExists(p.principalType, p.principalId, tx))) {
      throw new BusinessException('ไม่พบผู้รับสิทธิ์ที่ระบุในคำขอ', 'PRINCIPAL_NOT_FOUND');
    }
    const expiry = p.expiryDate ? new Date(`${p.expiryDate}T00:00:00`) : null;
    if (expiry && Number.isNaN(expiry.getTime())) {
      throw new BusinessException('วันหมดอายุในคำขอไม่ถูกต้อง', 'APPROVAL_PAYLOAD_INVALID');
    }
    // วันหมดอายุที่ผ่านไประหว่างรออนุมัติ → สิทธิ์จะหมดอายุทันที ให้ผู้อนุมัติปฏิเสธแทน (ระบบเดิมสร้างสิทธิ์ที่ใช้ไม่ได้)
    if (
      expiry &&
      expiry.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    ) {
      throw new BusinessException(
        'วันหมดอายุของการแชร์ผ่านไปแล้ว กรุณาปฏิเสธคำขอและให้ผู้ขอยื่นใหม่',
        'SHARE_EXPIRY_IN_PAST',
      );
    }
    return this.shares.insertFilePermission(tx, {
      fileId: p.fileId,
      principalType: p.principalType,
      principalId: p.principalId,
      canRead: p.canRead === true,
      canWrite: p.canWrite === true,
      canDelete: p.canDelete === true,
      expiryDate: expiry,
      grantedBy: requestedBy,
    });
  }
}
