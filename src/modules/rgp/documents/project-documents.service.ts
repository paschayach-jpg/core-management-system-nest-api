import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import {
  NOW_SQL,
  insertProjectDoc,
  nextDocSeq,
  requireActiveProject,
  requireState,
} from '../common/project-ops';
import { rgpActor } from '../common/rgp-actor';
import { docToDto } from '../common/rgp-mappers';
import { toYesNo } from '../common/rgp-rules';
import { Project } from '../entities/project.entity';
import { ProjectDocWorkflow } from '../entities/project-doc-workflow.entity';
import { ProjectState } from '../entities/project-state.entity';
import type {
  CreateDocDto,
  ProjectDocDto,
  UpdateDocDto,
  UpdateDocStatusDto,
} from './dto/document.dto';

/**
 * เอกสารใน workflow ของโครงการ (`RGP.t_project_doc_workflow`) — พอร์ตจาก ProjectDocumentService
 * (ส่วน E-Filing ของระบบเดิมไม่ถูกเรียกจากหน้าจอใด = dead จึงไม่พอร์ต)
 */
@Injectable()
export class ProjectDocumentsService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectDocWorkflow';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(ProjectDocWorkflow) private readonly repo: Repository<ProjectDocWorkflow>,
    @InjectRepository(ProjectState) private readonly states: Repository<ProjectState>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** เอกสารของโครงการ (ทุกขั้นตอน) เรียงตามลำดับขั้นตอน แล้วลำดับเอกสาร */
  async listByProject(projectId: number): Promise<ProjectDocDto[]> {
    if (!(await this.projects.existsBy({ projectId, active: 'Y' }))) {
      throw new ResourceNotFoundException('โครงการ', projectId);
    }
    return this.loadByProject(projectId);
  }

  /** ไม่ตรวจว่ามีโครงการ (ผู้เรียกตรวจแล้ว) */
  async loadByProject(projectId: number): Promise<ProjectDocDto[]> {
    const [docs, states] = await Promise.all([
      this.repo.findBy({ projectId }),
      this.states.findBy({ projectId }),
    ]);
    const stateById = new Map(states.map((s) => [s.projStateId, s]));
    return docs
      .sort(
        (a, b) =>
          (stateById.get(a.projStateId)?.seqNo ?? 0) - (stateById.get(b.projStateId)?.seqNo ?? 0) ||
          (a.seqNo ?? 0) - (b.seqNo ?? 0) ||
          a.docWfId - b.docWfId,
      )
      .map((d) => docToDto(d, stateById.get(d.projStateId)?.stateName));
  }

  async listByState(projStateId: number): Promise<ProjectDocDto[]> {
    const state = await this.states.findOneBy({ projStateId });
    if (!state) throw new ResourceNotFoundException('ขั้นตอน (state)', projStateId);
    const docs = await this.repo.find({ where: { projStateId }, order: { seqNo: 'ASC' } });
    return docs.map((d) => docToDto(d, state.stateName));
  }

  async get(docWfId: number): Promise<ProjectDocDto> {
    const doc = await this.repo.findOneBy({ docWfId });
    if (!doc) throw new ResourceNotFoundException('เอกสาร', docWfId);
    const state = await this.states.findOneBy({ projStateId: doc.projStateId });
    return docToDto(doc, state?.stateName);
  }

  // ── เขียน ──────────────────────────────────────────────────

  /** เพิ่มเอกสารต่อท้ายขั้นตอน (สถานะเริ่ม Pending) */
  create(projStateId: number, dto: CreateDocDto, user: UserContext): Promise<ProjectDocDto> {
    return this.logged(
      { action: 'CREATE', operation: 'ADD_PROJECT_DOC', meta: { projStateId } },
      () =>
        this.tx.run(async ({ manager }) => {
          const state = await requireState(manager, projStateId);
          await requireActiveProject(manager, state.projectId);
          const doc = await insertProjectDoc(manager, state, dto, rgpActor(user));
          return docToDto(doc, state.stateName);
        }),
      (d) => ({ recordId: d.docWfId, after: d }),
    );
  }

  /** แก้ไขเอกสาร (ย้ายไปขั้นตอนอื่นของโครงการเดียวกันได้) */
  update(docWfId: number, dto: UpdateDocDto, user: UserContext): Promise<ProjectDocDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_PROJECT_DOC',
        recordId: docWfId,
        captureBefore: () => this.get(docWfId),
      },
      async () => {
        await this.tx.run(async ({ manager }) => {
          const doc = await manager.findOneBy(ProjectDocWorkflow, { docWfId });
          if (!doc) throw new ResourceNotFoundException('เอกสาร', docWfId);
          await requireActiveProject(manager, doc.projectId);

          let seqNo = dto.seqNo;
          if (dto.projStateId !== undefined && dto.projStateId !== doc.projStateId) {
            const target = await requireState(manager, dto.projStateId);
            if (target.projectId !== doc.projectId) {
              throw new BusinessException(
                'ย้ายเอกสารไปขั้นตอนของโครงการอื่นไม่ได้',
                'DOC_STATE_OTHER_PROJECT',
              );
            }
            // ย้ายขั้นตอนโดยไม่ระบุลำดับ → ต่อท้ายของขั้นตอนใหม่
            seqNo ??= await nextDocSeq(manager, dto.projStateId);
          }

          await manager.update(
            ProjectDocWorkflow,
            { docWfId },
            {
              ...(dto.projStateId !== undefined ? { projStateId: dto.projStateId } : {}),
              ...(dto.name !== undefined ? { docName: dto.name.trim() } : {}),
              ...(dto.docType !== undefined
                ? { docType: dto.docType?.trim() ? dto.docType.trim() : null }
                : {}),
              ...(dto.required !== undefined ? { required: toYesNo(dto.required) } : {}),
              ...(dto.status !== undefined ? { docStatus: dto.status } : {}),
              ...(dto.remark !== undefined
                ? { remark: dto.remark?.trim() ? dto.remark.trim() : null }
                : {}),
              ...(seqNo !== undefined ? { seqNo } : {}),
              updateUser: rgpActor(user),
              updateDate: NOW_SQL,
            },
          );
        });
        return this.get(docWfId);
      },
      (d) => ({ after: d }),
    );
  }

  /** เปลี่ยนเฉพาะสถานะเอกสาร (Pending/Received/Verified/Rejected) */
  updateStatus(
    docWfId: number,
    dto: UpdateDocStatusDto,
    user: UserContext,
  ): Promise<ProjectDocDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_PROJECT_DOC_STATUS',
        recordId: docWfId,
        captureBefore: () => this.get(docWfId),
        meta: { status: dto.status },
      },
      async () => {
        const doc = await this.repo.findOneBy({ docWfId });
        if (!doc) throw new ResourceNotFoundException('เอกสาร', docWfId);
        if (!(await this.projects.existsBy({ projectId: doc.projectId, active: 'Y' }))) {
          throw new ResourceNotFoundException('โครงการ', doc.projectId);
        }
        await this.repo.update(
          { docWfId },
          { docStatus: dto.status, updateUser: rgpActor(user), updateDate: NOW_SQL },
        );
        return this.get(docWfId);
      },
      (d) => ({ after: d }),
    );
  }

  /** ลบเอกสารออกจาก workflow (ลบจริง) */
  remove(docWfId: number): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_PROJECT_DOC',
        recordId: docWfId,
        captureBefore: () => this.get(docWfId),
      },
      async () => {
        const doc = await this.repo.findOneBy({ docWfId });
        if (!doc) throw new ResourceNotFoundException('เอกสาร', docWfId);
        await this.repo.delete({ docWfId });
      },
    );
  }
}
