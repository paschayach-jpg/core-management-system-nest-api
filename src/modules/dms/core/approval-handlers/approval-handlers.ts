import type { ApprovalRequestType } from '../../../../common/constants/enums';
import type { UserContext } from '../../../../common/interfaces/user-context';
import type { TransactionScope } from '../../../../database/transaction-runner.service';
import type { ApprovalOutcomeHandler, ApprovalRecord } from '../../ports/dms-approval.port';
import type { FolderPermissionsService } from '../acl/folder-permissions.service';
import type { FoldersService } from '../folders/folders.service';

/**
 * ผลข้างเคียงหลังคำขออนุมัติของ DMS core ได้รับอนุมัติ (ลงทะเบียนกับ DMS_APPROVAL_HANDLERS ตอน DmsCoreModule เริ่มทำงาน)
 *
 * handler รับ `scope` เป็นพารามิเตอร์ตัวที่ 3 (ไม่บังคับ): ถ้า module อนุมัติส่ง transaction ของการเปลี่ยนสถานะคำขอมาให้
 * ผลข้างเคียงจะอยู่ใน transaction เดียวกัน (ล้ม = ย้อนทั้งคำขอ) · ถ้าไม่ส่ง handler เปิด transaction ของตัวเอง
 * (สัญญา `ApprovalOutcomeHandler.onApproved(request, approver)` ปัจจุบันยังไม่ส่ง scope — ดู "ขอแก้ core" ใน docs/modules/dms-core.md)
 * ทุก handler โยน error เมื่อทำไม่สำเร็จ (ต่างจากระบบเดิมที่กลืน exception แล้วยังบันทึกว่าอนุมัติ)
 */

/** CREATE_HC: สร้างโฟลเดอร์ 1HC หลังอนุมัติ */
export class CreateHcApprovalHandler implements ApprovalOutcomeHandler {
  readonly requestType: ApprovalRequestType = 'CREATE_HC';
  constructor(private readonly folders: FoldersService) {}

  async onApproved(
    request: ApprovalRecord,
    approver: UserContext,
    scope?: TransactionScope,
  ): Promise<void> {
    await this.folders.createAfterApproval(request, approver, scope);
  }
}

/** DELETE_FOLDER: ลบ (soft) โฟลเดอร์ทั้งต้นไม้ย่อยที่ขอลบ */
export class DeleteFolderApprovalHandler implements ApprovalOutcomeHandler {
  readonly requestType: ApprovalRequestType = 'DELETE_FOLDER';
  constructor(private readonly folders: FoldersService) {}

  async onApproved(
    request: ApprovalRecord,
    approver: UserContext,
    scope?: TransactionScope,
  ): Promise<void> {
    await this.folders.deleteAfterApproval(request, approver, scope);
  }
}

/** CHANGE_PERMISSION: ตั้งสิทธิ์โฟลเดอร์ตาม payload (JSON หรือข้อความ Remark รูปแบบเดิม) */
export class ChangePermissionApprovalHandler implements ApprovalOutcomeHandler {
  readonly requestType: ApprovalRequestType = 'CHANGE_PERMISSION';
  constructor(private readonly perms: FolderPermissionsService) {}

  async onApproved(
    request: ApprovalRecord,
    approver: UserContext,
    scope?: TransactionScope,
  ): Promise<void> {
    await this.perms.setAfterApproval(request, approver, scope);
  }
}

export function buildDmsCoreApprovalHandlers(
  folders: FoldersService,
  perms: FolderPermissionsService,
): ApprovalOutcomeHandler[] {
  return [
    new CreateHcApprovalHandler(folders),
    new DeleteFolderApprovalHandler(folders),
    new ChangePermissionApprovalHandler(perms),
  ];
}
