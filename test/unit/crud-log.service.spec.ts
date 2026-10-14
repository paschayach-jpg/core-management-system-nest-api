import { CrudLogRegistry } from '../../src/core/crud-log/crud-log.registry';
import { CrudLogService } from '../../src/core/crud-log/crud-log.service';
import type { CrudLogSink } from '../../src/core/crud-log/crud-log.types';
import { fakeConfig, fakeRequestContext, fakeUser, makeCrudLog } from '../helpers/stubs';

describe('CrudLogService', () => {
  it('เติม actor/requestId/เวลาให้อัตโนมัติ และ redact ค่าลับ', async () => {
    const { service, sink } = makeCrudLog({ user: fakeUser({ userId: 42, adUserName: 'DOM\\a' }) });
    service.record({
      module: 'DMS',
      entity: 'Folder',
      action: 'CREATE',
      recordId: 5,
      after: { name: 'x', password: 'nope' },
    });
    await service.drain();

    expect(sink.events).toHaveLength(1);
    const e = sink.events[0];
    expect(e.actor).toMatchObject({
      userId: 42,
      userName: 'DOM\\a',
      ip: '10.0.0.5',
      sessionId: 'sid-1',
    });
    expect(e.requestId).toBe('req-123');
    expect(e.success).toBe(true);
    expect(e.timestamp).toBeInstanceOf(Date);
    expect((e.after as Record<string, unknown>).password).toBe('[REDACTED]');
  });

  it('level=write ไม่เก็บ READ แต่เก็บ CREATE/UPDATE/DELETE/EXECUTE', async () => {
    const { service, sink } = makeCrudLog({ level: 'write' });
    for (const action of ['READ', 'CREATE', 'UPDATE', 'DELETE', 'EXECUTE'] as const) {
      service.record({ module: 'KMS', entity: 'KbArticle', action });
    }
    await service.drain();
    expect(sink.events.map((e) => e.action)).toEqual(['CREATE', 'UPDATE', 'DELETE', 'EXECUTE']);
  });

  it('level=all เก็บ READ ด้วย, level=off ไม่เก็บอะไร', async () => {
    const all = makeCrudLog({ level: 'all' });
    all.service.record({ module: 'KMS', entity: 'KbArticle', action: 'READ' });
    await all.service.drain();
    expect(all.sink.events).toHaveLength(1);

    const off = makeCrudLog({ level: 'off' });
    off.service.record({ module: 'KMS', entity: 'KbArticle', action: 'CREATE' });
    await off.service.drain();
    expect(off.sink.events).toHaveLength(0);
  });

  it('sink ที่พังไม่ทำให้ผู้เรียกล้ม และ sink อื่นยังได้รับ event', async () => {
    const registry = new CrudLogRegistry();
    const received: string[] = [];
    const bad: CrudLogSink = { name: 'bad', write: () => Promise.reject(new Error('boom')) };
    const good: CrudLogSink = { name: 'good', write: (e) => void received.push(e.entity) };
    registry.register(bad);
    registry.register(good);
    const service = new CrudLogService(registry, fakeRequestContext(fakeUser()), fakeConfig());

    expect(() =>
      service.record({ module: 'RGP', entity: 'Project', action: 'UPDATE' }),
    ).not.toThrow();
    await service.drain();
    expect(received).toEqual(['Project']);
  });

  it('เพิ่ม sink ใหม่ภายหลังผ่าน registry ได้ (จุดต่อขยายสำหรับระบบ log อนาคต)', async () => {
    const { service, registry } = makeCrudLog();
    const late: string[] = [];
    registry.register({
      name: 'future-store',
      write: (e) => void late.push(`${e.module}:${e.action}`),
    });
    service.record({
      module: 'WFE',
      entity: 'WfInstance',
      action: 'EXECUTE',
      operation: 'SUSPEND',
    });
    await service.drain();
    expect(late).toEqual(['WFE:EXECUTE']);
  });
});
