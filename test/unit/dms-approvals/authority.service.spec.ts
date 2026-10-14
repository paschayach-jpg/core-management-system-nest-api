import ExcelJS from 'exceljs';
import { AppRole } from '../../../src/common/constants/enums';
import { BusinessException } from '../../../src/common/exceptions/business.exception';
import { buildAuthorityTemplate } from '../../../src/modules/dms/approvals/authority/authority-excel';
import { AuthorityImportService } from '../../../src/modules/dms/approvals/authority/authority-import.service';
import { FolderAuthorityService } from '../../../src/modules/dms/approvals/authority/authority.service';
import type {
  AuthorityConfigRow,
  SaveConfigInput,
} from '../../../src/modules/dms/approvals/authority/authority.store';
import { fakeUser, makeCrudLog } from '../../helpers/stubs';

const ADMIN = fakeUser({ userId: 1, appRole: AppRole.Admin });
const MGR = fakeUser({ userId: 2, appRole: AppRole.Manager });

function make() {
  let nextId = 100;
  const rows: AuthorityConfigRow[] = [];
  const users = [
    { userId: 51, employeeCode: 'E001', levelCode: '1A' },
    { userId: 52, employeeCode: 'E002', levelCode: '2B' },
  ];
  const calls: string[] = [];
  const seed = (
    label: string,
    level: number,
    flags: [boolean, boolean, boolean, boolean],
    extra: Partial<AuthorityConfigRow> = {},
  ) =>
    rows.push({
      configId: nextId++,
      configLabel: label,
      positionName: label,
      departmentCode: 'D1',
      divisionCode: null,
      levelCode: ['1HC', '2SC', '3NC', '4PC'][level - 1],
      confidentialityLevel: level,
      canView: flags[0],
      canAdd: flags[1],
      canEdit: flags[2],
      canApprove: flags[3],
      canDownload: false,
      isActive: true,
      updatedDate: null,
      ...extra,
    });
  let failLevelUpdate = false;
  const store = {
    page: async () => ({ items: rows.filter((r) => r.isActive), total: rows.length }),
    get: async (id: number) => rows.find((r) => r.configId === id) ?? null,
    allActive: async () => rows.filter((r) => r.isActive),
    findActive: async (label: string, level: number, exclude: number | null) =>
      rows.find(
        (r) =>
          r.isActive &&
          r.configLabel === label &&
          r.confidentialityLevel === level &&
          r.configId !== exclude,
      ) ?? null,
    countActiveByLabel: async (label: string) =>
      rows.filter((r) => r.isActive && r.configLabel === label).length,
    insert: async (_t: unknown, c: SaveConfigInput, by: number) => {
      calls.push(`insert:${c.configLabel}:${c.confidentialityLevel}:${c.levelCode}:by${by}`);
      seed(c.configLabel, c.confidentialityLevel, [c.canView, c.canAdd, c.canEdit, c.canApprove], {
        positionName: c.positionName ?? null,
        departmentCode: c.departmentCode ?? null,
        divisionCode: c.divisionCode ?? null,
        levelCode: c.levelCode ?? null,
        canDownload: c.canDownload ?? false,
      });
      return rows[rows.length - 1].configId;
    },
    update: async (_t: unknown, id: number, c: SaveConfigInput, by: number) => {
      calls.push(
        `update:${id}:${c.confidentialityLevel}:${c.levelCode}:download=${c.canDownload}:by${by}`,
      );
      const r = rows.find((x) => x.configId === id) as AuthorityConfigRow;
      Object.assign(r, {
        canView: c.canView,
        canAdd: c.canAdd,
        canEdit: c.canEdit,
        canApprove: c.canApprove,
        levelCode: c.levelCode ?? r.levelCode,
      });
      if (c.canDownload !== undefined) r.canDownload = c.canDownload;
    },
    softDeleteGroup: async (_t: unknown, label: string) =>
      rows.filter((r) => r.configLabel === label).forEach((r) => (r.isActive = false)),
    resolve: async (p: { positionName?: string }) =>
      rows.filter((r) => r.isActive && r.positionName === p.positionName),
    usersWithEmployeeCode: async () => users,
    updateUserLevel: async (_t: unknown, userId: number, level: string) => {
      if (failLevelUpdate) throw new Error('UPDATE UserAccount ล้ม');
      users.find((u) => u.userId === userId)!.levelCode = level;
      calls.push(`level:${userId}:${level}`);
    },
  };
  const tx = {
    run: async <T>(work: (s: object) => Promise<T>): Promise<T> => {
      const snap = structuredClone({ rows, users });
      try {
        return await work({ manager: {}, sp: {} });
      } catch (e) {
        rows.splice(0, rows.length, ...snap.rows);
        users.splice(0, users.length, ...snap.users);
        throw e;
      }
    },
  };
  const invalidated: number[] = [];
  const userCtx = { invalidate: async (id: number) => void invalidated.push(id) };
  const { service: crud, sink } = makeCrudLog();
  return {
    rows,
    users,
    calls,
    invalidated,
    sink,
    crud,
    seed,
    failLevels: () => (failLevelUpdate = true),
    config: new FolderAuthorityService(crud, store as never, tx as never),
    importer: new AuthorityImportService(crud, store as never, tx as never, userCtx as never),
  };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: BusinessException) => (e.getResponse() as { code: string }).code,
  );
