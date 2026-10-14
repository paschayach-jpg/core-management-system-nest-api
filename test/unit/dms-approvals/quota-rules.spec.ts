import {
  areThresholdsValid,
  assertValidQuotaChangeRequest,
  buildQuotaAlertMessage,
  evaluateQuota,
  formatBytes,
  QuotaAlertLevel,
  quotaBatchExceededMessage,
  quotaFullMessage,
  resolveThresholds,
  wouldExceedQuota,
} from '../../../src/modules/dms/approvals/common/quota-rules';

const GB = 1024 ** 3;

describe('ระดับโควตา (Normal/Warning/Critical/Full)', () => {
  it('เกณฑ์เริ่มต้น 80/95: ต่ำกว่า 80 = Normal, 80 = Warning, 95 = Critical, 100 = Full', () => {
    const lv = (used: number) => evaluateQuota(used, 100).alert;
    expect(lv(79)).toBe(QuotaAlertLevel.Normal);
    expect(lv(80)).toBe(QuotaAlertLevel.Warning);
    expect(lv(94)).toBe(QuotaAlertLevel.Warning);
    expect(lv(95)).toBe(QuotaAlertLevel.Critical);
    expect(lv(99)).toBe(QuotaAlertLevel.Critical);
    expect(lv(100)).toBe(QuotaAlertLevel.Full);
    expect(lv(250)).toBe(QuotaAlertLevel.Full);
  });

  it('ยังไม่ตั้งโควตา (0) = ไม่จำกัด → Normal เสมอ ไม่ว่าใช้เท่าไร', () => {
    expect(evaluateQuota(10 * GB, 0)).toMatchObject({
      alert: QuotaAlertLevel.Normal,
      usedPercent: 0,
      quotaBytes: 0,
    });
  });

  it('ปัดร้อยละ 2 ตำแหน่ง', () => {
    expect(evaluateQuota(1, 3).usedPercent).toBe(33.33);
  });

  it('ใช้เกณฑ์จากค่าตั้งระบบได้', () => {
    const t = resolveThresholds(50, 70);
    expect(evaluateQuota(60, 100, t).alert).toBe(QuotaAlertLevel.Warning);
    expect(evaluateQuota(70, 100, t).alert).toBe(QuotaAlertLevel.Critical);
  });

  it('เกณฑ์ที่ตั้งผิด (warn>=critical, critical>=100, ไม่ใช่ตัวเลข) → กลับไปใช้ 80/95', () => {
    expect(areThresholdsValid({ warnPct: 90, criticalPct: 80 })).toBe(false);
    expect(resolveThresholds(90, 80)).toEqual({ warnPct: 80, criticalPct: 95 });
    expect(resolveThresholds(80, 100)).toEqual({ warnPct: 80, criticalPct: 95 });
    expect(resolveThresholds(Number.NaN, 95)).toEqual({ warnPct: 80, criticalPct: 95 });
    expect(resolveThresholds(null, null)).toEqual({ warnPct: 80, criticalPct: 95 });
  });

  it('ข้อความแจ้งเตือนตามระดับ', () => {
    const e = (u: number) => evaluateQuota(u * GB, 10 * GB);
    expect(buildQuotaAlertMessage('ฝ่าย A', e(8))).toBe(
      '[QUOTA เตือน] ฝ่าย A: ใช้ 8.0 GB / 10.0 GB (80.0%)',
    );
    expect(buildQuotaAlertMessage('ฝ่าย A', e(9.6))).toBe(
      '[QUOTA วิกฤต] ฝ่าย A: ใช้ 9.6 GB / 10.0 GB (96.0%)',
    );
    expect(buildQuotaAlertMessage('ฝ่าย A', e(10))).toBe(
      '[QUOTA FULL] ฝ่าย A: ใช้ 10.0 GB / 10.0 GB (100%)',
    );
    expect(quotaFullMessage(e(10))).toContain('พื้นที่ folder เต็ม');
  });
});

describe('อัปโหลดทั้งชุด', () => {
  it('ผลรวมไฟล์ทำให้เกินโควตา → เกิน (ล้มทั้งชุด); พอดีไม่เกิน', () => {
    expect(wouldExceedQuota(90, 100, [5, 5])).toBe(false);
    expect(wouldExceedQuota(90, 100, [5, 6])).toBe(true);
  });

  it('ไม่ตั้งโควตา = ไม่จำกัด', () => {
    expect(wouldExceedQuota(10 ** 12, 0, [10 ** 12])).toBe(false);
  });

  it('ขนาดติดลบ/ไม่ใช่ตัวเลขไม่ถูกนับ', () => {
    expect(wouldExceedQuota(0, 10, [-5, Number.NaN, 10])).toBe(false);
  });

  it('ข้อความบอกพื้นที่คงเหลือ/ขนาดรวม', () => {
    expect(quotaBatchExceededMessage(9 * GB, 10 * GB, [2 * GB])).toBe(
      'ไม่สามารถอัปโหลดได้ เนื่องจากพื้นที่คงเหลือ 1.00 GB แต่ไฟล์ที่เลือกมีขนาดรวม 2.00 GB (ใช้ไป 9.00 GB จาก quota 10.00 GB)',
    );
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('คำขอเพิ่มโควตา', () => {
  const code = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return (e as { response: { code: string } }).response.code;
    }
    return null;
  };

  it('ผ่านเมื่อ > ปัจจุบัน และมีเหตุผล', () => {
    expect(code(() => assertValidQuotaChangeRequest(200, 100, 'ไฟล์เยอะ'))).toBeNull();
  });
  it('ขอ <= 0 / <= ปัจจุบัน / ไม่มีเหตุผล → ปฏิเสธ', () => {
    expect(code(() => assertValidQuotaChangeRequest(0, 0, 'x'))).toBe('QUOTA_REQUEST_INVALID');
    expect(code(() => assertValidQuotaChangeRequest(100, 100, 'x'))).toBe(
      'QUOTA_REQUEST_NOT_GREATER',
    );
    expect(code(() => assertValidQuotaChangeRequest(200, 100, '  '))).toBe('QUOTA_REASON_REQUIRED');
  });
});
