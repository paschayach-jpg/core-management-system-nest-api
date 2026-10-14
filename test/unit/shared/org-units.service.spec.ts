import {
  BusinessException,
  ConflictBusinessException,
} from '../../../src/common/exceptions/business.exception';
import { OrgUnitsService } from '../../../src/modules/shared/org-units/org-units.service';
import { Sp } from '../../../src/database/sp/sp-catalog.generated';
import { fakeUser, makeCrudLog } from '../../helpers/stubs';

type Row = Record<string, unknown>;
const unit = (id: number, type: number, extra: Row = {}): Row => ({
  OrgUnitID: id,
  OrgUnitCode: `U-${id}`,
  OrgUnitNameTH: `หน่วย ${id}`,
  OrgUnitNameEN: null,
  OrgUnitType: type,
  ParentOrgUnitID: null,
  SortOrder: 0,
  IsActive: true,
  IsDeleted: false,
  ...extra,
});

/** สร้าง service พร้อม SpExecutor/DataSource ปลอม: units = ข้อมูลใน EMS.OrgUnit */
function make(units: Row[], opts: { dependents?: boolean; nameTaken?: boolean } = {}) {
  const calls: { sp: string; input: unknown }[] = [];
  const spExec = {
    call: (def: { name: string }) => {
      const run = async (input: Row): Promise<Row[]> => {
        calls.push({ sp: def.name, input });
        switch (def.name) {
          case Sp.ems.getOrgUnitById.name:
            return units.filter((u) => u.OrgUnitID === input.OrgUnitID);
          case Sp.ems.getOrgUnitHierarchy.name:
            return units;
          case Sp.ems.hasActiveDependents.name:
            return [{ HasDependents: opts.dependents ? 1 : 0 }];
          case Sp.ems.insertOrgUnit.name:
            units.push(
              unit(100, Number(input.OrgUnitType), {
                ParentOrgUnitID: input.ParentOrgUnitID,
                OrgUnitNameTH: input.OrgUnitNameTH,
                OrgUnitCode: input.OrgUnitCode,
              }),
            );
            return [{ NewOrgUnitID: 100 }];
          default:
            return [];
        }
      };
      return {
        rows: run,
        one: async (i: Row) => (await run(i))[0] ?? null,
        scalar: async (i: Row) => Object.values((await run(i))[0] ?? {})[0] ?? null,
        exec: async (i: Row) => void (await run(i)),
      };
    },
  };
  const ds = {
    query: async (sql: string) => {
      if (sql.includes('OrgUnitNameTH = @0')) return [{ c: opts.nameTaken ? 1 : 0 }];
      if (sql.includes('OrgUnitCode = @0')) return [{ c: 0 }];
      return [];
    },
  };
  const tx = {
    run: async (work: (s: { sp: object; manager: object }) => unknown) =>
      work({ sp: {}, manager: ds }),
  };
  const { service: crud, sink } = makeCrudLog();
  const svc = new OrgUnitsService(crud, spExec as never, tx as never, ds as never, {} as never);
  return { svc, calls, sink, crud };
}

describe('OrgUnitsService — กฎลำดับชั้น', () => {
  it('SubCommittee ห้ามมี parent', async () => {
    const { svc } = make([]);
    await expect(svc.validateParentTier(1, 5)).rejects.toMatchObject({
      response: { code: 'ORG_PARENT_NOT_ALLOWED' },
    });
  });

  it('Department ต้องมี parent', async () => {
    const { svc } = make([]);
    await expect(svc.validateParentTier(3, null)).rejects.toMatchObject({
      response: { code: 'ORG_PARENT_REQUIRED' },
    });
  });

  it('Department ใต้ SubCommittee (ผิดระดับ) ถูกปฏิเสธ', async () => {
    const { svc } = make([unit(1, 1)]);
    await expect(svc.validateParentTier(3, 1)).rejects.toMatchObject({
      response: { code: 'ORG_PARENT_WRONG_TYPE' },
    });
  });

  it('Division ใต้ SubCommittee ผ่าน · Division ไม่มี parent ก็ผ่าน', async () => {
    const { svc } = make([unit(1, 1)]);
    await expect(svc.validateParentTier(2, 1)).resolves.toBeUndefined();
    await expect(svc.validateParentTier(2, null)).resolves.toBeUndefined();
  });

  it('parent ที่ถูกปิดใช้งานใช้ไม่ได้', async () => {
    const { svc } = make([unit(1, 2, { IsActive: false })]);
    await expect(svc.validateParentTier(3, 1)).rejects.toMatchObject({
      response: { code: 'ORG_PARENT_INACTIVE' },
    });
  });
});

describe('OrgUnitsService — create / remove', () => {
  it('สร้าง Department: สร้างรหัสให้อัตโนมัติ DEPT-001 และบันทึก CRUD-log', async () => {
    const { svc, calls, sink, crud } = make([unit(2, 2)]);
    const created = await svc.create(
      { orgUnitType: 3, orgUnitNameTh: '  แผนกใหม่ ', parentOrgUnitId: 2 },
      fakeUser(),
    );
    await crud.drain();
    const insert = calls.find((c) => c.sp === Sp.ems.insertOrgUnit.name)!.input as Row;
    expect(insert).toMatchObject({
      OrgUnitCode: 'DEPT-001',
      OrgUnitNameTH: 'แผนกใหม่',
      OrgUnitType: 3,
      ParentOrgUnitID: 2,
    });
    expect(created.orgUnitId).toBe(100);
    expect(sink.events[0]).toMatchObject({
      module: 'SHARED',
      entity: 'OrgUnit',
      action: 'CREATE',
      recordId: 100,
      success: true,
    });
  });

  it('ชื่อซ้ำใน parent เดียวกัน → 409', async () => {
    const { svc } = make([unit(2, 2)], { nameTaken: true });
    await expect(
      svc.create({ orgUnitType: 3, orgUnitNameTh: 'ซ้ำ', parentOrgUnitId: 2 }, fakeUser()),
    ).rejects.toBeInstanceOf(ConflictBusinessException);
  });

  it('ลบหน่วยงานที่ยังมี dependents โดยไม่ force → 409 และบันทึก log ว่าล้มเหลว', async () => {
    const { svc, sink, crud } = make([unit(2, 2)], { dependents: true });
    await expect(svc.remove(2, fakeUser())).rejects.toMatchObject({
      response: { code: 'ORG_UNIT_HAS_DEPENDENTS' },
    });
    await crud.drain();
    expect(sink.events.at(-1)).toMatchObject({
      action: 'DELETE',
      success: false,
      errorCode: 'HTTP_409',
    });
  });

  it('force=true ลบได้แม้มี dependents และเรียก sp_SoftDeleteOrgUnit', async () => {
    const { svc, calls } = make([unit(2, 2)], { dependents: true });
    await svc.remove(2, fakeUser({ userId: 9 }), true);
    expect(calls.find((c) => c.sp === Sp.ems.softDeleteOrgUnit.name)?.input).toEqual({
      OrgUnitID: 2,
      DeletedBy: 9,
    });
  });

  it('ลบซ้ำหน่วยงานที่ลบแล้ว = ไม่ทำอะไร (idempotent)', async () => {
    const { svc, calls } = make([unit(2, 2, { IsDeleted: true })]);
    await svc.remove(2, fakeUser());
    expect(calls.some((c) => c.sp === Sp.ems.softDeleteOrgUnit.name)).toBe(false);
  });

  it('BusinessException ใช้ได้กับ instanceof', () => {
    expect(new BusinessException('x')).toBeInstanceOf(BusinessException);
  });
});
