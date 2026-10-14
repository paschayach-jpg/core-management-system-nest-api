/**
 * กฎระดับสิทธิ์ตามชั้นความลับ (EMS.FolderAuthorityConfig) — ฟังก์ชันล้วน
 * พอร์ตจาก FolderAuthorityService / AuthorityImportService (04-business-rules §1.3)
 */

export const LEVEL_CODES = ['1HC', '2SC', '3NC', '4PC'] as const;
export type LevelCode = (typeof LEVEL_CODES)[number];

export const levelCodeOf = (level: number): LevelCode | null => LEVEL_CODES[level - 1] ?? null;

/** รูปแบบ Level ของพนักงาน เช่น 1A, 5C (EMS.UserAccount.LevelCode) */
export const EMPLOYEE_LEVEL_PATTERN = /^[1-9][A-Z]$/;

// ── ลำดับความสำคัญของการ resolve ───────────────────────────

export type ResolveMatch =
  'LEVEL_DEPARTMENT' | 'LEVEL' | 'POSITION' | 'DEPARTMENT' | 'DIVISION' | 'NONE';

export interface ResolveParams {
  levelCode?: string | null;
  positionName?: string | null;
  departmentCode?: string | null;
  divisionCode?: string | null;
}

export interface ResolvedRowLite {
  levelCode?: string | null;
  positionName?: string | null;
  departmentCode?: string | null;
  divisionCode?: string | null;
}

const blank = (s: string | null | undefined): boolean =>
  s === null || s === undefined || s.trim() === '';

/**
 * บอกว่า sp_ResolveFolderAuthority เลือกชุดกฎจากลำดับไหน (ดูจากแถวแรกที่ได้กลับมา):
 *  0 LevelCode+DepartmentCode → 1 LevelCode (ไม่ระบุแผนก) → 2 PositionName → 3 DepartmentCode ล้วน → 4 DivisionCode ล้วน
 * SP หยุดที่ระดับแรกที่พบ จึงตัดสินจากแถวที่ได้ตามลำดับเดียวกัน
 */
export function describeResolveMatch(
  params: ResolveParams,
  first: ResolvedRowLite | undefined,
): ResolveMatch {
  if (!first) return 'NONE';
  const eq = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? '').trim() === (b ?? '').trim();
  if (
    !blank(params.levelCode) &&
    !blank(params.departmentCode) &&
    eq(first.levelCode, params.levelCode) &&
    eq(first.departmentCode, params.departmentCode)
  ) {
    return 'LEVEL_DEPARTMENT';
  }
  if (
    !blank(params.levelCode) &&
    eq(first.levelCode, params.levelCode) &&
    blank(first.departmentCode)
  ) {
    return 'LEVEL';
  }
  if (!blank(params.positionName) && eq(first.positionName, params.positionName)) return 'POSITION';
  if (
    !blank(params.departmentCode) &&
    eq(first.departmentCode, params.departmentCode) &&
    blank(first.positionName) &&
    blank(first.levelCode)
  ) {
    return 'DEPARTMENT';
  }
  return 'DIVISION';
}

// ── ตรวจข้อมูลที่บันทึก ────────────────────────────────────

export interface ConfigInput {
  configLabel: string;
  positionName?: string | null;
  departmentCode?: string | null;
  divisionCode?: string | null;
  levelCode?: string | null;
  confidentialityLevel: number;
}

/** ปัญหาของข้อมูล config (ข้อความภาษาไทย) — null = ผ่าน */
export function validateConfigInput(c: ConfigInput): { code: string; message: string } | null {
  if (!c.configLabel || c.configLabel.trim() === '') {
    return { code: 'AUTHORITY_LABEL_REQUIRED', message: 'ConfigLabel ต้องไม่ว่าง' };
  }
  if (
    !Number.isInteger(c.confidentialityLevel) ||
    c.confidentialityLevel < 1 ||
    c.confidentialityLevel > 4
  ) {
    return { code: 'AUTHORITY_LEVEL_INVALID', message: 'ConfidentialityLevel ต้องเป็น 1-4' };
  }
  // LevelCode ในตารางมี 2 ความหมายปะปนกัน: รหัสชั้นความลับ (1HC..4PC — SP คำนวณให้ถ้าไม่ส่ง) หรือ Level ของพนักงาน
  // (เช่น 5C — ใช้จับคู่ใน sp_ResolveFolderAuthority) จึงไม่บังคับให้ตรงกับ ConfidentialityLevel ตรวจแค่ความยาวคอลัมน์ (nchar(10))
  if (!blank(c.levelCode) && (c.levelCode as string).trim().length > 10) {
    return { code: 'AUTHORITY_LEVELCODE_INVALID', message: 'LevelCode ยาวเกิน 10 ตัวอักษร' };
  }
  if (
    blank(c.positionName) &&
    blank(c.departmentCode) &&
    blank(c.divisionCode) &&
    blank(c.levelCode)
  ) {
    // config ที่ไม่ระบุขอบเขตใดเลยจะไม่ถูกจับคู่โดย sp_ResolveFolderAuthority เลย
    return {
      code: 'AUTHORITY_SCOPE_REQUIRED',
      message: 'ต้องระบุอย่างน้อยหนึ่งอย่าง: ตำแหน่ง, รหัสแผนก, รหัสฝ่าย หรือ LevelCode',
    };
  }
  return null;
}

