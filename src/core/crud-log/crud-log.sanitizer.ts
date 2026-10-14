const SENSITIVE_KEY =
  /pass(word)?|pwd|secret|token|authorization|apikey|api_key|cookie|accesstoken|refreshtoken/i;
const MAX_DEPTH = 6;

/** ลบความลับ + ตัดขนาด ก่อนส่ง payload ไปเก็บ (กัน password/token รั่วเข้า log และกัน log โตเกินไป) */
export function sanitizeForLog(value: unknown, maxChars: number): unknown {
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'string')
      return v.length > 2000 ? `${v.slice(0, 2000)}…(${v.length} ตัวอักษร)` : v;
    if (typeof v !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (Buffer.isBuffer(v)) return `[binary ${v.length} bytes]`;
    if (seen.has(v)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[ลึกเกินกำหนด]';
    seen.add(v);
    if (Array.isArray(v)) {
      const items = v.slice(0, 100).map((x) => walk(x, depth + 1));
      if (v.length > 100) items.push(`…อีก ${v.length - 100} รายการ`);
      return items;
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : walk(val, depth + 1);
    }
    return out;
  };

  const cleaned = walk(value, 0);
  const json = safeStringify(cleaned);
  if (json !== undefined && json.length > maxChars) {
    return { truncated: true, preview: json.slice(0, maxChars), originalLength: json.length };
  }
  return cleaned;
}

export function safeStringify(v: unknown): string | undefined {
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}
