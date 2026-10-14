import { Injectable } from '@nestjs/common';
import { AppRole } from '../../../../common/constants/enums';
import {
  BusinessException,
  PermissionDeniedException,
} from '../../../../common/exceptions/business.exception';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { TransactionRunner } from '../../../../database/transaction-runner.service';
import { UserContextService } from '../../../auth/services/user-context.service';
import { buildAuthorityTemplate, listSheetNames, parseAuthorityWorkbook } from './authority-excel';
import {
  ImportIssue,
  LEVEL_CODES,
  LevelPlan,
  planLevelImport,
  planPositionImport,
  PositionPlan,
  validateImportRows,
} from './authority-rules';
import { AuthorityStore } from './authority.store';
import type {
  AuthorityImportOptionsDto,
  AuthorityImportPreviewDto,
  AuthorityImportResultDto,
} from './dto/authority.dto';

interface ImportPlan {
  sheetName: string;
  rowCount: number;
  issues: ImportIssue[];
  positionPlans: PositionPlan[];
  levelPlans: LevelPlan[];
  importPositions: boolean;
  updateUserLevel: boolean;
}

/**
 * นำเข้าสิทธิ์จาก Excel (AuthorityImportService.BuildPreview/Commit) — เฉพาะ Admin
 *
 * หมายเหตุ: ระบบเดิมที่ compile ไม่ได้เรียก EMS.sp_UpsertUserAuthority (ตาราง EMS.UserAuthority ไม่มี DDL และโค้ดไม่ใช้) —
 * การนำเข้าจริงคือ (1) อัปเดตสิทธิ์ 4 ชั้นความลับของตำแหน่งที่มี config อยู่แล้ว (2) อัปเดต EMS.UserAccount.LevelCode
 * จึงพอร์ตตามนั้น (ดู docs ข้อ 3)
 *
 * ต่างจากเดิม: commit ทั้งก้อนอยู่ใน transaction เดียว (เดิมใช้ undo stack ย้อนเอง) และอัปเดตแถวเดิมแทนการ soft delete + insert ใหม่
 * ซึ่งทำให้ค่า CanDownload ของตำแหน่งนั้นหายไป
 */
