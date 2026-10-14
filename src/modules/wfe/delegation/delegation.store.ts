import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { camelizeKeys } from '../../../common/utils/camelize';
import { WfDelegation } from '../entities/wf-delegation.entity';

export interface DelegationListFilter {
  userName: string;
  direction: 'from' | 'to' | 'any';
  activeOnly: boolean;
  page: number;
  pageSize: number;
}

/** SQL ของ dbo.WFDelegation (การสร้างและอ่านประวัติต่อ step ผ่าน SP dbo.sp_WF_CreateDelegation / sp_WF_GetDelegationHistory ใน service) */
@Injectable()
export class DelegationStore {
  findDelegation(m: EntityManager, id: number): Promise<WfDelegation | null> {
    return m.getRepository(WfDelegation).findOneBy({ wfDelegationId: id, isDeleted: false });
  }

  async deactivate(m: EntityManager, id: number): Promise<number> {
    const res = await m
      .getRepository(WfDelegation)
      .update({ wfDelegationId: id, isDeleted: false, isActive: true }, { isActive: false });
    return res.affected ?? 0;
  }

  async listForUser(
    m: EntityManager,
    f: DelegationListFilter,
  ): Promise<{ rows: WfDelegation[]; total: number }> {
    const params: unknown[] = [f.userName];
    const who =
      f.direction === 'from'
        ? 'd.DelegatedFrom = @0'
        : f.direction === 'to'
          ? 'd.DelegatedTo = @0'
          : '(d.DelegatedFrom = @0 OR d.DelegatedTo = @0)';
    params.push((f.page - 1) * f.pageSize, f.pageSize);
    const raw = (await m.query(
      `SELECT COUNT(*) OVER () AS Total, d.WFDelegationId, d.WorkflowStepInstanceId, d.DelegatedFrom, d.DelegatedTo,
              d.DelegationReason, d.DelegationDate, d.DelegationDepth, d.IsActive, d.IsDeleted, d.StartDate, d.EndDate, d.Remarks
         FROM dbo.WFDelegation d
        WHERE d.IsDeleted = 0 AND ${who} ${f.activeOnly ? 'AND d.IsActive = 1' : ''}
        ORDER BY d.DelegationDate DESC, d.WFDelegationId DESC
       OFFSET @1 ROWS FETCH NEXT @2 ROWS ONLY`,
      params,
    )) as Record<string, unknown>[];
    const total = raw.length ? Number(raw[0].Total) : 0;
    return {
      total,
      rows: raw.map((r) => {
        const { Total: _t, ...rest } = r;
        return camelizeKeys<WfDelegation>(rest);
      }),
    };
  }
}
