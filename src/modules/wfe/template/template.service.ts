import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { WorkflowTemplateStatus } from '../../../common/constants/enums';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
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
import type { WfDefinition } from '../entities/wf-definition.entity';
import type {
  CopyTemplateDto,
  CreateTemplateDto,
  DisableTemplateDto,
  ImportTemplateDto,
  RejectTemplateDto,
  TemplateDetailDto,
  TemplateExportDto,
  TemplateListQueryDto,
  TemplateSummaryDto,
  TemplateVersionDto,
  UpdateTemplateDto,
} from './dto/template.dto';
import { checkTemplateDefinitionJson } from './template-definition';
import {
  isTemplateEditable,
  nextTemplateState,
  templateIsActiveFor,
  transitionErrorMessage,
  type TemplateAction,
} from './template-status';
import { toSummary, toSummaryFromRow, toVersion } from './template.mapper';
import { TemplateStore } from './template.store';
import { TemplateStructureService } from './template-structure.service';

/**
 * Template ของ workflow (WFE.s_WFDefinition) — พอร์ตจาก WorkflowTemplateService
 *
 * วงจร: Draft → SubmitForApproval → PendingApproval → Approve → Active · Reject กลับ Draft · Publish ตรง · Deactivate · Deprecate
 * `IsActive` คู่กับสถานะเสมอ (true เฉพาะ Active) · ลบไม่ได้ถ้ายังมี instance ที่ทำงานอยู่ (ตรวจเอง)
 */
@Injectable()
export class WorkflowTemplatesService extends CrudLoggedService {
  protected readonly logModule = 'WFE' as const;
  protected readonly logEntity = WFE_ENTITY.template;

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly tx: TransactionRunner,
    private readonly store: TemplateStore,
    private readonly structure: TemplateStructureService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ─────────────────────────────────────────────────

  async list(q: TemplateListQueryDto): Promise<Paginated<TemplateSummaryDto>> {
    const { rows, total } = await this.store.listDefinitions(this.ds.manager, {
      q: q.q,
      approvalStatus: q.approvalStatus,
      isActive: q.isActive,
      category: q.category,
      createdBy: q.createdBy,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
      page: q.page,
      pageSize: q.pageSize,
    });
    return paginated(rows.map(toSummaryFromRow), total, q);
  }

  async get(id: number): Promise<TemplateDetailDto> {
    return this.detail(this.ds.manager, await this.require(this.ds.manager, id));
  }

  /** ระบบเดิมเก็บเวอร์ชันเป็นเลขที่เพิ่มทุกครั้งที่แก้ใน "แถวเดียว" ของ template — จึงได้ผลลัพธ์ 1 รายการเสมอ */
  async versions(id: number): Promise<TemplateVersionDto[]> {
    return [toVersion(await this.require(this.ds.manager, id))];
  }

  // ── สร้าง / แก้ / ลบ ─────────────────────────────────────

