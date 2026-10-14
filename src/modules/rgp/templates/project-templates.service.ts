import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import {
  BusinessException,
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { NOW_SQL } from '../common/project-ops';
import { rgpActor } from '../common/rgp-actor';
import { fromYesNo, nextSeqNo, toYesNo } from '../common/rgp-rules';
import { MasterDocument } from '../entities/master-document.entity';
import { Project } from '../entities/project.entity';
import { ProjectState } from '../entities/project-state.entity';
import { ProjectTemplate } from '../entities/project-template.entity';
import { TemplateDoc } from '../entities/template-doc.entity';
import { TemplateState } from '../entities/template-state.entity';
import type {
  BlueprintDocDto,
  CreateTemplateDocDto,
  CreateTemplateDto,
  CreateTemplateStateDto,
  TemplateBlueprintDto,
  TemplateDetailDto,
  TemplateDocDto,
  TemplateListItemDto,
  TemplateStateDto,
  UpdateTemplateDocDto,
  UpdateTemplateDto,
  UpdateTemplateStateDto,
} from './dto/template.dto';

const TEMPLATE_LIST_SQL = `
SELECT t.i_template_id AS templateId,
       t.c_template_code AS code,
       t.n_template_name AS name,
       t.c_description AS description,
       t.f_active AS active,
       ISNULL(t.f_is_legal_dict, 'N') AS isLegalDict,
       t.d_create_date AS createDate,
       (SELECT COUNT(*) FROM RGP.m_template_state s WHERE s.i_template_id = t.i_template_id) AS stateCount,
       (SELECT COUNT(*) FROM RGP.t_project p WHERE p.i_template_id = t.i_template_id) AS projectCount
FROM RGP.m_project_template t
WHERE (@0 = 0 OR t.f_active = 'Y')
ORDER BY t.n_template_name`;

type TemplateListRow = Omit<TemplateListItemDto, 'active' | 'isLegalDict'> & {
  active: string;
  isLegalDict: string;
};

/**
 * Template ประเภทโครงการ (`m_project_template`), ขั้นตอน (`m_template_state`) และเอกสาร (`m_template_doc`)
 * พอร์ตจาก ProjectTemplateRepository / TemplateDocRepository — เขียนได้เฉพาะ Manager ขึ้นไป (บังคับที่ controller)
 *
 * ต่างจากเดิม: ลบ template / คัดลอกขั้นตอน ทำใน transaction เดียว (เดิมลบทีละคำสั่ง ล้มกลางทางแล้วข้อมูลค้าง)
 * และตรวจว่าขั้นตอนของ template ยังถูกโครงการอ้างอิงอยู่หรือไม่ก่อนลบ (เดิมชน FK แล้ว error ดิบ)
 */
@Injectable()
export class ProjectTemplatesService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectTemplate';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ProjectTemplate) private readonly repo: Repository<ProjectTemplate>,
    @InjectRepository(TemplateState) private readonly stateRepo: Repository<TemplateState>,
    @InjectRepository(TemplateDoc) private readonly docRepo: Repository<TemplateDoc>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(MasterDocument, 'project')
    private readonly masters: Repository<MasterDocument>,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  async list(activeOnly = false): Promise<TemplateListItemDto[]> {
    const rows: TemplateListRow[] = await this.ds.query(TEMPLATE_LIST_SQL, [activeOnly ? 1 : 0]);
    return rows.map((r) => ({
      ...r,
      active: fromYesNo(r.active),
      isLegalDict: fromYesNo(r.isLegalDict),
      stateCount: Number(r.stateCount),
      projectCount: Number(r.projectCount),
    }));
  }

  async get(templateId: number): Promise<TemplateDetailDto> {
    const t = await this.repo.findOneBy({ templateId });
    if (!t) throw new ResourceNotFoundException('Template', templateId);
    const states = await this.stateRepo.find({ where: { templateId }, order: { seqNo: 'ASC' } });
    const docs = await this.docRepo.findBy({ templateId });
    const projectCount = await this.projects.countBy({ templateId });
    return {
      templateId: t.templateId,
      code: t.templateCode,
      name: t.templateName,
      description: t.description ?? null,
      active: fromYesNo(t.active),
      isLegalDict: fromYesNo(t.isLegalDict),
      createDate: t.createDate as Date,
      stateCount: states.length,
      projectCount,
      states: states.map((s) => toStateDto(s, docs.filter((d) => d.stateId === s.stateId).length)),
      docs: sortDocs(docs, states).map(toDocDto),
    };
  }

  async listStates(templateId: number): Promise<TemplateStateDto[]> {
    await this.requireTemplate(templateId);
    const states = await this.stateRepo.find({ where: { templateId }, order: { seqNo: 'ASC' } });
    const docs = await this.docRepo.findBy({ templateId });
    return states.map((s) => toStateDto(s, docs.filter((d) => d.stateId === s.stateId).length));
  }

  async listDocsByState(stateId: number): Promise<TemplateDocDto[]> {
    if (!(await this.stateRepo.existsBy({ stateId }))) {
      throw new ResourceNotFoundException('ขั้นตอนของ Template', stateId);
    }
    const docs = await this.docRepo.find({ where: { stateId }, order: { seqNo: 'ASC' } });
    return docs.map(toDocDto);
  }

  /**
   * ขั้นตอน+เอกสารของ template ในรูปแบบเดียวกับ states/documents ของ POST /rgp/projects
   * (แทนการ "stage ไว้ในหน่วยความจำแล้วให้ผู้ใช้แก้ก่อนบันทึก" ของโปรแกรมเดิม)
   */
  async blueprint(templateId: number): Promise<TemplateBlueprintDto> {
    const t = await this.requireTemplate(templateId);
    const states = await this.stateRepo.find({ where: { templateId }, order: { seqNo: 'ASC' } });
    const docs = await this.docRepo.findBy({ templateId });
    const indexByState = new Map(states.map((s, i) => [s.stateId, i]));
    const documents: BlueprintDocDto[] = sortDocs(docs, states)
      .filter((d) => indexByState.has(d.stateId))
      .map((d) => ({
        stateIndex: indexByState.get(d.stateId) as number,
        masterDocId: d.docId,
        name: d.docName,
        docType: d.docType ?? null,
        required: fromYesNo(d.required),
        remark: d.remark ?? null,
      }));
    return {
      templateId,
      isLegalDict: fromYesNo(t.isLegalDict),
      states: states.map((s) => ({
        templateStateId: s.stateId,
        name: s.stateName,
        seqNo: s.seqNo,
        description: s.description ?? null,
        required: fromYesNo(s.required),
      })),
      documents,
    };
  }

  // ── Template ───────────────────────────────────────────────

  create(dto: CreateTemplateDto, user: UserContext): Promise<TemplateDetailDto> {
    return this.logged(
      { action: 'CREATE', operation: 'CREATE_PROJECT_TEMPLATE' },
      async () => {
        const code = dto.code.trim();
        await this.assertCodeFree(code);
        const saved = await this.repo.save({
          templateCode: code,
          templateName: dto.name.trim(),
          description: blankToNull(dto.description),
          active: 'Y',
          isLegalDict: toYesNo(dto.isLegalDict, 'N'),
          createUser: rgpActor(user),
        });
        return this.get(saved.templateId);
      },
      (t) => ({ recordId: t.templateId, after: { templateId: t.templateId, code: t.code } }),
    );
  }

  update(
    templateId: number,
    dto: UpdateTemplateDto,
    user: UserContext,
  ): Promise<TemplateDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_PROJECT_TEMPLATE',
        recordId: templateId,
        captureBefore: () => this.get(templateId),
      },
      async () => {
        await this.requireTemplate(templateId);
        if (dto.code !== undefined) await this.assertCodeFree(dto.code.trim(), templateId);
        await this.repo.update(
          { templateId },
          {
            ...(dto.code !== undefined ? { templateCode: dto.code.trim() } : {}),
            ...(dto.name !== undefined ? { templateName: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: blankToNull(dto.description) } : {}),
            ...(dto.active !== undefined ? { active: toYesNo(dto.active) } : {}),
            ...(dto.isLegalDict !== undefined ? { isLegalDict: toYesNo(dto.isLegalDict) } : {}),
            updateUser: rgpActor(user),
            updateDate: NOW_SQL,
          },
        );
        return this.get(templateId);
      },
      (t) => ({ after: { templateId: t.templateId, code: t.code, active: t.active } }),
    );
  }

  /** ลบ template พร้อมขั้นตอนและเอกสารของมัน — ลบไม่ได้ถ้ายังมีโครงการ (แม้ถูกลบแบบ soft) ใช้อยู่ */
  remove(templateId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_PROJECT_TEMPLATE',
        recordId: templateId,
        captureBefore: () => this.get(templateId),
      },
      () =>
        this.tx.run(async ({ manager }) => {
          const t = await manager.findOneBy(ProjectTemplate, { templateId });
          if (!t) throw new ResourceNotFoundException('Template', templateId);

          const projectCount = await manager.countBy(Project, { templateId });
          if (projectCount > 0) {
            throw new ConflictBusinessException(
              `ไม่สามารถลบได้ มีโครงการที่ใช้งาน Template นี้อยู่ ${projectCount} รายการ`,
              'TEMPLATE_IN_USE',
              { projectCount },
            );
          }
          const states = await manager.findBy(TemplateState, { templateId });
          await this.assertStatesUnreferenced(
            manager,
            states.map((s) => s.stateId),
          );

          // ลบลูกก่อน: เอกสาร → ขั้นตอน → template
          await manager.delete(TemplateDoc, { templateId });
          await manager.delete(TemplateState, { templateId });
          await manager.delete(ProjectTemplate, { templateId });
        }),
    );
  }

  /** แทนที่ขั้นตอนของ template ปลายทางด้วยสำเนาขั้นตอนจากต้นทาง (เอกสารของปลายทางถูกลบ ต้นทางไม่ถูกคัดลอกเอกสาร) */
  copyStatesFrom(targetId: number, sourceId: number, user: UserContext): Promise<number> {
    return this.logged(
      {
        action: 'EXECUTE',
        operation: 'COPY_TEMPLATE_STATES',
        recordId: targetId,
        meta: { sourceId },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          if (targetId === sourceId) {
            throw new BusinessException(
              'ต้นทางและปลายทางเป็น Template เดียวกัน',
              'COPY_SAME_TEMPLATE',
            );
          }
          if (!(await manager.existsBy(ProjectTemplate, { templateId: targetId }))) {
            throw new ResourceNotFoundException('Template ปลายทาง', targetId);
          }
          if (!(await manager.existsBy(ProjectTemplate, { templateId: sourceId }))) {
            throw new ResourceNotFoundException('Template ต้นทาง', sourceId);
          }
          const oldStates = await manager.findBy(TemplateState, { templateId: targetId });
          await this.assertStatesUnreferenced(
            manager,
            oldStates.map((s) => s.stateId),
          );
          await manager.delete(TemplateDoc, { templateId: targetId });
          await manager.delete(TemplateState, { templateId: targetId });

          const source = await manager.find(TemplateState, {
            where: { templateId: sourceId },
            order: { seqNo: 'ASC' },
          });
          for (const s of source) {
            await manager.save(TemplateState, {
              templateId: targetId,
              stateName: s.stateName,
              seqNo: s.seqNo,
              description: s.description ?? null,
              required: s.required ?? 'Y',
              createUser: rgpActor(user),
            });
          }
          return source.length;
        }),
      (count) => ({ after: { copiedStates: count } }),
    );
  }

  // ── ขั้นตอนของ template ────────────────────────────────────

  createState(
    templateId: number,
    dto: CreateTemplateStateDto,
    user: UserContext,
  ): Promise<TemplateStateDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'CREATE_TEMPLATE_STATE',
        entity: 'TemplateState',
        meta: { templateId },
      },
      () =>
        this.tx.run(async ({ manager }) => {
          if (!(await manager.existsBy(ProjectTemplate, { templateId }))) {
            throw new ResourceNotFoundException('Template', templateId);
          }
          const existing = await manager.findBy(TemplateState, { templateId });
          const saved = await manager.save(TemplateState, {
            templateId,
            stateName: dto.name.trim(),
            seqNo: dto.seqNo ?? nextSeqNo(existing.map((s) => s.seqNo)),
            description: blankToNull(dto.description),
            required: toYesNo(dto.required),
            createUser: rgpActor(user),
          });
          return toStateDto(saved, 0);
        }),
      (s) => ({ recordId: s.stateId, after: s }),
    );
  }

  updateState(stateId: number, dto: UpdateTemplateStateDto): Promise<TemplateStateDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_TEMPLATE_STATE',
        entity: 'TemplateState',
        recordId: stateId,
        captureBefore: () => this.stateRepo.findOneBy({ stateId }),
      },
      async () => {
        const state = await this.requireTemplateState(stateId);
        await this.stateRepo.update(
          { stateId },
          {
            ...(dto.name !== undefined ? { stateName: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: blankToNull(dto.description) } : {}),
            ...(dto.required !== undefined ? { required: toYesNo(dto.required) } : {}),
            ...(dto.seqNo !== undefined ? { seqNo: dto.seqNo } : {}),
          },
        );
        const fresh = await this.requireTemplateState(stateId);
        const docCount = await this.docRepo.countBy({ stateId: state.stateId });
        return toStateDto(fresh, docCount);
      },
      (s) => ({ after: s }),
    );
  }

  /** ลบขั้นตอนของ template — ลบไม่ได้ถ้ามีเอกสารผูกอยู่ หรือโครงการอ้างอิงอยู่ */
  removeState(stateId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_TEMPLATE_STATE',
        entity: 'TemplateState',
        recordId: stateId,
        captureBefore: () => this.stateRepo.findOneBy({ stateId }),
      },
      () =>
        this.tx.run(async ({ manager }) => {
          if (!(await manager.existsBy(TemplateState, { stateId }))) {
            throw new ResourceNotFoundException('ขั้นตอนของ Template', stateId);
          }
          const docCount = await manager.countBy(TemplateDoc, { stateId });
          if (docCount > 0) {
            throw new ConflictBusinessException(
              `ไม่สามารถลบได้ ขั้นตอนนี้มีเอกสาร ${docCount} รายการผูกอยู่ กรุณาลบเอกสารออกก่อน`,
              'TEMPLATE_STATE_HAS_DOCS',
              { docCount },
            );
          }
          await this.assertStatesUnreferenced(manager, [stateId]);
          await manager.delete(TemplateState, { stateId });
        }),
    );
  }

  // ── เอกสารของ template ─────────────────────────────────────

  createDoc(
    stateId: number,
    dto: CreateTemplateDocDto,
    user: UserContext,
  ): Promise<TemplateDocDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'CREATE_TEMPLATE_DOC',
        entity: 'TemplateDoc',
        meta: { stateId },
      },
      async () => {
        const state = await this.requireTemplateState(stateId);
        const master = await this.requireMasterDoc(dto.masterDocId);
        return this.tx.run(async ({ manager }) => {
          await this.assertDocFree(manager, stateId, dto.masterDocId);
          const existing = await manager.findBy(TemplateDoc, { stateId });
          const saved = await manager.save(TemplateDoc, {
            templateId: state.templateId,
            stateId,
            docId: master.docId,
            docName: master.docName ?? '',
            docType: master.docCode ?? null,
            required: toYesNo(dto.required),
            seqNo: dto.seqNo ?? nextSeqNo(existing.map((d) => d.seqNo)),
            remark: blankToNull(dto.remark),
            createUser: rgpActor(user),
          });
          return toDocDto(saved);
        });
      },
      (d) => ({ recordId: d.templateDocId, after: d }),
    );
  }

  updateDoc(
    templateDocId: number,
    dto: UpdateTemplateDocDto,
    user: UserContext,
  ): Promise<TemplateDocDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_TEMPLATE_DOC',
        entity: 'TemplateDoc',
        recordId: templateDocId,
        captureBefore: () => this.docRepo.findOneBy({ templateDocId }),
      },
      async () => {
        const doc = await this.docRepo.findOneBy({ templateDocId });
        if (!doc) throw new ResourceNotFoundException('เอกสารของ Template', templateDocId);
        // เปลี่ยนเอกสารมาสเตอร์ → คัดลอกชื่อ/รหัสใหม่และตรวจซ้ำ (ระบบเดิมแก้ชื่อแต่ไม่แก้ i_doc_id ทำให้ไม่ตรงกัน)
        const master =
          dto.masterDocId !== undefined && dto.masterDocId !== doc.docId
            ? await this.requireMasterDoc(dto.masterDocId)
            : null;
        await this.tx.run(async ({ manager }) => {
          if (master) await this.assertDocFree(manager, doc.stateId, master.docId, templateDocId);
          await manager.update(
            TemplateDoc,
            { templateDocId },
            {
              ...(master
                ? {
                    docId: master.docId,
                    docName: master.docName ?? '',
                    docType: master.docCode ?? null,
                  }
                : {}),
              ...(dto.required !== undefined ? { required: toYesNo(dto.required) } : {}),
              ...(dto.seqNo !== undefined ? { seqNo: dto.seqNo } : {}),
              ...(dto.remark !== undefined ? { remark: blankToNull(dto.remark) } : {}),
              updateUser: rgpActor(user),
              updateDate: NOW_SQL,
            },
          );
        });
        const fresh = await this.docRepo.findOneByOrFail({ templateDocId });
        return toDocDto(fresh);
      },
      (d) => ({ after: d }),
    );
  }

  removeDoc(templateDocId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_TEMPLATE_DOC',
        entity: 'TemplateDoc',
        recordId: templateDocId,
        captureBefore: () => this.docRepo.findOneBy({ templateDocId }),
      },
      async () => {
        if (!(await this.docRepo.existsBy({ templateDocId }))) {
          throw new ResourceNotFoundException('เอกสารของ Template', templateDocId);
        }
        await this.docRepo.delete({ templateDocId });
      },
    );
  }

  // ── ภายใน ──────────────────────────────────────────────────

  private async requireTemplate(templateId: number): Promise<ProjectTemplate> {
    const t = await this.repo.findOneBy({ templateId });
    if (!t) throw new ResourceNotFoundException('Template', templateId);
    return t;
  }

  private async requireTemplateState(stateId: number): Promise<TemplateState> {
    const s = await this.stateRepo.findOneBy({ stateId });
    if (!s) throw new ResourceNotFoundException('ขั้นตอนของ Template', stateId);
    return s;
  }

  /** เอกสารมาสเตอร์อยู่ฐาน BUI_RG (DataSource 'project') */
  private async requireMasterDoc(docId: number): Promise<MasterDocument> {
    const m = await this.masters.findOneBy({ docId });
    if (!m) {
      throw new BusinessException(`ไม่พบเอกสารมาสเตอร์ (${docId})`, 'MASTER_DOC_NOT_FOUND');
    }
    return m;
  }

  private async assertCodeFree(code: string, excludeTemplateId?: number): Promise<void> {
    const same = await this.repo.findBy({ templateCode: code });
    if (same.some((t) => t.templateId !== excludeTemplateId)) {
      throw new ConflictBusinessException(`รหัส '${code}' มีในระบบแล้ว`, 'TEMPLATE_CODE_DUPLICATE');
    }
  }

  private async assertDocFree(
    manager: EntityManager,
    stateId: number,
    docId: number,
    excludeTemplateDocId?: number,
  ): Promise<void> {
    const same = await manager.findBy(TemplateDoc, { stateId, docId });
    if (same.some((d) => d.templateDocId !== excludeTemplateDocId)) {
      throw new ConflictBusinessException(
        'เอกสารนี้ถูก mapping กับขั้นตอนนี้ไว้แล้ว',
        'TEMPLATE_DOC_DUPLICATE',
      );
    }
  }

  /** ขั้นตอนของ template ที่โครงการสร้างไปแล้วอ้างอิงอยู่ (t_project_state.i_state_id) ห้ามลบ */
  private async assertStatesUnreferenced(
    manager: EntityManager,
    stateIds: number[],
  ): Promise<void> {
    if (stateIds.length === 0) return;
    const used = await manager.countBy(ProjectState, { stateId: In(stateIds) });
    if (used > 0) {
      throw new ConflictBusinessException(
        `ไม่สามารถลบได้ มีขั้นตอนของโครงการ ${used} รายการสร้างมาจากขั้นตอนของ Template นี้`,
        'TEMPLATE_STATE_IN_USE',
        { projectStates: used },
      );
    }
  }
}

