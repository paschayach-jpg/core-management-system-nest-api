import { Injectable, Logger } from '@nestjs/common';
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
import { NotificationsService } from '../../../shared/notifications/notifications.service';
import { SystemConfigService } from '../../../shared/system-config/system-config.service';
import { EVENT } from '../common/approval-messages';
import { clip } from '../common/approval.constants';
import {
  assertValidQuotaChangeRequest,
  buildQuotaAlertMessage,
  BYTES_PER_GB,
  evaluateQuota,
  QUOTA_CRITICAL_CONFIG_KEY,
  QUOTA_WARN_CONFIG_KEY,
  QuotaAlertLevel,
  quotaBatchExceededMessage,
  QuotaEvaluation,
  quotaFullMessage,
  QuotaThresholds,
  resolveThresholds,
  wouldExceedQuota,
} from '../common/quota-rules';
import type {
  OrgQuotaUsageDto,
  QuotaRequestDto,
  QuotaRequestListQueryDto,
  QuotaUnitDto,
  SubmitQuotaRequestDto,
} from './dto/quota.dto';
import { OrgQuota, QuotaRequestRow, QuotaStore, QuotaUnitRow } from './quota.store';

const ALERT_NAMES = ['Normal', 'Warning', 'Critical', 'Full'] as const;
/** ส่งแจ้งเตือนโควตาซ้ำระดับเดิมของหน่วยงานเดียวกันไม่ถี่กว่านี้ (เดิมส่งทุกครั้งที่สร้างโฟลเดอร์/อัปโหลด) */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

const skipTake = (q: Pick<PaginationQueryDto, 'page' | 'pageSize'>) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});

/**
 * โควตาพื้นที่ DMS — พอร์ตจาก FolderQuotaService (04-business-rules §2.7)
 * โควตาเก็บเป็นคอลัมน์ quota_size บน EMS.m_SubCommittee / m_Division / m_Department (0 = ไม่จำกัด)
 * คำขอเพิ่มโควตาใช้ dms.FolderQuotaChangeRequest (อ้าง EMS.OrgUnitID)
 */
