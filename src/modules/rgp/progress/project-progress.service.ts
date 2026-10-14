import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../database/transaction-runner.service';
import { applyStateProgress, requireActiveProject, requireState } from '../common/project-ops';
import { rgpActor } from '../common/rgp-actor';
import { fromYesNo, overallProjectPct } from '../common/rgp-rules';
import { LATEST_PROGRESS_BY_PROJECT_SQL } from '../common/rgp-sql';
import { Project } from '../entities/project.entity';
import { ProjectProgress } from '../entities/project-progress.entity';
import { ProjectState } from '../entities/project-state.entity';
import type {
  LatestProgressDto,
  ProgressHistoryDto,
  ProgressResultDto,
  ProjectProgressOverviewDto,
  UpdateProgressDto,
} from './dto/progress.dto';

type LatestRow = Omit<LatestProgressDto, 'required'> & { required: string };

/**
 * ความคืบหน้าของขั้นตอน (`RGP.t_project_progress`) — พอร์ตจาก ProjectProgressService
 * บันทึกแล้ว: ตั้งสถานะ state ตาม % (0=Pending, 100=Completed, อื่นๆ=InProgress) → คำนวณสถานะโครงการใหม่ (ดู project-ops.ts)
 */
@Injectable()
export class ProjectProgressService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'ProjectProgress';

  constructor(
    crudLog: CrudLogService,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(ProjectProgress) private readonly repo: Repository<ProjectProgress>,
    @InjectRepository(ProjectState) private readonly states: Repository<ProjectState>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly tx: TransactionRunner,
  ) {
    super(crudLog);
  }

  /** บันทึกความคืบหน้าของขั้นตอน — ทั้งสามขั้น (progress → สถานะ state → สถานะโครงการ) อยู่ใน transaction เดียว */
  update(
    projStateId: number,
    dto: UpdateProgressDto,
    user: UserContext,
  ): Promise<ProgressResultDto> {
    return this.logged(
      {
        action: 'CREATE',
        operation: 'UPDATE_STATE_PROGRESS',
        meta: { projStateId, pctComplete: dto.pctComplete },
      },
      async () => {
        const applied = await this.tx.run(async ({ manager }) => {
          const state = await requireState(manager, projStateId);
          await requireActiveProject(manager, state.projectId);
          return applyStateProgress(manager, {
            projStateId,
            pctComplete: dto.pctComplete,
            remark: dto.remark,
            actor: rgpActor(user),
          });
        });
        const overview = await this.overview(applied.projectId);
        return {
          progressId: applied.progressId,
          projStateId: applied.projStateId,
          projectId: applied.projectId,
          pctComplete: applied.pctComplete,
          stateStatus: applied.stateStatus,
          projectStatus: applied.projectStatus,
          projectPctOverall: overview.pctOverall,
        };
      },
      (r) => ({ recordId: r.progressId, after: r }),
    );
  }

  /** ประวัติความคืบหน้าของขั้นตอน (ใหม่สุดก่อน) */
  async history(projStateId: number): Promise<ProgressHistoryDto[]> {
    const state = await this.states.findOneBy({ projStateId });
    if (!state) throw new ResourceNotFoundException('ขั้นตอน (state)', projStateId);
    const rows = await this.repo.find({
      where: { projStateId },
      order: { actionDate: 'DESC', progressId: 'DESC' },
    });
    return rows.map((r) => ({
      progressId: r.progressId,
      projStateId: r.projStateId,
      projectId: r.projectId,
      stateName: state.stateName,
      status: r.status,
      pctComplete: r.pctComplete ?? 0,
      remark: r.remark ?? null,
      actionDate: r.actionDate as Date,
      actionUser: r.actionUser,
    }));
  }

  /** ความคืบหน้าล่าสุดต่อขั้นตอน + % รวมของโครงการ (แท็บ Progress) */
  async overview(projectId: number): Promise<ProjectProgressOverviewDto> {
    if (!(await this.projects.existsBy({ projectId, active: 'Y' }))) {
      throw new ResourceNotFoundException('โครงการ', projectId);
    }
    const rows: LatestRow[] = await this.ds.query(LATEST_PROGRESS_BY_PROJECT_SQL, [projectId]);
    const states: LatestProgressDto[] = rows.map((r) => ({
      ...r,
      required: fromYesNo(r.required),
      pctComplete: Number(r.pctComplete ?? 0),
      refPctOverall: Number(r.refPctOverall ?? 0),
    }));
    return {
      projectId,
      pctOverall: overallProjectPct(
        states.map((s) => ({
          pct: s.pctComplete,
          refProjectId: s.refProjectId,
          refPctOverall: s.refPctOverall,
        })),
      ),
      states,
    };
  }
}
