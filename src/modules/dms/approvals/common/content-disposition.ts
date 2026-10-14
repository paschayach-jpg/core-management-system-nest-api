/**
 * header Content-Disposition แบบ attachment รองรับชื่อไฟล์ภาษาไทย (RFC 5987/6266):
 * `filename` เป็น ASCII สำรอง, `filename*` เป็น UTF-8 percent-encoded · ตัดอักขระควบคุม/ตัวคั่น path ออกกัน header injection
 */
export function attachmentDisposition(fileName: string): string {
  const clean =
    [...fileName]
      .map((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x20 || code === 0x7f || ch === '"' || ch === '\\' || ch === '/' ? '_' : ch;
      })
      .join('')
      .trim() || 'download';
  const ascii = [...clean].map((ch) => (ch.charCodeAt(0) > 0x7e ? '_' : ch)).join('');
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
