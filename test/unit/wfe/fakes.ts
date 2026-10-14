/**
 * ตัวช่วยเทสต์ของ WFE: ฐานข้อมูลในหน่วยความจำ + store/SP/transaction ปลอมที่ทำงานตามสัญญาเดียวกับของจริง
 * (ไม่มี SQL Server — ตรวจได้ที่ตรรกะ ลำดับการเรียก SP, rollback และ CRUD-log; ไม่ได้พิสูจน์ว่า SQL รันถูก)
 */
import { SpExecutionError } from '../../../src/database/sp/sp-execution.error';
import { Sp } from '../../../src/database/sp/sp-catalog.generated';
import { AppRole, WorkflowStepType as T } from '../../../src/common/constants/enums';
import { sameUser } from '../../../src/modules/wfe/common/wfe-access';
import { WorkflowDelegationsService } from '../../../src/modules/wfe/delegation/delegation.service';
import { WorkflowInstancesService } from '../../../src/modules/wfe/instance/instance.service';
import { WorkflowSlaService } from '../../../src/modules/wfe/sla/sla.service';
import { TemplateStructureService } from '../../../src/modules/wfe/template/template-structure.service';
import { WorkflowTemplatesService } from '../../../src/modules/wfe/template/template.service';
import type { WfConnection } from '../../../src/modules/wfe/entities/wf-connection.entity';
import type { WfDefinition } from '../../../src/modules/wfe/entities/wf-definition.entity';
import type { WfDelegation } from '../../../src/modules/wfe/entities/wf-delegation.entity';
import type { WfStep } from '../../../src/modules/wfe/entities/wf-step.entity';
import type {
  InstanceRow,
  StepInstanceRow,
} from '../../../src/modules/wfe/instance/instance.store';
import type { WfeNotice } from '../../../src/modules/wfe/common/wfe-notifications.service';
import type { DirectoryUser } from '../../../src/modules/wfe/common/wfe-user-directory';
import { fakeUser, makeCrudLog } from '../../helpers/stubs';
import type { UserContext } from '../../../src/common/interfaces/user-context';

type Row = Record<string, unknown>;

// ───────────────────────── ฐานข้อมูลในหน่วยความจำ ─────────────────────────

export class FakeDb {
  seq = { def: 0, step: 0, conn: 0, inst: 0, si: 0, deleg: 0 };
  defs: WfDefinition[] = [];
  steps: WfStep[] = [];
  conns: WfConnection[] = [];
  instances: InstanceRow[] = [];
  stepInstances: StepInstanceRow[] = [];
  delegations: WfDelegation[] = [];
  users: DirectoryUser[] = [];
  /** ค่า SystemConfig ที่ตั้งทับ */
  config: Record<string, number | boolean> = {};

  snapshot(): string {
    const { seq, defs, steps, conns, instances, stepInstances, delegations } = this;
    return JSON.stringify({ seq, defs, steps, conns, instances, stepInstances, delegations });
  }

  restore(s: string): void {
    const j = JSON.parse(s, (_k, v) =>
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
    ) as Pick<
      FakeDb,
      'seq' | 'defs' | 'steps' | 'conns' | 'instances' | 'stepInstances' | 'delegations'
    >;
    Object.assign(this, j);
  }
}

// ───────────────────────── transaction ─────────────────────────

export class FakeTx {
  constructor(
    private readonly db: FakeDb,
    private readonly trace: string[],
  ) {}
  depth = 0;
  async run<T>(work: (scope: { manager: object; queryRunner: object; sp: object }) => Promise<T>) {
    const snap = this.db.snapshot();
    this.trace.push('tx:begin');
    this.depth++;
    try {
      const r = await work({ manager: { fake: true }, queryRunner: {}, sp: { fakeTx: true } });
      this.trace.push('tx:commit');
      return r;
    } catch (err) {
      this.db.restore(snap);
      this.trace.push('tx:rollback');
      throw err;
    } finally {
      this.depth--;
    }
  }
}

// ───────────────────────── store ปลอม ─────────────────────────

export class FakeTemplateStore {
  constructor(
    private readonly db: FakeDb,
    private readonly trace: string[],
  ) {}

  async findDefinition(_m: unknown, id: number) {
    return this.db.defs.find((d) => d.wfDefinitionId === id && !d.isDeleted) ?? null;
  }

