import { RunningNumber } from '../../../src/modules/rgp/entities/running-number.entity';
import { makeHarness, seedRunningNumber } from './helpers/harness';

const JAN_2026 = new Date(2026, 0, 10);
const JAN_2027 = new Date(2027, 0, 5);

describe('RunningNumberService — ออกเลขที่รันในฐาน BUI_RG', () => {
  it('ออกเลขถัดไป เขียน current_number/Year_UW กลับ และล็อกแถวด้วย UPDLOCK,ROWLOCK', async () => {
    const h = makeHarness();
    seedRunningNumber(h.project, { type: 'PRJ', current: 41, year: 2026 });

    const no = await h.runningNumbers.next(h.project.manager() as never, 'PRJ', JAN_2026);

    expect(no).toBe('PRJ-26-000042');
    const row = h.project.rows<Record<string, unknown>>(RunningNumber)[0];
    expect(row.currentNumber).toBe('42');
    expect(row.yearUw).toBe(2026);
    const select = h.project.queries[0];
    expect(select.sql).toContain('WITH (UPDLOCK, ROWLOCK)');
    expect(select.sql).toContain('running_type = @0'); // พารามิเตอร์ ไม่ concat
    expect(select.params).toEqual(['PRJ']);
    // UPDATE ตาม id ของแถวที่อ่าน (ไม่อัปเดตทุกแถวที่ running_type ตรงกันเหมือนระบบเดิม)
    expect(h.project.queries[1].sql).toContain('WHERE id = @2');
  });

  it('ขึ้นปีใหม่ → รีเซ็ตเป็น 1 และเขียนปีใหม่', async () => {
    const h = makeHarness();
    seedRunningNumber(h.project, { type: 'PRJ', current: 987, year: 2026 });

    const no = await h.runningNumbers.next(h.project.manager() as never, 'PRJ', JAN_2027);

    expect(no).toBe('PRJ-27-000001');
    const row = h.project.rows<Record<string, unknown>>(RunningNumber)[0];
    expect(row.currentNumber).toBe('1');
    expect(row.yearUw).toBe(2027);
  });

  it('เรียกต่อเนื่องได้เลขไม่ซ้ำ และแยก running_type กัน (PRJ vs TK)', async () => {
    const h = makeHarness();
    seedRunningNumber(h.project, { type: 'PRJ', current: 0, year: 2026 });
    h.project.seed(RunningNumber, [
      {
        runningType: 'TK',
        product: 'RG',
        prefix: 'TK',
        format: 'PPP-YY-######',
        digitNumber: 6,
        maximumNumber: '999999',
        yearUw: 2026,
        currentNumber: '10',
      },
    ]);
    const m = h.project.manager() as never;

    const a = await h.runningNumbers.next(m, 'PRJ', JAN_2026);
    const b = await h.runningNumbers.next(m, 'PRJ', JAN_2026);
    const t = await h.runningNumbers.next(m, 'TK', JAN_2026);

    expect([a, b, t]).toEqual(['PRJ-26-000001', 'PRJ-26-000002', 'TK-26-000011']);
  });

  it('ไม่มีแถว running_type → ล้มพร้อมข้อความชัดเจน และไม่เขียนอะไร', async () => {
    const h = makeHarness();
    seedRunningNumber(h.project, { type: 'PRJ', current: 5 });

    await expect(
      h.runningNumbers.next(h.project.manager() as never, 'TK', JAN_2026),
    ).rejects.toMatchObject({
      response: {
        code: 'RUNNING_NUMBER_NOT_CONFIGURED',
        message: expect.stringContaining("running_type = 'TK'"),
      },
    });
    expect(h.project.queries.some((q) => q.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('เลขที่ยาวเกิน 20 ตัวอักษร → ล้มก่อนเขียน (กัน varchar(20) ล้น)', async () => {
    const h = makeHarness();
    seedRunningNumber(h.project, {
      type: 'PRJ',
      prefix: 'PROJECT-TOO-LONG-PREFIX',
      current: 0,
      year: 2026,
    });
    await expect(
      h.runningNumbers.next(h.project.manager() as never, 'PRJ', JAN_2026),
    ).rejects.toMatchObject({ response: { code: 'RUNNING_NUMBER_TOO_LONG' } });
    expect(h.project.rows<Record<string, unknown>>(RunningNumber)[0].currentNumber).toBe('0');
  });

  it('บันทึก CRUD-log (EXECUTE GENERATE_RUNNING_NUMBER) ทั้งสำเร็จและล้มเหลว', async () => {
    const h = makeHarness();
    seedRunningNumber(h.project, { type: 'PRJ', current: 0, year: 2026 });
    const m = h.project.manager() as never;

    await h.runningNumbers.next(m, 'PRJ', JAN_2026);
    await h.runningNumbers.next(m, 'TK', JAN_2026).catch(() => undefined);
    await h.crud.drain();

    expect(
      h.sink.events.map((e) => [e.module, e.action, e.operation, e.recordId, e.success]),
    ).toEqual([
      ['RGP', 'EXECUTE', 'GENERATE_RUNNING_NUMBER', 'PRJ', true],
      ['RGP', 'EXECUTE', 'GENERATE_RUNNING_NUMBER', 'TK', false],
    ]);
  });
});
