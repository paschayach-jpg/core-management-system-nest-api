import { sanitizeForLog } from '../../src/core/crud-log/crud-log.sanitizer';

describe('sanitizeForLog', () => {
  it('redact คีย์ที่เป็นความลับทุกระดับ', () => {
    const out = sanitizeForLog(
      { user: 'a', password: 'p', nested: { accessToken: 't', ok: 1 }, list: [{ secret: 's' }] },
      8000,
    ) as Record<string, unknown>;
    expect(out.password).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).accessToken).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(((out.list as unknown[])[0] as Record<string, unknown>).secret).toBe('[REDACTED]');
    expect(out.user).toBe('a');
  });

  it('แปลง Date/bigint/Buffer และกัน circular', () => {
    const a: Record<string, unknown> = {
      d: new Date('2026-01-02T03:04:05Z'),
      b: 10n,
      buf: Buffer.from('abc'),
    };
    a.self = a;
    const out = sanitizeForLog(a, 8000) as Record<string, unknown>;
    expect(out.d).toBe('2026-01-02T03:04:05.000Z');
    expect(out.b).toBe('10');
    expect(out.buf).toBe('[binary 3 bytes]');
    expect(out.self).toBe('[circular]');
  });

  it('ตัด payload ที่ใหญ่เกินกำหนด', () => {
    const out = sanitizeForLog({ text: 'x'.repeat(1500), more: 'y'.repeat(1500) }, 500) as {
      truncated: boolean;
      preview: string;
    };
    expect(out.truncated).toBe(true);
    expect(out.preview.length).toBe(500);
  });

  it('รับ null/undefined/ค่าพื้นฐานได้', () => {
    expect(sanitizeForLog(null, 100)).toBeNull();
    expect(sanitizeForLog(undefined, 100)).toBeUndefined();
    expect(sanitizeForLog(5, 100)).toBe(5);
  });
});
