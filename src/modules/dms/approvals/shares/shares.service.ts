import { Injectable } from '@nestjs/common';
import { AppRole } from '../../../../common/constants/enums';
import { paginated, Paginated, PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../../database/transaction-runner.service';
import {
  NotificationsService,
  SendNotificationInput,
} from '../../../shared/notifications/notifications.service';
import { PermissionEvaluator } from '../../permissions/permission-evaluator';
import { ApprovalsService } from '../approvals/approvals.service';
import { ShareApprovalOutcomes } from '../approvals/share-approval-outcomes';
import { encodeRemark } from '../common/approval-remark';
import { REQUEST_EXPIRY_DAYS } from '../common/approval.constants';
import { EVENT } from '../common/approval-messages';
import type { ExternalSharePayload, InternalSharePayload } from '../common/approval-payloads';
import type { Tx } from '../common/db.types';
import { isFileActive, LookupStore } from '../common/lookup.store';
import { hashSharePassword, generateShareToken } from '../common/share-crypto';
import {
  assertDownloadLimit,
  assertExternalShareAllowedLevel,
  assertInternalShareExpiry,
  canDecideShare,
  canRevokeShare,
  canToggleShare,
  effectiveShareStatus,
  internalShareNeedsApproval,
  resolveExternalShareExpiry,
  SHARE_STATUS,
} from '../common/share-rules';
import type {
  CreateExternalShareDto,
  CreateInternalShareDto,
  ExternalShareDto,
  ExternalShareListQueryDto,
  FolderShareRequestResultDto,
  InternalShareDto,
  InternalShareListQueryDto,
  InternalShareResultDto,
  RequestFolderShareDto,
  ShareAccessLogDto,
} from './dto/shares.dto';
import {
  ExternalShareListRow,
  ExternalShareRow,
  InternalShareRow,
  SharesStore,
} from './shares.store';

const DAY_MS = 86_400_000;
const skipTake = (q: Pick<PaginationQueryDto, 'page' | 'pageSize'>) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * แชร์ไฟล์/โฟลเดอร์ — พอร์ตจาก ShareService (04-business-rules §2.6)
 *  - แชร์ภายใน (security.FilePermission): ผ่านอนุมัติเมื่อผู้แชร์ AppRole<3 หรือแชร์ให้แผนก
 *  - แชร์ภายนอก (storage.ExternalShare + ShareToken): สร้างเป็น Pending + คำขออนุมัติ EXTERNAL_SHARE ให้ Manager
 * งานที่แก้หลายตาราง (แชร์ + token + คำขอ + step) ทำใน transaction เดียว (เดิมแยกกัน → ค้างครึ่งๆ กลางๆ ได้)
 */
@Injectable()
export class SharesService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'Share';

  constructor(
    crudLog: CrudLogService,
    private readonly store: SharesStore,
    private readonly lookup: LookupStore,
    private readonly approvals: ApprovalsService,
    private readonly outcomes: ShareApprovalOutcomes,
    private readonly tx: TransactionRunner,
    private readonly notifications: NotificationsService,
    private readonly perm: PermissionEvaluator,
  ) {
    super(crudLog);
  }

  // ═══════════════════════════════════════════════════════════
  //  แชร์ภายใน
  // ═══════════════════════════════════════════════════════════

  /** ขอแชร์สิทธิ์โฟลเดอร์ให้ผู้อื่น (RequestFolderShareApproval) → คำขอ CHANGE_PERMISSION ให้ Manager อนุมัติ */
  requestFolderShareApproval(
    dto: RequestFolderShareDto,
    user: UserContext,
  ): Promise<FolderShareRequestResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'ApprovalRequest',
        operation: 'REQUEST_FOLDER_SHARE',
        meta: { folderId: dto.folderId, principalType: dto.principalType },
      },
      async () => {
        const folder = await this.lookup.getFolder(dto.folderId);
        if (!folder || folder.isDeleted)
          throw new ResourceNotFoundException('Folder', dto.folderId);
        await this.perm.assert(user, dto.folderId, 'Read', 'ไม่มีสิทธิ์ขอแชร์โฟลเดอร์นี้');
        if (!(await this.lookup.principalExists(dto.principalType, dto.principalId))) {
          throw new BusinessException('ไม่พบผู้รับสิทธิ์ที่ระบุ', 'PRINCIPAL_NOT_FOUND');
        }
        if (
          !dto.isDeny &&
          !(dto.canRead || dto.canWrite || dto.canDelete || dto.canModify || dto.canFullControl)
        ) {
          throw new BusinessException('ต้องเลือกสิทธิ์อย่างน้อย 1 อย่าง', 'PERMISSION_FLAGS_EMPTY');
        }
        const approverIds = await this.approvals.resolveDefaultApprovers(
          'CHANGE_PERMISSION',
          user.userId,
        );
        if (approverIds.length === 0) {
          throw new BusinessException('ไม่พบผู้อนุมัติที่ใช้งานอยู่ในระบบ', 'NO_APPROVER');
        }
        const payload = {
          principalType: dto.principalType,
          principalId: dto.principalId,
          canRead: dto.canRead,
          canWrite: dto.canWrite,
          canDelete: dto.canDelete,
          canModify: dto.canModify,
          canFullControl: dto.canFullControl,
          isDeny: dto.isDeny,
        };
        const requestId = await this.tx.run((t) =>
          this.approvals.insertRequestWithSteps(t, {
            requestType: 'CHANGE_PERMISSION',
            folderId: dto.folderId,
            requestedBy: user.userId,
            subject: `ขออนุมัติแชร์โฟลเดอร์ภายใน: ${folder.folderName}`,
            remark: encodeRemark({ payload }),
            expiryDate: new Date(Date.now() + REQUEST_EXPIRY_DAYS.share * DAY_MS),
            approverIds,
          }),
        );
        await this.notifications.sendMany(
          approverIds.map((id) => ({
            recipientUserId: id,
            eventType: EVENT.folderShareRequested,
            relatedEntityId: requestId,
            messageText: `${user.adUserName} ขออนุมัติแชร์โฟลเดอร์ '${folder.folderName}' ให้ผู้รับ (RequestID:${requestId})`,
          })),
        );
        return { approvalRequestId: requestId };
      },
      (r) => ({ recordId: r.approvalRequestId }),
    );
  }

  /** แชร์ไฟล์ภายใน (CreateInternalShare) */
  createInternalShare(
    dto: CreateInternalShareDto,
    user: UserContext,
  ): Promise<InternalShareResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'FilePermission',
        operation: 'CREATE_INTERNAL_SHARE',
        meta: {
          fileId: dto.fileId,
          principalType: dto.principalType,
          principalId: dto.principalId,
        },
      },
      async () => {
        const file = await this.lookup.getFile(dto.fileId);
        if (!file || !isFileActive(file)) throw new ResourceNotFoundException('File', dto.fileId);
        await this.assertCanShareFile(file.fileId, file.folderId, file.uploadedBy, user);

        if (!(dto.canRead || dto.canWrite || dto.canDelete)) {
          throw new BusinessException('ต้องเลือกสิทธิ์อย่างน้อย 1 อย่าง', 'PERMISSION_FLAGS_EMPTY');
        }
        assertInternalShareExpiry(dto.expiryDate);
        if (!(await this.lookup.principalExists(dto.principalType, dto.principalId))) {
          throw new BusinessException('ไม่พบผู้รับสิทธิ์ที่ระบุ', 'PRINCIPAL_NOT_FOUND');
        }

        if (internalShareNeedsApproval(user.appRole, dto.principalType)) {
          const approverIds = await this.approvals.resolveDefaultApprovers(
            'INTERNAL_SHARE',
            user.userId,
          );
          if (approverIds.length === 0) {
            throw new BusinessException('ไม่พบผู้อนุมัติที่ใช้งานอยู่ในระบบ', 'NO_APPROVER');
          }
          const payload: InternalSharePayload = {
            fileId: dto.fileId,
            principalType: dto.principalType,
            principalId: dto.principalId,
            canRead: dto.canRead,
            canWrite: dto.canWrite,
            canDelete: dto.canDelete,
            expiryDate: dto.expiryDate ? ymd(dto.expiryDate) : null,
          };
          const requestId = await this.tx.run((t) =>
            this.approvals.insertRequestWithSteps(t, {
              requestType: 'INTERNAL_SHARE',
              fileId: dto.fileId,
              requestedBy: user.userId,
              subject: `ขออนุมัติแชร์ไฟล์ภายใน: ${file.originalFileName || `File #${dto.fileId}`}`,
              remark: encodeRemark({ payload: payload as unknown as Record<string, unknown> }),
              expiryDate: new Date(Date.now() + REQUEST_EXPIRY_DAYS.share * DAY_MS),
              approverIds,
            }),
          );
          await this.notifications.sendMany(
            approverIds.map((id) => ({
              recipientUserId: id,
              eventType: EVENT.internalShareRequested,
              relatedEntityId: requestId,
              messageText: `${user.adUserName} ขออนุมัติแชร์ไฟล์ '${file.originalFileName}' ให้ผู้รับ (RequestID:${requestId})`,
            })),
          );
          return { requiresApproval: true, filePermissionId: null, approvalRequestId: requestId };
        }

        // Manager/Admin แชร์ให้ User/Role/Division: สร้างสิทธิ์ทันที
        const id = await this.store.insertFilePermission(undefined, {
          fileId: dto.fileId,
          principalType: dto.principalType,
          principalId: dto.principalId,
          canRead: dto.canRead,
          canWrite: dto.canWrite,
          canDelete: dto.canDelete,
          expiryDate: dto.expiryDate ?? null,
          grantedBy: user.userId,
        });
        if (dto.principalType === 1) {
          // ผู้รับเป็นรายบุคคลเท่านั้นที่แจ้งเตือนได้ (Role/Division ไม่มีผู้รับคนเดียว)
          await this.notifications.send({
            recipientUserId: dto.principalId,
            eventType: EVENT.internalShareCreated,
            relatedEntityId: id,
            messageText: `${user.adUserName} แชร์ไฟล์ '${file.originalFileName}' ให้คุณ (อ่าน=${dto.canRead}, เขียน=${dto.canWrite}, ลบ=${dto.canDelete})`,
          });
        }
        return { requiresApproval: false, filePermissionId: id, approvalRequestId: null };
      },
      (r) => ({ recordId: r.filePermissionId ?? r.approvalRequestId ?? undefined, after: r }),
    );
  }

  /** ผู้แชร์ต้องเห็นไฟล์ได้: Read/Write บนโฟลเดอร์ | เป็นผู้อัปโหลด | ได้สิทธิ์ระดับไฟล์ | โฟลเดอร์ระดับ PC (4) */
  private async assertCanShareFile(
    fileId: number,
    folderId: number,
    uploadedBy: number,
    user: UserContext,
  ): Promise<void> {
    if (uploadedBy === user.userId) return;
    if (
      (await this.perm.check(user, folderId, 'Read')) ||
      (await this.perm.check(user, folderId, 'Write'))
    ) {
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const direct = (await this.store.activeFilePermissions(fileId)).some(
      (p) =>
        p.principalType === 1 &&
        p.principalId === user.userId &&
        !p.isDeny &&
        (p.canRead || p.canWrite) &&
        (!p.expiryDate || p.expiryDate.getTime() >= today.getTime()),
    );
    if (direct) return;
    const folder = await this.lookup.getFolder(folderId);
    if (folder?.confidentialityLevel === 4) return;
    throw new PermissionDeniedException(
      'ไม่มีสิทธิ์เพียงพอในการแชร์ไฟล์นี้',
      'SHARE_PERMISSION_DENIED',
    );
  }

  /** ยกเลิกแชร์ภายใน — เจ้าของสิทธิ์ (ผู้ให้) หรือ Admin */
  revokeInternalShare(filePermissionId: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        entity: 'FilePermission',
        operation: 'REVOKE_INTERNAL_SHARE',
        recordId: filePermissionId,
        captureBefore: () => this.store.getFilePermission(filePermissionId),
      },
      async () => {
        const p = await this.store.getFilePermission(filePermissionId);
        if (!p) throw new ResourceNotFoundException('FilePermission', filePermissionId);
        if (p.grantedBy !== user.userId && user.appRole < AppRole.Admin) {
          throw new PermissionDeniedException(
            'เฉพาะผู้แชร์เดิมหรือ Admin เท่านั้นที่ยกเลิกการแชร์นี้ได้',
            'NOT_SHARE_OWNER',
          );
        }
        if (p.revokedDate) {
          throw new ConflictBusinessException('การแชร์นี้ถูกยกเลิกไปแล้ว', 'SHARE_ALREADY_REVOKED');
        }
        await this.tx.run((t) =>
          this.store.revokeFilePermission(t, filePermissionId, user.userId, 'Revoked by Sharer'),
        );
      },
    );
  }

  /** รายการแชร์ภายในที่ยังไม่ถูกเพิกถอน — ของฉัน (grantedBy = ฉัน) */
  async listMyInternal(
    user: UserContext,
    q: PaginationQueryDto,
  ): Promise<Paginated<InternalShareDto>> {
    const r = await this.store.pageInternal(user.userId, skipTake(q));
    return paginated(r.items.map(toInternalDto), r.total, q);
  }

  /** ทั้งหมด — Admin (กรองตามผู้ให้สิทธิ์ได้) */
  async listAllInternal(
    user: UserContext,
    q: InternalShareListQueryDto,
  ): Promise<Paginated<InternalShareDto>> {
    this.assertAdmin(user);
    const r = await this.store.pageInternal(q.grantedBy ?? null, skipTake(q));
    return paginated(r.items.map(toInternalDto), r.total, q);
  }

  // ═══════════════════════════════════════════════════════════
  //  แชร์ภายนอก
  // ═══════════════════════════════════════════════════════════

  /**
   * สร้างลิงก์แชร์ภายนอก (ไฟล์ หรือ โฟลเดอร์) เป็น Pending + token + เปิดคำขออนุมัติ — ทั้งหมดใน transaction เดียว
   * (ผิดจากเดิมที่ถ้าไม่มี Manager/Admin จะสร้างแชร์ Pending ที่ไม่มีใครอนุมัติได้ ที่นี่ปฏิเสธก่อนสร้าง)
   */
  createExternalShare(dto: CreateExternalShareDto, user: UserContext): Promise<ExternalShareDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'ExternalShare',
        operation: 'CREATE_EXTERNAL_SHARE',
        meta: { fileId: dto.fileId, folderId: dto.folderId },
      },
      async () => {
        const hasFile = dto.fileId !== undefined;
        const hasFolder = dto.folderId !== undefined;
        if (hasFile === hasFolder) {
          throw new BusinessException(
            'ต้องระบุ fileId หรือ folderId อย่างใดอย่างหนึ่ง (ไม่ทั้งคู่)',
            'SHARE_TARGET_INVALID',
          );
        }

        let name: string;
        let permFolderId: number;
        if (hasFile) {
          const file = await this.lookup.getFile(dto.fileId as number);
          if (!file || !isFileActive(file)) throw new ResourceNotFoundException('File', dto.fileId);
          const folder = await this.lookup.getFolder(file.folderId);
          if (!folder || folder.isDeleted)
            throw new ResourceNotFoundException('Folder', file.folderId);
          // เดิมส่ง FileID ไปตรวจสิทธิ์ในฐานะ FolderID (OPEN_QUESTIONS C4) — ที่นี่ตรวจที่โฟลเดอร์ของไฟล์
          permFolderId = folder.folderId;
          // ไฟล์ไม่มี ConfidentialityLevel ในฐานจริง (C2) → ใช้ระดับของโฟลเดอร์ที่ไฟล์อยู่
          assertExternalShareAllowedLevel(folder.confidentialityLevel, 'file');
          name = file.originalFileName;
        } else {
          const folder = await this.lookup.getFolder(dto.folderId as number);
          if (!folder || folder.isDeleted)
            throw new ResourceNotFoundException('Folder', dto.folderId);
          permFolderId = folder.folderId;
          assertExternalShareAllowedLevel(folder.confidentialityLevel, 'folder');
          name = folder.folderName;
        }
        await this.perm.assert(user, permFolderId, 'Read', 'ไม่มีสิทธิ์แชร์ไฟล์/โฟลเดอร์นี้');

        const now = new Date();
        const expiry = resolveExternalShareExpiry(dto.expiryDate, now);
        assertDownloadLimit(dto.downloadLimit);
        const approverIds = await this.approvals.resolveDefaultApprovers(
          'EXTERNAL_SHARE',
          user.userId,
        );
        if (approverIds.length === 0) {
          throw new BusinessException(
            'ไม่พบผู้อนุมัติที่ใช้งานอยู่ในระบบ ไม่สามารถขออนุมัติแชร์ภายนอกได้',
            'NO_APPROVER',
          );
        }

        const token = generateShareToken();
        const passwordHash = dto.password ? await hashSharePassword(dto.password) : null;

        const shareId = await this.tx.run(async (t) => {
          const id = await this.store.insertExternal(t, {
            token,
            fileId: dto.fileId ?? null,
            folderId: dto.folderId ?? null,
            sharerUserId: user.userId,
            passwordHash,
            expiryDate: expiry,
            downloadLimit: dto.downloadLimit ?? null,
            sharePurpose: dto.sharePurpose?.trim() || null,
            notifyOnAccess: dto.notifyOnAccess ?? true,
          });
          await this.store.insertToken(t, token, id, expiry);
          const payload: ExternalSharePayload = { externalShareId: id };
          await this.approvals.insertRequestWithSteps(t, {
            requestType: 'EXTERNAL_SHARE',
            fileId: dto.fileId ?? null,
            folderId: dto.folderId ?? null,
            requestedBy: user.userId,
            subject: `ขออนุมัติแชร์ภายนอก: ${name}`,
            remark: encodeRemark({
              reason: dto.sharePurpose,
              payload: payload as unknown as Record<string, unknown>,
            }),
            expiryDate: new Date(now.getTime() + REQUEST_EXPIRY_DAYS.share * DAY_MS),
            approverIds,
          });
          return id;
        });

        await this.notifications.send({
          recipientUserId: user.userId,
          eventType: EVENT.externalShareCreated,
          relatedEntityId: shareId,
          messageText: `สร้างลิงก์แชร์ภายนอกสำหรับ '${name}' แล้ว สถานะรออนุมัติ (หมดอายุ ${ymd(expiry)})`,
        });
        return this.getExternal(shareId, user);
      },
      (r) => ({ recordId: r.externalShareId, after: { ...r, shareToken: undefined } }),
    );
  }

  /** อนุมัติแชร์ภายนอกจากหน้าจัดการแชร์ (ApproveExternalShare) — Manager ขึ้นไป, ผู้แชร์อนุมัติของตัวเองไม่ได้ (ยกเว้น Admin) */
  approveExternalShare(id: number, user: UserContext): Promise<ExternalShareDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: 'ExternalShare',
        operation: 'APPROVE_EXTERNAL_SHARE',
        recordId: id,
      },
      async () => {
        const outbox: SendNotificationInput[] = [];
        await this.tx.run(async (t) => {
          const request = await this.approvals.lockRequestForShare(t, id);
          const share = await this.requireShareForDecision(id, user, t);
          await this.outcomes.activateExternal(t, id, user);
          // เดิมคำขอใน Approval Inbox ค้าง Pending ทั้งที่แชร์อนุมัติแล้ว → ปิดคำขอด้วยใน transaction เดียวกัน
          await this.approvals.closeRequestForShare(t, request, 'approved', user, null);
          outbox.push({
            recipientUserId: share.sharerUserId,
            eventType: EVENT.externalShareApproved,
            relatedEntityId: id,
            messageText: 'การแชร์ภายนอกของคุณได้รับการอนุมัติ ลิงก์ใช้งานได้แล้ว',
          });
        });
        await this.notifications.sendMany(outbox);
        return this.getExternal(id, user);
      },
    );
  }

  /** ปฏิเสธแชร์ภายนอก (RejectExternalShare) → สถานะ Revoked */
  rejectExternalShare(id: number, reason: string, user: UserContext): Promise<ExternalShareDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: 'ExternalShare',
        operation: 'REJECT_EXTERNAL_SHARE',
        recordId: id,
      },
      async () => {
        const outbox: SendNotificationInput[] = [];
        await this.tx.run(async (t) => {
          const request = await this.approvals.lockRequestForShare(t, id);
          const share = await this.requireShareForDecision(id, user, t);
          await this.outcomes.rejectExternal(t, id, user, reason);
          await this.approvals.closeRequestForShare(t, request, 'rejected', user, reason);
          outbox.push({
            recipientUserId: share.sharerUserId,
            eventType: EVENT.externalShareRejected,
            relatedEntityId: id,
            messageText: `การแชร์ภายนอกของคุณถูกปฏิเสธ เหตุผล: ${reason}`,
          });
        });
        await this.notifications.sendMany(outbox);
        return this.getExternal(id, user);
      },
    );
  }

  private async requireShareForDecision(
    id: number,
    user: UserContext,
    t: Tx,
  ): Promise<ExternalShareRow> {
    if (user.appRole < AppRole.Manager) {
      throw new PermissionDeniedException(
        'การอนุมัติ/ปฏิเสธแชร์ต้องเป็น Manager หรือ Admin',
        'ROLE_REQUIRED',
      );
    }
    const share = await this.store.getExternal(id, t, true);
    if (!share) throw new ResourceNotFoundException('ExternalShare', id);
    if (!canDecideShare(share.status)) {
      throw new BusinessException(
        `ดำเนินการได้เฉพาะแชร์ที่รออนุมัติ (สถานะปัจจุบัน: ${share.status})`,
        'SHARE_NOT_PENDING',
      );
    }
    if (share.sharerUserId === user.userId && user.appRole < AppRole.Admin) {
      throw new PermissionDeniedException(
        'ไม่สามารถอนุมัติ/ปฏิเสธการแชร์ของตัวเองได้',
        'SELF_APPROVAL_FORBIDDEN',
      );
    }
    return share;
  }

  /** ยกเลิกแชร์ภายนอกถาวร (RevokeExternalShare) — เจ้าของหรือ Admin; ถ้ายัง Pending จะปิดคำขอที่ค้างด้วย */
  revokeExternalShare(id: number, reason: string, user: UserContext): Promise<ExternalShareDto> {
    return this.logged(
      {
        action: 'DELETE',
        entity: 'ExternalShare',
        operation: 'REVOKE_EXTERNAL_SHARE',
        recordId: id,
      },
      async () => {
        const outbox: SendNotificationInput[] = [];
        await this.tx.run(async (t) => {
          const request = await this.approvals.lockRequestForShare(t, id);
          const share = await this.store.getExternal(id, t, true);
          if (!share) throw new ResourceNotFoundException('ExternalShare', id);
          this.assertOwnerOrAdmin(share, user);
          if (!canRevokeShare(share.status)) {
            throw new ConflictBusinessException(
              `ยกเลิกไม่ได้ เพราะแชร์นี้อยู่ในสถานะ ${share.status}`,
              'SHARE_NOT_REVOCABLE',
            );
          }
          const wasPending = share.status === SHARE_STATUS.Pending;
          await this.store.revoke(t, id, user.userId, reason, [
            SHARE_STATUS.Pending,
            SHARE_STATUS.Active,
            SHARE_STATUS.Disabled,
          ]);
          if (wasPending)
            await this.approvals.closeRequestForShare(t, request, 'withdrawn', user, reason);
          outbox.push({
            recipientUserId: share.sharerUserId,
            eventType: EVENT.externalShareRevoked,
            relatedEntityId: id,
            messageText: `การแชร์ภายนอกถูกยกเลิก เหตุผล: ${reason}`,
          });
        });
        await this.notifications.sendMany(outbox);
        return this.getExternal(id, user);
      },
    );
  }

  /** เปิด/ปิดชั่วคราว (Active ↔ Disabled) — เจ้าของหรือ Admin */
  toggleExternalShare(id: number, user: UserContext): Promise<ExternalShareDto> {
    return this.logged(
      {
        action: 'UPDATE',
        entity: 'ExternalShare',
        operation: 'TOGGLE_EXTERNAL_SHARE',
        recordId: id,
      },
      async () => {
        await this.tx.run(async (t) => {
          const share = await this.store.getExternal(id, t, true);
          if (!share) throw new ResourceNotFoundException('ExternalShare', id);
          this.assertOwnerOrAdmin(share, user);
          if (!canToggleShare(share.status)) {
            throw new ConflictBusinessException(
              `เปิด/ปิดได้เฉพาะแชร์ที่ Active หรือ Disabled (สถานะปัจจุบัน: ${share.status})`,
              'SHARE_NOT_TOGGLEABLE',
            );
          }
          await this.store.toggle(t, id, user.userId);
        });
        return this.getExternal(id, user);
      },
      (r) => ({
        operation:
          r.status === SHARE_STATUS.Disabled ? 'DISABLE_EXTERNAL_SHARE' : 'ENABLE_EXTERNAL_SHARE',
      }),
    );
  }

  private assertOwnerOrAdmin(share: ExternalShareRow, user: UserContext): void {
    if (share.sharerUserId !== user.userId && user.appRole < AppRole.Admin) {
      throw new PermissionDeniedException(
        'เฉพาะเจ้าของลิงก์หรือ Admin เท่านั้นที่ดำเนินการนี้ได้',
        'NOT_SHARE_OWNER',
      );
    }
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** เจ้าของ, Admin หรือ Manager ขึ้นไป (ผู้อนุมัติต้องเห็นรายละเอียดก่อนตัดสินใจ) — token เห็นได้เฉพาะเจ้าของ */
  async getExternal(id: number, user: UserContext): Promise<ExternalShareDto> {
    const row = await this.store.getExternalListRow(id);
    if (!row) throw new ResourceNotFoundException('ExternalShare', id);
    if (row.sharerUserId !== user.userId && user.appRole < AppRole.Manager) {
      throw new PermissionDeniedException('ไม่มีสิทธิ์ดูรายการแชร์นี้', 'NOT_SHARE_OWNER');
    }
    return toExternalDto(row, user.userId);
  }

  async listMyExternal(
    user: UserContext,
    q: ExternalShareListQueryDto,
  ): Promise<Paginated<ExternalShareDto>> {
    const r = await this.store.pageExternal(
      { sharerUserId: user.userId, status: q.status },
      skipTake(q),
    );
    return paginated(
      r.items.map((x) => toExternalDto(x, user.userId)),
      r.total,
      q,
    );
  }

  async listAllExternal(
    user: UserContext,
    q: ExternalShareListQueryDto,
  ): Promise<Paginated<ExternalShareDto>> {
    this.assertAdmin(user);
    const r = await this.store.pageExternal(
      { sharerUserId: q.sharerUserId, status: q.status },
      skipTake(q),
    );
    return paginated(
      r.items.map((x) => toExternalDto(x, user.userId)),
      r.total,
      q,
    );
  }

  /** log การเข้าถึงลิงก์ — เจ้าของหรือ Admin */
  async listAccessLog(
    id: number,
    user: UserContext,
    q: PaginationQueryDto,
  ): Promise<Paginated<ShareAccessLogDto>> {
    const share = await this.store.getExternal(id);
    if (!share) throw new ResourceNotFoundException('ExternalShare', id);
    this.assertOwnerOrAdmin(share, user);
    const r = await this.store.pageAccessLog(id, skipTake(q));
    return paginated(
      r.items.map((l) => ({
        accessLogId: l.accessLogId,
        externalShareId: l.externalShareId,
        recipientIdentifier: l.recipientIdentifier,
        accessType: l.accessType,
        isSuccessful: l.isSuccessful,
        failureReason: l.failureReason,
        fileSizeBytes: l.fileSizeBytes,
        accessTimestamp: l.accessTimestamp,
        ipAddress: l.ipAddress,
        userAgent: l.userAgent,
      })),
      r.total,
      q,
    );
  }

  private assertAdmin(user: UserContext): void {
    if (user.appRole < AppRole.Admin) {
      throw new PermissionDeniedException(
        'เฉพาะ Admin เท่านั้นที่ดูรายการแชร์ทั้งหมดได้',
        'ROLE_REQUIRED',
      );
    }
  }
}

