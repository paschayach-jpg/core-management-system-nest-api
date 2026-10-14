import { AppRole } from '../../../../src/common/constants/enums';
import { ProjectAttachmentsService } from '../../../../src/modules/rgp/attachments/project-attachments.service';
import { ProjectAuditService } from '../../../../src/modules/rgp/audit/project-audit.service';
import { ProjectDocumentsService } from '../../../../src/modules/rgp/documents/project-documents.service';
import { MasterDocumentType } from '../../../../src/modules/rgp/entities/master-document-type.entity';
import { MasterDocument } from '../../../../src/modules/rgp/entities/master-document.entity';
import { ProjectAttachment } from '../../../../src/modules/rgp/entities/project-attachment.entity';
import { ProjectAuditLog } from '../../../../src/modules/rgp/entities/project-audit-log.entity';
import { ProjectDocWorkflow } from '../../../../src/modules/rgp/entities/project-doc-workflow.entity';
import { ProjectMemberRole } from '../../../../src/modules/rgp/entities/project-member-role.entity';
import { ProjectMember } from '../../../../src/modules/rgp/entities/project-member.entity';
import { ProjectNotifyLog } from '../../../../src/modules/rgp/entities/project-notify-log.entity';
import { ProjectProgress } from '../../../../src/modules/rgp/entities/project-progress.entity';
import { ProjectStateMember } from '../../../../src/modules/rgp/entities/project-state-member.entity';
import { ProjectState } from '../../../../src/modules/rgp/entities/project-state.entity';
import { ProjectTaskComment } from '../../../../src/modules/rgp/entities/project-task-comment.entity';
import { ProjectTaskStatusLog } from '../../../../src/modules/rgp/entities/project-task-status-log.entity';
import { ProjectTask } from '../../../../src/modules/rgp/entities/project-task.entity';
import { ProjectTemplate } from '../../../../src/modules/rgp/entities/project-template.entity';
import { Project } from '../../../../src/modules/rgp/entities/project.entity';
import { RunningNumber } from '../../../../src/modules/rgp/entities/running-number.entity';
import { TemplateDoc } from '../../../../src/modules/rgp/entities/template-doc.entity';
import { TemplateState } from '../../../../src/modules/rgp/entities/template-state.entity';
import { MemberRolesService } from '../../../../src/modules/rgp/members/member-roles.service';
import { ProjectMembersService } from '../../../../src/modules/rgp/members/project-members.service';
import { ProjectProgressService } from '../../../../src/modules/rgp/progress/project-progress.service';
import { ProjectsService } from '../../../../src/modules/rgp/projects/projects.service';
import { RunningNumberService } from '../../../../src/modules/rgp/running-number/running-number.service';
import { ProjectStatesService } from '../../../../src/modules/rgp/states/project-states.service';
import { StateMembersService } from '../../../../src/modules/rgp/states/state-members.service';
import { StateNotifyService } from '../../../../src/modules/rgp/states/state-notify.service';
import { ProjectTasksService } from '../../../../src/modules/rgp/tasks/project-tasks.service';
import { ProjectTemplatesService } from '../../../../src/modules/rgp/templates/project-templates.service';
import { Employee } from '../../../../src/modules/shared/entities/employee.entity';
import {
  LATEST_PROGRESS_BY_PROJECT_SQL,
  STATES_WITH_PROGRESS_SQL,
} from '../../../../src/modules/rgp/common/rgp-sql';
import { fakeUser, makeCrudLog } from '../../../helpers/stubs';
import { FakeTransactionRunner, MemoryDb } from './memory-db';

/** แถว RunningNumber สำหรับเทสต์ */
export interface RunningSeed {
  type: string;
  prefix?: string | null;
  format?: string;
  digits?: number;
  current?: number;
  year?: number | null;
}

export function seedRunningNumber(project: MemoryDb, seed: RunningSeed): void {
  project.seed(RunningNumber, [
    {
      runningType: seed.type,
      product: 'RG',
      prefix: seed.prefix === undefined ? seed.type : seed.prefix,
      format: seed.format ?? 'PPP-YY-######',
      digitNumber: seed.digits ?? 6,
      maximumNumber: '999999',
      yearUw: seed.year === undefined ? new Date().getFullYear() : seed.year,
      // bigint ใน SQL Server → driver คืนเป็นสตริง
      currentNumber: String(seed.current ?? 0),
    },
  ]);
  project.onQuery = (sql, params, db) => {
    if (sql.includes('WITH (UPDLOCK, ROWLOCK)')) {
      const rows = db
        .rows<Record<string, unknown>>(RunningNumber)
        .filter((r) => r.runningType === params[0])
        .sort((a, b) => (a.id as number) - (b.id as number));
      return rows.slice(0, 1).map((r) => ({
        id: r.id,
        currentNumber: r.currentNumber,
        prefix: r.prefix,
        format: r.format,
        digitNumber: r.digitNumber,
        yearUw: r.yearUw,
      }));
    }
    if (sql.startsWith('UPDATE dbo.RunningNumber SET current_number')) {
      const [next, year, id] = params as [number, number, number];
      const row = db.rows<Record<string, unknown>>(RunningNumber).find((r) => r.id === id);
      if (row) {
        row.currentNumber = String(next);
        row.yearUw = year;
      }
      return [];
    }
    throw new Error(`SQL ที่ไม่คาดคิดบนฐานโครงการ: ${sql}`);
  };
}