  create(dto: CreateTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: WFE_OP.templateCreated,
        meta: { name: dto.name },
      },
      () => this.createDraft(dto, user),
      (r) => ({ recordId: r.workflowDefinitionId, after: toLogSummary(r) }),
    );
  }

  update(id: number, dto: UpdateTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: WFE_OP.templateUpdated,
        recordId: id,
        meta: { changeDescription: dto.changeDescription },
        captureBefore: async () => {
          const d = await this.store.findDefinition(this.ds.manager, id);
          return d ? toSummary(d) : undefined;
        },
      },
      async () => {
        this.assertDefinitionJson(dto.templateDefinition);
        await this.tx.run(async ({ manager }) => {
          const def = await this.require(manager, id);
          const status = (def.approvalStatus ?? 0) as WorkflowTemplateStatus;
          if (!isTemplateEditable(status))
            throw new BusinessException(
              status === WorkflowTemplateStatus.PendingApproval
                ? 'Template กำลังรออนุมัติ แก้ไขไม่ได้ (ให้ผู้อนุมัติปฏิเสธเพื่อส่งกลับเป็น Draft ก่อน)'
                : 'Template ที่ยกเลิกเวอร์ชัน (Deprecated) แล้วแก้ไขไม่ได้',
              'TEMPLATE_NOT_EDITABLE',
            );
          const patch: Partial<WfDefinition> = {};
          if (dto.name !== undefined) patch.wfName = dto.name;
          if (dto.description !== undefined) patch.wfDescription = dto.description;
          if (dto.category !== undefined) patch.category = dto.category;
          if (dto.templateDefinition !== undefined)
            patch.templateDefinition = dto.templateDefinition;
          if (Object.keys(patch).length === 0)
            throw new BusinessException('ไม่มีข้อมูลที่ต้องแก้ไข', 'NO_CHANGES');

          const affected = await this.store.updateDefinition(
            manager,
            id,
            {
              ...patch,
              version: (def.version ?? 1) + 1, // ระบบเดิมเพิ่ม Version ทุกครั้งที่แก้
              isActive: templateIsActiveFor(status), // ให้ IsActive คู่กับสถานะเสมอ
              modifiedBy: user.adUserName,
            },
            status,
          );
          if (affected === 0) throw this.statusChanged();

          // Draft ไม่มี instance → ผังใน s_WFStep/s_WFConnection ต้องตรงกับ definition ที่เพิ่งบันทึก
          // (Active/Inactive มี instance อ้างอิงแถวเดิมอยู่ จึงไม่แตะ — ดู docs/modules/wfe.md)
          if (dto.templateDefinition !== undefined && status === WorkflowTemplateStatus.Draft) {
            const updated = await this.require(manager, id);
            await this.structure.materializeFromDefinition(manager, updated, true);
          }
        });
        return this.get(id);
      },
      (r) => ({ after: toLogSummary(r) }),
    );
  }

  remove(id: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: WFE_OP.templateDeleted,
        recordId: id,
        captureBefore: async () => {
          const d = await this.store.findDefinition(this.ds.manager, id);
          return d ? toSummary(d) : undefined;
        },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await this.require(manager, id);
          const open = await this.store.countOpenInstances(manager, id);
          if (open > 0)
            throw new ConflictBusinessException(
              `ลบ Template ไม่ได้ เพราะยังมี workflow ที่ทำงานอยู่ ${open} รายการ`,
              'TEMPLATE_HAS_ACTIVE_INSTANCES',
              { activeInstances: open },
            );
          const affected = await this.store.softDeleteDefinition(manager, id, user.adUserName);
          if (affected === 0) throw this.statusChanged();
        }),
    );
  }

  /** คัดลอก template เป็น Draft ใหม่ (ย้ายการอ่าน step/connection ตรงใน WorkflowCreateTemplateForm เข้ามาไว้ที่นี่) */
  copy(id: number, dto: CopyTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: WFE_OP.templateDuplicated,
        meta: { copiedFrom: id },
      },
      async () => {
        const newId = await this.tx.run(async ({ manager }) => {
          const src = await this.require(manager, id);
          const name = (dto.name ?? `${src.wfName} (Copy)`).slice(0, 200);
          const created = await this.store.insertDefinition(manager, {
            wfName: name,
            wfDescription: src.wfDescription ?? null,
            category: src.category ?? null,
            templateDefinition: src.templateDefinition ?? null,
            version: 1,
            isActive: false,
            approvalStatus: WorkflowTemplateStatus.Draft,
            createdBy: user.adUserName,
            isDeleted: false,
          });
          const cloned = await this.structure.cloneStructure(manager, id, created);
          if (cloned.steps === 0) {
            // ต้นทางยังไม่มีแถว (ผังอยู่ใน JSON อย่างเดียว) → สร้างแถวจาก JSON ให้ฉบับคัดลอก
            await this.structure.materializeFromDefinition(
              manager,
              await this.require(manager, created),
              false,
            );
          }
          return created;
        });
        return this.get(newId);
      },
      (r) => ({ recordId: r.workflowDefinitionId, after: toLogSummary(r) }),
    );
  }

  /** ส่งออก template เป็น JSON (ย้ายจาก WorkflowTemplateListPresenter.ExportTemplate ที่เขียนไฟล์ฝั่ง client) */
  export(id: number): Promise<TemplateExportDto> {
    return this.logged(
      { action: 'READ', operation: WFE_OP.templateExported, recordId: id },
      async () => {
        const d = await this.require(this.ds.manager, id);
        return {
          name: d.wfName,
          description: d.wfDescription ?? null,
          category: d.category ?? null,
          version: d.version ?? 1,
          isActive: Boolean(d.isActive),
          approvalStatus: (d.approvalStatus ?? 0) as WorkflowTemplateStatus,
          templateDefinition: d.templateDefinition ?? null,
        };
      },
    );
  }

  /** นำเข้า template จากไฟล์ export — สร้างเป็น Draft ชื่อ "<ชื่อ> (Imported)" (พฤติกรรมเดิม) */
  import(dto: ImportTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.logged(
      { action: 'CREATE', operation: WFE_OP.templateImported, meta: { name: dto.name } },
      () =>
        this.createDraft(
          {
            name: `${dto.name} (Imported)`.slice(0, 200),
            description: dto.description ?? 'Imported from file',
            category: dto.category,
            templateDefinition: dto.templateDefinition ?? '{}',
          },
          user,
        ),
      (r) => ({ recordId: r.workflowDefinitionId, after: toLogSummary(r) }),
    );
  }

  // ── วงจรสถานะ ────────────────────────────────────────────

  submitForApproval(id: number, user: UserContext): Promise<TemplateDetailDto> {
    return this.transition(id, 'SUBMIT', WFE_OP.templateSubmitted, user, {
      validate: true,
      patch: () => ({
        submittedBy: user.adUserName,
        submittedDate: new Date(),
        rejectionReason: null,
      }),
    });
  }

  approve(id: number, user: UserContext): Promise<TemplateDetailDto> {
    return this.transition(id, 'APPROVE', WFE_OP.templateApproved, user, {
      validate: true,
      patch: () => ({
        approvedBy: user.adUserName,
        approvedDate: new Date(),
        ...clearDisabled(),
      }),
    });
  }

  reject(id: number, dto: RejectTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.transition(id, 'REJECT', WFE_OP.templateRejected, user, {
      meta: { reason: dto.reason },
      // เหมือนระบบเดิม: บันทึกผู้ปฏิเสธ/เวลาไว้ในช่อง Approved* ด้วย
      patch: () => ({
        rejectionReason: dto.reason,
        approvedBy: user.adUserName,
        approvedDate: new Date(),
      }),
    });
  }

  publish(id: number, user: UserContext): Promise<TemplateDetailDto> {
    return this.transition(id, 'PUBLISH', WFE_OP.templatePublished, user, {
      validate: true,
      patch: () => clearDisabled(),
    });
  }

  deactivate(id: number, dto: DisableTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.transition(id, 'DEACTIVATE', WFE_OP.templateDeactivated, user, {
      meta: { reason: dto.reason },
      patch: () => disabledBy(user, dto.reason),
    });
  }

  deprecate(id: number, dto: DisableTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.transition(id, 'DEPRECATE', WFE_OP.templateDeprecated, user, {
      meta: { reason: dto.reason },
      patch: () => disabledBy(user, dto.reason),
    });
  }

  // ── ภายใน ────────────────────────────────────────────────

  private transition(
    id: number,
    action: TemplateAction,
    operation: string,
    user: UserContext,
    opts: {
      validate?: boolean;
      meta?: Record<string, unknown>;
      patch: () => Partial<WfDefinition>;
    },
  ): Promise<TemplateDetailDto> {
    return this.logged(
      {
        action: 'EXECUTE',
        operation,
        recordId: id,
        meta: opts.meta,
        captureBefore: async () => {
          const d = await this.store.findDefinition(this.ds.manager, id);
          return d ? toSummary(d) : undefined;
        },
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          const def = await this.require(manager, id);
          const current = (def.approvalStatus ?? 0) as WorkflowTemplateStatus;
          const next = nextTemplateState(current, action);
          if (!next)
            throw new BusinessException(
              transitionErrorMessage(current, action),
              'TEMPLATE_INVALID_TRANSITION',
              { current, action },
            );
          if (opts.validate) await this.structure.assertValid(manager, def);
          const affected = await this.store.updateDefinition(
            manager,
            id,
            {
              ...opts.patch(),
              approvalStatus: next.approvalStatus,
              isActive: next.isActive,
              modifiedBy: user.adUserName,
            },
            current, // เปลี่ยนเฉพาะเมื่อสถานะยังเป็นค่าที่อ่านมา (กันกดพร้อมกัน)
          );
          if (affected === 0) throw this.statusChanged();
        });
        return this.get(id);
      },
      (r) => ({ after: toLogSummary(r) }),
    );
  }

  private async createDraft(dto: CreateTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    this.assertDefinitionJson(dto.templateDefinition);
    const id = await this.tx.run(async ({ manager }) => {
      const newId = await this.store.insertDefinition(manager, {
        wfName: dto.name,
        wfDescription: dto.description ?? null,
        category: dto.category ?? null,
        templateDefinition: dto.templateDefinition ?? null,
        version: 1,
        // ระบบเดิมรับ IsActive จาก client (หน้าจอบางหน้าส่ง true ทั้งที่เป็น Draft) — API บังคับให้คู่กับสถานะ
        isActive: false,
        approvalStatus: WorkflowTemplateStatus.Draft,
        createdBy: user.adUserName,
        isDeleted: false,
      });
      if (dto.templateDefinition) {
        await this.structure.materializeFromDefinition(
          manager,
          await this.require(manager, newId),
          false,
        );
      }
      return newId;
    });
    return this.get(id);
  }

  private async detail(m: EntityManager, def: WfDefinition): Promise<TemplateDetailDto> {
    const [counts, structure, validation] = await Promise.all([
      this.store.counts(m, def.wfDefinitionId),
      this.structure.getStructure(m, def),
      this.structure.validate(m, def),
    ]);
    return {
      ...toSummary(def, counts),
      templateDefinition: def.templateDefinition ?? null,
      structure,
      validation,
    };
  }

  private async require(m: EntityManager, id: number): Promise<WfDefinition> {
    const def = await this.store.findDefinition(m, id);
    if (!def) throw new ResourceNotFoundException('Template', id);
    return def;
  }

  private assertDefinitionJson(raw: string | undefined): void {
    const problem = checkTemplateDefinitionJson(raw);
    if (problem) throw new BusinessException(problem, 'TEMPLATE_DEFINITION_INVALID');
  }

  private statusChanged(): ConflictBusinessException {
    return new ConflictBusinessException(
      'สถานะของ Template เปลี่ยนไปแล้วโดยผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่',
      'TEMPLATE_STATE_CHANGED',
    );
  }
}

/** ย่อผลลัพธ์สำหรับ CRUD-log (ไม่เก็บ TemplateDefinition/โครงสร้างทั้งก้อน) */
function toLogSummary(r: TemplateDetailDto): Omit<TemplateSummaryDto, never> {
  const { templateDefinition: _d, structure: _s, validation: _v, ...rest } = r;
  return rest;
}

function clearDisabled(): Partial<WfDefinition> {
  return { disabledBy: null, disabledDate: null, disabledReason: null };
}

function disabledBy(user: UserContext, reason: string | undefined): Partial<WfDefinition> {
  return { disabledBy: user.adUserName, disabledDate: new Date(), disabledReason: reason ?? null };
}