  async listDefinitions(_m: unknown, f: Row) {
    let rows = this.db.defs.filter((d) => !d.isDeleted);
    if (f.approvalStatus !== undefined)
      rows = rows.filter((d) => d.approvalStatus === f.approvalStatus);
    if (f.isActive !== undefined) rows = rows.filter((d) => Boolean(d.isActive) === f.isActive);
    if (f.category) rows = rows.filter((d) => d.category === f.category);
    if (f.q) rows = rows.filter((d) => d.wfName.includes(String(f.q)));
    rows = [...rows].sort((a, b) => a.wfName.localeCompare(b.wfName));
    const page = Number(f.page);
    const size = Number(f.pageSize);
    return {
      total: rows.length,
      rows: rows.slice((page - 1) * size, page * size).map((d) => ({
        ...d,
        stepCount: this.db.steps.filter(
          (s) => s.wfDefinitionId === d.wfDefinitionId && !s.isDeleted,
        ).length,
        totalInstanceCount: 0,
        activeInstanceCount: 0,
      })),
    };
  }

  async insertDefinition(_m: unknown, v: Partial<WfDefinition>) {
    const id = ++this.db.seq.def;
    this.db.defs.push({
      wfDefinitionId: id,
      version: 1,
      isActive: true,
      approvalStatus: 0,
      createdDate: new Date('2026-01-01T00:00:00Z'),
      isDeleted: false,
      ...v,
    } as WfDefinition);
    this.trace.push('store.insertDefinition');
    return id;
  }

  async updateDefinition(_m: unknown, id: number, patch: Partial<WfDefinition>, expected?: number) {
    const d = this.db.defs.find((x) => x.wfDefinitionId === id && !x.isDeleted);
    if (!d) return 0;
    if (expected !== undefined && d.approvalStatus !== expected) return 0;
    Object.assign(d, patch, { modifiedDate: new Date('2026-02-01T00:00:00Z') });
    return 1;
  }

  async softDeleteDefinition(_m: unknown, id: number, by: string) {
    const d = this.db.defs.find((x) => x.wfDefinitionId === id && !x.isDeleted);
    if (!d) return 0;
    Object.assign(d, { isDeleted: true, deletedDate: new Date(), modifiedBy: by });
    return 1;
  }

  async countOpenInstances(_m: unknown, id: number) {
    return this.db.instances.filter(
      (i) => i.wfDefinitionId === id && !i.isDeleted && [0, 1, 2, 5].includes(i.status),
    ).length;
  }

  async counts(_m: unknown, id: number) {
    const inst = this.db.instances.filter((i) => i.wfDefinitionId === id && !i.isDeleted);
    return {
      stepCount: this.db.steps.filter((s) => s.wfDefinitionId === id && !s.isDeleted).length,
      totalInstanceCount: inst.length,
      activeInstanceCount: inst.filter((i) => [0, 1, 2, 5].includes(i.status)).length,
    };
  }

  async findSteps(_m: unknown, defId: number) {
    return this.db.steps
      .filter((s) => s.wfDefinitionId === defId && !s.isDeleted)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.wfStepId - b.wfStepId);
  }

  async findStep(_m: unknown, id: number) {
    return this.db.steps.find((s) => s.wfStepId === id && !s.isDeleted) ?? null;
  }

  async insertStep(_m: unknown, v: Partial<WfStep>) {
    const id = ++this.db.seq.step;
    this.db.steps.push({
      wfStepId: id,
      allowDelegation: false,
      maxDelegationDepth: 1,
      isDeleted: false,
      ...v,
    } as WfStep);
    this.trace.push('store.insertStep');
    return id;
  }

  async updateStep(_m: unknown, id: number, patch: Partial<WfStep>) {
    const s = this.db.steps.find((x) => x.wfStepId === id && !x.isDeleted);
    if (!s) return 0;
    Object.assign(s, patch);
    return 1;
  }

  async softDeleteStep(_m: unknown, id: number) {
    const s = this.db.steps.find((x) => x.wfStepId === id && !x.isDeleted);
    if (!s) return 0;
    s.isDeleted = true;
    return 1;
  }

  async countStepReferences(_m: unknown, id: number) {
    return (
      this.db.stepInstances.filter((s) => s.wfStepId === id).length +
      this.db.instances.filter((i) => i.currentStepId === id).length
    );
  }

  async findConnections(_m: unknown, defId: number) {
    return this.db.conns
      .filter((c) => c.wfDefinitionId === defId && !c.isDeleted)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.wfConnectionId - b.wfConnectionId);
  }

  async findConnectionsFrom(_m: unknown, fromId: number) {
    return this.db.conns
      .filter((c) => c.fromStepId === fromId && !c.isDeleted)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.wfConnectionId - b.wfConnectionId);
  }

  async findConnection(_m: unknown, id: number) {
    return this.db.conns.find((c) => c.wfConnectionId === id && !c.isDeleted) ?? null;
  }

  async insertConnection(_m: unknown, v: Partial<WfConnection>) {
    const id = ++this.db.seq.conn;
    this.db.conns.push({ wfConnectionId: id, isDeleted: false, ...v } as WfConnection);
    this.trace.push('store.insertConnection');
    return id;
  }

  async updateConnection(_m: unknown, id: number, patch: Partial<WfConnection>) {
    const c = this.db.conns.find((x) => x.wfConnectionId === id && !x.isDeleted);
    if (!c) return 0;
    Object.assign(c, patch);
    return 1;
  }

  async softDeleteConnection(_m: unknown, id: number) {
    const c = this.db.conns.find((x) => x.wfConnectionId === id && !x.isDeleted);
    if (!c) return 0;
    c.isDeleted = true;
    return 1;
  }

  async softDeleteStructure(_m: unknown, defId: number) {
    this.db.conns.filter((c) => c.wfDefinitionId === defId).forEach((c) => (c.isDeleted = true));
    this.db.steps.filter((s) => s.wfDefinitionId === defId).forEach((s) => (s.isDeleted = true));
  }
}

