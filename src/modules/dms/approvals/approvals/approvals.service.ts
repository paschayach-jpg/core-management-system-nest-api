import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  APPROVAL_REQUEST_TYPES,
  AppRole,
  ApprovalRequestType,
} from '../../../../common/constants/enums';
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
import { PermissionEvaluator } from '../../permissions/permission-evaluator';
import type {
  ApprovalRecord,
  ApprovalRef,
  SubmitApprovalInput,
} from '../../ports/dms-approval.port';
import {
  NotificationsService,
  SendNotificationInput,
} from '../../../shared/notifications/notifications.service';
import { decodeRemark, effectiveRequestType, encodeRemark } from '../common/approval-remark';
import {
  canActOnStep,
  decideAfterApprove,
  defaultApproverIds,
  escalationTargetRole,
  isStepActionable,
  nextStepOrder,
  pickActingStep,
} from '../common/approval-flow';
import {
  clip,
  ESCALATION_EXTENSION_DAYS,
  REQUEST_APPROVED,
  REQUEST_EXPIRY_DAYS,
  REQUEST_EXPIRED_OR_WITHDRAWN,
  REQUEST_PENDING,
  REQUEST_REJECTED,
  REQUEST_STATUS_CONSUMED,
  STEP_APPROVED,
  STEP_DELEGATED_OR_AUTOCLOSED,
  STEP_PENDING,
  STEP_REJECTED,
} from '../common/approval.constants';
import {
  approvedMessage,
  escalatedToApproverMessage,
  escalatedToRequesterMessage,
  EVENT,
  rejectedMessage,
  stepPendingMessage,
} from '../common/approval-messages';
import type { ExternalSharePayload, InternalSharePayload } from '../common/approval-payloads';
import type { Tx } from '../common/db.types';
import { isFileActive, LookupStore, UserLite } from '../common/lookup.store';
import { InMemoryApprovalHandlerRegistry } from './approval-handler.registry';
import {
  ApprovalListRow,
  ApprovalRequestRow,
  ApprovalsStore,
  ApprovalStepRow,
} from './approvals.store';
import type {
  ApprovalDetailDto,
  ApprovalRequestDto,
  ApprovalResultDto,
  ApprovalStepDto,
  MyRequestsQueryDto,
  SubmitDownloadRequestDto,
  SubmitPermissionRequestDto,
} from './dto/approvals.dto';
import { ShareApprovalOutcomes } from './share-approval-outcomes';

const DAY_MS = 86_400_000;
/** step ที่แสดงในรายละเอียดคำขอ (คำขอเก่าบางรายการมี step นับพัน) */
const DETAIL_STEP_LIMIT = 50;
const CORE_HANDLED_TYPES = new Set<string>(['CREATE_HC', 'DELETE_FOLDER', 'CHANGE_PERMISSION']);

const skipTake = (q: Pick<PaginationQueryDto, 'page' | 'pageSize'>) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});

function statusLabel(s: number): string {
  return ['', 'Pending', 'Approved', 'Rejected', 'Expired', 'Consumed'][s] ?? String(s);
}

/**
 * งานอนุมัติ (workflow.ApprovalRequest / ApprovalStep) — พอร์ตจาก ApprovalService
 *
 * ต่างจากระบบเดิมที่สำคัญ (รายละเอียดใน docs/modules/dms-approvals.md):
 *  - ลงมติ + ผลข้างเคียงตามชนิดคำขอ ทำใน transaction เดียว: ผลข้างเคียงล้ม = rollback ทั้งก้อน (เดิมกลืน error แล้วยังตั้ง Approved)
 *  - ผู้ลงมติต้องเป็นเจ้าของ step (หรือผู้รับมอบ) — ข้อยกเว้นเฉพาะที่ UI เดิมยอม (Admin กับ CREATE_HC, Manager+ กับ DELETE_FOLDER)
 *  - ค้น step ด้วย StepID ตรง (เดิมวนดึง step ของทุกคำขอที่ Pending)
 *  - escalation ยกระดับไปยังผู้ใช้จริงของ role ปลายทางและเลื่อนวันหมดอายุ (เดิมใส่เลข role เป็น ApproverID และยกซ้ำทุก tick)
 */