@Injectable()
export class AuthorityImportService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'FolderAuthorityConfig';

  constructor(
    crudLog: CrudLogService,
    private readonly store: AuthorityStore,
    private readonly tx: TransactionRunner,
    private readonly userCtx: UserContextService,
  ) {
    super(crudLog);
  }

  async template(user: UserContext): Promise<Buffer> {
    this.assertAdmin(user);
    return buildAuthorityTemplate();
  }

  async sheetNames(buffer: Buffer, user: UserContext): Promise<string[]> {
    this.assertAdmin(user);
    return listSheetNames(buffer);
  }

  /** แสดงผลที่จะเกิดขึ้นโดยไม่เขียนอะไร */
  async preview(
    buffer: Buffer,
    opts: AuthorityImportOptionsDto,
    user: UserContext,
  ): Promise<AuthorityImportPreviewDto> {
    this.assertAdmin(user);
    const plan = await this.buildPlan(buffer, opts);
    const errors = plan.issues.some((i) => i.severity === 'Error');
    const posChanged = plan.positionPlans.filter((p) => p.status !== 'Unchanged').length;
    const lvlChanged = plan.levelPlans.filter((p) => p.status === 'Updated').length;
    return {
      sheetName: plan.sheetName,
      rowCount: plan.rowCount,
      issues: plan.issues,
      positionPlans: plan.positionPlans,
      levelPlans: plan.levelPlans,
      hasErrors: errors,
      hasChanges: posChanged + lvlChanged > 0,
      positionsUpdated: posChanged,
      positionsUnchanged: plan.positionPlans.length - posChanged,
      levelChanges: lvlChanged,
    };
  }

  /** นำเข้าจริง (ต้อง preview ไม่มี Error) — คำนวณแผนใหม่จากไฟล์ที่ส่งมาอีกครั้งเพื่อให้ตรงกับข้อมูลปัจจุบันเสมอ */
  commit(
    buffer: Buffer,
    opts: AuthorityImportOptionsDto,
    user: UserContext,
  ): Promise<AuthorityImportResultDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'IMPORT_AUTHORITY', meta: { sheet: opts.sheetName ?? null } },
      async () => {
        this.assertAdmin(user);
        const plan = await this.buildPlan(buffer, opts);
        const errors = plan.issues.filter((i) => i.severity === 'Error');
        if (errors.length > 0) {
          throw new BusinessException(
            'ไม่สามารถนำเข้าได้ เพราะยังมี Error',
            'AUTHORITY_IMPORT_HAS_ERRORS',
            {
              issues: errors,
            },
          );
        }
        const positionPlans = plan.positionPlans.filter((p) => p.status !== 'Unchanged');
        const levelPlans = plan.levelPlans.filter(
          (p) => p.status === 'Updated' && p.userId !== null,
        );
        if (positionPlans.length === 0 && levelPlans.length === 0) {
          return { configsUpdated: 0, levelsChanged: 0 };
        }

        await this.tx.run(async (t) => {
          const existing = await this.store.allActive(t);
          for (const p of positionPlans) {
            const mine = existing.filter(
              (c) => c.configLabel.toLowerCase() === p.label.toLowerCase(),
            );
            for (let g = 0; g < 4; g++) {
              const level = g + 1;
              const flags = {
                canView: p.permissions[g * 4],
                canAdd: p.permissions[g * 4 + 1],
                canEdit: p.permissions[g * 4 + 2],
                canApprove: p.permissions[g * 4 + 3],
              };
              const rows = mine.filter((c) => c.confidentialityLevel === level);
              if (rows.length > 0) {
                for (const row of rows) {
                  await this.store.update(
                    t,
                    row.configId,
                    {
                      configLabel: row.configLabel,
                      positionName: row.positionName,
                      departmentCode: row.departmentCode,
                      divisionCode: row.divisionCode,
                      levelCode: row.levelCode ?? LEVEL_CODES[g],
                      confidentialityLevel: level,
                      ...flags, // canDownload ไม่ส่ง = คงค่าเดิม
                    },
                    user.userId,
                  );
                }
              } else {
                await this.store.insert(
                  t,
                  {
                    configLabel: p.label,
                    positionName: p.positionName,
                    departmentCode: p.departmentCode,
                    divisionCode: p.divisionCode,
                    levelCode: LEVEL_CODES[g],
                    confidentialityLevel: level,
                    ...flags,
                  },
                  user.userId,
                );
              }
            }
          }
          if (plan.updateUserLevel) {
            for (const lp of levelPlans)
              await this.store.updateUserLevel(t, lp.userId as number, lp.newLevel);
          }
        });

        if (plan.updateUserLevel) {
          for (const lp of levelPlans) {
            await this.userCtx.invalidate(lp.userId as number);
            this.logEvent({
              action: 'UPDATE',
              entity: 'UserAccount',
              operation: 'AUTHORITY_IMPORT_USER_LEVEL',
              recordId: lp.userId as number,
              before: { employeeCode: lp.employeeCode, levelCode: lp.oldLevel },
              after: { levelCode: lp.newLevel },
            });
          }
        }
        return {
          configsUpdated: positionPlans.length,
          levelsChanged: plan.updateUserLevel ? levelPlans.length : 0,
        };
      },
      (r) => ({ after: r }),
    );
  }

  // ── แผน (ใช้ร่วมกันระหว่าง preview/commit) ─────────────────

  private async buildPlan(buffer: Buffer, opts: AuthorityImportOptionsDto): Promise<ImportPlan> {
    const importPositions = opts.importPositions ?? true;
    const updateUserLevel = opts.updateUserLevel ?? false;
    if (!importPositions && !updateUserLevel) {
      throw new BusinessException(
        'ต้องเลือกอย่างน้อยหนึ่งอย่าง: อัปเดตสิทธิ์ตำแหน่ง หรืออัปเดต Level',
        'AUTHORITY_IMPORT_NO_MODE',
      );
    }
    const parsed = await parseAuthorityWorkbook(buffer, opts.sheetName);
    let issues = [...parsed.issues];
    // โหมดนำเข้า Level อย่างเดียวไม่สนใจช่องสิทธิ์ จึงไม่เตือนค่าที่ไม่ใช่ X
    if (!importPositions) issues = issues.filter((i) => i.code !== 'UNEXPECTED_CELL');
    const base: ImportPlan = {
      sheetName: parsed.sheetName,
      rowCount: parsed.rows.length,
      issues,
      positionPlans: [],
      levelPlans: [],
      importPositions,
      updateUserLevel,
    };
    if (issues.some((i) => i.severity === 'Error')) return base;

    issues.push(
      ...validateImportRows(parsed.rows, {
        checkLevel: updateUserLevel,
        checkPositions: importPositions,
      }),
    );
    if (importPositions) {
      const existing = await this.store.allActive();
      const r = planPositionImport(parsed.rows, existing);
      base.positionPlans = r.plans;
      issues.push(...r.issues);
    }
    if (updateUserLevel) {
      const users = await this.store.usersWithEmployeeCode();
      const r = planLevelImport(parsed.rows, users);
      base.levelPlans = r.plans;
      issues.push(...r.issues);
    }
    return base;
  }

  private assertAdmin(user: UserContext): void {
    if (user.appRole < AppRole.Admin) {
      throw new PermissionDeniedException(
        'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่นำเข้าสิทธิ์ได้',
        'ROLE_REQUIRED',
      );
    }
  }
}