export class FakeInstanceStore {
  constructor(
    private readonly db: FakeDb,
    private readonly trace: string[],
  ) {}

  async findInstance(_m: unknown, id: number) {
    const i = this.db.instances.find((x) => x.wfInstanceId === id && !x.isDeleted);
    return i ? { ...i } : null;
  }

  async updateInstance(_m: unknown, id: number, patch: Row) {
    this.trace.push('store.updateInstance');
    const i = this.db.instances.find((x) => x.wfInstanceId === id && !x.isDeleted);
    if (!i) return 0;
    Object.assign(i, patch);
    return 1;
  }

  async softDeleteInstance(_m: unknown, id: number) {
    const i = this.db.instances.find((x) => x.wfInstanceId === id && !x.isDeleted);
    if (!i) return 0;
    i.isDeleted = true;
    return 1;
  }

  async participants(_m: unknown, id: number) {
    return [
      ...new Set(
        this.db.stepInstances
          .filter((s) => s.wfInstanceId === id && s.assignedTo)
          .map((s) => s.assignedTo as string),
      ),
    ];
  }

  async listInstances(_m: unknown, f: Row) {
    const viewer = f.viewer as { userName: string; seesAll: boolean };
    let rows = this.db.instances.filter((i) => !i.isDeleted);
    if (f.status !== undefined) rows = rows.filter((i) => i.status === f.status);
    if (!viewer.seesAll)
      rows = rows.filter(
        (i) =>
          sameUser(i.initiatedBy, viewer.userName) ||
          this.db.stepInstances.some(
            (s) => s.wfInstanceId === i.wfInstanceId && sameUser(s.assignedTo, viewer.userName),
          ),
      );
    return {
      total: rows.length,
      rows: rows.map((i) => ({
        ...i,
        templateName:
          this.db.defs.find((d) => d.wfDefinitionId === i.wfDefinitionId)?.wfName ?? null,
        currentStepName:
          this.db.steps.find((s) => s.wfStepId === i.currentStepId)?.stepName ?? null,
        totalStepCount: this.db.steps.filter((s) => s.wfDefinitionId === i.wfDefinitionId).length,
        completedStepCount: this.db.stepInstances.filter(
          (s) => s.wfInstanceId === i.wfInstanceId && s.status === 3,
        ).length,
      })),
    };
  }

  async findStepInstance(_m: unknown, id: number) {
    const s = this.db.stepInstances.find((x) => x.wfStepInstanceId === id);
    return s ? { ...s } : null;
  }

  async listStepInstances(_m: unknown, instanceId: number) {
    return this.db.stepInstances
      .filter((s) => s.wfInstanceId === instanceId)
      .map((s) => {
        const st = this.db.steps.find((x) => x.wfStepId === s.wfStepId);
        return {
          ...s,
          stepName: st?.stepName ?? null,
          stepType: st?.stepType ?? null,
          stepSequence: st?.sequenceNumber ?? null,
        };
      })
      .sort(
        (a, b) =>
          (a.stepSequence ?? 999) - (b.stepSequence ?? 999) ||
          Number(a.assignedDate) - Number(b.assignedDate) ||
          a.wfStepInstanceId - b.wfStepInstanceId,
      );
  }