@Injectable()
export class ApprovalsService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'ApprovalRequest';
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    crudLog: CrudLogService,
    private readonly store: ApprovalsStore,
    private readonly lookup: LookupStore,
    private readonly tx: TransactionRunner,
    private readonly notifications: NotificationsService,
    private readonly handlers: InMemoryApprovalHandlerRegistry,
    private readonly shareOutcomes: ShareApprovalOutcomes,
    private readonly perm: PermissionEvaluator,
  ) {
    super(crudLog);
  }

  // ═══════════════════════════════════════════════════════════
  //  อ่าน
  // ═══════════════════════════════════════════════════════════

  async listPending(
    user: UserContext,
    q: PaginationQueryDto,
  ): Promise<Paginated<ApprovalRequestDto>> {
    const r = await this.store.pagePendingFor(user.userId, user.appRole, skipTake(q));
    return paginated(r.items.map(toRequestDto), r.total, q);
  }

  async listMine(user: UserContext, q: MyRequestsQueryDto): Promise<Paginated<ApprovalRequestDto>> {
    const r = await this.store.pageRequestedBy(user.userId, q.status ?? null, skipTake(q));
    return paginated(r.items.map(toRequestDto), r.total, q);
  }

  /** ทุกสถานะของคำขอที่ผูกกับโฟลเดอร์ — ต้องมีสิทธิ์ Read บนโฟลเดอร์ */
  async listByFolder(
    folderId: number,
    user: UserContext,
    q: PaginationQueryDto,
  ): Promise<Paginated<ApprovalRequestDto>> {
    const folder = await this.lookup.getFolder(folderId);
    if (!folder) throw new ResourceNotFoundException('Folder', folderId);
    await this.perm.assert(user, folderId, 'Read');
    const r = await this.store.pageByFolder(folderId, skipTake(q));
    return paginated(r.items.map(toRequestDto), r.total, q);
  }

  async get(id: number, user: UserContext): Promise<ApprovalDetailDto> {
    const row = await this.requireVisible(id, user);
    const steps = await this.store.pageSteps(id, { skip: 0, take: DETAIL_STEP_LIMIT }, 'DESC');
    return {
      ...toRequestDto(row),
      steps: steps.items.reverse().map(toStepDto),
      totalSteps: steps.total,
    };
  }

  async listSteps(
    id: number,
    user: UserContext,
    q: PaginationQueryDto,
  ): Promise<Paginated<ApprovalStepDto>> {
    await this.requireVisible(id, user);
    const r = await this.store.pageSteps(id, skipTake(q), q.sortDir === 'desc' ? 'DESC' : 'ASC');
    return paginated(r.items.map(toStepDto), r.total, q);
  }

  /** ผู้ขอ, Manager ขึ้นไป หรือผู้ที่มี step ในคำขอนั้น เห็นได้ */
  private async requireVisible(id: number, user: UserContext): Promise<ApprovalListRow> {
    const row = await this.store.getListRow(id, user.userId);
    if (!row) throw new ResourceNotFoundException('ApprovalRequest', id);
    if (
      row.requestedBy !== user.userId &&
      user.appRole < AppRole.Manager &&
      !(await this.store.isAssignedApprover(id, user.userId))
    ) {
      throw new PermissionDeniedException('ไม่มีสิทธิ์ดูคำขอนี้', 'APPROVAL_VIEW_DENIED');
    }
    return row;
  }

  // ═══════════════════════════════════════════════════════════
  //  ยื่นคำขอ
  // ═══════════════════════════════════════════════════════════

  /**
   * ยื่นคำขอเปลี่ยนสิทธิ์โฟลเดอร์ HC/SC (SubmitPermissionRequest) — Manager/Admin
   * payload เก็บเป็น JSON ใน Remark; หลังอนุมัติ handler ของ DMS-core (CHANGE_PERMISSION) เป็นผู้ตั้งสิทธิ์จริง
   */
  submitPermissionRequest(
    dto: SubmitPermissionRequestDto,
    user: UserContext,
  ): Promise<ApprovalRequestDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'SUBMIT_PERMISSION_REQUEST',
        meta: { folderId: dto.folderId, principalType: dto.principalType },
      },
      async () => {
        if (user.appRole < AppRole.Manager) {
          throw new PermissionDeniedException(
            'การยื่นคำขอเปลี่ยนสิทธิ์ต้องเป็น Manager หรือ Admin',
            'ROLE_REQUIRED',
          );
        }
        const folder = await this.lookup.getFolder(dto.folderId);
        if (!folder || folder.isDeleted)
          throw new ResourceNotFoundException('Folder', dto.folderId);
        if (folder.confidentialityLevel > 2) {
          throw new BusinessException(
            `ขออนุมัติได้เฉพาะโฟลเดอร์ระดับ HC (1) และ SC (2) — โฟลเดอร์นี้เป็นระดับ ${folder.confidentialityLevel}`,
            'APPROVAL_FOLDER_LEVEL',
          );
        }
        await this.perm.assert(user, dto.folderId, 'Read');
        if (!(await this.lookup.principalExists(dto.principalType, dto.principalId))) {
          throw new BusinessException('ไม่พบผู้รับสิทธิ์ที่ระบุ', 'PRINCIPAL_NOT_FOUND');
        }
        if (
          !dto.isDeny &&
          !(dto.canRead || dto.canWrite || dto.canDelete || dto.canModify || dto.canFullControl)
        ) {
          throw new BusinessException('ต้องเลือกสิทธิ์อย่างน้อย 1 อย่าง', 'PERMISSION_FLAGS_EMPTY');
        }
        await this.assertApprovers(dto.approverUserIds);

        const now = new Date();
        const expiry =
          dto.expiryDate ?? new Date(now.getTime() + REQUEST_EXPIRY_DAYS.permission * DAY_MS);
        if (expiry.getTime() <= now.getTime()) {
          throw new BusinessException(
            'วันหมดอายุของคำขอต้องอยู่ในอนาคต',
            'APPROVAL_EXPIRY_IN_PAST',
          );
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
        const requestId = await this.tx.run(async (t) =>
          this.insertRequestWithSteps(t, {
            requestType: 'CHANGE_PERMISSION',
            folderId: dto.folderId,
            requestedBy: user.userId,
            subject: dto.subject.trim(),
            remark: encodeRemark({ reason: dto.reason, payload }),
            expiryDate: expiry,
            approverIds: dto.approverUserIds,
          }),
        );
        // แจ้งผู้อนุมัติ step แรก (พฤติกรรมเดิม)
        await this.notifications.send({
          recipientUserId: dto.approverUserIds[0],
          eventType: EVENT.requestCreated,
          relatedEntityId: requestId,
          messageText: `มีคำขออนุมัติ (ID ${requestId}) ที่ต้องดำเนินการ`,
        });
        return this.get(requestId, user);
      },
      (r) => ({
        recordId: r.requestId,
        after: { requestId: r.requestId, status: r.requestStatus },
      }),
    );
  }

  /**
   * ยื่นคำขออนุมัติทั่วไปให้ DMS-core (DMS_APPROVAL_PORT.submit): CREATE_HC, DELETE_FOLDER, ขอดาวน์โหลด ฯลฯ
   * ผู้อนุมัติ: ตาม `approverUserIds` ถ้าระบุ มิฉะนั้นใช้กฎเดิม (Admin ทุกคนสำหรับ CREATE_HC/DELETE_FOLDER, Manager ทุกคน/สำรอง Admin สำหรับชนิดอื่น)
   */
  submit(user: UserContext, input: SubmitApprovalInput): Promise<ApprovalRef> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'SUBMIT_APPROVAL',
        meta: { requestType: input.requestType, folderId: input.folderId, fileId: input.fileId },
      },
      async () => {
        if (!(APPROVAL_REQUEST_TYPES as readonly string[]).includes(input.requestType)) {
          throw new BusinessException(
            `ไม่รองรับคำขอชนิด ${String(input.requestType)}`,
            'APPROVAL_TYPE_INVALID',
          );
        }
        const subject = input.subject?.trim();
        if (!subject)
          throw new BusinessException('ต้องระบุหัวข้อคำขอ', 'APPROVAL_SUBJECT_REQUIRED');
        if (subject.length > 500) {
          throw new BusinessException(
            'หัวข้อคำขอยาวเกิน 500 ตัวอักษร',
            'APPROVAL_SUBJECT_TOO_LONG',
          );
        }
        if (input.folderId) {
          const folder = await this.lookup.getFolder(input.folderId);
          if (!folder) throw new ResourceNotFoundException('Folder', input.folderId);
          if (input.requestType === 'DELETE_FOLDER' && folder.isDeleted) {
            throw new BusinessException('โฟลเดอร์นี้อยู่ในถังขยะแล้ว', 'FOLDER_ALREADY_DELETED');
          }
        }
        if (input.fileId) {
          const file = await this.lookup.getFile(input.fileId);
          if (!file || !isFileActive(file))
            throw new ResourceNotFoundException('File', input.fileId);
        }

        let approverIds: number[];
        const explicit = input.approverUserIds && input.approverUserIds.length > 0;
        if (explicit) {
          approverIds = [...new Set(input.approverUserIds)];
          await this.assertApprovers(approverIds);
        } else {
          approverIds = await this.resolveDefaultApprovers(input.requestType, user.userId);
        }
        if (approverIds.length === 0) {
          throw new BusinessException(
            'ไม่พบผู้อนุมัติที่ใช้งานอยู่ในระบบ ไม่สามารถส่งคำขออนุมัติได้',
            'NO_APPROVER',
          );
        }

        const expiryDays =
          input.requestType === 'DELETE_FOLDER'
            ? REQUEST_EXPIRY_DAYS.deleteFolder
            : input.requestType === 'DOWNLOAD_FILE'
              ? REQUEST_EXPIRY_DAYS.download
              : input.requestType === 'EXTERNAL_SHARE' || input.requestType === 'INTERNAL_SHARE'
                ? REQUEST_EXPIRY_DAYS.share
                : REQUEST_EXPIRY_DAYS.permission;
        const requestId = await this.tx.run(async (t) =>
          this.insertRequestWithSteps(t, {
            requestType: input.requestType,
            folderId: input.folderId ?? null,
            fileId: input.fileId ?? null,
            requestedBy: user.userId,
            subject,
            remark: encodeRemark({ reason: input.reason, payload: input.payload }),
            expiryDate: new Date(Date.now() + expiryDays * DAY_MS),
            approverIds,
          }),
        );
        const notifyIds = explicit ? [approverIds[0]] : approverIds;
        const eventType =
          input.requestType === 'DELETE_FOLDER'
            ? EVENT.deleteFolderRequested
            : input.requestType === 'CREATE_HC'
              ? EVENT.createHcRequested
              : EVENT.requestCreated;
        await this.notifications.sendMany(
          notifyIds.map((id) => ({
            recipientUserId: id,
            eventType,
            relatedEntityId: requestId,
            messageText: `${subject} (คำขอ ID ${requestId}) รออนุมัติจากคุณ`,
          })),
        );
        return { requestId, requestStatus: REQUEST_PENDING };
      },
      (r) => ({ recordId: r.requestId, after: r }),
    );
  }

  /** สร้างคำขอ + step 1..n ใน transaction ของผู้เรียก (ใช้ร่วมกับ SharesService) */
  async insertRequestWithSteps(
    t: Tx,
    r: {
      requestType: string;
      folderId?: number | null;
      fileId?: number | null;
      requestedBy: number;
      subject: string;
      remark: string | null;
      expiryDate: Date;
      approverIds: number[];
    },
  ): Promise<number> {
    const requestId = await this.store.insertRequest(t, {
      requestType: r.requestType,
      folderId: r.folderId ?? null,
      fileId: r.fileId ?? null,
      requestedBy: r.requestedBy,
      subject: r.subject,
      remark: r.remark,
      expiryDate: r.expiryDate,
    });
    let order = 1;
    for (const approverId of r.approverIds) {
      await this.store.insertStep(t, requestId, order++, approverId);
    }
    return requestId;
  }

  /** ผู้อนุมัติตั้งต้นตามกฎเดิม (ShareService / RequestFolderDelete) */
  async resolveDefaultApprovers(
    requestType: string,
    requesterId: number,
    t?: Tx,
  ): Promise<number[]> {
    const admins = (await this.lookup.getActiveUsersByRole(AppRole.Admin, t)).map((u) => u.userId);
    const type = requestType.toUpperCase();
    const managers =
      type === 'CREATE_HC' || type === 'DELETE_FOLDER'
        ? []
        : (await this.lookup.getActiveUsersByRole(AppRole.Manager, t)).map((u) => u.userId);
    return defaultApproverIds({ requestType, requesterId, managers, admins });
  }

  /** ผู้อนุมัติที่ผู้ใช้ระบุเองต้องมีอยู่จริง ใช้งานอยู่ และเป็น Manager ขึ้นไป (ลงมติได้) */
  private async assertApprovers(ids: number[]): Promise<UserLite[]> {
    const users = await this.lookup.getUsersByIds(ids);
    const byId = new Map(users.map((u) => [u.userId, u]));
    for (const id of ids) {
      const u = byId.get(id);
      if (!u || !u.isActive || u.appRole < AppRole.Manager) {
        throw new BusinessException(
          `ผู้อนุมัติ (UserID ${id}) ต้องเป็น Manager หรือ Admin ที่ใช้งานอยู่`,
          'APPROVER_INVALID',
          { userId: id },
        );
      }
    }
    return ids.map((id) => byId.get(id) as UserLite);
  }

  // ═══════════════════════════════════════════════════════════
  //  ลงมติ
  // ═══════════════════════════════════════════════════════════

  approveStep(
    stepId: number,
    remark: string | undefined,
    user: UserContext,
  ): Promise<ApprovalResultDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'APPROVE_STEP', recordId: stepId },
      () => this.decide({ stepId }, 'approve', remark ?? null, user),
      (r) => ({ meta: { requestId: r.requestId, finalized: r.finalized } }),
    );
  }

  rejectStep(stepId: number, reason: string, user: UserContext): Promise<ApprovalResultDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'REJECT_STEP', recordId: stepId },
      () => this.decide({ stepId }, 'reject', reason, user),
      (r) => ({ meta: { requestId: r.requestId } }),
    );
  }

  /** ลงมติระดับคำขอ: ระบบเลือก step ให้ผู้ใช้ตามลำดับเดียวกับหน้า Approval Inbox เดิม */
  approveRequest(
    requestId: number,
    remark: string | undefined,
    user: UserContext,
  ): Promise<ApprovalResultDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'APPROVE_REQUEST', recordId: requestId },
      () => this.decide({ requestId }, 'approve', remark ?? null, user),
      (r) => ({ meta: { finalized: r.finalized } }),
    );
  }

  rejectRequest(requestId: number, reason: string, user: UserContext): Promise<ApprovalResultDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'REJECT_REQUEST', recordId: requestId },
      () => this.decide({ requestId }, 'reject', reason, user),
    );
  }

  private async decide(
    target: { stepId?: number; requestId?: number },
    action: 'approve' | 'reject',
    text: string | null,
    user: UserContext,
  ): Promise<ApprovalResultDto> {
    if (user.appRole < AppRole.Manager) {
      throw new PermissionDeniedException(
        action === 'approve'
          ? 'การอนุมัติต้องเป็น Manager หรือ Admin'
          : 'การปฏิเสธต้องเป็น Manager หรือ Admin',
        'ROLE_REQUIRED',
      );
    }
    const outbox: SendNotificationInput[] = [];

    // ทั้งก้อนอยู่ใน transaction เดียว: ผลข้างเคียงล้ม (throw) = rollback การเปลี่ยนสถานะทั้งหมด
    const result = await this.tx.run(async (t): Promise<ApprovalResultDto> => {
      let requestId = target.requestId ?? 0;
      if (target.stepId !== undefined) {
        const probe = await this.store.getStep(target.stepId, t);
        if (!probe) throw new ResourceNotFoundException('ApprovalStep', target.stepId);
        requestId = probe.requestId;
      }
      // ล็อกแถวคำขอ ก่อนอ่าน step — กันสองคนลงมติพร้อมกัน
      const request = await this.store.getRequest(requestId, t, true);
      if (!request) throw new ResourceNotFoundException('ApprovalRequest', requestId);
      if (request.requestStatus !== REQUEST_PENDING) {
        throw new BusinessException(
          `คำขอ ${requestId} ดำเนินการไม่ได้ เพราะสถานะปัจจุบันคือ ${statusLabel(request.requestStatus)}`,
          'APPROVAL_NOT_PENDING',
          { status: request.requestStatus },
        );
      }
      const steps = await this.store.getSteps(requestId, t);

      let step: ApprovalStepRow | undefined;
      if (target.stepId !== undefined) {
        step = steps.find((s) => s.stepId === target.stepId);
      } else {
        const picked = pickActingStep(user, request, steps, action);
        step = picked ? steps.find((s) => s.stepId === picked.stepId) : undefined;
        if (!step) {
          throw new PermissionDeniedException(
            'คุณไม่มี step ที่ต้องลงมติในคำขอนี้',
            'NOT_STEP_APPROVER',
          );
        }
      }
      if (!step) throw new ResourceNotFoundException('ApprovalStep', target.stepId);
      if (!isStepActionable(step)) {
        throw new BusinessException(
          `step ${step.stepId} ลงมติไม่ได้ เพราะสถานะปัจจุบันคือ ${step.stepStatus}`,
          'STEP_NOT_ACTIONABLE',
          { status: step.stepStatus },
        );
      }
      if (!canActOnStep(user, request, step, action)) {
        throw new PermissionDeniedException('คุณไม่ใช่ผู้อนุมัติของ step นี้', 'NOT_STEP_APPROVER');
      }

      const decoded = decodeRemark(request.requestType, request.remark);
      const type = effectiveRequestType(request.requestType, decoded);
      const actionRemark = clip(
        step.approverId !== user.userId && step.delegatedTo !== user.userId
          ? `[${user.displayName}] ${text ?? ''}`.trim()
          : text,
      );

      if (action === 'reject') {
        await this.store.updateStepStatus(t, step.stepId, STEP_REJECTED, actionRemark);
        await this.store.updateRequestStatus(
          t,
          requestId,
          REQUEST_REJECTED,
          user.userId,
          clip(text),
        );
        await this.applyRejectedOutcome(t, request, decoded.payload, type, user, text, outbox);
        outbox.push({
          recipientUserId: request.requestedBy,
          eventType: EVENT.requestRejected,
          relatedEntityId: requestId,
          messageText: rejectedMessage(requestId, text),
        });
        return {
          requestId,
          requestStatus: REQUEST_REJECTED,
          finalized: true,
          nextApproverId: null,
        };
      }

      await this.store.updateStepStatus(t, step.stepId, STEP_APPROVED, actionRemark);
      const decision = decideAfterApprove({
        requestType: type,
        steps,
        approvedStepId: step.stepId,
      });
      for (const id of decision.autoCloseStepIds) {
        await this.store.updateStepStatus(
          t,
          id,
          STEP_DELEGATED_OR_AUTOCLOSED,
          'Auto-closed: คำขอจบแล้วโดยผู้อนุมัติคนแรกของกลุ่ม',
        );
      }
      if (!decision.finalize && decision.nextStep) {
        outbox.push({
          recipientUserId: decision.nextStep.approverId,
          eventType: EVENT.requestPending,
          relatedEntityId: requestId,
          messageText: stepPendingMessage(requestId),
        });
        return {
          requestId,
          requestStatus: REQUEST_PENDING,
          finalized: false,
          nextApproverId: decision.nextStep.approverId,
        };
      }

      await this.store.updateRequestStatus(t, requestId, REQUEST_APPROVED, user.userId, clip(text));
      // ผลข้างเคียงทำเป็นขั้นสุดท้ายก่อน commit เพื่อให้ช่องว่างระหว่าง "handler สำเร็จ" กับ "commit" สั้นที่สุด
      await this.applyApprovedOutcome(t, request, decoded.payload, type, user, outbox);
      outbox.push({
        recipientUserId: request.requestedBy,
        eventType: EVENT.requestApproved,
        relatedEntityId: requestId,
        messageText: approvedMessage(type, requestId),
      });
      return { requestId, requestStatus: REQUEST_APPROVED, finalized: true, nextApproverId: null };
    });

    await this.notifications.sendMany(outbox); // หลัง commit เท่านั้น (ถ้า rollback จะไม่แจ้งเตือน)
    return result;
  }

  private toRecord(
    request: ApprovalRequestRow,
    type: string,
    payload: Record<string, unknown> | null,
  ): ApprovalRecord {
    return {
      requestId: request.requestId,
      requestType: type as ApprovalRequestType,
      folderId: request.folderId,
      fileId: request.fileId,
      requestedBy: request.requestedBy,
      subject: request.subject,
      payload,
    };
  }

  /** ผลข้างเคียงเมื่ออนุมัติจบ — โยน error = rollback */
  private async applyApprovedOutcome(
    t: Tx,
    request: ApprovalRequestRow,
    payload: Record<string, unknown> | null,
    type: string,
    approver: UserContext,
    outbox: SendNotificationInput[],
  ): Promise<void> {
    switch (type) {
      case 'EXTERNAL_SHARE': {
        const shareId = Number(
          (payload as Partial<ExternalSharePayload> | null)?.externalShareId ?? 0,
        );
        if (!(shareId > 0)) {
          throw new BusinessException(
            'คำขอแชร์ภายนอกไม่ระบุรหัสการแชร์',
            'APPROVAL_PAYLOAD_INVALID',
          );
        }
        const share = await this.shareOutcomes.activateExternal(t, shareId, approver);
        outbox.push({
          recipientUserId: share.sharerUserId,
          eventType: EVENT.externalShareApproved,
          relatedEntityId: shareId,
          messageText: 'การแชร์ภายนอกของคุณได้รับการอนุมัติ ลิงก์ใช้งานได้แล้ว',
        });
        return;
      }
      case 'INTERNAL_SHARE':
        await this.shareOutcomes.grantInternal(
          t,
          request.requestedBy,
          payload as Partial<InternalSharePayload> | null,
        );
        return;
      default:
    }

    const handler = this.handlers.get(type as ApprovalRequestType);
    if (CORE_HANDLED_TYPES.has(type)) {
      if (!handler) {
        throw new BusinessException(
          `ยังไม่มีตัวจัดการผลลัพธ์ของคำขอชนิด ${type} (DMS core ยังไม่ได้ลงทะเบียน) จึงอนุมัติไม่ได้`,
          'APPROVAL_HANDLER_MISSING',
          { requestType: type },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.assertCoreInputs(request, payload, type);
    }
    if (!handler) return; // ชนิดอื่นๆ (เช่น DOWNLOAD_FILE) ไม่มีผลข้างเคียง
    try {
      await handler.onApproved(this.toRecord(request, type, payload), approver);
    } catch (err) {
      throw this.wrapSideEffectError(err, type, request.requestId);
    }
  }

  private assertCoreInputs(
    request: ApprovalRequestRow,
    payload: Record<string, unknown> | null,
    type: string,
  ): void {
    if ((type === 'DELETE_FOLDER' || type === 'CHANGE_PERMISSION') && !request.folderId) {
      throw new BusinessException('คำขอนี้ไม่ได้ระบุโฟลเดอร์', 'APPROVAL_PAYLOAD_INVALID');
    }
    if ((type === 'CREATE_HC' || type === 'CHANGE_PERMISSION') && !payload) {
      // เดิม: parse remark ไม่ได้ → บันทึก log แล้วยังตั้งคำขอเป็น Approved (ไม่มีผลจริง)
      throw new BusinessException(
        'อ่านรายละเอียดคำขอ (Remark) ไม่ได้ จึงไม่สามารถดำเนินการหลังอนุมัติได้',
        'APPROVAL_PAYLOAD_INVALID',
      );
    }
  }

  private async applyRejectedOutcome(
    t: Tx,
    request: ApprovalRequestRow,
    payload: Record<string, unknown> | null,
    type: string,
    rejecter: UserContext,
    reason: string | null,
    outbox: SendNotificationInput[],
  ): Promise<void> {
    if (type === 'EXTERNAL_SHARE') {
      const shareId = Number(
        (payload as Partial<ExternalSharePayload> | null)?.externalShareId ?? 0,
      );
      if (shareId > 0) {
        // เดิม: ปฏิเสธผ่านกล่องอนุมัติแล้วแชร์ค้าง Pending ตลอดไป → ที่นี่ยกเลิกแชร์ด้วย
        const share = await this.shareOutcomes.rejectExternal(t, shareId, rejecter, reason);
        if (share) {
          outbox.push({
            recipientUserId: share.sharerUserId,
            eventType: EVENT.externalShareRejected,
            relatedEntityId: shareId,
            messageText: `การแชร์ภายนอกของคุณถูกปฏิเสธ เหตุผล: ${reason ?? 'ไม่ระบุเหตุผล'}`,
          });
        }
      }
      return;
    }
    const handler = this.handlers.get(type as ApprovalRequestType);
    if (!handler?.onRejected) return;
    try {
      await handler.onRejected(this.toRecord(request, type, payload), rejecter);
    } catch (err) {
      throw this.wrapSideEffectError(err, type, request.requestId);
    }
  }

  private wrapSideEffectError(err: unknown, type: string, requestId: number): Error {
    if (err instanceof HttpException) return err; // ข้อผิดพลาดที่ handler ตั้งใจสื่อกับผู้ใช้ (422/403/...) ส่งต่อตามเดิม
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`ผลข้างเคียงของคำขอ ${requestId} (${type}) ล้มเหลว — rollback: ${message}`);
    return new BusinessException(
      `ไม่สามารถดำเนินการหลังอนุมัติได้ (${type}): ${message}`,
      'APPROVAL_SIDE_EFFECT_FAILED',
      { requestId, requestType: type },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  ถอนคำขอ
  // ═══════════════════════════════════════════════════════════

  /**
   * ถอนคำขอ (เฉพาะผู้ขอ, เฉพาะที่ยัง Pending): step ที่ค้างเป็น Rejected(3), คำขอเป็น 4
   * (4 = Expired ซึ่งใช้ร่วมกับ "หมดอายุ" ตามระบบเดิม — ห้ามเปลี่ยนความหมาย; แยกไม่ออกเพราะ DB ไม่มีสถานะ "ถอน" แยก)
   * ถ้าเป็นคำขอแชร์ภายนอก จะยกเลิกแชร์ที่ค้าง Pending ด้วย
   */
  withdraw(requestId: number, user: UserContext): Promise<ApprovalResultDto> {
    return this.logged(
      { action: 'UPDATE', operation: 'WITHDRAW_REQUEST', recordId: requestId },
      async () => {
        return this.tx.run(async (t): Promise<ApprovalResultDto> => {
          const request = await this.store.getRequest(requestId, t, true);
          if (!request) throw new ResourceNotFoundException('ApprovalRequest', requestId);
          if (request.requestedBy !== user.userId) {
            throw new PermissionDeniedException('ถอนได้เฉพาะคำขอของตนเอง', 'NOT_REQUESTER');
          }
          if (request.requestStatus !== REQUEST_PENDING) {
            throw new BusinessException(
              `คำขอ ${requestId} ถอนไม่ได้ เพราะสถานะปัจจุบันคือ ${statusLabel(request.requestStatus)}`,
              'APPROVAL_NOT_PENDING',
            );
          }
          const steps = await this.store.getSteps(requestId, t);
          for (const s of steps.filter(isStepActionable)) {
            await this.store.updateStepStatus(
              t,
              s.stepId,
              STEP_REJECTED,
              'Withdrawn by requestor.',
            );
          }
          await this.store.updateRequestStatus(
            t,
            requestId,
            REQUEST_EXPIRED_OR_WITHDRAWN,
            user.userId,
            'Withdrawn by requestor.',
          );
          const decoded = decodeRemark(request.requestType, request.remark);
          if (effectiveRequestType(request.requestType, decoded) === 'EXTERNAL_SHARE') {
            const shareId = Number(
              (decoded.payload as Partial<ExternalSharePayload> | null)?.externalShareId ?? 0,
            );
            if (shareId > 0)
              await this.shareOutcomes.rejectExternal(t, shareId, user, 'ผู้ขอถอนคำขอ');
          }
          return {
            requestId,
            requestStatus: REQUEST_EXPIRED_OR_WITHDRAWN,
            finalized: true,
            nextApproverId: null,
          };
        });
      },
    );
  }

  /**
   * ล็อก (UPDLOCK) คำขอ Pending ที่ผูกกับแชร์ภายนอก — เรียกก่อนล็อกแถวแชร์ เพื่อให้ลำดับล็อกเหมือน decide()
   * (คำขอ → แชร์) กัน deadlock เมื่อมีคนอนุมัติผ่าน Approval Inbox กับหน้าจัดการแชร์พร้อมกัน
   */
  lockRequestForShare(t: Tx, externalShareId: number): Promise<ApprovalRequestRow | null> {
    return this.store.findPendingRequestForExternalShare(t, externalShareId);
  }

  /**
   * ปิดคำขอที่ผูกกับแชร์ภายนอกเมื่อแชร์ถูกอนุมัติ/ปฏิเสธ/ยกเลิกจากหน้าจัดการแชร์ (ไม่ผ่านกล่องอนุมัติ)
   * เดิมคำขอค้าง Pending ทั้งที่แชร์จบไปแล้ว — เรียกใน transaction ของผู้เรียก
   * approved → Approved (step ของผู้ลงมติเป็น Approved ที่เหลือปิดเป็น 4) · rejected → Rejected · withdrawn → 4 (step ที่ค้างเป็น Rejected)
   */
  async closeRequestForShare(
    t: Tx,
    request: ApprovalRequestRow | null,
    outcome: 'approved' | 'rejected' | 'withdrawn',
    actor: UserContext,
    remark: string | null,
  ): Promise<void> {
    if (!request) return;
    const steps = await this.store.getSteps(request.requestId, t);
    const own = steps.find((s) => isStepActionable(s) && s.approverId === actor.userId);
    for (const s of steps.filter(isStepActionable)) {
      let status: number;
      if (outcome === 'withdrawn') status = STEP_REJECTED;
      else if (s.stepId === own?.stepId)
        status = outcome === 'approved' ? STEP_APPROVED : STEP_REJECTED;
      else status = STEP_DELEGATED_OR_AUTOCLOSED;
      await this.store.updateStepStatus(
        t,
        s.stepId,
        status,
        status === STEP_DELEGATED_OR_AUTOCLOSED
          ? 'Auto-closed: ดำเนินการผ่านหน้าจัดการแชร์'
          : clip(remark),
      );
    }
    await this.store.updateRequestStatus(
      t,
      request.requestId,
      outcome === 'approved'
        ? REQUEST_APPROVED
        : outcome === 'rejected'
          ? REQUEST_REJECTED
          : REQUEST_EXPIRED_OR_WITHDRAWN,
      actor.userId,
      clip(remark),
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  คำขอดาวน์โหลด (submit → approve → find → consume ใช้ครั้งเดียว)
  // ═══════════════════════════════════════════════════════════

  submitDownloadRequest(
    dto: SubmitDownloadRequestDto,
    user: UserContext,
  ): Promise<ApprovalRequestDto> {
    return this.logged(
      { action: 'CREATE', operation: 'SUBMIT_DOWNLOAD_REQUEST', meta: { fileId: dto.fileId } },
      async () => {
        const file = await this.lookup.getFile(dto.fileId);
        if (!file || !isFileActive(file)) throw new ResourceNotFoundException('File', dto.fileId);
        if (dto.approverId === user.userId) {
          throw new BusinessException('ไม่สามารถเลือกตัวเองเป็นผู้อนุมัติได้', 'APPROVER_INVALID');
        }
        await this.assertApprovers([dto.approverId]);
        const requestId = await this.tx.run(async (t) =>
          this.insertRequestWithSteps(t, {
            requestType: 'DOWNLOAD_FILE',
            fileId: dto.fileId,
            requestedBy: user.userId,
            subject: `ขออนุมัติดาวน์โหลดไฟล์ ID ${dto.fileId}`,
            remark: encodeRemark({ reason: dto.reason }),
            expiryDate: new Date(Date.now() + REQUEST_EXPIRY_DAYS.download * DAY_MS),
            approverIds: [dto.approverId],
          }),
        );
        await this.notifications.send({
          recipientUserId: dto.approverId,
          eventType: EVENT.downloadRequested,
          relatedEntityId: requestId,
          messageText: `มีคำขออนุมัติดาวน์โหลดไฟล์ (คำขอ ID ${requestId}) รออนุมัติจากคุณ โดย ${user.displayName || user.adUserName}`,
        });
        const row = await this.store.getListRow(requestId, user.userId);
        return toRequestDto(row as ApprovalListRow);
      },
      (r) => ({ recordId: r.requestId }),
    );
  }

  /** คำขอดาวน์โหลดที่อนุมัติแล้วและยังไม่ถูกใช้ของผู้ใช้กับไฟล์นี้ (null ถ้าไม่มี) */
  async findApprovedDownload(user: UserContext, fileId: number): Promise<ApprovalRef | null> {
    const row = await this.store.findApprovedDownload(user.userId, fileId);
    return row ? { requestId: row.requestId, requestStatus: row.requestStatus } : null;
  }

  /**
   * ใช้สิทธิ์ดาวน์โหลด (Approved → 5) — ใช้ได้ครั้งเดียว เฉพาะผู้ขอ, แข่งกันใช้ซ้ำไม่ได้ (เงื่อนไขอยู่ใน UPDATE เดียว)
   */
  consumeDownload(user: UserContext, requestId: number): Promise<void> {
    return this.logged(
      { action: 'EXECUTE', operation: 'CONSUME_DOWNLOAD_APPROVAL', recordId: requestId },
      async () => {
        const ok = await this.tx.run((t) => this.store.consumeDownload(t, requestId, user.userId));
        if (ok) return;
        const row = await this.store.getRequest(requestId);
        if (!row || row.requestType !== 'DOWNLOAD_FILE' || row.requestedBy !== user.userId) {
          throw new ResourceNotFoundException('DownloadApproval', requestId);
        }
        throw new ConflictBusinessException(
          row.requestStatus === REQUEST_STATUS_CONSUMED
            ? 'สิทธิ์ดาวน์โหลดนี้ถูกใช้ไปแล้ว'
            : `คำขอนี้ยังใช้ดาวน์โหลดไม่ได้ (สถานะ ${statusLabel(row.requestStatus)})`,
          'DOWNLOAD_APPROVAL_UNAVAILABLE',
        );
      },
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  Escalation (เรียกจาก ApprovalEscalationJob)
  // ═══════════════════════════════════════════════════════════

  /**
   * ยกระดับคำขอที่ยัง Pending และเกิน ExpiryDate: step Pending ลำดับแรกเป็น Delegated(4) + EscalatedDate,
   * เพิ่ม step ให้ผู้ใช้ที่ใช้งานอยู่ของ role ปลายทาง (Manager→Admin) แล้วเลื่อน ExpiryDate ออกไป 1 วัน
   * (เดิมไม่เลื่อน จึงยกซ้ำทุก tick ของทุกเครื่อง — น่าจะเป็นที่มาของ ApprovalStep 2.2e5 แถวจากคำขอ 40 รายการ)
   */
  async escalateExpired(
    now = new Date(),
    limit = 200,
  ): Promise<{ checked: number; escalated: number; skipped: number; failed: number }> {
    const due = await this.store.getExpiredPending(limit);
    const summary = { checked: due.length, escalated: 0, skipped: 0, failed: 0 };
    for (const req of due) {
      try {
        const did = await this.logged(
          { action: 'UPDATE', operation: 'ESCALATE_APPROVAL', recordId: req.requestId },
          () => this.escalateOne(req.requestId, now),
        );
        if (did) summary.escalated++;
        else summary.skipped++;
      } catch (err) {
        summary.failed++;
        this.logger.error(
          `ยกระดับคำขอ ${req.requestId} ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return summary;
  }

  private async escalateOne(requestId: number, now: Date): Promise<boolean> {
    const outbox: SendNotificationInput[] = [];
    const did = await this.tx.run(async (t) => {
      const request = await this.store.getRequest(requestId, t, true);
      // มีคนลงมติ/ถอน/เลื่อนวันไปแล้วระหว่างรอ → ไม่ทำอะไร
      if (
        !request ||
        request.requestStatus !== REQUEST_PENDING ||
        !request.expiryDate ||
        request.expiryDate.getTime() >= now.getTime()
      ) {
        return false;
      }
      const steps = await this.store.getSteps(requestId, t);
      const newExpiry = new Date(now.getTime() + ESCALATION_EXTENSION_DAYS * DAY_MS);
      const pending = steps
        .filter((s) => s.stepStatus === STEP_PENDING)
        .sort((a, b) => a.stepOrder - b.stepOrder);
      if (pending.length === 0) {
        await this.store.extendExpiry(t, requestId, newExpiry); // ไม่มี step ให้ยก → อย่าวนซ้ำทุกรอบ
        return false;
      }
      const current = pending[0];
      const currentApprover = await this.lookup.getUser(current.approverId, t);
      const role = escalationTargetRole(currentApprover?.appRole);
      const alreadyOnRequest = new Set(steps.map((s) => s.approverId));
      const candidates = (await this.lookup.getActiveUsersByRole(role, t)).filter(
        (u) => !alreadyOnRequest.has(u.userId),
      );
      const others = candidates.filter((u) => u.userId !== request.requestedBy);
      const targets = others.length > 0 ? others : candidates;
      if (targets.length === 0) {
        await this.store.extendExpiry(t, requestId, newExpiry);
        return false;
      }

      await this.store.updateStepStatus(
        t,
        current.stepId,
        STEP_DELEGATED_OR_AUTOCLOSED,
        'Escalated due to timeout.',
      );
      await this.store.markStepEscalated(t, current.stepId);
      let order = nextStepOrder(steps);
      for (const u of targets) {
        await this.store.insertStep(t, requestId, order++, u.userId);
        outbox.push({
          recipientUserId: u.userId,
          eventType: EVENT.escalation,
          relatedEntityId: requestId,
          messageText: escalatedToApproverMessage(requestId),
        });
      }
      await this.store.extendExpiry(t, requestId, newExpiry);
      outbox.push({
        recipientUserId: request.requestedBy,
        eventType: EVENT.escalation,
        relatedEntityId: requestId,
        messageText: escalatedToRequesterMessage(requestId),
      });
      return true;
    });
    await this.notifications.sendMany(outbox);
    return did;
  }
}

// ── mapper ────────────────────────────────────────────────

export function toRequestDto(row: ApprovalListRow): ApprovalRequestDto {
  const decoded = decodeRemark(row.requestType, row.remark);
  return {
    requestId: row.requestId,
    requestType: row.requestType,
    effectiveType: effectiveRequestType(row.requestType, decoded),
    folderId: row.folderId,
    folderName: row.folderName,
    fileId: row.fileId,
    fileName: row.fileName,
    requestedBy: row.requestedBy,
    requestedByName: row.requesterName,
    requestedDate: row.requestedDate,
    requestStatus: row.requestStatus,
    subject: row.subject,
    reason: decoded.reason,
    payload: decoded.payload,
    expiryDate: row.expiryDate,
    resolvedBy: row.resolvedBy,
    resolvedDate: row.resolvedDate,
    resolveRemark: row.resolveRemark,
    myStepId: row.myStepId,
  };
}

export function toStepDto(s: ApprovalStepRow): ApprovalStepDto {
  return {
    stepId: s.stepId,
    requestId: s.requestId,
    stepOrder: s.stepOrder,
    approverId: s.approverId,
    stepStatus: s.stepStatus,
    actionDate: s.actionDate,
    actionRemark: s.actionRemark,
    delegatedTo: s.delegatedTo ?? null,
    notifiedDate: s.notifiedDate,
    escalatedDate: s.escalatedDate,
  };
}
