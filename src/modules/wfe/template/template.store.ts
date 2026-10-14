import { Injectable } from '@nestjs/common';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import { camelizeKeys } from '../../../common/utils/camelize';
import { LIKE_ESCAPE, likeContains } from '../../../common/utils/query.util';
import { OPEN_INSTANCE_STATUSES } from '../common/wfe.constants';
import { WfConnection } from '../entities/wf-connection.entity';
import { WfDefinition } from '../entities/wf-definition.entity';
import { WfStep } from '../entities/wf-step.entity';

export interface TemplateListFilter {
  q?: string;
  /** ApprovalStatus (0..4) */
  approvalStatus?: number;
  isActive?: boolean;
  category?: string;
  createdBy?: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** แถวรายการ template (ไม่รวม TemplateDefinition ซึ่งยาว) + จำนวนที่นับให้ */
export interface TemplateListRow {
  wfDefinitionId: number;
  wfName: string;
  wfDescription: string | null;
  version: number;
  isActive: boolean;
  approvalStatus: number;
  submittedBy: string | null;
  submittedDate: Date | null;
  approvedBy: string | null;
  approvedDate: Date | null;
  rejectionReason: string | null;
  createdBy: string;
  createdDate: Date;
  modifiedBy: string | null;
  modifiedDate: Date | null;
  category: string | null;
  disabledBy: string | null;
  disabledDate: Date | null;
  disabledReason: string | null;
  stepCount: number;
  totalInstanceCount: number;
  activeInstanceCount: number;
}

export interface TemplateCounts {
  stepCount: number;
  totalInstanceCount: number;
  activeInstanceCount: number;
}

/** whitelist ของ ?sortBy= → นิพจน์คอลัมน์ (กัน SQL injection ผ่านชื่อคอลัมน์) */
export const TEMPLATE_SORT: Record<string, string> = {
  name: 'd.WFName',
  createdDate: 'd.CreatedDate',
  modifiedDate: 'd.ModifiedDate',
  version: 'd.Version',
  approvalStatus: 'd.ApprovalStatus',
  category: 'd.Category',
};

const OPEN = OPEN_INSTANCE_STATUSES.join(',');

/**
 * SQL ของ template/step/connection (WFE.s_WFDefinition, s_WFStep, s_WFConnection)
 * ทุกเมธอดรับ EntityManager เพื่อให้รันใน transaction เดียวกับผู้เรียกได้ (ส่ง `scope.manager` จาก TransactionRunner)
 */
@Injectable()
export class TemplateStore {
  // ── definition ──────────────────────────────────────────────

  findDefinition(m: EntityManager, id: number): Promise<WfDefinition | null> {
    return m.getRepository(WfDefinition).findOneBy({ wfDefinitionId: id, isDeleted: false });
  }

  async listDefinitions(
    m: EntityManager,
    f: TemplateListFilter,
  ): Promise<{ rows: TemplateListRow[]; total: number }> {
    const where: string[] = ['d.IsDeleted = 0'];
    const params: unknown[] = [];
    const p = (v: unknown) => `@${params.push(v) - 1}`;

    if (f.approvalStatus !== undefined) where.push(`d.ApprovalStatus = ${p(f.approvalStatus)}`);
    if (f.isActive !== undefined) where.push(`d.IsActive = ${p(f.isActive ? 1 : 0)}`);
    if (f.category) where.push(`d.Category = ${p(f.category)}`);
    if (f.createdBy) where.push(`d.CreatedBy = ${p(f.createdBy)}`);
    if (f.q?.trim()) {
      const like = p(likeContains(f.q.trim()));
      where.push(
        `(d.WFName LIKE ${like} ${LIKE_ESCAPE} OR d.WFDescription LIKE ${like} ${LIKE_ESCAPE})`,
      );
    }

    // sortBy ที่ไม่อยู่ใน whitelist ถือว่าไม่ได้เลือกเรียง → เรียงตามชื่อ (ก-ฮ) ตามค่าเริ่มต้นของระบบเดิม
    const custom = !!f.sortBy && Object.hasOwn(TEMPLATE_SORT, f.sortBy);
    const sortCol = custom ? TEMPLATE_SORT[f.sortBy as string] : 'd.WFName';
    const dir = custom && f.sortDir === 'desc' ? 'DESC' : 'ASC';
    const offset = p((f.page - 1) * f.pageSize);
    const take = p(f.pageSize);

    const sql = `
      SELECT COUNT(*) OVER () AS Total,
             d.WFDefinitionId, d.WFName, d.WFDescription, d.Version, d.IsActive, d.ApprovalStatus,
             d.SubmittedBy, d.SubmittedDate, d.ApprovedBy, d.ApprovedDate, d.RejectionReason,
             d.CreatedBy, d.CreatedDate, d.ModifiedBy, d.ModifiedDate, d.Category,
             d.DisabledBy, d.DisabledDate, d.DisabledReason,
             (SELECT COUNT(*) FROM WFE.s_WFStep s WHERE s.WFDefinitionId = d.WFDefinitionId AND s.IsDeleted = 0) AS StepCount,
             (SELECT COUNT(*) FROM WFE.t_WFInstance i WHERE i.WFDefinitionId = d.WFDefinitionId AND i.IsDeleted = 0) AS TotalInstanceCount,
             (SELECT COUNT(*) FROM WFE.t_WFInstance i WHERE i.WFDefinitionId = d.WFDefinitionId AND i.IsDeleted = 0 AND i.Status IN (${OPEN})) AS ActiveInstanceCount
        FROM WFE.s_WFDefinition d
       WHERE ${where.join(' AND ')}
       ORDER BY ${sortCol} ${dir}, d.WFDefinitionId ASC
      OFFSET ${offset} ROWS FETCH NEXT ${take} ROWS ONLY`;

    const raw = (await m.query(sql, params)) as Record<string, unknown>[];
    const total = raw.length ? Number(raw[0].Total) : 0;
    const rows = raw.map((r) => {
      const { Total: _t, ...rest } = r;
      return camelizeKeys<TemplateListRow>(rest);
    });
    return { rows, total };
  }