// ── mapper ────────────────────────────────────────────────

export function toExternalDto(row: ExternalShareListRow, viewerId: number): ExternalShareDto {
  return {
    externalShareId: row.externalShareId,
    shareToken: row.sharerUserId === viewerId ? row.shareToken : null,
    fileId: row.fileId,
    fileName: row.fileName,
    folderId: row.folderId,
    folderName: row.folderName,
    sharerUserId: row.sharerUserId,
    sharerName: row.sharerName,
    approverUserId: row.approverUserId,
    hasPassword: !!row.passwordHash,
    expiryDate: row.expiryDate,
    downloadLimit: row.downloadLimit,
    currentDownloadCount: row.currentDownloadCount,
    status: row.status,
    effectiveStatus: effectiveShareStatus(row.status, row.expiryDate),
    createdDate: row.createdDate,
    approvedDate: row.approvedDate,
    disabledDate: row.disabledDate,
    disabledReason: row.disabledReason,
    revokedDate: row.revokedDate,
    revocationReason: row.revocationReason,
    sharePurpose: row.sharePurpose,
    notifyOnAccess: row.notifyOnAccess,
  };
}

export function toInternalDto(r: InternalShareRow): InternalShareDto {
  return {
    filePermissionId: r.filePermissionId,
    fileId: r.fileId,
    fileName: r.fileName,
    principalType: r.principalType,
    principalId: r.principalId,
    canRead: r.canRead,
    canWrite: r.canWrite,
    canDelete: r.canDelete,
    expiryDate: r.expiryDate,
    grantedBy: r.grantedBy,
    grantedByName: r.grantedByName,
    grantedDate: r.grantedDate,
  };
}