  async updateStepInstance(_m: unknown, id: number, patch: Row) {
    this.trace.push('store.updateStepInstance');
    const s = this.db.stepInstances.find((x) => x.wfStepInstanceId === id);
    if (!s) return 0;
    Object.assign(s, patch);
    return 1;
  }

  async taskSlaRows(_m: unknown, userName: string, since: Date) {
    return this.db.stepInstances
      .filter((s) => sameUser(s.assignedTo, userName))
      .filter((s) => {
        const inst = this.db.instances.find((i) => i.wfInstanceId === s.wfInstanceId);
        const open = [1, 2, 5].includes(s.status) && [0, 1, 2].includes(inst?.status ?? -1);
        const doneToday = s.status === 3 && !!s.completedDate && s.completedDate >= since;
        return open || doneToday;
      })
      .map((s) => ({
        status: s.status,
        assignedDate: s.assignedDate,
        slaDeadline: s.slaDeadline,
        completedDate: s.completedDate,
      }));
  }

  async myTasks(
    _m: unknown,
    o: { userName: string; onlyOpen: boolean; page: number; pageSize: number },
  ) {
    const mine = this.db.stepInstances.filter(
      (s) =>
        sameUser(s.assignedTo, o.userName) &&
        [1, 2, 5, ...(o.onlyOpen ? [] : [3])].includes(s.status),
    );
    return {
      total: mine.length,
      rows: mine.slice((o.page - 1) * o.pageSize, o.page * o.pageSize).map((s) => {
        const inst = this.db.instances.find(
          (i) => i.wfInstanceId === s.wfInstanceId,
        ) as InstanceRow;
        const st = this.db.steps.find((x) => x.wfStepId === s.wfStepId);
        return {
          ...s,
          wfDefinitionId: inst.wfDefinitionId,
          instanceStatus: inst.status,
          initiatedBy: inst.initiatedBy,
          templateName:
            this.db.defs.find((d) => d.wfDefinitionId === inst.wfDefinitionId)?.wfName ?? null,
          stepName: st?.stepName ?? null,
          stepType: st?.stepType ?? null,
          stepDescription: st?.description ?? null,
          allowDelegation: st?.allowDelegation ?? false,
          maxDelegationDepth: st?.maxDelegationDepth ?? 1,
          stepSequence: st?.sequenceNumber ?? null,
          totalSteps: this.db.steps.filter((x) => x.wfDefinitionId === inst.wfDefinitionId).length,
        };
      }),
    };
  }
}

export class FakeDelegationStore {
  constructor(private readonly db: FakeDb) {}
  async findDelegation(_m: unknown, id: number) {
    return this.db.delegations.find((d) => d.wfDelegationId === id && !d.isDeleted) ?? null;
  }
  async deactivate(_m: unknown, id: number) {
    const d = this.db.delegations.find(
      (x) => x.wfDelegationId === id && !x.isDeleted && x.isActive,
    );
    if (!d) return 0;
    d.isActive = false;
    return 1;
  }
  async listForUser(
    _m: unknown,
    f: { userName: string; direction: string; activeOnly: boolean; page: number; pageSize: number },
  ) {
    const rows = this.db.delegations.filter(
      (d) =>
        !d.isDeleted &&
        (!f.activeOnly || d.isActive) &&
        (f.direction === 'from'
          ? sameUser(d.delegatedFrom, f.userName)
          : f.direction === 'to'
            ? sameUser(d.delegatedTo, f.userName)
            : sameUser(d.delegatedFrom, f.userName) || sameUser(d.delegatedTo, f.userName)),
    );
    return { total: rows.length, rows: rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize) };
  }
}

// ───────────────────────── SpExecutor ปลอม ─────────────────────────

export interface SpCallRecord {
  sp: string;
  input: Row;
  options: unknown;
}

/** จำลอง 4 SP ของ WFE ตามนิยามจริงใน db-export/sp-by-schema (ลำดับ/พารามิเตอร์/ค่า OUTPUT/RAISERROR) */
export class FakeSp {
  calls: SpCallRecord[] = [];
  /** ชื่อ SP → error ที่จะโยนในการเรียกครั้งที่ n (นับจาก 1) */
  failures: { spName: string; onCall: number; error: Error }[] = [];
  private counts = new Map<string, number>();
  reportRows: Record<string, Row[]> = {};

