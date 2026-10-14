import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppRole } from '../../../common/constants/enums';
import { Paginated, paginated } from '../../../common/dto/pagination.dto';
import {
  BusinessException,
  ConflictBusinessException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { LIKE_ESCAPE, likeContains } from '../../../common/utils/query.util';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { ProjectAuditService } from '../audit/project-audit.service';
import { ProjectDocumentsService } from '../documents/project-documents.service';
import { insertProjectMember } from '../common/member-resolver';
import {
  NOW_SQL,
  insertProjectDoc,
  insertProjectState,
  recalculateProjectStatus,
  requireActiveProject,
} from '../common/project-ops';
import { ACTOR_LONG, rgpActor } from '../common/rgp-actor';
import {
  allRequiredStatesCompleted,
  fromYesNo,
  hasActiveProgress,
  overallProjectPct,
  parseDateOnly,
  toDateOnly,
} from '../common/rgp-rules';
import {
  PROJECT_LAST_PROGRESS,
  PROJECT_OVERALL_PCT,
  PROJECT_STATE_SUMMARY,
} from '../common/rgp-sql';
import { Project } from '../entities/project.entity';
import { ProjectState } from '../entities/project-state.entity';
import { ProjectTemplate } from '../entities/project-template.entity';
import { ProjectMembersService } from '../members/project-members.service';
import { RunningNumberService } from '../running-number/running-number.service';
import { ProjectStatesService } from '../states/project-states.service';
import type {
  CreateProjectDto,
  ProjectDetailDto,
  ProjectListQueryDto,
  ProjectNoCheckDto,
  ProjectStatusResultDto,
  ProjectSummaryDto,
  ReferenceCandidateDto,
  UpdateLegalDictDto,
  UpdateProjectDto,
} from './dto/project.dto';
import {
  assertDateRange,
  assertDocStateIndexes,
  assertStagedDays,
  planStateOrder,
} from './project-rules';

/** ฟิลด์ที่เรียงได้ในรายการค้นหา (whitelist → นิพจน์ SQL) */
const SORT: Record<string, string> = {
  projectNo: 'p.c_project_no',
  name: 'p.n_project_name',
  status: 'p.c_status',
  createDate: 'p.d_create_date',
  startDate: 'p.d_start_date',
  dueDate: 'p.d_due_date',
  pctOverall: 'ISNULL(st.i_pct_overall, 0)',
};

const SEARCH_SELECT = `
SELECT p.i_project_id AS projectId,
       p.c_project_no AS projectNo,
       p.n_project_name AS name,
       p.i_template_id AS templateId,
       ISNULL(t.n_template_name, N'-') AS templateName,
       p.c_status AS status,
       p.c_description AS description,
       p.d_start_date AS startDate,
       p.d_due_date AS dueDate,
       p.d_close_date AS closeDate,
       p.i_create_user AS createUser,
       p.d_create_date AS createDate,
       p.i_update_user AS updateUser,
       p.d_update_date AS updateDate,
       ISNULL(lpr.i_action_user, p.i_update_user) AS lastWorker,
       ISNULL(lpr.d_action_date, p.d_update_date) AS lastUpdate,
       ISNULL(st.i_total_states, 0) AS totalStates,
       ISNULL(st.i_completed_states, 0) AS completedStates,
       ISNULL(st.i_pct_overall, 0) AS pctOverall
FROM RGP.t_project p
LEFT JOIN RGP.m_project_template t ON t.i_template_id = p.i_template_id
LEFT JOIN ${PROJECT_STATE_SUMMARY} st ON st.i_project_id = p.i_project_id
LEFT JOIN ${PROJECT_LAST_PROGRESS} lpr ON lpr.i_project_id = p.i_project_id`;

const REFERENCE_CANDIDATES_SQL = `
SELECT p.i_project_id AS projectId,
       p.c_project_no AS projectNo,
       p.n_project_name AS name,
       p.c_status AS status,
       ISNULL(st.i_pct_overall, 0) AS pctOverall
FROM RGP.t_project p
LEFT JOIN ${PROJECT_OVERALL_PCT} st ON st.i_project_id = p.i_project_id
WHERE p.f_active = 'Y' AND p.c_status <> 'Completed' AND (@0 = 0 OR p.i_project_id <> @0)
ORDER BY p.d_create_date DESC`;

/**
 * โครงการ (`RGP.t_project`) — พอร์ตจาก ProjectService + ProjectRepository
 *
 * จุดสำคัญ
 *  - เลขที่โครงการ `PRJ` ออกจาก RunningNumber (ฐาน BUI_RG) โดยถือ transaction ฐานนั้นค้างไว้จนโครงการ+ลูก commit
 *    (ล็อก UPDLOCK,ROWLOCK, รีเซ็ตรายปี) · งานล้มจึงไม่เสียเลข
 *  - สร้างโครงการพร้อมขั้นตอน/เอกสาร/บุคคลใน transaction เดียว (ระบบเดิม insert ทีละรายการแล้วข้ามตัวที่ล้ม)
 *  - audit: ทั้ง CRUD-log กลาง และ `RGP.t_project_audit_log` (CREATE/UPDATE/DELETE/CLOSE_PROJECT[_FAILED])
 */
@Injectable()
export class ProjectsService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'Project';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Project) private readonly repo: Repository<Project>,
    @InjectRepository(ProjectTemplate) private readonly templates: Repository<ProjectTemplate>,
    private readonly tx: TransactionRunner,
    private readonly audit: ProjectAuditService,
    private readonly runningNumbers: RunningNumberService,
    private readonly states: ProjectStatesService,
    private readonly documents: ProjectDocumentsService,
    private readonly members: ProjectMembersService,
  ) {
    super(crudLog);
  }

  // ── อ่าน ───────────────────────────────────────────────────

  /** ค้นหาโครงการ (SearchProjects) พร้อมสรุปความคืบหน้า — แบ่งหน้า ใหม่สุดก่อน */
  async list(q: ProjectListQueryDto): Promise<Paginated<ProjectSummaryDto>> {
    const params: unknown[] = [];
    const bind = (v: unknown): string => `@${params.push(v) - 1}`;
    const where: string[] = ["p.f_active = 'Y'"];
    if (q.projectNo)
      where.push(`p.c_project_no LIKE ${bind(likeContains(q.projectNo))} ${LIKE_ESCAPE}`);
    if (q.name) where.push(`p.n_project_name LIKE ${bind(likeContains(q.name))} ${LIKE_ESCAPE}`);
    if (q.q) {
      const like = bind(likeContains(q.q));
      where.push(
        `(p.c_project_no LIKE ${like} ${LIKE_ESCAPE} OR p.n_project_name LIKE ${like} ${LIKE_ESCAPE})`,
      );
    }
    if (q.status) where.push(`p.c_status = ${bind(q.status)}`);
    if (q.templateId !== undefined) where.push(`p.i_template_id = ${bind(q.templateId)}`);
    if (q.createdFrom) {
      where.push(`CAST(p.d_create_date AS DATE) >= CAST(${bind(q.createdFrom)} AS DATE)`);
    }
    if (q.createdTo)
      where.push(`CAST(p.d_create_date AS DATE) <= CAST(${bind(q.createdTo)} AS DATE)`);
    const whereSql = where.join(' AND ');

    const sortExpr =
      q.sortBy && Object.prototype.hasOwnProperty.call(SORT, q.sortBy) ? SORT[q.sortBy] : undefined;
    const orderBy = sortExpr
      ? `${sortExpr} ${q.sortDir === 'desc' ? 'DESC' : 'ASC'}, p.i_project_id DESC`
      : 'p.d_create_date DESC, p.i_project_id DESC';

    const counted: { total: number }[] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM RGP.t_project p WHERE ${whereSql}`,
      [...params],
    );
    const total = Number(counted[0]?.total ?? 0);

    const offset = bind((q.page - 1) * q.pageSize);
    const fetch = bind(q.pageSize);
    const rows: RawSummaryRow[] = await this.ds.query(
      `${SEARCH_SELECT}\nWHERE ${whereSql}\nORDER BY ${orderBy}\nOFFSET ${offset} ROWS FETCH NEXT ${fetch} ROWS ONLY`,
      params,
    );
    return paginated(rows.map(toSummary), total, q);
  }

  /** รายละเอียดโครงการ พร้อมขั้นตอน (และ % ล่าสุด) เอกสาร และบุคคลที่เกี่ยวข้อง */
  async getDetail(projectId: number): Promise<ProjectDetailDto> {
    const p = await this.repo.findOneBy({ projectId, active: 'Y' });
    if (!p) throw new ResourceNotFoundException('โครงการ', projectId);
    const template = p.templateId
      ? await this.templates.findOneBy({ templateId: p.templateId })
      : null;
    const [states, documents, members] = await Promise.all([
      this.states.loadByProject(projectId),
      this.documents.loadByProject(projectId),
      this.members.loadByProject(projectId),
    ]);
    return {
      projectId: p.projectId,
      projectNo: p.projectNo,
      name: p.projectName,
      templateId: p.templateId ?? null,
      templateName: template?.templateName ?? null,
      isLegalDict: fromYesNo(template?.isLegalDict),
      status: p.status ?? 'Open',
      description: p.description ?? null,
      startDate: toDateOnly(p.startDate),
      dueDate: toDateOnly(p.dueDate),
      closeDate: p.closeDate ?? null,
      owner: p.projectOwner ?? null,
      developer: p.projectDeveloper ?? null,
      legalDictJson: p.legalDictJson ?? null,
      createUser: p.createUser,
      createDate: p.createDate as Date,
      updateUser: p.updateUser ?? null,
      updateDate: p.updateDate ?? null,
      pctOverall: overallProjectPct(
        states.map((s) => ({
          pct: s.pctComplete,
          refProjectId: s.refProjectId,
          refPctOverall: s.refPctOverall,
        })),
      ),
      states,
      documents,
      members,
    };
  }

  /** เลขที่โครงการนี้มีโครงการที่ใช้งานอยู่ใช้แล้วหรือไม่ (IsProjectNoExists) */
  async checkProjectNo(projectNo: string): Promise<ProjectNoCheckDto> {
    const no = projectNo.trim();
    return { projectNo: no, exists: await this.repo.existsBy({ projectNo: no, active: 'Y' }) };
  }

  /** โครงการที่เลือกเป็น "โครงการอ้างอิง" ของขั้นตอนได้ (ยังไม่ Completed, ไม่ใช่โครงการปัจจุบัน) */
  async referenceCandidates(excludeProjectId = 0): Promise<ReferenceCandidateDto[]> {
    const rows: ReferenceCandidateDto[] = await this.ds.query(REFERENCE_CANDIDATES_SQL, [
      excludeProjectId,
    ]);
    return rows.map((r) => ({ ...r, pctOverall: Number(r.pctOverall ?? 0) }));
  }

  // ── เขียน ──────────────────────────────────────────────────

  /**
   * สร้างโครงการ (สถานะเริ่ม Open) พร้อมขั้นตอน/เอกสาร/บุคคลที่ส่งมา — ทั้งหมดใน transaction เดียว
   * ไม่ระบุ projectNo = ออกเลขอัตโนมัติ (PRJ) จาก RunningNumber
   */
  create(dto: CreateProjectDto, user: UserContext): Promise<ProjectDetailDto> {
    return this.logged(
      { action: 'CREATE', operation: 'CREATE_PROJECT', meta: { name: dto.name } },
      async () => {
        const manualNo = dto.projectNo?.trim();
        const projectId = manualNo
          ? await this.createWithNumber(manualNo, dto, user)
          : await this.createWithGeneratedNumber(dto, user);
        return this.getDetail(projectId);
      },
      (d) => ({
        recordId: d.projectId,
        after: {
          projectId: d.projectId,
          projectNo: d.projectNo,
          name: d.name,
          states: d.states.length,
          documents: d.documents.length,
          members: d.members.length,
        },
      }),
    );
  }

  /** แก้ไขข้อมูลหัวโครงการ (ชื่อ/template/รายละเอียด/วันที่) — audit UPDATE_PROJECT */
  update(projectId: number, dto: UpdateProjectDto, user: UserContext): Promise<ProjectDetailDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_PROJECT',
        recordId: projectId,
        captureBefore: () => this.headerOf(projectId),
      },
      async () => {
        await this.audit.withAudit(
          { user, action: 'UPDATE_PROJECT', tableName: 't_project', recordId: projectId },
          async ({ manager }) => {
            const p = await requireActiveProject(manager, projectId);
            assertDateRange(
              dto.startDate !== undefined ? dto.startDate : toDateOnly(p.startDate),
              dto.dueDate !== undefined ? dto.dueDate : toDateOnly(p.dueDate),
            );
            if (dto.templateId && dto.templateId !== p.templateId) {
              await this.assertTemplateUsable(manager, dto.templateId);
            }
            await manager.update(
              Project,
              { projectId },
              {
                ...(dto.name !== undefined ? { projectName: dto.name.trim() } : {}),
                ...(dto.templateId !== undefined ? { templateId: dto.templateId } : {}),
                ...(dto.description !== undefined
                  ? { description: dto.description?.trim() ? dto.description.trim() : null }
                  : {}),
                ...(dto.startDate !== undefined ? { startDate: parseDateOnly(dto.startDate) } : {}),
                ...(dto.dueDate !== undefined ? { dueDate: parseDateOnly(dto.dueDate) } : {}),
                updateUser: rgpActor(user),
                updateDate: NOW_SQL,
              },
            );
          },
        );
        return this.getDetail(projectId);
      },
      (d) => ({ after: { projectId: d.projectId, name: d.name } }),
    );
  }

  /** บันทึก JSON พจนานุกรมกฎหมาย (เฉพาะโครงการที่ template เป็นประเภทพจนานุกรมกฎหมาย) */
  updateLegalDict(projectId: number, dto: UpdateLegalDictDto, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'UPDATE_LEGAL_DICT_JSON',
        recordId: projectId,
        meta: { length: dto.json?.length ?? 0 }, // ไม่ใส่เนื้อหา JSON ลง log (ขนาดใหญ่)
      },
      () =>
        this.tx.run(async ({ manager }) => {
          const p = await requireActiveProject(manager, projectId);
          const template = p.templateId
            ? await manager.findOneBy(ProjectTemplate, { templateId: p.templateId })
            : null;
          if (!template || template.isLegalDict !== 'Y') {
            throw new BusinessException(
              'โครงการนี้ไม่ใช่ประเภทพจนานุกรมกฎหมาย',
              'NOT_LEGAL_DICT_PROJECT',
            );
          }
          if (dto.json !== null && dto.json.trim() !== '') {
            try {
              JSON.parse(dto.json);
            } catch {
              throw new BusinessException('ข้อมูลพจนานุกรมไม่ใช่ JSON ที่ถูกต้อง', 'INVALID_JSON');
            }
          }
          await manager.update(
            Project,
            { projectId },
            {
              legalDictJson: dto.json === null || dto.json.trim() === '' ? null : dto.json,
              updateUser: rgpActor(user),
              updateDate: NOW_SQL,
            },
          );
        }),
    );
  }

  /**
   * ลบโครงการ (soft delete: f_active='N', สถานะ Cancelled) — ถูกบล็อกถ้าขั้นตอนใดเลย Pending ไปแล้ว (มีความคืบหน้า)
   * ลบได้เฉพาะผู้สร้างโครงการหรือ Manager ขึ้นไป (ระบบเดิมไม่จำกัดสิทธิ์ — ดู docs ข้อ 3)
   */
  remove(projectId: number, user: UserContext): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        operation: 'DELETE_PROJECT',
        recordId: projectId,
        captureBefore: () => this.headerOf(projectId),
      },
      () =>
        this.audit.withAudit(
          { user, action: 'DELETE_PROJECT', tableName: 't_project', recordId: projectId },
          async ({ manager }) => {
            const p = await requireActiveProject(manager, projectId);
            if (user.appRole < AppRole.Manager && p.createUser !== rgpActor(user)) {
              throw new PermissionDeniedException(
                'ลบโครงการได้เฉพาะผู้สร้างโครงการหรือผู้จัดการขึ้นไป',
                'PROJECT_DELETE_NOT_ALLOWED',
              );
            }
            const states = await manager.findBy(ProjectState, { projectId });
            if (hasActiveProgress(states.map((s) => ({ status: s.status ?? 'Pending' })))) {
              throw new BusinessException(
                'ไม่สามารถลบโครงการได้ เนื่องจากมีการอัปเดตความคืบหน้าแล้ว',
                'PROJECT_HAS_PROGRESS',
              );
            }
            await manager.update(
              Project,
              { projectId },
              { active: 'N', status: 'Cancelled', updateUser: rgpActor(user), updateDate: NOW_SQL },
            );
          },
        ),
    );
  }

  /**
   * ปิดโครงการ (CloseProject — เมธอดเดิมไม่มีหน้าจอเรียก) → Completed + วันที่ปิด
   * ถูกบล็อกถ้ายังมีขั้นตอนที่ f_required='Y' และยังไม่ Completed · Manager ขึ้นไป
   */
  close(projectId: number, user: UserContext): Promise<ProjectStatusResultDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'CLOSE_PROJECT',
        recordId: projectId,
        captureBefore: () => this.headerOf(projectId),
      },
      () =>
        this.audit.withAudit(
          { user, action: 'CLOSE_PROJECT', tableName: 't_project', recordId: projectId },
          async ({ manager }) => {
            const p = await requireActiveProject(manager, projectId);
            if (p.status === 'Completed') {
              throw new ConflictBusinessException('โครงการนี้ปิดแล้ว', 'PROJECT_ALREADY_COMPLETED');
            }
            const states = await manager.findBy(ProjectState, { projectId });
            const views = states.map((s) => ({
              required: fromYesNo(s.required),
              status: s.status ?? 'Pending',
            }));
            if (!allRequiredStatesCompleted(views)) {
              throw new BusinessException(
                'ยังมีขั้นตอนที่จำเป็น (Required) ยังไม่เสร็จสมบูรณ์',
                'REQUIRED_STATES_INCOMPLETE',
                {
                  pendingStates: states
                    .filter((s) => fromYesNo(s.required) && s.status !== 'Completed')
                    .map((s) => s.stateName),
                },
              );
            }
            await manager.update(
              Project,
              { projectId },
              {
                status: 'Completed',
                closeDate: NOW_SQL,
                updateUser: rgpActor(user),
                updateDate: NOW_SQL,
              },
            );
            return { projectId, status: 'Completed' };
          },
        ),
      (r) => ({ after: r }),
    );
  }

  /** คำนวณสถานะโครงการใหม่จากสถานะขั้นตอน (ใช้เมื่อเพิ่ม/ลบ/แก้ขั้นตอนแล้วต้องการให้สถานะสอดคล้อง) */
  recalculateStatus(projectId: number, user: UserContext): Promise<ProjectStatusResultDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: 'RECALCULATE_PROJECT_STATUS',
        recordId: projectId,
        captureBefore: () => this.headerOf(projectId),
      },
      () =>
        this.tx.run(async ({ manager }) => {
          await requireActiveProject(manager, projectId);
          const status = await recalculateProjectStatus(manager, projectId, rgpActor(user));
          return { projectId, status: status ?? 'Open' };
        }),
      (r) => ({ after: r }),
    );
  }

  // ── ภายใน ──────────────────────────────────────────────────

  /** เลขที่ระบุเอง: ตรวจซ้ำแล้วสร้าง */
  private createWithNumber(
    projectNo: string,
    dto: CreateProjectDto,
    user: UserContext,
  ): Promise<number> {
    return this.audit.withAudit(
      { user, action: 'CREATE_PROJECT', tableName: 't_project' },
      async ({ manager }) => {
        if (await manager.existsBy(Project, { projectNo, active: 'Y' })) {
          throw new ConflictBusinessException(
            `เลขที่โครงการ '${projectNo}' มีในระบบแล้ว กรุณาระบุเลขที่ใหม่`,
            'PROJECT_NO_DUPLICATE',
          );
        }
        return this.insertProjectTree(manager, projectNo, dto, user);
      },
      (id) => id,
    );
  }

  /**
   * ออกเลขอัตโนมัติ: เปิด transaction ฐานโครงการ (BUI_RG) ล็อกแถว RunningNumber ค้างไว้ → สร้างโครงการในฐานหลัก
   * - สร้างล้ม → rollback ฝั่ง BUI_RG เลขไม่ถูกใช้ · ถ้า commit ฝั่งหลักแล้วแต่ commit ฝั่ง BUI_RG ล้ม (ทางทฤษฎี)
   *   เลขเดิมจะถูกออกซ้ำ → ตรวจเลขที่ซ้ำก่อนใช้ทุกครั้ง (ลองใหม่สูงสุด 3 ครั้ง)
   */
  private createWithGeneratedNumber(dto: CreateProjectDto, user: UserContext): Promise<number> {
    const MAX_ATTEMPTS = 3;
    return this.tx.run(
      async ({ manager: numberManager }) => {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const projectNo = await this.runningNumbers.next(numberManager, 'PRJ');
          if (!(await this.repo.existsBy({ projectNo, active: 'Y' }))) {
            return this.createWithNumber(projectNo, dto, user);
          }
        }
        throw new ConflictBusinessException(
          'ไม่สามารถออกเลขที่โครงการที่ไม่ซ้ำได้ กรุณาตรวจการตั้งค่า RunningNumber (PRJ)',
          'PROJECT_NO_GENERATION_CONFLICT',
        );
      },
      { target: 'project' },
    );
  }

  /** เพิ่มโครงการ + ขั้นตอน + เอกสาร + บุคคล ใน transaction ของผู้เรียก — คืน projectId */
  private async insertProjectTree(
    manager: import('typeorm').EntityManager,
    projectNo: string,
    dto: CreateProjectDto,
    user: UserContext,
  ): Promise<number> {
    const actor = rgpActor(user);
    const states = dto.states ?? [];
    const docs = dto.documents ?? [];
    const members = dto.members ?? [];

    assertDateRange(dto.startDate, dto.dueDate);
    assertDocStateIndexes(states.length, docs);
    const order = planStateOrder(states);
    assertStagedDays(dto.startDate, dto.dueDate, states, order);
    if (dto.templateId) await this.assertTemplateUsable(manager, dto.templateId);

    const project = await manager.save(Project, {
      projectNo,
      projectName: dto.name.trim(),
      templateId: dto.templateId ?? null,
      status: 'Open',
      description: dto.description?.trim() ? dto.description.trim() : null,
      startDate: parseDateOnly(dto.startDate),
      dueDate: parseDateOnly(dto.dueDate),
      active: 'Y',
      createUser: actor,
    });

    // ขั้นตอนก่อน (ได้ id จริงมาผูกเอกสาร) · ผูกอ้างอิงตามตำแหน่งใน array ของคำขอ
    const stateByIndex: ProjectState[] = [];
    for (const index of order) {
      stateByIndex[index] = await insertProjectState(
        manager,
        project.projectId,
        states[index],
        actor,
      );
    }
    for (const doc of docs) {
      await insertProjectDoc(manager, stateByIndex[doc.stateIndex], doc, actor);
    }
    for (const m of members) {
      await insertProjectMember(manager, project.projectId, m, m.role, rgpActor(user, ACTOR_LONG));
    }
    return project.projectId;
  }

  /** template ที่เลือกต้องมีอยู่และเปิดใช้งาน */
  private async assertTemplateUsable(
    manager: import('typeorm').EntityManager,
    templateId: number,
  ): Promise<void> {
    const t = await manager.findOneBy(ProjectTemplate, { templateId, active: 'Y' });
    if (!t) {
      throw new BusinessException(
        `ไม่พบประเภทโครงการ (Template ${templateId}) หรือถูกปิดใช้งาน`,
        'TEMPLATE_NOT_FOUND',
      );
    }
  }

  /** ข้อมูลหัวโครงการ (สำหรับ CRUD-log ก่อน/หลัง — เบากว่า getDetail) */
  private async headerOf(projectId: number): Promise<Record<string, unknown> | null> {
    const p = await this.repo.findOneBy({ projectId });
    if (!p) return null;
    return {
      projectId: p.projectId,
      projectNo: p.projectNo,
      name: p.projectName,
      templateId: p.templateId ?? null,
      status: p.status,
      active: p.active,
      startDate: toDateOnly(p.startDate),
      dueDate: toDateOnly(p.dueDate),
    };
  }
}

// ───────────────────────── mapping ─────────────────────────

type RawSummaryRow = Omit<ProjectSummaryDto, 'startDate' | 'dueDate'> & {
  startDate: Date | string | null;
  dueDate: Date | string | null;
};

function toSummary(r: RawSummaryRow): ProjectSummaryDto {
  return {
    ...r,
    startDate: toDateOnly(r.startDate),
    dueDate: toDateOnly(r.dueDate),
    totalStates: Number(r.totalStates ?? 0),
    completedStates: Number(r.completedStates ?? 0),
    pctOverall: Number(r.pctOverall ?? 0),
  };
}
