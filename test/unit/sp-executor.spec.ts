import { SpExecutor } from '../../src/database/sp/sp-executor.service';
import { SpExecutionError } from '../../src/database/sp/sp-execution.error';
import { defineSp } from '../../src/database/sp/sp.types';
import * as realMssql from 'mssql';

interface In {
  A: number | null;
  B?: string | null;
}

const SP = defineSp<In, { Out1: number }>('test.sp_Demo', [
  { name: 'A', sqlType: 'INT', required: true, output: false },
  { name: 'B', sqlType: 'NVARCHAR(50)', required: false, output: false },
  { name: 'Out1', sqlType: 'INT', required: false, output: true },
]);

interface FakeRequest {
  target: unknown;
  inputs: Record<string, unknown>;
  outputs: string[];
}

/** mssql ปลอม: บันทึก input/output และคืน recordset ตามที่กำหนด */
function makeDriver(behaviour: (name: string, req: FakeRequest) => unknown) {
  class FakeRequest {
    inputs: Record<string, unknown> = {};
    outputs: string[] = [];
    timeout?: number;
    constructor(public readonly target: unknown) {}
    input(name: string, _type: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    }
    output(name: string) {
      this.outputs.push(name);
      return this;
    }
    async execute(name: string) {
      return behaviour(name, this);
    }
  }
  return { mssql: { ...realMssql, Request: FakeRequest }, master: { id: 'pool' } };
}

function makeExecutor(mainDriver: unknown, projectDriver: unknown = makeDriver(() => ({}))) {
  return new SpExecutor({ driver: mainDriver } as never, { driver: projectDriver } as never);
}

describe('SpExecutor', () => {
  it('ส่ง input ตามชนิด, ข้าม param ที่ไม่บังคับและไม่ได้ส่ง, และลงทะเบียน OUTPUT', async () => {
    let seen: { inputs: Record<string, unknown>; outputs: string[] } | undefined;
    const driver = makeDriver((_n, req) => {
      seen = { inputs: req.inputs, outputs: req.outputs };
      return {
        recordset: [{ X: 1 }],
        recordsets: [[{ X: 1 }], [{ Y: 2 }]],
        output: { Out1: 5 },
        returnValue: 0,
        rowsAffected: [1],
      };
    });
    const exec = makeExecutor(driver);

    const res = await exec.execute(SP, { A: 3 });
    expect(seen?.inputs).toEqual({ A: 3 }); // B ไม่ถูกส่ง (ใช้ default ใน SP)
    expect(seen?.outputs).toEqual(['Out1']);
    expect(res.rows).toEqual([{ X: 1 }]);
    expect(res.recordsets).toHaveLength(2); // คืนครบทุก recordset
    expect(res.output).toEqual({ Out1: 5 });
  });

  it('param ที่บังคับแต่ไม่ได้ส่ง → ส่ง null (ไม่ปล่อยให้ SP error ว่าขาด param)', async () => {
    let inputs: Record<string, unknown> = {};
    const exec = makeExecutor(
      makeDriver((_n, req) => {
        inputs = req.inputs;
        return { recordset: [], recordsets: [], output: {}, returnValue: 0, rowsAffected: [] };
      }),
    );
    await exec.execute(SP, {} as In);
    expect(inputs).toEqual({ A: null });
  });

  it('call().one / scalar / rows ทำงานตาม recordset แรก', async () => {
    const exec = makeExecutor(
      makeDriver(() => ({
        recordset: [{ NewId: 41 }, { NewId: 42 }],
        recordsets: [],
        output: {},
        returnValue: 0,
        rowsAffected: [],
      })),
    );
    expect(await exec.call(SP).scalar<number>({ A: 1 })).toBe(41);
    expect(await exec.call(SP).one<{ NewId: number }>({ A: 1 })).toEqual({ NewId: 41 });
    expect(await exec.call(SP).rows({ A: 1 })).toHaveLength(2);
  });

  it('RAISERROR ของผู้พัฒนา SP (เลข >= 50000) ถูกห่อเป็น SpExecutionError.isUserRaised', async () => {
    const exec = makeExecutor(
      makeDriver(() => {
        throw Object.assign(new Error('รหัสหน่วยงาน X มีอยู่ในระบบแล้ว'), { number: 50000 });
      }),
    );
    const err = await exec.execute(SP, { A: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpExecutionError);
    expect((err as SpExecutionError).isUserRaised).toBe(true);
    expect((err as SpExecutionError).spName).toBe('test.sp_Demo');
  });

  it('deadlock (1205) นอก transaction ลองซ้ำแล้วสำเร็จ', async () => {
    let calls = 0;
    const exec = makeExecutor(
      makeDriver(() => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('deadlock'), { number: 1205 });
        return {
          recordset: [{ ok: 1 }],
          recordsets: [],
          output: {},
          returnValue: 0,
          rowsAffected: [],
        };
      }),
    );
    const res = await exec.execute(SP, { A: 1 });
    expect(calls).toBe(3);
    expect(res.rows).toEqual([{ ok: 1 }]);
  });

  it('deadlock ภายใน transaction ไม่ retry (ให้ผู้เรียก rollback เอง)', async () => {
    let calls = 0;
    const tx = { id: 'tx' };
    const exec = makeExecutor(
      makeDriver(() => {
        calls++;
        throw Object.assign(new Error('deadlock'), { number: 1205 });
      }),
    );
    const qr = { isTransactionActive: true, databaseConnection: tx };
    await expect(exec.execute(SP, { A: 1 }, { queryRunner: qr as never })).rejects.toBeInstanceOf(
      SpExecutionError,
    );
    expect(calls).toBe(1);
  });

  it('ใน transaction ใช้ connection ของ transaction ไม่ใช่ pool', async () => {
    let target: unknown;
    const tx = { id: 'tx' };
    const exec = makeExecutor(
      makeDriver((_n, req) => {
        target = req.target;
        return { recordset: [], recordsets: [], output: {}, returnValue: 0, rowsAffected: [] };
      }),
    );
    await exec.execute(
      SP,
      { A: 1 },
      { queryRunner: { isTransactionActive: true, databaseConnection: tx } as never },
    );
    expect(target).toBe(tx);
  });

  it('target=project ใช้ DataSource ของ BUI_RG', async () => {
    let usedProject = false;
    const exec = makeExecutor(
      makeDriver(() => ({
        recordset: [],
        recordsets: [],
        output: {},
        returnValue: 0,
        rowsAffected: [],
      })),
      makeDriver(() => {
        usedProject = true;
        return { recordset: [], recordsets: [], output: {}, returnValue: 0, rowsAffected: [] };
      }),
    );
    await exec.execute(SP, { A: 1 }, { target: 'project' });
    expect(usedProject).toBe(true);
  });
});
