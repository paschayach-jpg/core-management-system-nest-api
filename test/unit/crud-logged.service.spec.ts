import { ConflictException } from '@nestjs/common';
import { CrudLoggedService } from '../../src/core/crud-log/crud-logged.service';
import type { CrudLogService } from '../../src/core/crud-log/crud-log.service';
import { makeCrudLog } from '../helpers/stubs';

class DemoService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'Folder';
  constructor(crudLog: CrudLogService) {
    super(crudLog);
  }

  create(name: string) {
    return this.logged(
      { action: 'CREATE' },
      async () => ({ id: 9, name }),
      (r) => ({ recordId: r.id, after: r }),
    );
  }

  update(
    id: number,
    fail = false,
    capture: () => Promise<unknown> = async () => ({ name: 'old' }),
  ) {
    return this.logged({ action: 'UPDATE', recordId: id, captureBefore: capture }, async () => {
      if (fail) throw new ConflictException('ชื่อซ้ำ');
      return 'ok';
    });
  }

  read(id: number) {
    return this.logged({ action: 'READ', recordId: id }, async () => id);
  }
}

describe('CrudLoggedService', () => {
  it('สำเร็จ: บันทึก recordId/after จากผลลัพธ์ พร้อมระยะเวลา', async () => {
    const { service, sink } = makeCrudLog();
    const demo = new DemoService(service);
    await expect(demo.create('A')).resolves.toEqual({ id: 9, name: 'A' });
    await service.drain();
    expect(sink.events[0]).toMatchObject({
      module: 'DMS',
      entity: 'Folder',
      action: 'CREATE',
      recordId: 9,
      success: true,
    });
    expect(sink.events[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('ล้มเหลว: โยน error เดิมต่อ และบันทึก success=false พร้อมรหัสข้อผิดพลาด', async () => {
    const { service, sink } = makeCrudLog();
    const demo = new DemoService(service);
    await expect(demo.update(3, true)).rejects.toBeInstanceOf(ConflictException);
    await service.drain();
    expect(sink.events[0]).toMatchObject({
      success: false,
      errorCode: 'HTTP_409',
      errorMessage: 'ชื่อซ้ำ',
      before: { name: 'old' },
    });
  });

  it('captureBefore ไม่ถูกเรียกเมื่อปิด log (ไม่เสีย query เพิ่ม)', async () => {
    const { service } = makeCrudLog({ level: 'off' });
    const demo = new DemoService(service);
    const capture = jest.fn(async () => ({}));
    await demo.update(1, false, capture);
    expect(capture).not.toHaveBeenCalled();
  });

  it('captureBefore พังต้องไม่ทำให้งานหลักล้ม', async () => {
    const { service, sink } = makeCrudLog();
    const demo = new DemoService(service);
    const capture = jest.fn(async () => {
      throw new Error('db down');
    });
    await expect(demo.update(1, false, capture)).resolves.toBe('ok');
    await service.drain();
    expect(sink.events[0].before).toBeUndefined();
  });

  it('READ ถูกข้ามเมื่อ level=write', async () => {
    const { service, sink } = makeCrudLog({ level: 'write' });
    await new DemoService(service).read(1);
    await service.drain();
    expect(sink.events).toHaveLength(0);
  });
});