  async insertDefinition(m: EntityManager, values: Partial<WfDefinition>): Promise<number> {
    const res = await m.getRepository(WfDefinition).insert(values);
    return Number((res.identifiers[0] as { wfDefinitionId: number }).wfDefinitionId);
  }

  /**
   * แก้ template — ถ้าระบุ expectedStatus จะแก้เฉพาะเมื่อสถานะยังเป็นค่านั้น (กันสองคนกดพร้อมกัน)
   * @returns จำนวนแถวที่ถูกแก้ (0 = สถานะเปลี่ยนไปแล้ว/ไม่พบ)
   */
  async updateDefinition(
    m: EntityManager,
    id: number,
    patch: Partial<WfDefinition>,
    expectedStatus?: number,
  ): Promise<number> {
    const where: FindOptionsWhere<WfDefinition> = { wfDefinitionId: id, isDeleted: false };
    if (expectedStatus !== undefined) where.approvalStatus = expectedStatus;
    const res = await m.getRepository(WfDefinition).update(where, {
      ...patch,
      // ระบบเดิมใช้ GETUTCDATE() กับ ModifiedDate/DeletedDate ของตารางนี้
      modifiedDate: () => 'GETUTCDATE()',
    } as never);
    return res.affected ?? 0;
  }

  async softDeleteDefinition(m: EntityManager, id: number, by: string): Promise<number> {
    const res = await m
      .getRepository(WfDefinition)
      .update({ wfDefinitionId: id, isDeleted: false }, {
        isDeleted: true,
        deletedDate: () => 'GETUTCDATE()',
        modifiedDate: () => 'GETUTCDATE()',
        modifiedBy: by,
      } as never);
    return res.affected ?? 0;
  }

  /** จำนวน instance ที่ยังทำงานอยู่ (0, Created, InProgress, Suspended) ของ template — ใช้กันการลบ */
  async countOpenInstances(m: EntityManager, definitionId: number): Promise<number> {
    const rows = (await m.query(
      `SELECT COUNT(*) AS c FROM WFE.t_WFInstance
        WHERE WFDefinitionId = @0 AND IsDeleted = 0 AND Status IN (${OPEN})`,
      [definitionId],
    )) as { c: number }[];
    return Number(rows[0]?.c ?? 0);
  }

  async counts(m: EntityManager, definitionId: number): Promise<TemplateCounts> {
    const rows = (await m.query(
      `SELECT (SELECT COUNT(*) FROM WFE.s_WFStep WHERE WFDefinitionId = @0 AND IsDeleted = 0) AS StepCount,
              (SELECT COUNT(*) FROM WFE.t_WFInstance WHERE WFDefinitionId = @0 AND IsDeleted = 0) AS TotalInstanceCount,
              (SELECT COUNT(*) FROM WFE.t_WFInstance WHERE WFDefinitionId = @0 AND IsDeleted = 0 AND Status IN (${OPEN})) AS ActiveInstanceCount`,
      [definitionId],
    )) as Record<string, unknown>[];
    const r = camelizeKeys<TemplateCounts>(rows[0] ?? {});
    return {
      stepCount: Number(r.stepCount ?? 0),
      totalInstanceCount: Number(r.totalInstanceCount ?? 0),
      activeInstanceCount: Number(r.activeInstanceCount ?? 0),
    };
  }