  constructor(
    private readonly db: FakeDb,
    private readonly trace: string[],
  ) {}

  /** ให้การเรียกครั้งที่ n นับจาก "ตอนนี้" (ค่าเริ่มต้น 1 = ครั้งถัดไป) โยน error */
  failOn(spName: string, error: Error, nthFromNow = 1) {
    this.failures.push({ spName, onCall: (this.counts.get(spName) ?? 0) + nthFromNow, error });
  }

  call(def: { name: string }, options: unknown = {}) {
    const run = async (input: Row) => {
      this.calls.push({ sp: def.name, input, options });
      this.trace.push(`sp:${def.name}`);
      const n = (this.counts.get(def.name) ?? 0) + 1;
      this.counts.set(def.name, n);
      const f = this.failures.find((x) => x.spName === def.name && x.onCall === n);
      if (f) throw f.error;
      return this.exec(def.name, input);
    };
    return {
      execute: run,
      rows: async (i: Row) => (await run(i)).rows,
      one: async (i: Row) => (await run(i)).rows[0] ?? null,
      scalar: async (i: Row) => Object.values((await run(i)).rows[0] ?? {})[0] ?? null,
      exec: async (i: Row) => void (await run(i)),
    };
  }

  private exec(name: string, input: Row): { rows: Row[]; output: Row } {
    const db = this.db;
    switch (name) {
      case Sp.wfe.createWfInstance.name: {
        const id = ++db.seq.inst;
        db.instances.push({
          wfInstanceId: id,
          wfDefinitionId: Number(input.WFDefinitionId),
          templateVersion: Number(input.TemplateVersion),
          status: 0, // sp_CreateWFInstance ใส่ 0
          initiatedBy: String(input.InitiatedBy),
          initiatedDate: new Date('2026-03-01T02:00:00Z'),
          currentStepId: null,
          completedDate: null,
          inputParameters: (input.InputParameters as string | null) ?? null,
          isDeleted: false,
        });
        return { rows: [], output: { NewWFInstanceId: id } };
      }
      case Sp.wfe.createWfStepInstance.name: {
        const instId = Number(input.WFInstanceId ?? input.WorkflowInstanceId);
        const stepId = Number(input.WFStepId ?? input.WorkflowStepId);
        if (!instId || !stepId)
          throw new SpExecutionError(name, 'WFInstanceId and WFStepId are required.');
        const inst = db.instances.find((i) => i.wfInstanceId === instId);
        const assignedTo = (input.AssignedTo as string) || inst?.initiatedBy || 'system';
        const id = ++db.seq.si;
        db.stepInstances.push({
          wfStepInstanceId: id,
          wfInstanceId: instId,
          wfStepId: stepId,
          status: 1, // Pending
          assignedTo,
          assignedDate: new Date(),
          startedDate: new Date(),
          completedDate: null,
          completedBy: null,
          outputData: null,
          remarks: null,
          slaDeadline: (input.SLADeadline as Date | null) ?? null,
          slaStatus: 1, // OnTime (N'1')
        });
        return { rows: [], output: { NewWFStepInstanceId: id, NewWorkflowStepInstanceId: id } };
      }
      case Sp.dbo.wfCreateDelegation.name: {
        const sid = Number(input.WorkflowStepInstanceId);
        db.delegations
          .filter((d) => d.workflowStepInstanceId === sid && d.isActive)
          .forEach((d) => (d.isActive = false));
        const depth =
          db.delegations
            .filter((d) => d.workflowStepInstanceId === sid && !d.isDeleted)
            .reduce((m, d) => Math.max(m, d.delegationDepth), 0) + 1;
        if (depth > Number(input.MaxDelegationDepth ?? 3))
          throw new SpExecutionError(name, 'Maximum delegation depth exceeded');
        const id = ++db.seq.deleg;
        db.delegations.push({
          wfDelegationId: id,
          workflowStepInstanceId: sid,
          delegatedFrom: String(input.DelegatedFrom),
          delegatedTo: String(input.DelegatedTo),
          delegationReason: (input.DelegationReason as string | null) ?? null,
          delegationDate: new Date(),
          delegationDepth: depth,
          isActive: true,
          isDeleted: false,
          startDate: (input.StartDate as Date | null) ?? null,
          endDate: (input.EndDate as Date | null) ?? null,
          remarks: (input.Remarks as string | null) ?? null,
        });
        return { rows: [], output: { NewWFDelegationId: id } };
      }
      case Sp.dbo.wfGetDelegationHistory.name: {
        const sid = Number(input.WorkflowStepInstanceId);
        const rows = db.delegations
          .filter((d) => d.workflowStepInstanceId === sid && !d.isDeleted)
          .sort((a, b) => a.delegationDepth - b.delegationDepth)
          .map((d) => ({
            WFDelegationId: d.wfDelegationId,
            WorkflowStepInstanceId: d.workflowStepInstanceId,
            DelegatedFrom: d.delegatedFrom,
            DelegatedTo: d.delegatedTo,
            DelegationReason: d.delegationReason,
            DelegationDate: d.delegationDate,
            DelegationDepth: d.delegationDepth,
            IsActive: d.isActive,
            IsDeleted: d.isDeleted,
            StartDate: d.startDate,
            EndDate: d.endDate,
            Remarks: d.remarks,
          }));
        return { rows, output: {} };
      }
      default:
        return { rows: this.reportRows[name] ?? [], output: {} };
    }
  }
}