// ───────────────────────── mapping ─────────────────────────

const blankToNull = (v: string | null | undefined): string | null =>
  v === undefined || v === null || v.trim() === '' ? null : v.trim();

function toStateDto(s: TemplateState, docCount: number): TemplateStateDto {
  return {
    stateId: s.stateId,
    templateId: s.templateId,
    name: s.stateName,
    seqNo: s.seqNo,
    description: s.description ?? null,
    required: fromYesNo(s.required),
    docCount,
  };
}

function toDocDto(d: TemplateDoc): TemplateDocDto {
  return {
    templateDocId: d.templateDocId,
    templateId: d.templateId,
    stateId: d.stateId,
    masterDocId: d.docId,
    name: d.docName,
    docType: d.docType ?? null,
    required: fromYesNo(d.required),
    seqNo: d.seqNo ?? 1,
    remark: d.remark ?? null,
  };
}

/** เรียงเอกสารตามลำดับขั้นตอน แล้วลำดับเอกสาร */
function sortDocs(docs: TemplateDoc[], states: TemplateState[]): TemplateDoc[] {
  const seq = new Map(states.map((s) => [s.stateId, s.seqNo]));
  return [...docs].sort(
    (a, b) =>
      (seq.get(a.stateId) ?? 0) - (seq.get(b.stateId) ?? 0) ||
      (a.seqNo ?? 0) - (b.seqNo ?? 0) ||
      a.templateDocId - b.templateDocId,
  );
}