const dto = (over: object = {}) => ({
  configLabel: 'ผู้จัดการ',
  positionName: 'ผู้จัดการ',
  departmentCode: 'D1',
  confidentialityLevel: 2,
  canView: true,
  canAdd: false,
  canEdit: false,
  canApprove: false,
  ...over,
});

describe('FolderAuthorityService — CRUD', () => {
  it('เพิ่ม: ตรวจข้อมูล · ซ้ำ (กลุ่ม+ชั้นความลับ) ปฏิเสธ · บันทึก CRUD-log', async () => {
    const t = make();
    expect(await code(t.config.create(dto({ confidentialityLevel: 7 }) as never, ADMIN))).toBe(
      'AUTHORITY_LEVEL_INVALID',
    );
    expect(
      await code(t.config.create(dto({ positionName: '', departmentCode: '' }) as never, ADMIN)),
    ).toBe('AUTHORITY_SCOPE_REQUIRED');
    const created = await t.config.create(dto({ canDownload: true }) as never, ADMIN);
    expect(created).toMatchObject({
      configLabel: 'ผู้จัดการ',
      confidentialityLevel: 2,
      canView: true,
      canDownload: true,
    });
    expect(await code(t.config.create(dto() as never, ADMIN))).toBe('AUTHORITY_DUPLICATE');
    await t.crud.drain();
    const events = t.sink.events.map((e) => e.success);
    expect(events).toEqual([false, false, true, false]); // ความล้มเหลวก็ถูกบันทึก (success=false)
    expect(t.sink.events[2]).toMatchObject({
      operation: 'SAVE_FOLDER_AUTHORITY',
      action: 'CREATE',
      module: 'DMS',
      entity: 'FolderAuthorityConfig',
    });
  });

  it('แก้: ไม่พบ 404 · ไม่ชนตัวเอง · ชนแถวอื่นของกลุ่มเดียวกันไม่ได้ · ไม่ส่ง canDownload = คงค่าเดิม', async () => {
    const t = make();
    t.seed('ผู้จัดการ', 1, [true, true, true, true], { canDownload: true });
    t.seed('ผู้จัดการ', 2, [true, false, false, false]);
    await expect(t.config.update(999, dto() as never, ADMIN)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await code(
        t.config.update(t.rows[1].configId, dto({ confidentialityLevel: 1 }) as never, ADMIN),
      ),
    ).toBe('AUTHORITY_DUPLICATE');
    const u = await t.config.update(
      t.rows[0].configId,
      dto({ confidentialityLevel: 1, canView: false }) as never,
      ADMIN,
    );
    expect(u).toMatchObject({ canView: false, canDownload: true });
  });

  it('ลบ = soft delete ทั้งกลุ่มตาม ConfigLabel (ทุกชั้นความลับ) · ไม่พบกลุ่ม → 404', async () => {
    const t = make();
    t.seed('ผู้จัดการ', 1, [true, false, false, false]);
    t.seed('ผู้จัดการ', 2, [true, false, false, false]);
    t.seed('อื่น', 1, [true, false, false, false]);
    await expect(t.config.removeGroup('ไม่มี', ADMIN)).rejects.toMatchObject({ status: 404 });
    expect(await t.config.removeGroup('ผู้จัดการ', ADMIN)).toEqual({ deletedRows: 2 });
    expect(t.rows.filter((r) => r.isActive).map((r) => r.configLabel)).toEqual(['อื่น']);
    await t.crud.drain();
    expect(t.sink.events.at(-1)).toMatchObject({
      operation: 'DELETE_FOLDER_AUTHORITY_GROUP',
      action: 'DELETE',
    });
  });

  it('resolve: บอกลำดับที่ใช้ (matchedBy) พร้อมแถวต่อชั้น', async () => {
    const t = make();
    t.seed('ผู้จัดการ', 1, [true, false, false, false]);
    const r = await t.config.resolve({ positionName: 'ผู้จัดการ' } as never);
    expect(r.matchedBy).toBe('POSITION');
    expect(r.rows).toHaveLength(1);
    expect((await t.config.resolve({ positionName: 'ไม่มีตำแหน่งนี้' } as never)).matchedBy).toBe(
      'NONE',
    );
  });
});