// ───────────────────────── อื่นๆ ─────────────────────────

export class FakeDirectory {
  constructor(private readonly db: FakeDb) {}
  async findByAdUserName(name: string) {
    return this.db.users.find((u) => sameUser(u.adUserName, name)) ?? null;
  }
  async findMany(names: readonly string[]) {
    const out = new Map<string, DirectoryUser>();
    for (const n of names) {
      const u = this.db.users.find((x) => sameUser(x.adUserName, n));
      if (u) out.set(u.adUserName.toLowerCase(), u);
    }
    return out;
  }
}

export class FakeConfig {
  constructor(private readonly db: FakeDb) {}
  async getNumber(key: string, fallback: number) {
    const v = this.db.config[key];
    return typeof v === 'number' ? v : fallback;
  }
  async getBool(key: string, fallback: boolean) {
    const v = this.db.config[key];
    return typeof v === 'boolean' ? v : fallback;
  }
}

export class FakeNotifier {
  sent: { notices: WfeNotice[]; actor?: string }[] = [];
  constructor(private readonly trace: string[]) {}
  async dispatch(notices: readonly WfeNotice[], actor?: string) {
    this.trace.push('notify');
    this.sent.push({ notices: [...notices], actor });
  }
  get all(): WfeNotice[] {
    return this.sent.flatMap((s) => s.notices);
  }
}

export class FakeSlaStore {
  constructor(
    private readonly db: FakeDb,
    private readonly trace: string[],
  ) {}
  lockAvailable = true;
  lockAttempts = 0;
  updatedStatuses: { ids: number[]; status: number }[] = [];
  openCalls = 0;

  async openSlaRows(_m: unknown, afterId: number, limit: number) {
    this.openCalls++;
    return this.db.stepInstances
      .filter((s) => [1, 2, 5].includes(s.status) && s.slaDeadline && s.wfStepInstanceId > afterId)
      .filter((s) =>
        [0, 1, 2].includes(
          this.db.instances.find((i) => i.wfInstanceId === s.wfInstanceId)?.status ?? -1,
        ),
      )
      .slice(0, limit)
      .map((s) => {
        const inst = this.db.instances.find(
          (i) => i.wfInstanceId === s.wfInstanceId,
        ) as InstanceRow;
        return {
          ...s,
          initiatedBy: inst.initiatedBy,
          templateName:
            this.db.defs.find((d) => d.wfDefinitionId === inst.wfDefinitionId)?.wfName ?? null,
          stepName: this.db.steps.find((x) => x.wfStepId === s.wfStepId)?.stepName ?? null,
        };
      });
  }
  async setSlaStatus(_m: unknown, ids: readonly number[], status: number) {
    this.updatedStatuses.push({ ids: [...ids], status });
    for (const s of this.db.stepInstances)
      if (ids.includes(s.wfStepInstanceId)) s.slaStatus = status;
  }
  async tryAcquireJobLock() {
    this.lockAttempts++;
    this.trace.push('sla:lock');
    if (!this.lockAvailable) return null;
    return { release: async () => void this.trace.push('sla:unlock') };
  }
  async byTemplate() {
    return [{ wfDefinitionId: 1, templateName: 'T1', total: 4, onTime: 2, atRisk: 1, overdue: 1 }];
  }
  async weeklyTrend() {
    return [
      { yr: 2026, wk: 9, total: 4, onTime: 3 },
      { yr: 2026, wk: 10, total: 2, onTime: 1 },
    ];
  }
  async cycleTime() {
    return [
      { label: '0–1', sortKey: 0, cnt: 3 },
      { label: '3–4', sortKey: 3, cnt: 2 },
      { label: '10+', sortKey: 7, cnt: 1 },
    ];
  }
  async overdue(_m: unknown, f: { now: Date; page: number; pageSize: number }) {
    return {
      total: 1,
      rows: [
        {
          wfStepInstanceId: 5,
          wfInstanceId: 2,
          templateName: 'T1',
          stepName: 'อนุมัติ',
          assignedTo: 'DOM\\bob',
          initiatedBy: 'DOM\\alice',
          assignedDate: new Date(f.now.getTime() - 50 * 3_600_000),
          slaDeadline: new Date(f.now.getTime() - 26 * 3_600_000),
        },
      ],
    };
  }
}