type DbRow = Record<string, unknown>;

/** progress ล่าสุดของ state = แถวที่ i_progress_id มากสุด (เหมือน LATEST_PROGRESS_PER_STATE) */
function latestProgress(db: MemoryDb, projStateId: unknown): DbRow | undefined {
  return db
    .rows<DbRow>(ProjectProgress)
    .filter((p) => p.projStateId === projStateId)
    .sort((a, b) => (b.progressId as number) - (a.progressId as number))[0];
}

/** % รวมของโครงการ (ค่าเฉลี่ยตัดทศนิยมของ % ล่าสุดต่อ state) — ใช้เป็น refPctOverall */
function projectOverall(db: MemoryDb, projectId: unknown): number {
  const states = db.rows<DbRow>(ProjectState).filter((s) => s.projectId === projectId);
  if (states.length === 0) return 0;
  const sum = states.reduce(
    (acc, s) => acc + Number(latestProgress(db, s.projStateId)?.pctComplete ?? 0),
    0,
  );
  return Math.trunc(sum / states.length);
}

/** จำลองผลของ SQL อ่านที่ service ใช้ (ขั้นตอน+progress) บน MemoryDb ฐานหลัก */
export function installMainQueryEmulation(main: MemoryDb): void {
  main.onQuery = (sql, params, db) => {
    const projectId = params[0];
    const states = db
      .rows<DbRow>(ProjectState)
      .filter((s) => s.projectId === projectId)
      .sort(
        (a, b) =>
          (a.seqNo as number) - (b.seqNo as number) ||
          (a.projStateId as number) - (b.projStateId as number),
      );
    const refOf = (s: DbRow) => {
      const ref = s.refProjectId
        ? db.rows<DbRow>(Project).find((p) => p.projectId === s.refProjectId && p.active === 'Y')
        : undefined;
      return {
        refProjectNo: ref?.projectNo ?? null,
        refProjectName: ref?.projectName ?? null,
        refPctOverall: ref ? projectOverall(db, ref.projectId) : 0,
      };
    };
    if (sql === STATES_WITH_PROGRESS_SQL) {
      return states.map((s) => {
        const pr = latestProgress(db, s.projStateId);
        return {
          projStateId: s.projStateId,
          projectId: s.projectId,
          templateStateId: s.stateId ?? null,
          name: s.stateName,
          seqNo: s.seqNo,
          description: s.description ?? null,
          required: s.required,
          status: s.status,
          estimatedDays: s.estimatedDays ?? null,
          refProjectId: s.refProjectId ?? null,
          createUser: s.createUser,
          createDate: s.createDate,
          updateUser: s.updateUser ?? null,
          updateDate: s.updateDate ?? null,
          pctComplete: pr?.pctComplete ?? 0,
          latestRemark: pr?.remark ?? '',
          ...refOf(s),
        };
      });
    }
    if (sql === LATEST_PROGRESS_BY_PROJECT_SQL) {
      return states.map((s) => {
        const pr = latestProgress(db, s.projStateId);
        return {
          projStateId: s.projStateId,
          projectId: s.projectId,
          stateName: s.stateName,
          seqNo: s.seqNo,
          required: s.required,
          stateStatus: s.status,
          status: pr?.status ?? 'Pending',
          remark: pr?.remark ?? '',
          pctComplete: pr?.pctComplete ?? 0,
          actionDate: pr?.actionDate ?? null,
          actionUser: pr?.actionUser ?? null,
          progressId: pr?.progressId ?? null,
          refProjectId: s.refProjectId ?? null,
          ...refOf(s),
        };
      });
    }
    return [];
  };
}

export interface HarnessOptions {
  user?: ReturnType<typeof fakeUser>;
  /** port ไฟล์ DMS ปลอม (ไม่ส่ง = ยังไม่มี provider) */
  dms?: unknown;
  sysConfig?: { getNumber: (key: string, fallback: number) => Promise<number> };
  notifications?: { send: (input: unknown) => Promise<void> };
}