describe('AuthorityImportService — นำเข้าจาก Excel', () => {
  /** template + แก้แถวตัวอย่างเป็นข้อมูลที่ต้องการ */
  async function file(
    rows: { code: string; level: string; position: string; marks: number[] }[],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildAuthorityTemplate()) as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    ws.spliceRows(3, 1);
    rows.forEach((r, i) => {
      const row = ws.getRow(3 + i);
      row.getCell(2).value = r.code;
      row.getCell(5).value = r.level;
      row.getCell(6).value = r.position;
      r.marks.forEach((m) => (row.getCell(9 + m).value = 'X'));
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('Admin เท่านั้น', async () => {
    const t = make();
    const buf = await file([{ code: 'E001', level: '1A', position: 'ผู้จัดการ', marks: [0] }]);
    await expect(t.importer.preview(buf, {}, MGR)).rejects.toMatchObject({ status: 403 });
    await expect(t.importer.commit(buf, {}, MGR)).rejects.toMatchObject({ status: 403 });
    await expect(t.importer.template(MGR)).rejects.toMatchObject({ status: 403 });
  });

  it('preview: นับสิ่งที่จะเปลี่ยน ไม่เขียนอะไร', async () => {
    const t = make();
    t.seed('ผู้จัดการ', 1, [true, false, false, false]);
    const buf = await file([
      { code: 'E001', level: '3C', position: 'ผู้จัดการ', marks: [0, 1, 4] },
    ]);
    const p = await t.importer.preview(
      buf,
      { importPositions: true, updateUserLevel: true },
      ADMIN,
    );
    expect(p).toMatchObject({
      hasErrors: false,
      hasChanges: true,
      positionsUpdated: 1,
      levelChanges: 1,
      rowCount: 1,
    });
    expect(t.calls).toEqual([]);
  });

  it('commit: อัปเดตแถวเดิมในที่ (คง CanDownload) + เพิ่มชั้นที่ขาด + อัปเดต Level + เคลียร์ cache ผู้ใช้', async () => {
    const t = make();
    t.seed('ผู้จัดการ', 1, [true, false, false, false], { canDownload: true });
    const buf = await file([
      { code: 'E001', level: '3C', position: 'ผู้จัดการ', marks: [0, 1, 4] },
    ]); // HC ดู+เพิ่ม, SC ดู
    const r = await t.importer.commit(buf, { importPositions: true, updateUserLevel: true }, ADMIN);
    expect(r).toEqual({ configsUpdated: 1, levelsChanged: 1 });

    expect(t.rows[0]).toMatchObject({ canView: true, canAdd: true, canDownload: true }); // ไม่ทำ CanDownload หาย (เดิม delete+insert ทำให้เป็น 0)
    expect(t.calls.filter((c) => c.startsWith('update'))).toEqual([
      'update:100:1:1HC:download=undefined:by1',
    ]);
    expect(t.calls.filter((c) => c.startsWith('insert'))).toEqual([
      'insert:ผู้จัดการ:2:2SC:by1',
      'insert:ผู้จัดการ:3:3NC:by1',
      'insert:ผู้จัดการ:4:4PC:by1',
    ]);
    expect(t.rows.find((x) => x.confidentialityLevel === 2)).toMatchObject({
      canView: true,
      departmentCode: 'D1',
    }); // คงแผนกเดิม
    expect(t.users[0].levelCode).toBe('3C');
    expect(t.invalidated).toEqual([51]);
    await t.crud.drain();
    expect(t.sink.events.map((e) => e.operation)).toEqual([
      'AUTHORITY_IMPORT_USER_LEVEL',
      'IMPORT_AUTHORITY',
    ]);
  });

  it('commit ล้มกลางทาง (อัปเดต Level ไม่สำเร็จ) → rollback สิทธิ์ตำแหน่งที่แก้ไปแล้วด้วย (เดิมต้องย้อนด้วยมือ)', async () => {
    const t = make();
    t.seed('ผู้จัดการ', 1, [true, false, false, false]);
    t.failLevels();
    const buf = await file([{ code: 'E001', level: '3C', position: 'ผู้จัดการ', marks: [0, 1] }]);
    await expect(
      t.importer.commit(buf, { importPositions: true, updateUserLevel: true }, ADMIN),
    ).rejects.toThrow('UPDATE UserAccount ล้ม');
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].canAdd).toBe(false);
    expect(t.invalidated).toEqual([]);
  });

  it('มี Error (รหัสพนักงานซ้ำ / Level ผิดรูปแบบ) → ไม่นำเข้า; ไม่เลือกโหมดใดเลย → ปฏิเสธ', async () => {
    const t = make();
    const dup = await file([
      { code: 'E001', level: '1A', position: 'ผู้จัดการ', marks: [0] },
      { code: 'E001', level: '1A', position: 'ผู้จัดการ', marks: [0] },
    ]);
    expect(
      await code(t.importer.commit(dup, { importPositions: true, updateUserLevel: false }, ADMIN)),
    ).toBe('AUTHORITY_IMPORT_HAS_ERRORS');
    const badLevel = await file([{ code: 'E001', level: 'ZZ', position: 'ผู้จัดการ', marks: [0] }]);
    expect(await code(t.importer.commit(badLevel, { updateUserLevel: true }, ADMIN))).toBe(
      'AUTHORITY_IMPORT_HAS_ERRORS',
    );
    expect(
      await code(t.importer.commit(dup, { importPositions: false, updateUserLevel: false }, ADMIN)),
    ).toBe('AUTHORITY_IMPORT_NO_MODE');
    expect(t.calls).toEqual([]);
  });

  it('ไม่มีอะไรต้องเปลี่ยน (สิทธิ์เท่าเดิม) → ไม่เขียน', async () => {
    const t = make();
    t.seed('ผู้จัดการ', 1, [true, false, false, false]);
    for (const l of [2, 3, 4]) t.seed('ผู้จัดการ', l, [false, false, false, false]);
    const buf = await file([{ code: 'E001', level: '1A', position: 'ผู้จัดการ', marks: [0] }]);
    expect(await t.importer.commit(buf, {}, ADMIN)).toEqual({
      configsUpdated: 0,
      levelsChanged: 0,
    });
    expect(t.calls).toEqual([]);
  });
});