// ── นำเข้าจาก Excel ─────────────────────────────────────────

export type ImportSeverity = 'Warning' | 'Error';
export type ImportStatus = 'New' | 'Updated' | 'Unchanged' | 'NotFound';

export interface ImportIssue {
  /** แถวใน Excel (เริ่มที่ 1) · 0 = ระดับไฟล์ */
  rowNumber: number;
  severity: ImportSeverity;
  code: string;
  message: string;
}

/** แถวพนักงาน 1 แถว · permissions[levelIndex*4 + action]: levelIndex 0=HC,1=SC,2=NC,3=PC · action 0=ดู,1=เพิ่ม,2=แก้ไข,3=อนุมัติ */
export interface ImportRow {
  rowNumber: number;
  employeeCode: string;
  employeeName: string;
  level: string;
  position: string;
  department: string;
  division: string;
  remark: string;
  permissions: boolean[];
}

export interface ExistingConfig {
  configId: number;
  configLabel: string;
  positionName: string | null;
  departmentCode: string | null;
  divisionCode: string | null;
  confidentialityLevel: number;
  levelCode: string | null;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canDownload: boolean;
}

export interface PositionPlan {
  label: string;
  positionName: string;
  departmentCode: string | null;
  divisionCode: string | null;
  permissions: boolean[];
  status: ImportStatus;
}

export interface LevelPlan {
  employeeCode: string;
  employeeName: string;
  userId: number | null;
  oldLevel: string;
  newLevel: string;
  status: ImportStatus;
}

export interface ImportUser {
  userId: number;
  employeeCode: string | null;
  levelCode: string | null;
}

const issue = (
  rowNumber: number,
  severity: ImportSeverity,
  code: string,
  message: string,
): ImportIssue => ({ rowNumber, severity, code, message });

/** ตรวจแถวที่อ่านได้ (ValidateRows เดิม) */
export function validateImportRows(
  rows: ImportRow[],
  opts: { checkLevel: boolean; checkPositions: boolean },
): ImportIssue[] {
  const out: ImportIssue[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (opts.checkPositions && !r.position) {
      out.push(
        issue(
          r.rowNumber,
          'Warning',
          'MISSING_POSITION',
          'ไม่มีตำแหน่ง ข้ามการอัปเดตสิทธิ์ของแถวนี้ (Level ยังอัปเดตตามปกติ)',
        ),
      );
    }
    const key = r.employeeCode.toLowerCase();
    if (seen.has(key)) {
      out.push(
        issue(
          r.rowNumber,
          'Error',
          'DUPLICATE_EMPLOYEE',
          `รหัสพนักงานซ้ำในไฟล์: ${r.employeeCode}`,
        ),
      );
    }
    seen.add(key);
    if (opts.checkLevel && !EMPLOYEE_LEVEL_PATTERN.test(r.level)) {
      out.push(
        issue(r.rowNumber, 'Error', 'INVALID_LEVEL', `รูปแบบ Level ไม่ถูกต้อง: "${r.level}"`),
      );
    }
    if (!opts.checkPositions) continue;
    for (let g = 0; g < 4; g++) {
      if (r.permissions[g * 4 + 3] && !r.permissions[g * 4]) {
        out.push(
          issue(
            r.rowNumber,
            'Warning',
            'APPROVE_WITHOUT_VIEW',
            `มีสิทธิ์อนุมัติแต่ไม่มีสิทธิ์ดู (${LEVEL_CODES[g]})`,
          ),
        );
      }
    }
    if (r.remark) out.push(issue(r.rowNumber, 'Warning', 'REMARK', `หมายเหตุ: ${r.remark}`));
  }
  return out;
}