/** ประกอบ service ของ RGP ทั้งชุดบน MemoryDb สองฐาน (main = CMS_DB, project = BUI_RG) */
export function makeHarness(opts: HarnessOptions = {}) {
  const main = new MemoryDb();
  const project = new MemoryDb();
  const tx = new FakeTransactionRunner(main, project);
  installMainQueryEmulation(main);
  const user = opts.user ?? fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });
  const { service: crud, sink } = makeCrudLog({ user });

  const repo = (e: Function) => main.repo(e) as never; // eslint-disable-line @typescript-eslint/no-unsafe-function-type
  const projectRepo = (e: Function) => project.repo(e) as never; // eslint-disable-line @typescript-eslint/no-unsafe-function-type
  const ds = main as never;

  const audit = new ProjectAuditService(crud, tx as never, repo(ProjectAuditLog));
  const runningNumbers = new RunningNumberService(crud);
  const states = new ProjectStatesService(
    crud,
    ds,
    repo(ProjectState),
    repo(Project),
    tx as never,
    audit,
  );
  const stateMembers = new StateMembersService(
    crud,
    repo(ProjectStateMember),
    repo(ProjectNotifyLog),
    repo(ProjectState),
    tx as never,
  );
  const progress = new ProjectProgressService(
    crud,
    ds,
    repo(ProjectProgress),
    repo(ProjectState),
    repo(Project),
    tx as never,
  );
  const tasks = new ProjectTasksService(
    crud,
    repo(ProjectTask),
    repo(ProjectTaskComment),
    repo(ProjectTaskStatusLog),
    repo(ProjectState),
    repo(Project),
    tx as never,
    audit,
    runningNumbers,
  );
  const documents = new ProjectDocumentsService(
    crud,
    repo(ProjectDocWorkflow),
    repo(ProjectState),
    repo(Project),
    tx as never,
  );
  const members = new ProjectMembersService(crud, repo(ProjectMember), repo(Project), tx as never);
  const roles = new MemberRolesService(crud, repo(ProjectMemberRole));
  const attachments = new ProjectAttachmentsService(
    crud,
    ds,
    repo(ProjectAttachment),
    repo(Project),
    tx as never,
    (opts.sysConfig ?? { getNumber: async (_k: string, f: number) => f }) as never,
    opts.dms as never,
  );
  const templates = new ProjectTemplatesService(
    crud,
    ds,
    repo(ProjectTemplate),
    repo(TemplateState),
    repo(TemplateDoc),
    repo(Project),
    projectRepo(MasterDocument),
    tx as never,
  );
  const projects = new ProjectsService(
    crud,
    ds,
    repo(Project),
    repo(ProjectTemplate),
    tx as never,
    audit,
    runningNumbers,
    states,
    documents,
    members,
  );
  const notify = new StateNotifyService(
    crud,
    repo(ProjectStateMember),
    repo(ProjectNotifyLog),
    repo(ProjectState),
    repo(Project),
    repo(Employee) as never, // แทน UserAccount repo — ไม่ใช้ใน harness พื้นฐาน (เทสต์ notify ประกอบเอง)
    tasks,
    (opts.notifications ?? { send: async () => undefined }) as never,
  );

  return {
    main,
    project,
    tx,
    user,
    crud,
    sink,
    audit,
    runningNumbers,
    states,
    stateMembers,
    progress,
    tasks,
    documents,
    members,
    roles,
    attachments,
    templates,
    projects,
    notify,
    MasterDocumentType,
  };
}

export type Harness = ReturnType<typeof makeHarness>;

/** สร้างโครงการ + ขั้นตอนตั้งต้นลง MemoryDb โดยตรง (ข้าม service) */
export function seedProject(
  h: Harness,
  opts: {
    projectNo?: string;
    status?: string;
    createUser?: string;
    templateId?: number | null;
    startDate?: string | null;
    dueDate?: string | null;
    states?: { name: string; required?: boolean; status?: string; estimatedDays?: number }[];
  } = {},
) {
  const [p] = h.main.seed(Project, [
    {
      projectNo: opts.projectNo ?? 'PRJ-26-000001',
      projectName: 'โครงการทดสอบ',
      templateId: opts.templateId ?? null,
      status: opts.status ?? 'Open',
      active: 'Y',
      startDate: opts.startDate ?? null,
      dueDate: opts.dueDate ?? null,
      createUser: opts.createUser ?? 'somchai',
      createDate: new Date(),
    },
  ]);
  const stateRows = h.main.seed(
    ProjectState,
    (opts.states ?? []).map((s, i) => ({
      projectId: p.projectId,
      stateName: s.name,
      seqNo: i + 1,
      required: s.required === false ? 'N' : 'Y',
      status: s.status ?? 'Pending',
      estimatedDays: s.estimatedDays ?? null,
      createUser: 'somchai',
      createDate: new Date(),
    })),
  );
  return { project: p as Project, states: stateRows as ProjectState[] };
}
