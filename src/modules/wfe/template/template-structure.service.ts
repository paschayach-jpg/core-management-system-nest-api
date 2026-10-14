import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { WorkflowStepType, WorkflowTemplateStatus } from '../../../common/constants/enums';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { WFE_ENTITY, WFE_OP } from '../common/wfe.constants';
import { WfeUserDirectory } from '../common/wfe-user-directory';
import type { WfConnection } from '../entities/wf-connection.entity';
import type { WfDefinition } from '../entities/wf-definition.entity';
import type { WfStep } from '../entities/wf-step.entity';
import type {
  ConnectionDto,
  CreateConnectionDto,
  CreateStepDto,
  GraphValidationDto,
  StepDto,
  TemplateStructureDto,
  UpdateConnectionDto,
  UpdateStepDto,
} from './dto/template.dto';
import {
  graphFromDefinition,
  parseTemplateDefinition,
  validateGraph,
  type GraphEdge,
  type GraphIssue,
  type GraphNode,
} from './template-definition';
import { isStructureEditable } from './template-status';
import {
  toConnectionDto,
  toConnectionDtoFromDesign,
  toStepDto,
  toStepDtoFromDesign,
} from './template.mapper';
import { TemplateStore } from './template.store';

/** ปัญหาที่พบตอนตรวจ template (กราฟ + ผู้รับผิดชอบของ step) */
export interface TemplateIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  stepKey?: number;
}

export interface TemplateValidation {
  valid: boolean;
  issues: TemplateIssue[];
}