@Injectable()
export class QuotaService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'Quota';
  private readonly logger = new Logger(QuotaService.name);
  private readonly lastAlert = new Map<string, number>();

  constructor(
    crudLog: CrudLogService,
    private readonly store: QuotaStore,
    private readonly tx: TransactionRunner,
    private readonly notifications: NotificationsService,
    private readonly sysConfig: SystemConfigService,
  ) {
    super(crudLog);
  }

  // ── เกณฑ์ ────────────────────────────────────────────────

  /** เกณฑ์เตือนจาก dbo.SystemConfig (ถ้าไม่ตั้งหรือตั้งผิด → 80/95 ตามระบบเดิม) */
  async thresholds(): Promise<QuotaThresholds> {
    try {
      const [warn, critical] = await Promise.all([
        this.sysConfig.get(QUOTA_WARN_CONFIG_KEY),
        this.sysConfig.get(QUOTA_CRITICAL_CONFIG_KEY),
      ]);
      const w = warn === null ? null : Number(warn);
      const c = critical === null ? null : Number(critical);
      return resolveThresholds(Number.isFinite(w) ? w : null, Number.isFinite(c) ? c : null);
    } catch (err) {
      this.logger.warn(`อ่านเกณฑ์โควตาจาก SystemConfig ไม่ได้ ใช้ค่าเริ่มต้น: ${String(err)}`);
      return resolveThresholds(null, null);
    }
  }

  // ── อ่าน ─────────────────────────────────────────────────

  /** โควตาและการใช้พื้นที่ของทุกหน่วยงานหลัก (รวมลำดับชั้น) */
  async list(): Promise<QuotaUnitDto[]> {
    const [units, stats, th] = await Promise.all([
      this.store.listUnits(),
      this.store.fileStats(),
      this.thresholds(),
    ]);
    return units.map((u) => {
      const s = stats.get(`${u.unitType}:${u.unitId}`) ?? { fileCount: 0, usedBytes: 0 };
      return toUnitDto(u, s.fileCount, evaluateQuota(s.usedBytes, u.quotaBytes, th));
    });
  }

  /** การใช้พื้นที่ของ EMS.OrgUnit หนึ่งหน่วย (ตัวเลขเดียวกับที่ใช้บังคับโควตาตอนสร้างโฟลเดอร์/อัปโหลด) */
  async usageForOrgUnit(orgUnitId: number): Promise<OrgQuotaUsageDto> {
    const { org, evaluation, thresholds } = await this.evaluateOrg(orgUnitId);
    if (!org) throw new ResourceNotFoundException('OrgUnit', orgUnitId);
    return {
      orgUnitId: org.orgUnitId,
      orgUnitName: org.orgUnitName,
      quotaBytes: String(evaluation.quotaBytes),
      usedBytes: String(evaluation.usedBytes),
      usedPercent: evaluation.usedPercent,
      alertLevel: evaluation.alert,
      alertName: ALERT_NAMES[evaluation.alert],
      warnThresholdPct: thresholds.warnPct,
      criticalThresholdPct: thresholds.criticalPct,
    };
  }

  private async evaluateOrg(
    orgUnitId: number,
  ): Promise<{ org: OrgQuota | null; evaluation: QuotaEvaluation; thresholds: QuotaThresholds }> {
    const [org, thresholds] = await Promise.all([
      this.store.resolveOrgQuota(orgUnitId),
      this.thresholds(),
    ]);
    if (!org || !(org.quotaBytes > 0)) {
      // ไม่มีหน่วยงาน/ยังไม่ตั้งโควตา = ไม่จำกัด (ไม่ต้องคำนวณขนาดที่ใช้)
      return { org, evaluation: evaluateQuota(0, 0, thresholds), thresholds };
    }
    const used = await this.store.orgUsedBytes(orgUnitId);
    return { org, evaluation: evaluateQuota(used, org.quotaBytes, thresholds), thresholds };
  }

  // ── พอร์ตให้ DMS-core ─────────────────────────────────────

  /** บล็อกการสร้างโฟลเดอร์/อัปโหลดเมื่อพื้นที่ของหน่วยงานเต็ม (EnforceQuota) */
  async enforce(orgUnitId: number): Promise<void> {
    const { evaluation } = await this.evaluateOrg(orgUnitId);
    if (evaluation.alert === QuotaAlertLevel.Full) {
      throw new BusinessException(quotaFullMessage(evaluation), 'QUOTA_FULL', {
        orgUnitId,
        usedBytes: String(evaluation.usedBytes),
        quotaBytes: String(evaluation.quotaBytes),
      });
    }
  }

  /** ตรวจทั้งชุดไฟล์ก่อนอัปโหลด: ผลรวมขนาดทำให้เกินโควตา → ล้มทั้งชุด */
  async validateBatch(orgUnitId: number, sizes: number[]): Promise<void> {
    const { evaluation } = await this.evaluateOrg(orgUnitId);
    if (wouldExceedQuota(evaluation.usedBytes, evaluation.quotaBytes, sizes)) {
      throw new BusinessException(
        quotaBatchExceededMessage(evaluation.usedBytes, evaluation.quotaBytes, sizes),
        'QUOTA_EXCEEDED',
        { orgUnitId },
      );
    }
  }

  /** แจ้งเตือนเมื่อเกินเกณฑ์ Warning/Critical/Full — ไม่โยน error และไม่ส่งซ้ำระดับเดิมภายใน 1 ชั่วโมง */
  async sendAlertIfNeeded(orgUnitId: number, now = Date.now()): Promise<void> {
    try {
      const { org, evaluation } = await this.evaluateOrg(orgUnitId);
      if (!org || evaluation.alert === QuotaAlertLevel.Normal) return;
      const key = `${orgUnitId}:${evaluation.alert}`;
      const last = this.lastAlert.get(key) ?? 0;
      if (now - last < ALERT_COOLDOWN_MS) return;
      this.lastAlert.set(key, now);
      const recipients = await this.store.alertRecipients(orgUnitId);
      const message = buildQuotaAlertMessage(org.orgUnitName, evaluation);
      await this.notifications.sendMany(
        recipients.map((id) => ({
          recipientUserId: id,
          eventType: EVENT.quotaAlert,
          relatedEntityId: orgUnitId,
          messageText: message,
        })),
      );
    } catch (err) {
      this.logger.warn(`ส่งแจ้งเตือนโควตา OrgUnit ${orgUnitId} ไม่สำเร็จ: ${String(err)}`);
    }
  }

  // ── ตั้งค่าโควตา (Admin) ───────────────────────────────────

  setQuota(
    unitType: number,
    unitId: number,
    quotaBytes: string,
    user: UserContext,
  ): Promise<QuotaUnitDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'SAVE_QUOTA_CONFIG',
        recordId: `${unitType}:${unitId}`,
        captureBefore: () => this.store.getUnit(unitType, unitId),
      },
      async () => {
        this.assertAdmin(user);
        const bytes = Number(quotaBytes);
        if (!(bytes > 0)) throw new BusinessException('QuotaBytes ต้องมากกว่า 0', 'QUOTA_INVALID');
        await this.applyQuota(unitType, unitId, bytes, user);
        return this.unitDto(unitType, unitId);
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบการตั้งค่าโควตา (ตั้งเป็น 0 = ไม่จำกัด) */
  clearQuota(unitType: number, unitId: number, user: UserContext): Promise<QuotaUnitDto> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_QUOTA_CONFIG',
        recordId: `${unitType}:${unitId}`,
        captureBefore: () => this.store.getUnit(unitType, unitId),
      },
      async () => {
        this.assertAdmin(user);
        await this.applyQuota(unitType, unitId, 0, user);
        return this.unitDto(unitType, unitId);
      },
      (r) => ({ after: r }),
    );
  }

  private async applyQuota(unitType: number, unitId: number, bytes: number, user: UserContext) {
    await this.tx.run(async (t) => {
      const ok = await this.store.setQuota(t, unitType, unitId, bytes, user.adUserName);
      if (!ok) throw new ResourceNotFoundException('QuotaUnit', `${unitType}:${unitId}`);
    });
  }

  private async unitDto(unitType: number, unitId: number): Promise<QuotaUnitDto> {
    const unit = await this.store.getUnit(unitType, unitId);
    if (!unit) throw new ResourceNotFoundException('QuotaUnit', `${unitType}:${unitId}`);
    const stats = await this.store.fileStats();
    const s = stats.get(`${unitType}:${unitId}`) ?? { fileCount: 0, usedBytes: 0 };
    return toUnitDto(
      unit,
      s.fileCount,
      evaluateQuota(s.usedBytes, unit.quotaBytes, await this.thresholds()),
    );
  }

  // ── คำขอเพิ่มโควตา ────────────────────────────────────────

  /** ยื่นคำขอเพิ่มโควตา: Manager ขึ้นไปยื่นแทนหน่วยงานใดก็ได้, ผู้ใช้อื่นยื่นได้เฉพาะหน่วยงานที่ตนสังกัด */
  submitRequest(dto: SubmitQuotaRequestDto, user: UserContext): Promise<QuotaRequestDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: 'FolderQuotaChangeRequest',
        operation: 'SUBMIT_QUOTA_REQUEST',
        meta: { orgUnitId: dto.orgUnitId },
      },
      async () => {
        if (user.appRole < AppRole.Manager && user.orgUnitId !== dto.orgUnitId) {
          throw new PermissionDeniedException(
            'ยื่นคำขอได้เฉพาะหน่วยงานที่ตนสังกัด',
            'QUOTA_REQUEST_OTHER_ORG',
          );
        }
        const org = await this.store.resolveOrgQuota(dto.orgUnitId);
        if (!org) throw new ResourceNotFoundException('OrgUnit', dto.orgUnitId);
        const requested = Number(dto.requestedQuotaBytes);
        assertValidQuotaChangeRequest(requested, org.quotaBytes, dto.reason);
        const id = await this.tx.run((t) =>
          this.store.insertRequest(t, {
            orgUnitId: dto.orgUnitId,
            currentQuotaBytes: org.quotaBytes,
            requestedQuotaBytes: requested,
            reason: dto.reason.trim(),
            requestedBy: user.userId,
          }),
        );
        return this.requireRequest(id);
      },
      (r) => ({ recordId: r.requestId, after: r }),
    );
  }

  async listRequests(q: QuotaRequestListQueryDto): Promise<Paginated<QuotaRequestDto>> {
    const r = await this.store.pageRequests(
      { status: q.status, orgUnitId: q.orgUnitId },
      skipTake(q),
    );
    return paginated(r.items.map(toRequestDto), r.total, q);
  }

  async listMyRequests(
    user: UserContext,
    q: QuotaRequestListQueryDto,
  ): Promise<Paginated<QuotaRequestDto>> {
    const r = await this.store.pageRequests(
      { status: q.status, requestedBy: user.userId, orgUnitId: q.orgUnitId },
      skipTake(q),
    );
    return paginated(r.items.map(toRequestDto), r.total, q);
  }

  /** อนุมัติ: เปลี่ยนสถานะคำขอ + ตั้ง quota_size ของหน่วยงานหลักใน transaction เดียว (เดิมสองขั้นแยกกัน) — Admin */
  approveRequest(
    id: number,
    remark: string | undefined,
    user: UserContext,
  ): Promise<QuotaRequestDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: 'FolderQuotaChangeRequest',
        operation: 'APPROVE_QUOTA_REQUEST',
        recordId: id,
      },
      async () => {
        this.assertAdmin(user);
        let req!: QuotaRequestRow;
        await this.tx.run(async (t) => {
          const found = await this.store.getRequest(id, t, true);
          if (!found) throw new ResourceNotFoundException('FolderQuotaChangeRequest', id);
          req = found;
          this.assertPending(found);
          const org = await this.store.resolveOrgQuota(found.orgUnitId, t);
          if (!org || org.unitType === null || org.unitId === null) {
            // เดิมไม่พบหน่วยงานหลักก็ยังตั้งสถานะ Approved แต่ไม่มีอะไรถูกแก้ (UPDATE ไม่มีแถวที่ตรง)
            throw new BusinessException(
              'ไม่พบหน่วยงานหลัก (SubCommittee/Division/Department) ที่รหัสตรงกับหน่วยงานนี้ จึงตั้งโควตาไม่ได้',
              'QUOTA_UNIT_NOT_FOUND',
            );
          }
          if (found.requestedQuotaBytes <= org.quotaBytes) {
            throw new BusinessException(
              'โควตาปัจจุบันไม่น้อยกว่าที่ขอแล้ว (มีการปรับระหว่างรออนุมัติ) กรุณาปฏิเสธคำขอนี้',
              'QUOTA_REQUEST_OUTDATED',
            );
          }
          if (!(await this.store.resolveRequest(t, id, 2, user.userId, clip(remark ?? null)))) {
            throw new ConflictBusinessException(
              'คำขอนี้ถูกดำเนินการไปแล้ว',
              'QUOTA_REQUEST_NOT_PENDING',
            );
          }
          const applied = await this.store.setQuota(
            t,
            org.unitType,
            org.unitId,
            found.requestedQuotaBytes,
            user.adUserName,
          );
          if (!applied) {
            // UPDATE ไม่เจอแถว (เช่น หน่วยงานหลักถูกปิดระหว่างนี้) → ยกเลิกทั้งก้อน ไม่ปล่อยให้คำขอเป็น Approved โดยไม่มีผล
            throw new BusinessException(
              'ตั้งโควตาของหน่วยงานหลักไม่สำเร็จ',
              'QUOTA_UNIT_NOT_FOUND',
            );
          }
        });
        await this.notifications.send({
          recipientUserId: req.requestedBy,
          eventType: EVENT.quotaRequestApproved,
          relatedEntityId: id,
          messageText: `คำขอเพิ่ม quota พื้นที่ folder ของ ${req.orgUnitName ?? req.orgUnitId} ได้รับการอนุมัติแล้ว (ใหม่: ${(req.requestedQuotaBytes / BYTES_PER_GB).toFixed(1)} GB)`,
        });
        return this.requireRequest(id);
      },
    );
  }

  /** ปฏิเสธ (ต้องมีเหตุผล) — Admin */
  rejectRequest(
    id: number,
    remark: string | undefined,
    user: UserContext,
  ): Promise<QuotaRequestDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: 'FolderQuotaChangeRequest',
        operation: 'REJECT_QUOTA_REQUEST',
        recordId: id,
      },
      async () => {
        this.assertAdmin(user);
        if (!remark || remark.trim() === '') {
          throw new BusinessException('กรุณาระบุเหตุผลในการปฏิเสธ', 'QUOTA_REASON_REQUIRED');
        }
        let req!: QuotaRequestRow;
        await this.tx.run(async (t) => {
          const found = await this.store.getRequest(id, t, true);
          if (!found) throw new ResourceNotFoundException('FolderQuotaChangeRequest', id);
          req = found;
          this.assertPending(found);
          if (!(await this.store.resolveRequest(t, id, 3, user.userId, clip(remark)))) {
            throw new ConflictBusinessException(
              'คำขอนี้ถูกดำเนินการไปแล้ว',
              'QUOTA_REQUEST_NOT_PENDING',
            );
          }
        });
        await this.notifications.send({
          recipientUserId: req.requestedBy,
          eventType: EVENT.quotaRequestRejected,
          relatedEntityId: id,
          messageText: `คำขอเพิ่ม quota พื้นที่ folder ของ ${req.orgUnitName ?? req.orgUnitId} ถูกปฏิเสธ: ${remark}`,
        });
        return this.requireRequest(id);
      },
    );
  }

  /** ยกเลิกคำขอของตนเองที่ยัง Pending */
  cancelRequest(id: number, user: UserContext): Promise<QuotaRequestDto> {
    return this.logged(
      {
        action: 'UPDATE',
        entity: 'FolderQuotaChangeRequest',
        operation: 'CANCEL_QUOTA_REQUEST',
        recordId: id,
      },
      async () => {
        await this.tx.run(async (t) => {
          const found = await this.store.getRequest(id, t, true);
          if (!found) throw new ResourceNotFoundException('FolderQuotaChangeRequest', id);
          if (found.requestedBy !== user.userId) {
            throw new PermissionDeniedException(
              'ยกเลิกได้เฉพาะคำขอของตนเองเท่านั้น',
              'NOT_REQUESTER',
            );
          }
          this.assertPending(found, 'ยกเลิกได้เฉพาะคำขอที่ยังรออนุมัติ');
          if (!(await this.store.resolveRequest(t, id, 4, user.userId, 'ยกเลิกโดยผู้ขอ'))) {
            throw new ConflictBusinessException(
              'คำขอนี้ถูกดำเนินการไปแล้ว',
              'QUOTA_REQUEST_NOT_PENDING',
            );
          }
        });
        return this.requireRequest(id);
      },
    );
  }

  private assertPending(r: QuotaRequestRow, message = 'คำขอนี้ไม่อยู่ในสถานะรอดำเนินการ'): void {
    if (r.status !== 1)
      throw new BusinessException(message, 'QUOTA_REQUEST_NOT_PENDING', { status: r.status });
  }

  private assertAdmin(user: UserContext): void {
    if (user.appRole < AppRole.Admin) {
      throw new PermissionDeniedException('ต้องเป็น Admin เท่านั้น', 'ROLE_REQUIRED');
    }
  }

  private async requireRequest(id: number): Promise<QuotaRequestDto> {
    const r = await this.store.getRequest(id);
    if (!r) throw new ResourceNotFoundException('FolderQuotaChangeRequest', id);
    return toRequestDto(r);
  }
}

// ── mapper ────────────────────────────────────────────────

export function toUnitDto(u: QuotaUnitRow, fileCount: number, e: QuotaEvaluation): QuotaUnitDto {
  return {
    unitType: u.unitType,
    unitId: u.unitId,
    emsOrgUnitId: u.emsOrgUnitId,
    code: u.code,
    name: u.name,
    parentUnitId: u.parentUnitId,
    quotaBytes: String(u.quotaBytes),
    usedBytes: String(e.usedBytes),
    fileCount,
    usedPercent: e.usedPercent,
    alertLevel: e.alert,
    alertName: ALERT_NAMES[e.alert],
  };
}

export function toRequestDto(r: QuotaRequestRow): QuotaRequestDto {
  return {
    requestId: r.requestId,
    orgUnitId: r.orgUnitId,
    orgUnitName: r.orgUnitName,
    currentQuotaBytes: String(r.currentQuotaBytes),
    requestedQuotaBytes: String(r.requestedQuotaBytes),
    reason: r.reason,
    status: r.status,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    requestedDate: r.requestedDate,
    reviewedBy: r.reviewedBy,
    reviewedDate: r.reviewedDate,
    reviewRemark: r.reviewRemark,
  };
}