  // ── step ────────────────────────────────────────────────────

  findSteps(m: EntityManager, definitionId: number): Promise<WfStep[]> {
    return m.getRepository(WfStep).find({
      where: { wfDefinitionId: definitionId, isDeleted: false },
      order: { sequenceNumber: 'ASC', wfStepId: 'ASC' },
    });
  }

  findStep(m: EntityManager, stepId: number): Promise<WfStep | null> {
    return m.getRepository(WfStep).findOneBy({ wfStepId: stepId, isDeleted: false });
  }

  async insertStep(m: EntityManager, values: Partial<WfStep>): Promise<number> {
    const res = await m.getRepository(WfStep).insert(values);
    return Number((res.identifiers[0] as { wfStepId: number }).wfStepId);
  }

  async updateStep(m: EntityManager, stepId: number, patch: Partial<WfStep>): Promise<number> {
    const res = await m
      .getRepository(WfStep)
      .update({ wfStepId: stepId, isDeleted: false }, patch as never);
    return res.affected ?? 0;
  }

  async softDeleteStep(m: EntityManager, stepId: number): Promise<number> {
    const res = await m
      .getRepository(WfStep)
      .update({ wfStepId: stepId, isDeleted: false }, { isDeleted: true });
    return res.affected ?? 0;
  }

  /** step นี้ถูก instance ใดอ้างอิงอยู่หรือไม่ (step instance หรือ CurrentStepId) — ถ้าใช่ห้ามลบ */
  async countStepReferences(m: EntityManager, stepId: number): Promise<number> {
    const rows = (await m.query(
      `SELECT (SELECT COUNT(*) FROM WFE.t_WFStepInstance WHERE WFStepId = @0)
            + (SELECT COUNT(*) FROM WFE.t_WFInstance WHERE CurrentStepId = @0) AS c`,
      [stepId],
    )) as { c: number }[];
    return Number(rows[0]?.c ?? 0);
  }

  // ── connection ──────────────────────────────────────────────

  findConnections(m: EntityManager, definitionId: number): Promise<WfConnection[]> {
    return m.getRepository(WfConnection).find({
      where: { wfDefinitionId: definitionId, isDeleted: false },
      order: { sequenceNumber: 'ASC', wfConnectionId: 'ASC' },
    });
  }

  findConnectionsFrom(m: EntityManager, fromStepId: number): Promise<WfConnection[]> {
    return m.getRepository(WfConnection).find({
      where: { fromStepId, isDeleted: false },
      order: { sequenceNumber: 'ASC', wfConnectionId: 'ASC' },
    });
  }

  findConnection(m: EntityManager, connectionId: number): Promise<WfConnection | null> {
    return m
      .getRepository(WfConnection)
      .findOneBy({ wfConnectionId: connectionId, isDeleted: false });
  }

  async insertConnection(m: EntityManager, values: Partial<WfConnection>): Promise<number> {
    const res = await m.getRepository(WfConnection).insert(values);
    return Number((res.identifiers[0] as { wfConnectionId: number }).wfConnectionId);
  }

  async updateConnection(
    m: EntityManager,
    connectionId: number,
    patch: Partial<WfConnection>,
  ): Promise<number> {
    const res = await m
      .getRepository(WfConnection)
      .update({ wfConnectionId: connectionId, isDeleted: false }, patch as never);
    return res.affected ?? 0;
  }

  async softDeleteConnection(m: EntityManager, connectionId: number): Promise<number> {
    const res = await m
      .getRepository(WfConnection)
      .update({ wfConnectionId: connectionId, isDeleted: false }, { isDeleted: true });
    return res.affected ?? 0;
  }

  /** soft delete โครงสร้างทั้งชุดของ template (เชื่อมต่อก่อน แล้วค่อย step) — ใช้ตอนสร้างผังใหม่จาก definition */
  async softDeleteStructure(m: EntityManager, definitionId: number): Promise<void> {
    await m.query(
      'UPDATE WFE.s_WFConnection SET IsDeleted = 1 WHERE WFDefinitionId = @0 AND IsDeleted = 0',
      [definitionId],
    );
    await m.query(
      'UPDATE WFE.s_WFStep SET IsDeleted = 1 WHERE WFDefinitionId = @0 AND IsDeleted = 0',
      [definitionId],
    );
  }
}