// ───────────────────────── ประกอบ service ─────────────────────────

export const USERS: DirectoryUser[] = [
  {
    userId: 11,
    adUserName: 'DOM\\alice',
    displayName: 'Alice',
    isActive: true,
    appRole: AppRole.Officer,
  },
  {
    userId: 12,
    adUserName: 'DOM\\bob',
    displayName: 'Bob',
    isActive: true,
    appRole: AppRole.Officer,
  },
  {
    userId: 13,
    adUserName: 'DOM\\carol',
    displayName: 'Carol',
    isActive: true,
    appRole: AppRole.Officer,
  },
  {
    userId: 14,
    adUserName: 'DOM\\dave',
    displayName: 'Dave',
    isActive: true,
    appRole: AppRole.Officer,
  },
  {
    userId: 15,
    adUserName: 'DOM\\erin',
    displayName: 'Erin',
    isActive: true,
    appRole: AppRole.Officer,
  },
  {
    userId: 16,
    adUserName: 'DOM\\gone',
    displayName: 'Gone',
    isActive: false,
    appRole: AppRole.Officer,
  },
  {
    userId: 90,
    adUserName: 'DOM\\boss',
    displayName: 'Boss',
    isActive: true,
    appRole: AppRole.Manager,
  },
  {
    userId: 99,
    adUserName: 'DOM\\root',
    displayName: 'Root',
    isActive: true,
    appRole: AppRole.Admin,
  },
];

export const asUser = (name: string, role: AppRole = AppRole.Officer): UserContext =>
  fakeUser({
    adUserName: `DOM\\${name}`,
    displayName: name,
    appRole: role,
    userId: 1000 + name.length,
  });
export const alice = asUser('alice');
export const bob = asUser('bob');
export const carol = asUser('carol');
export const boss = asUser('boss', AppRole.Manager);
export const root = asUser('root', AppRole.Admin);

export function makeWfe(opts: { logLevel?: 'off' | 'write' | 'all' } = {}) {
  const db = new FakeDb();
  db.users = USERS.map((u) => ({ ...u }));
  const trace: string[] = [];
  const { service: crud, sink } = makeCrudLog({ level: opts.logLevel });
  const tx = new FakeTx(db, trace);
  const sp = new FakeSp(db, trace);
  const templateStore = new FakeTemplateStore(db, trace);
  const instanceStore = new FakeInstanceStore(db, trace);
  const delegationStore = new FakeDelegationStore(db);
  const slaStore = new FakeSlaStore(db, trace);
  const directory = new FakeDirectory(db);
  const config = new FakeConfig(db);
  const notifier = new FakeNotifier(trace);
  const audit = { byWorkflowInstance: async (id: number) => [{ auditId: '1', recordId: id }] };
  const ds = { manager: { fake: true }, query: async () => [], createQueryRunner: () => ({}) };

  const structure = new TemplateStructureService(
    crud,
    ds as never,
    tx as never,
    templateStore as never,
    directory as never,
  );
  const templates = new WorkflowTemplatesService(
    crud,
    ds as never,
    tx as never,
    templateStore as never,
    structure,
  );
  const instances = new WorkflowInstancesService(
    crud,
    ds as never,
    tx as never,
    sp as never,
    instanceStore as never,
    templateStore as never,
    structure,
    directory as never,
    config as never,
    notifier as never,
    audit as never,
  );
  const delegations = new WorkflowDelegationsService(
    crud,
    ds as never,
    tx as never,
    sp as never,
    delegationStore as never,
    instanceStore as never,
    templateStore as never,
    directory as never,
    notifier as never,
  );
  const sla = new WorkflowSlaService(
    crud,
    ds as never,
    tx as never,
    sp as never,
    slaStore as never,
    config as never,
    notifier as never,
  );
  return {
    db,
    trace,
    sink,
    crud,
    tx,
    sp,
    notifier,
    slaStore,
    structure,
    templates,
    instances,
    delegations,
    sla,
    /** event ของ CRUD-log ที่บันทึกไว้ (รอให้เขียนเสร็จก่อน) */
    async events() {
      await crud.drain();
      return sink.events;
    },
  };
}

