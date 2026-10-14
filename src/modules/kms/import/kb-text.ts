/**
 * แปลงข้อความจาก Excel เป็นรูปแบบที่เก็บลง DB — พอร์ตจาก KBImportProcessor.ConvertPlainTextToHtml / ToPlainText
 *
 * ต้องให้ผลเหมือนระบบเดิมทุกตัวอักษร: re-upload เปรียบเทียบ ContentHTML ที่เก็บไว้กับที่แปลงใหม่แบบ ordinal ถ้า encode ต่างกัน
 * แม้นิดเดียว ทุกบทความที่มีอักขระนั้นจะถูกสร้าง version ใหม่โดยไม่จำเป็น (จึงจำลอง WebUtility.HtmlEncode ของ .NET Framework 4.5)
 */

/**
 * เหมือน System.Net.WebUtility.HtmlEncode: & < > " ' → entity · อักขระ U+00A0–U+00FF และ code point ≥ U+10000 → &#N; (เลขฐานสิบ)
 * อักษรไทยและอักขระอื่นคงเดิม
 */
export function htmlEncodeDotNet(value: string): string {
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0x3e) {
      switch (ch) {
        case '<':
          out += '&lt;';
          break;
        case '>':
          out += '&gt;';
          break;
        case '"':
          out += '&quot;';
          break;
        case "'":
          out += '&#39;';
          break;
        case '&':
          out += '&amp;';
          break;
        default:
          out += ch;
      }
    } else if ((cp >= 160 && cp < 256) || cp >= 0x10000) {
      out += `&#${cp};`;
    } else {
      out += ch;
    }
  }
  return out;
}

function encodeLineForHtml(line: string): string {
  // tab → &nbsp; x4 (หลัง encode เพื่อไม่ให้ถูก encode ซ้ำ)
  const encoded = htmlEncodeDotNet(line).split('\t').join('&nbsp;&nbsp;&nbsp;&nbsp;');

  let start = 0;
  while (start < encoded.length && encoded[start] === ' ') start++;
  let end = encoded.length;
  while (end > start && encoded[end - 1] === ' ') end--;

  // ช่องว่างซ้อน: "a    b" → "a &nbsp; &nbsp;b" (ช่องว่างเดี่ยวระหว่างคำคงเดิมเพื่อให้ตัดบรรทัดได้)
  const core = encoded.substring(start, end).split('  ').join(' &nbsp;');

  return '&nbsp;'.repeat(start) + core + '&nbsp;'.repeat(encoded.length - end);
}

/**
 * ข้อความล้วนจาก Excel (ContentHTML) → HTML ก่อนเก็บลง t_KBArticle.ContentHTML (หน้าจอแสดงเป็น HTML ตรงๆ):
 * ขึ้นบรรทัดใหม่ → `<br>` · tab → `&nbsp;`x4 · ช่องว่างหัว/ท้ายบรรทัด → `&nbsp;` · ช่องว่างซ้อนสลับ space/`&nbsp;`
 */
export function convertPlainTextToHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines.map(encodeLineForHtml).join('<br>');
}

/**
 * ข้อความที่เก็บเป็นข้อความล้วน (Title / TitleCategory / Summary — แสดงใน Label/TextBox/Grid ไม่ใช่ HTML): คงทุกอย่างตามต้นฉบับ
 * (เว้นวรรค, indent, tab, ช่องว่างหัว-ท้าย) ปรับเฉพาะตัวขึ้นบรรทัดใหม่เป็น CRLF เหมือนที่ TextBox ของหน้าแก้ไขบทความบันทึก
 * ห้าม HTML-encode ข้อความกลุ่มนี้
 */
export function toPlainText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw === '') return '';
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
}

/** ตัดข้อความให้ไม่เกิน max ตัว (ใช้กับ StatusNote ของแถว import) */
export function truncate(message: string | null | undefined, max = 200): string {
  if (!message) return '';
  return message.length <= max ? message : message.substring(0, max);
}
