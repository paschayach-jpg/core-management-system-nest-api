import { SpExecutionError } from '../../../src/database/sp/sp-execution.error';
import { Sp } from '../../../src/database/sp/sp-catalog.generated';
import { isDeadlockError, withDeadlockRetry } from '../../../src/modules/wfe/common/wfe-retry';
import { alice, makeWfe, seedLinear } from './fakes';

const SP_STEP = Sp.wfe.createWfStepInstance.name;
const deadlock = (sp = SP_STEP) =>
  new SpExecutionError(sp, 'Transaction was deadlocked ... victim', 1205);

describe('isDeadlockError', () => {
  it('รู้จัก error 1205 จากทุกรูปแบบที่ driver/TypeORM/SpExecutor ส่งมา', () => {
    expect(isDeadlockError(deadlock())).toBe(true);
    expect(isDeadlockError({ driverError: { number: 1205 } })).toBe(true);
    expect(isDeadlockError({ number: 1205 })).toBe(true);
    expect(isDeadlockError({ originalError: { info: { number: 1205 } } })).toBe(true);
  });
  it('error อื่นไม่ใช่', () => {
    expect(isDeadlockError(new Error('x'))).toBe(false);
    expect(isDeadlockError(new SpExecutionError('sp', 'x', 547))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError('1205')).toBe(false);
  });
});

describe('withDeadlockRetry', () => {
  it('รันซ้ำเมื่อ deadlock จนสำเร็จ', async () => {
    let n = 0;
    const r = await withDeadlockRetry(
      async () => {
        if (++n < 3) throw deadlock();
        return 'ok';
      },
      { baseDelayMs: 1 },
    );
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('เกินจำนวนครั้งที่กำหนดโยน error เดิม; error อื่นไม่รันซ้ำ', async () => {
    let n = 0;
    await expect(
      withDeadlockRetry(
        async () => {
          n++;
          throw deadlock();
        },
        { attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ sqlNumber: 1205 });
    expect(n).toBe(2);

    let m = 0;
    await expect(
      withDeadlockRetry(async () => {
        m++;
        throw new Error('business');
      }),
    ).rejects.toThrow('business');
    expect(m).toBe(1);
  });
});

describe('การรันซ้ำเมื่อ deadlock ใน service (SP ล็อกทั้งตาราง)', () => {
  it('สร้าง instance: deadlock ที่ SP ตัวที่สอง → rollback แล้วรันใหม่ทั้งก้อน ได้ instance เดียว', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db);
    w.sp.failOn(SP_STEP, deadlock());
    const r = await w.instances.create({ workflowDefinitionId: defId }, alice);
    expect(w.db.instances).toHaveLength(1);
    expect(w.db.stepInstances).toHaveLength(1);
    expect(r.status).toBe(2);
    expect(w.trace.filter((t) => t === 'tx:rollback')).toHaveLength(1);
    expect(w.trace.filter((t) => t === 'tx:commit')).toHaveLength(1);
    expect(w.notifier.sent).toHaveLength(1); // แจ้งเตือนครั้งเดียว หลัง commit รอบที่สำเร็จ
  });

  it('จบ step: deadlock หนึ่งครั้งแล้วสำเร็จ ไม่สร้าง step ถัดไปซ้ำ', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db);
    await w.instances.create({ workflowDefinitionId: defId }, alice);
    const startSi = w.db.stepInstances[0];
    w.sp.failOn(SP_STEP, deadlock());
    const r = await w.instances.completeStep(startSi.wfStepInstanceId, {}, alice);
    expect(r.createdStepInstances).toHaveLength(1);
    expect(w.db.stepInstances).toHaveLength(2);
  });

  it('deadlock ติดกัน 3 ครั้ง → ยอมแพ้และโยน error (ไม่เหลือข้อมูลค้าง), บันทึก success=false', async () => {
    const w = makeWfe();
    const { defId } = seedLinear(w.db);
    for (const nth of [1, 2, 3]) w.sp.failOn(SP_STEP, deadlock(), nth);
    await expect(w.instances.create({ workflowDefinitionId: defId }, alice)).rejects.toMatchObject({
      sqlNumber: 1205,
    });
    expect(w.db.instances).toHaveLength(0);
    const evs = (await w.events()).filter((e) => e.operation === 'WorkflowInstanceCreated');
    expect(evs).toHaveLength(1); // log หนึ่งเหตุการณ์ต่อหนึ่งคำสั่ง ไม่ใช่ต่อรอบที่รันซ้ำ
    expect(evs[0].success).toBe(false);
  });
});