/**
 * แผนสิทธิ์ตามตำแหน่ง: อัปเดตเท่านั้น — ตำแหน่งที่มี config อยู่แล้ว (จับคู่ ConfigLabel = ชื่อตำแหน่ง ไม่สนตัวพิมพ์)
 * คงแผนก/ฝ่ายเดิมไว้ · ตำแหน่งที่ยังไม่มี config ข้ามพร้อมคำเตือน (ไม่สร้างใหม่) ·
 * หลายแถวของตำแหน่งเดียวกันรวมสิทธิ์ (ติ๊กถ้าแถวใดแถวหนึ่งติ๊ก) พร้อมคำเตือน
 */
export function planPositionImport(
  rows: ImportRow[],
  existing: ExistingConfig[],
): { plans: PositionPlan[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const plans: PositionPlan[] = [];
  const byLabel = new Map<string, ExistingConfig[]>();
  for (const c of existing) {
    const k = (c.configLabel ?? '').toLowerCase();
    byLabel.set(k, [...(byLabel.get(k) ?? []), c]);
  }

  const groups = new Map<string, ImportRow[]>();
  for (const r of rows) {
    if (!r.position) continue;
    const k = r.position.trim().toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  for (const [key, grp] of groups) {
    const first = grp[0];
    const configs = byLabel.get(key);
    if (!configs || configs.length === 0) {
      issues.push(
        issue(
          first.rowNumber,
          'Warning',
          'POSITION_NOT_FOUND',
          `ไม่พบ config ของตำแหน่ง "${first.position.trim()}" ในระบบ จึงไม่อัปเดตสิทธิ์ตำแหน่งนี้ (ไม่สร้างใหม่)`,
        ),
      );
      continue;
    }
    const perms = [...first.permissions];
    const merged: number[] = [];
    for (const r of grp.slice(1)) {
      if (r.permissions.every((v, i) => v === first.permissions[i])) continue;
      for (let i = 0; i < 16; i++) perms[i] = perms[i] || r.permissions[i];
      merged.push(r.rowNumber);
    }
    if (merged.length > 0) {
      issues.push(
        issue(
          first.rowNumber,
          'Warning',
          'POSITION_MERGED',
          `ตำแหน่ง "${first.position.trim()}" มีสิทธิ์ไม่ตรงกันในแถว ${[first.rowNumber, ...merged].join(', ')} จึงรวมสิทธิ์ (ติ๊กถ้าแถวใดแถวหนึ่งติ๊ก)`,
        ),
      );
    }
    const head = configs[0];
    const plan: PositionPlan = {
      label: head.configLabel,
      positionName: head.positionName ?? first.position.trim(),
      departmentCode: head.departmentCode,
      divisionCode: head.divisionCode,
      permissions: perms,
      status: 'Updated',
    };
    plan.status = samePermissions(perms, configs) ? 'Unchanged' : 'Updated';
    plans.push(plan);
  }
  return { plans, issues };
}

function samePermissions(perms: boolean[], configs: ExistingConfig[]): boolean {
  for (let g = 0; g < 4; g++) {
    const row = configs.find((c) => c.confidentialityLevel === g + 1);
    const cur = [
      row?.canView ?? false,
      row?.canAdd ?? false,
      row?.canEdit ?? false,
      row?.canApprove ?? false,
    ];
    for (let a = 0; a < 4; a++) if (cur[a] !== perms[g * 4 + a]) return false;
  }
  return true;
}

/** แผนอัปเดต Level ของผู้ใช้ (จับคู่ด้วย EmployeeCode ไม่สนตัวพิมพ์/ช่องว่าง) */
export function planLevelImport(
  rows: ImportRow[],
  users: ImportUser[],
): { plans: LevelPlan[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const plans: LevelPlan[] = [];
  const byCode = new Map<string, ImportUser>();
  for (const u of users) {
    const k = (u.employeeCode ?? '').trim().toLowerCase();
    if (k && !byCode.has(k)) byCode.set(k, u);
  }
  for (const r of rows) {
    const u = byCode.get(r.employeeCode.toLowerCase());
    if (!u) {
      plans.push({
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        userId: null,
        oldLevel: '',
        newLevel: r.level,
        status: 'NotFound',
      });
      issues.push(
        issue(
          r.rowNumber,
          'Warning',
          'USER_NOT_FOUND',
          `ไม่พบผู้ใช้รหัส ${r.employeeCode} ในระบบ (อาจยังไม่เคย login) ข้ามการอัปเดต Level`,
        ),
      );
      continue;
    }
    const old = (u.levelCode ?? '').trim().toUpperCase();
    plans.push({
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      userId: u.userId,
      oldLevel: old,
      newLevel: r.level,
      status: old === r.level ? 'Unchanged' : 'Updated',
    });
  }
  return { plans, issues };
}