const blankToNull = (v: string | undefined | null): string | null => {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/**
 * โครงสร้างของ template: step + connection (WFE.s_WFStep / s_WFConnection) และการสร้างแถวเหล่านี้จาก TemplateDefinition (JSON)
 *
 * เหตุผลที่ต้องมี "Sync": designer ของระบบเดิมบันทึกผังเต็มไว้ใน TemplateDefinition เท่านั้น (ไม่ได้เขียน s_WFStep/s_WFConnection)
 * แต่ engine รันจากแถวใน s_WFStep/s_WFConnection → `SyncStepsFromTemplateDefinition` ของ WorkflowService เดิมสร้างแถวตอนสร้าง instance
 * ครั้งแรกถ้ายังไม่มี step เลย API เก็บ fallback นั้นไว้ (`ensureStepsForInstance`) และเพิ่มการสร้างแถวทันทีที่บันทึก Draft
 */
@Injectable()
export class TemplateStructureService extends CrudLoggedService {
  protected readonly logModule = 'WFE' as const;
  protected readonly logEntity = WFE_ENTITY.step;

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly store: TemplateStore,
    private readonly directory: WfeUserDirectory,
  ) {
    super(crudLog);
  }

  // ── อ่าน ─────────────────────────────────────────────────

  async listSteps(definitionId: number): Promise<StepDto[]> {
    await this.requireDefinition(this.ds.manager, definitionId);
    return (await this.store.findSteps(this.ds.manager, definitionId)).map(toStepDto);
  }

  async listConnections(definitionId: number): Promise<ConnectionDto[]> {
    await this.requireDefinition(this.ds.manager, definitionId);
    return (await this.store.findConnections(this.ds.manager, definitionId)).map(toConnectionDto);
  }

  /** โครงสร้างของ template: ใช้แถวใน DB ถ้ามี ไม่มีก็อ่านจาก TemplateDefinition (ไม่เขียนอะไร) */
  async getStructure(m: EntityManager, def: WfDefinition): Promise<TemplateStructureDto> {
    const steps = await this.store.findSteps(m, def.wfDefinitionId);
    if (steps.length > 0) {
      const conns = await this.store.findConnections(m, def.wfDefinitionId);
      return {
        source: 'rows',
        steps: steps.map(toStepDto),
        connections: conns.map(toConnectionDto),
      };
    }
    const parsed = parseTemplateDefinition(def.templateDefinition);
    if (!parsed) return { source: 'none', steps: [], connections: [] };
    return {
      source: 'definition',
      steps: parsed.steps.map((s) => toStepDtoFromDesign(def.wfDefinitionId, s)),
      connections: parsed.connections.map((c) => toConnectionDtoFromDesign(def.wfDefinitionId, c)),
    };
  }

  // ── ตรวจ ─────────────────────────────────────────────────

  /** ตรวจ template: กราฟ (Start/End/ไม่มี step ลอย/เดินถึง End) + ผู้รับผิดชอบของแต่ละ step */
  async validate(m: EntityManager, def: WfDefinition): Promise<TemplateValidation> {
    const rows = await this.store.findSteps(m, def.wfDefinitionId);
    let nodes: GraphNode[];
    let edges: GraphEdge[];
    let assignees: {
      key: number;
      name: string;
      type: WorkflowStepType;
      user: string | null;
      role: string | null;
      org: string | null;
    }[];

    if (rows.length > 0) {
      const conns = await this.store.findConnections(m, def.wfDefinitionId);
      nodes = rows.map((s) => ({
        key: s.wfStepId,
        name: s.stepName,
        type: s.stepType as WorkflowStepType,
        sequence: s.sequenceNumber,
      }));
      edges = conns.map((c) => ({ from: c.fromStepId, to: c.toStepId }));
      assignees = rows.map((s) => ({
        key: s.wfStepId,
        name: s.stepName,
        type: s.stepType as WorkflowStepType,
        user: blankToNull(s.assignedUser),
        role: blankToNull(s.assignedRole),
        org: blankToNull(s.assignedOrgUnit),
      }));
    } else {
      const parsed = parseTemplateDefinition(def.templateDefinition);
      ({ nodes, edges } = parsed ? graphFromDefinition(parsed) : { nodes: [], edges: [] });
      assignees = (parsed?.steps ?? []).map((s) => ({
        key: s.key,
        name: s.stepName,
        type: s.stepType,
        user: s.assignedUser,
        role: null,
        org: null,
      }));
    }

    const issues: TemplateIssue[] = [...validateGraph(nodes, edges).issues] as GraphIssue[];

    const names = assignees.map((a) => a.user).filter((u): u is string => !!u);
    const users = names.length ? await this.directory.findMany(names, m) : new Map();
    for (const a of assignees) {
      if (a.user) {
        const u = users.get(a.user.toLowerCase());
        if (!u?.isActive)
          issues.push({
            severity: 'error',
            code: 'ASSIGNEE_NOT_FOUND',
            stepKey: a.key,
            message: `ขั้นตอน '${a.name}' ระบุผู้รับผิดชอบ '${a.user}' ซึ่งไม่ใช่ผู้ใช้ที่ใช้งานอยู่ในระบบ (กลุ่ม AD ยังไม่รองรับ — ต้องระบุชื่อผู้ใช้)`,
          });
      } else if (a.role || a.org) {
        issues.push({
          severity: 'error',
          code: 'ASSIGNEE_UNSUPPORTED',
          stepKey: a.key,
          message: `ขั้นตอน '${a.name}' ระบุผู้รับผิดชอบเป็นบทบาท/หน่วยงานเท่านั้น ซึ่งระบบยังไม่รองรับ — ต้องระบุชื่อผู้ใช้`,
        });
      } else if (a.type === WorkflowStepType.Approval || a.type === WorkflowStepType.Review) {
        issues.push({
          severity: 'warning',
          code: 'ASSIGNEE_BLANK',
          stepKey: a.key,
          message: `ขั้นตอน '${a.name}' ไม่ได้ระบุผู้รับผิดชอบ — งานจะตกเป็นของผู้ที่ทำขั้นตอนก่อนหน้า`,
        });
      }
    }
    return { valid: !issues.some((i) => i.severity === 'error'), issues };
  }

  async validateById(definitionId: number): Promise<GraphValidationDto> {
    const def = await this.requireDefinition(this.ds.manager, definitionId);
    return this.validate(this.ds.manager, def);
  }

  /** โยน 422 พร้อมรายการปัญหาถ้า template ยังไม่พร้อมส่งอนุมัติ/เผยแพร่ */
  async assertValid(m: EntityManager, def: WfDefinition): Promise<void> {
    const v = await this.validate(m, def);
    if (!v.valid) {
      const errors = v.issues.filter((i) => i.severity === 'error');
      throw new BusinessException(
        `Template ยังไม่พร้อมใช้งาน: ${errors.map((e) => e.message).join('; ')}`,
        'TEMPLATE_GRAPH_INVALID',
        { issues: v.issues },
      );
    }
  }

  // ── สร้างแถวจาก definition / คัดลอก ───────────────────────

  /**
   * สร้างแถว s_WFStep/s_WFConnection จาก TemplateDefinition รูปแบบ designer (พอร์ตจาก SyncStepsFromTemplateDefinition)
   * @param replace true = ลบ (soft) ของเดิมก่อน — ใช้กับ Draft เท่านั้น
   * @returns step ที่มีอยู่หลังสร้าง (ว่างถ้า definition ว่าง/ไม่ใช่รูปแบบ designer)
   */
  async materializeFromDefinition(
    m: EntityManager,
    def: WfDefinition,
    replace: boolean,
  ): Promise<WfStep[]> {
    const parsed = parseTemplateDefinition(def.templateDefinition);
    if (!parsed || parsed.format !== 'designer') return [];
    if (replace) await this.store.softDeleteStructure(m, def.wfDefinitionId);

    const idMap = new Map<number, number>(); // รหัสใน layout → WFStepId
    for (const s of parsed.steps) {
      const id = await this.store.insertStep(m, {
        wfDefinitionId: def.wfDefinitionId,
        stepName: s.stepName.slice(0, 200),
        stepType: s.stepType,
        description: s.description,
        assignedUser: s.assignedUser?.slice(0, 255) ?? null,
        slaDays: s.slaDays,
        allowDelegation: s.allowDelegation,
        sequenceNumber: s.sequenceNumber,
        isDeleted: false,
      });
      idMap.set(s.key, id);
    }
    for (const c of parsed.connections) {
      const from = idMap.get(c.fromKey);
      const to = idMap.get(c.toKey);
      if (from === undefined || to === undefined) continue; // เหมือนเดิม: ข้ามเส้นที่อ้าง step ไม่มี
      await this.store.insertConnection(m, {
        wfDefinitionId: def.wfDefinitionId,
        fromStepId: from,
        toStepId: to,
        conditionExpression: c.condition,
        sequenceNumber: c.sequenceNumber,
        isDeleted: false,
      });
    }
    return this.store.findSteps(m, def.wfDefinitionId);
  }

  /** step ของ template สำหรับสร้าง instance: ใช้แถวที่มี ถ้าไม่มีเลยค่อยสร้างจาก definition (fallback ของระบบเดิม) */
  async ensureStepsForInstance(m: EntityManager, def: WfDefinition): Promise<WfStep[]> {
    const steps = await this.store.findSteps(m, def.wfDefinitionId);
    if (steps.length > 0) return steps;
    if (!def.templateDefinition?.trim()) return [];
    return this.materializeFromDefinition(m, def, false);
  }

  /** คัดลอกแถว step/connection ทั้งชุดจาก template ต้นทางไป template ใหม่ (map รหัสใหม่) — คืนจำนวนที่คัดลอก */
  async cloneStructure(
    m: EntityManager,
    fromDefinitionId: number,
    toDefinitionId: number,
  ): Promise<{ steps: number; connections: number }> {
    const steps = await this.store.findSteps(m, fromDefinitionId);
    const idMap = new Map<number, number>();
    for (const s of steps) {
      const id = await this.store.insertStep(m, {
        wfDefinitionId: toDefinitionId,
        stepName: s.stepName,
        stepType: s.stepType,
        description: s.description ?? null,
        assignedRole: s.assignedRole ?? null,
        assignedUser: s.assignedUser ?? null,
        assignedOrgUnit: s.assignedOrgUnit ?? null,
        slaHours: s.slaHours ?? null,
        slaDays: s.slaDays ?? null,
        allowDelegation: s.allowDelegation ?? false,
        maxDelegationDepth: s.maxDelegationDepth,
        sequenceNumber: s.sequenceNumber,
        stepConfig: s.stepConfig ?? null,
        isDeleted: false,
      });
      idMap.set(s.wfStepId, id);
    }
    let connections = 0;
    for (const c of await this.store.findConnections(m, fromDefinitionId)) {
      const from = idMap.get(c.fromStepId);
      const to = idMap.get(c.toStepId);
      if (from === undefined || to === undefined) continue;
      await this.store.insertConnection(m, {
        wfDefinitionId: toDefinitionId,
        fromStepId: from,
        toStepId: to,
        conditionExpression: c.conditionExpression ?? null,
        sequenceNumber: c.sequenceNumber,
        isDeleted: false,
      });
      connections++;
    }
    return { steps: steps.length, connections };
  }

  // ── เขียน (เฉพาะ template ที่เป็น Draft) ──────────────────

  /** สร้างแถว step/connection ใหม่ทั้งชุดจาก TemplateDefinition (แทนที่ของเดิม) */
  syncFromDefinition(definitionId: number, user: UserContext): Promise<TemplateStructureDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        entity: WFE_ENTITY.template,
        operation: WFE_OP.templateStepsSynced,
        recordId: definitionId,
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          const def = await this.requireEditableStructure(manager, definitionId);
          const steps = await this.materializeFromDefinition(manager, def, true);
          if (steps.length === 0)
            throw new BusinessException(
              'TemplateDefinition ไม่มีผังแบบ designer (Steps) ให้สร้างขั้นตอน',
              'TEMPLATE_DEFINITION_EMPTY',
            );
          await this.touch(manager, definitionId, user);
        });
        const def = await this.requireDefinition(this.ds.manager, definitionId);
        return this.getStructure(this.ds.manager, def);
      },
      (r) => ({ meta: { steps: r.steps.length, connections: r.connections.length } }),
    );
  }

  createStep(definitionId: number, dto: CreateStepDto, user: UserContext): Promise<StepDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: WFE_ENTITY.step,
        operation: WFE_OP.stepCreated,
        meta: { definitionId },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await this.requireEditableStructure(manager, definitionId);
          const existing = await this.store.findSteps(manager, definitionId);
          const seq =
            dto.sequenceNumber ?? existing.reduce((m, s) => Math.max(m, s.sequenceNumber), 0) + 1;
          const id = await this.store.insertStep(manager, {
            wfDefinitionId: definitionId,
            stepName: dto.stepName,
            stepType: dto.stepType,
            description: blankToNull(dto.description),
            assignedRole: blankToNull(dto.assignedRole),
            assignedUser: blankToNull(dto.assignedUser),
            assignedOrgUnit: blankToNull(dto.assignedOrgUnit),
            slaHours: dto.slaHours ?? null,
            slaDays: dto.slaDays ?? null,
            allowDelegation: dto.allowDelegation ?? false,
            maxDelegationDepth: dto.maxDelegationDepth,
            sequenceNumber: seq,
            stepConfig: blankToNull(dto.stepConfig),
            isDeleted: false,
          });
          await this.touch(manager, definitionId, user);
          return toStepDto((await this.store.findStep(manager, id)) as WfStep);
        }),
      (r) => ({ recordId: r.workflowStepId, after: r }),
    );
  }

  updateStep(
    definitionId: number,
    stepId: number,
    dto: UpdateStepDto,
    user: UserContext,
  ): Promise<StepDto> {
    return this.logged(
      {
        action: 'UPDATE',
        entity: WFE_ENTITY.step,
        operation: WFE_OP.stepUpdated,
        recordId: stepId,
        captureBefore: async () => {
          const s = await this.store.findStep(this.ds.manager, stepId);
          return s ? toStepDto(s) : undefined;
        },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await this.requireEditableStructure(manager, definitionId);
          const step = await this.requireStep(manager, definitionId, stepId);
          const patch: Partial<WfStep> = {};
          if (dto.stepName !== undefined) patch.stepName = dto.stepName;
          if (dto.stepType !== undefined) patch.stepType = dto.stepType;
          if (dto.description !== undefined) patch.description = blankToNull(dto.description);
          if (dto.assignedRole !== undefined) patch.assignedRole = blankToNull(dto.assignedRole);
          if (dto.assignedUser !== undefined) patch.assignedUser = blankToNull(dto.assignedUser);
          if (dto.assignedOrgUnit !== undefined)
            patch.assignedOrgUnit = blankToNull(dto.assignedOrgUnit);
          if (dto.slaHours !== undefined) patch.slaHours = dto.slaHours;
          if (dto.slaDays !== undefined) patch.slaDays = dto.slaDays;
          if (dto.allowDelegation !== undefined) patch.allowDelegation = dto.allowDelegation;
          if (dto.maxDelegationDepth !== undefined)
            patch.maxDelegationDepth = dto.maxDelegationDepth;
          if (dto.sequenceNumber !== undefined) patch.sequenceNumber = dto.sequenceNumber;
          if (dto.stepConfig !== undefined) patch.stepConfig = blankToNull(dto.stepConfig);
          if (Object.keys(patch).length === 0)
            throw new BusinessException('ไม่มีข้อมูลที่ต้องแก้ไข', 'NO_CHANGES');
          await this.store.updateStep(manager, step.wfStepId, patch);
          await this.touch(manager, definitionId, user);
          return toStepDto((await this.store.findStep(manager, stepId)) as WfStep);
        }),
      (r) => ({ after: r }),
    );
  }

  deleteStep(definitionId: number, stepId: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        entity: WFE_ENTITY.step,
        operation: WFE_OP.stepDeleted,
        recordId: stepId,
        captureBefore: async () => {
          const s = await this.store.findStep(this.ds.manager, stepId);
          return s ? toStepDto(s) : undefined;
        },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await this.requireEditableStructure(manager, definitionId);
          await this.requireStep(manager, definitionId, stepId);
          if ((await this.store.countStepReferences(manager, stepId)) > 0)
            throw new ConflictBusinessException(
              'ลบขั้นตอนนี้ไม่ได้ เพราะมี instance อ้างอิงอยู่แล้ว',
              'STEP_IN_USE',
            );
          // เส้นเชื่อมที่เข้า/ออกจาก step นี้ไปด้วย (soft delete)
          for (const c of await this.store.findConnections(manager, definitionId)) {
            if (c.fromStepId === stepId || c.toStepId === stepId)
              await this.store.softDeleteConnection(manager, c.wfConnectionId);
          }
          await this.store.softDeleteStep(manager, stepId);
          await this.touch(manager, definitionId, user);
        }),
    );
  }

  createConnection(
    definitionId: number,
    dto: CreateConnectionDto,
    user: UserContext,
  ): Promise<ConnectionDto> {
    return this.logged(
      {
        action: 'CREATE',
        entity: WFE_ENTITY.connection,
        operation: WFE_OP.connectionCreated,
        meta: { definitionId },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await this.requireEditableStructure(manager, definitionId);
          await this.assertConnectionEnds(manager, definitionId, dto.fromStepId, dto.toStepId);
          const existing = await this.store.findConnections(manager, definitionId);
          if (existing.some((c) => c.fromStepId === dto.fromStepId && c.toStepId === dto.toStepId))
            throw new ConflictBusinessException('มีเส้นเชื่อมนี้อยู่แล้ว', 'CONNECTION_DUPLICATE');
          const seq =
            dto.sequenceNumber ?? existing.reduce((m, c) => Math.max(m, c.sequenceNumber), 0) + 1;
          const id = await this.store.insertConnection(manager, {
            wfDefinitionId: definitionId,
            fromStepId: dto.fromStepId,
            toStepId: dto.toStepId,
            conditionExpression: blankToNull(dto.conditionExpression),
            sequenceNumber: seq,
            isDeleted: false,
          });
          await this.touch(manager, definitionId, user);
          return toConnectionDto((await this.store.findConnection(manager, id)) as WfConnection);
        }),
      (r) => ({ recordId: r.workflowConnectionId, after: r }),
    );
  }

  updateConnection(
    definitionId: number,
    connectionId: number,
    dto: UpdateConnectionDto,
    user: UserContext,
  ): Promise<ConnectionDto> {
    return this.logged(
      {
        action: 'UPDATE',
        entity: WFE_ENTITY.connection,
        operation: WFE_OP.connectionUpdated,
        recordId: connectionId,
        captureBefore: async () => {
          const c = await this.store.findConnection(this.ds.manager, connectionId);
          return c ? toConnectionDto(c) : undefined;
        },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await this.requireEditableStructure(manager, definitionId);
          const conn = await this.store.findConnection(manager, connectionId);
          if (!conn || conn.wfDefinitionId !== definitionId)
            throw new ResourceNotFoundException('Connection', connectionId);
          const from = dto.fromStepId ?? conn.fromStepId;
          const to = dto.toStepId ?? conn.toStepId;
          if (from !== conn.fromStepId || to !== conn.toStepId)
            await this.assertConnectionEnds(manager, definitionId, from, to);
          const patch: Partial<WfConnection> = {};
          if (dto.fromStepId !== undefined) patch.fromStepId = dto.fromStepId;
          if (dto.toStepId !== undefined) patch.toStepId = dto.toStepId;
          if (dto.conditionExpression !== undefined)
            patch.conditionExpression = blankToNull(dto.conditionExpression);
          if (dto.sequenceNumber !== undefined) patch.sequenceNumber = dto.sequenceNumber;
          if (Object.keys(patch).length === 0)
            throw new BusinessException('ไม่มีข้อมูลที่ต้องแก้ไข', 'NO_CHANGES');
          await this.store.updateConnection(manager, connectionId, patch);
          await this.touch(manager, definitionId, user);
          return toConnectionDto(
            (await this.store.findConnection(manager, connectionId)) as WfConnection,
          );
        }),
      (r) => ({ after: r }),
    );
  }

  deleteConnection(definitionId: number, connectionId: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        entity: WFE_ENTITY.connection,
        operation: WFE_OP.connectionDeleted,
        recordId: connectionId,
        captureBefore: async () => {
          const c = await this.store.findConnection(this.ds.manager, connectionId);
          return c ? toConnectionDto(c) : undefined;
        },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await this.requireEditableStructure(manager, definitionId);
          const conn = await this.store.findConnection(manager, connectionId);
          if (!conn || conn.wfDefinitionId !== definitionId)
            throw new ResourceNotFoundException('Connection', connectionId);
          await this.store.softDeleteConnection(manager, connectionId);
          await this.touch(manager, definitionId, user);
        }),
    );
  }

  // ── ภายใน ────────────────────────────────────────────────

  private async requireDefinition(m: EntityManager, id: number): Promise<WfDefinition> {
    const def = await this.store.findDefinition(m, id);
    if (!def) throw new ResourceNotFoundException('Template', id);
    return def;
  }

  private async requireEditableStructure(m: EntityManager, id: number): Promise<WfDefinition> {
    const def = await this.requireDefinition(m, id);
    if (!isStructureEditable((def.approvalStatus ?? 0) as WorkflowTemplateStatus))
      throw new BusinessException(
        'แก้ขั้นตอน/เส้นเชื่อมได้เฉพาะ Template ที่เป็น Draft (Template ที่ใช้งานแล้วให้คัดลอกเป็น Draft ใหม่)',
        'TEMPLATE_STRUCTURE_LOCKED',
      );
    return def;
  }

  private async requireStep(
    m: EntityManager,
    definitionId: number,
    stepId: number,
  ): Promise<WfStep> {
    const step = await this.store.findStep(m, stepId);
    if (!step || step.wfDefinitionId !== definitionId)
      throw new ResourceNotFoundException('Step', stepId);
    return step;
  }

  private async assertConnectionEnds(
    m: EntityManager,
    definitionId: number,
    fromStepId: number,
    toStepId: number,
  ): Promise<void> {
    if (fromStepId === toStepId)
      throw new BusinessException('เส้นเชื่อมต้องไม่วนกลับหาขั้นตอนเดิม', 'CONNECTION_SELF_LOOP');
    for (const id of [fromStepId, toStepId]) {
      const s = await this.store.findStep(m, id);
      if (!s || s.wfDefinitionId !== definitionId)
        throw new BusinessException(
          `ไม่พบขั้นตอน ${id} ใน Template นี้`,
          'CONNECTION_STEP_NOT_FOUND',
        );
    }
  }

  private async touch(m: EntityManager, definitionId: number, user: UserContext): Promise<void> {
    await this.store.updateDefinition(m, definitionId, { modifiedBy: user.adUserName });
  }
}
