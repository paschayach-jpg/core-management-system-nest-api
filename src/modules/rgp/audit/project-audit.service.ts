import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { Repository, type EntityManager } from 'typeorm';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import { applyPaging, applySort } from '../../../common/utils/query.util';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import {
  TransactionRunner,
  type TransactionScope,
} from '../../../database/transaction-runner.service';
import { clip, rgpActor, ACTOR_LONG } from '../common/rgp-actor';
import { ProjectAuditLog } from '../entities/project-audit-log.entity';
import type { ProjectAuditQueryDto, ProjectAuditRowDto } from './dto/project-audit.dto';

export const AUDIT_MODULE = 'Project';
export const AUDIT_OK = 1;
export const AUDIT_FAILED = 2;

export interface ProjectAuditEntry {
  /** ชื่อผู้ใช้ AD */
  userId: string;
  action: string;
  tableName: string;
  recordId?: number | null;
  /** 1 = สำเร็จ, 2 = ล้มเหลว */
  result: typeof AUDIT_OK | typeof AUDIT_FAILED;
  message?: string | null;
}

export interface AuditSpec {
  user: Pick<UserContext, 'adUserName'>;
  /** เช่น CREATE_PROJECT — ล้มเหลวจะบันทึกเป็น `<action>_FAILED` */
  action: string;
  tableName: string;
  /** id ของระเบียนที่กระทำ (ถ้ารู้ล่วงหน้า) ไม่เช่นนั้นดึงจากผลลัพธ์ด้วย recordIdOf */
  recordId?: number;
}

const SORT = { auditId: 'a.i_audit_id', actionDate: 'a.d_action_date', action: 'a.n_action' };

/**
 * Audit ของโมดูล RGP — เขียนตาราง `RGP.t_project_audit_log` เหมือนระบบเดิม (รายงานเดิมยังอ่านตารางนี้)
 * ควบคู่กับ CRUD-log กลาง (ผู้เรียกแต่ละ service ห่อด้วย `logged()` อยู่แล้ว):
 *  - สำเร็จ  → เขียนแถว Result=1 "ใน transaction เดียวกับงาน" (งานกับ audit สำเร็จ/ล้มพร้อมกัน)
 *  - ล้มเหลว → งาน rollback แล้วเขียนแถว `<action>_FAILED` Result=2 พร้อมข้อความ แยก connection (ถ้าเขียนไม่ได้แค่ log เตือน)
 *
 * การเพิ่มแถว audit เองไม่ผ่าน `logged()` เพื่อไม่ให้เกิด CRUD-log ซ้อนสองชั้นต่อหนึ่งการกระทำ
 */
@Injectable()
export class ProjectAuditService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectAuditLog';
  private readonly logger = new Logger(ProjectAuditService.name);
  private readonly machine = hostname();

  constructor(
    crudLog: CrudLogService,
    private readonly tx: TransactionRunner,
    @InjectRepository(ProjectAuditLog) private readonly repo: Repository<ProjectAuditLog>,
  ) {
    super(crudLog);
  }

  /**
   * รัน `work` ใน transaction (ฐานหลัก) แล้วบันทึก audit — ใช้กับการกระทำที่ระบบเดิมเขียน audit
   * @param recordIdOf ดึง id ระเบียนจากผลลัพธ์ (เช่น id โครงการที่เพิ่งสร้าง)
   */
  async withAudit<T>(
    spec: AuditSpec,
    work: (scope: TransactionScope) => Promise<T>,
    recordIdOf?: (result: T) => number | undefined,
  ): Promise<T> {
    try {
      return await this.tx.run(async (scope) => {
        const result = await work(scope);
        await this.insertRow(
          {
            userId: rgpActor(spec.user, ACTOR_LONG),
            action: spec.action,
            tableName: spec.tableName,
            recordId: spec.recordId ?? recordIdOf?.(result) ?? null,
            result: AUDIT_OK,
          },
          scope.manager,
        );
        return result;
      });
    } catch (err) {
      await this.recordFailure(spec, err);
      throw err;
    }
  }

  /** เขียนแถว audit หนึ่งแถว (ใช้ manager ของ transaction ถ้าส่งมา) */
  async record(entry: ProjectAuditEntry, manager?: EntityManager): Promise<void> {
    await this.insertRow(entry, manager);
  }

  /** บันทึกความล้มเหลวนอก transaction — ห้ามทำให้ error จริงถูกบัง */
  private async recordFailure(spec: AuditSpec, err: unknown): Promise<void> {
    try {
      await this.insertRow({
        userId: rgpActor(spec.user, ACTOR_LONG),
        action: `${spec.action}_FAILED`,
        tableName: spec.tableName,
        recordId: spec.recordId ?? null,
        result: AUDIT_FAILED,
        message: (err as Error)?.message ?? String(err),
      });
    } catch (auditErr) {
      this.logger.error(
        `เขียน audit ล้มเหลว (${spec.action}_FAILED) ไม่สำเร็จ: ${(auditErr as Error)?.message}`,
      );
    }
  }

  private async insertRow(entry: ProjectAuditEntry, manager?: EntityManager): Promise<void> {
    const row = {
      userId: clip(entry.userId, ACTOR_LONG) ?? '',
      module: AUDIT_MODULE,
      action: clip(entry.action, 100) ?? '',
      tableName: clip(entry.tableName, 200),
      recordId: entry.recordId ?? null,
      result: entry.result,
      message: clip(entry.message, 500),
      machineName: clip(this.machine, 200),
      actionDate: new Date(),
    };
    if (manager) await manager.insert(ProjectAuditLog, row);
    else await this.repo.insert(row);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** ค้น audit ของ RGP (ใหม่สุดก่อน) — กรองตามโครงการได้ (รวม state/task ของโครงการนั้น) */
  async query(q: ProjectAuditQueryDto): Promise<Paginated<ProjectAuditRowDto>> {
    const qb = this.repo.createQueryBuilder('a');
    if (q.projectId !== undefined) {
      qb.andWhere(
        `((a.n_table_name = 't_project' AND a.i_record_id = :pid)
          OR (a.n_table_name = 't_project_state' AND a.i_record_id IN
                (SELECT s.i_proj_state_id FROM RGP.t_project_state s WHERE s.i_project_id = :pid))
          OR (a.n_table_name = 't_project_task' AND a.i_record_id IN
                (SELECT t.i_task_id FROM RGP.t_project_task t WHERE t.i_project_id = :pid)))`,
        { pid: q.projectId },
      );
    }
    if (q.action) qb.andWhere('a.n_action = :action', { action: q.action });
    if (q.userId) qb.andWhere('a.i_user_id = :uid', { uid: q.userId });
    if (q.result !== undefined) qb.andWhere('a.i_result = :res', { res: q.result });
    if (q.from) qb.andWhere('a.d_action_date >= :from', { from: q.from });
    if (q.to) qb.andWhere('a.d_action_date <= :to', { to: q.to });
    applySort(qb, q, SORT, { column: 'a.i_audit_id', dir: 'DESC' });
    applyPaging(qb, q);
    const [items, total] = await qb.getManyAndCount();
    return paginated(items.map(toRow), total, q);
  }
}

function toRow(a: ProjectAuditLog): ProjectAuditRowDto {
  return {
    auditId: a.auditId,
    userId: a.userId,
    module: a.module,
    action: a.action,
    tableName: a.tableName,
    recordId: a.recordId,
    result: a.result,
    message: a.message,
    machineName: a.machineName,
    actionDate: a.actionDate as Date,
  };
}