export type Wfe = ReturnType<typeof makeWfe>;

// ───────────────────────── ข้อมูลตั้งต้น ─────────────────────────

export interface SeedStep {
  key: string;
  type: T;
  name?: string;
  assignedUser?: string | null;
  assignedRole?: string | null;
  slaHours?: number | null;
  slaDays?: number | null;
  allowDelegation?: boolean;
  seq?: number;
}

export interface SeedTemplate {
  defId: number;
  step: Record<string, number>;
}

/** สร้าง template (ค่าเริ่มต้น Active) พร้อมแถว step/connection; edges เป็นคู่ [fromKey, toKey] */
export function seedTemplate(
  db: FakeDb,
  steps: SeedStep[],
  edges: [string, string][] | null,
  over: Partial<WfDefinition> = {},
): SeedTemplate {
  const defId = ++db.seq.def;
  db.defs.push({
    wfDefinitionId: defId,
    wfName: `Template ${defId}`,
    version: 3,
    isActive: true,
    approvalStatus: 2,
    createdBy: 'DOM\\boss',
    createdDate: new Date('2026-01-01T00:00:00Z'),
    isDeleted: false,
    ...over,
  } as WfDefinition);
  const step: Record<string, number> = {};
  steps.forEach((s, i) => {
    const id = ++db.seq.step;
    step[s.key] = id;
    db.steps.push({
      wfStepId: id,
      wfDefinitionId: defId,
      stepName: s.name ?? s.key,
      stepType: s.type,
      assignedUser: s.assignedUser ?? null,
      assignedRole: s.assignedRole ?? null,
      assignedOrgUnit: null,
      slaHours: s.slaHours ?? null,
      slaDays: s.slaDays ?? null,
      allowDelegation: s.allowDelegation ?? false,
      maxDelegationDepth: 1,
      sequenceNumber: s.seq ?? i + 1,
      isDeleted: false,
    } as WfStep);
  });
  (edges ?? []).forEach(([a, b], i) => {
    db.conns.push({
      wfConnectionId: ++db.seq.conn,
      wfDefinitionId: defId,
      fromStepId: step[a],
      toStepId: step[b],
      conditionExpression: null,
      sequenceNumber: i + 1,
      isDeleted: false,
    } as WfConnection);
  });
  return { defId, step };
}

/** Start → Approval(bob) → End */
export function seedLinear(db: FakeDb, over: Partial<WfDefinition> = {}) {
  return seedTemplate(
    db,
    [
      { key: 'start', type: T.Start, name: 'เริ่ม' },
      {
        key: 'approve',
        type: T.Approval,
        name: 'อนุมัติ',
        assignedUser: 'DOM\\bob',
        allowDelegation: true,
      },
      { key: 'end', type: T.End, name: 'จบ' },
    ],
    [
      ['start', 'approve'],
      ['approve', 'end'],
    ],
    over,
  );
}

export const designerJson = (steps: object[], connections: object[]) =>
  JSON.stringify({ Steps: steps, Connections: connections });

export const LINEAR_JSON = designerJson(
  [
    { WorkflowStepId: 1, StepName: 'เริ่ม', StepType: 'Start' },
    {
      WorkflowStepId: 2,
      StepName: 'อนุมัติ',
      StepType: 'Approval',
      AssignedUser: 'DOM\\bob',
      SLADays: 2,
    },
    { WorkflowStepId: 3, StepName: 'จบ', StepType: 'End' },
  ],
  [
    { FromStepId: 1, ToStepId: 2 },
    { FromStepId: 2, ToStepId: 3 },
  ],
);
