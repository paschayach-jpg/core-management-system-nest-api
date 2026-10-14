import {
  convertPlainTextToHtml,
  htmlEncodeDotNet,
  toPlainText,
  truncate,
} from '../../../src/modules/kms/import/kb-text';

describe('convertPlainTextToHtml — ต้องเหมือน KBImportProcessor.ConvertPlainTextToHtml เดิม', () => {
  it('ว่าง/null → สตริงว่าง', () => {
    expect(convertPlainTextToHtml('')).toBe('');
    expect(convertPlainTextToHtml(null)).toBe('');
    expect(convertPlainTextToHtml(undefined)).toBe('');
  });

  it('ขึ้นบรรทัดใหม่ทุกแบบ (LF, CRLF, CR) → <br>', () => {
    expect(convertPlainTextToHtml('ก\nข\r\nค\rง')).toBe('ก<br>ข<br>ค<br>ง');
  });

  it('ข้อความไทยปกติไม่ถูกแปลง', () => {
    expect(convertPlainTextToHtml('ผู้ใดประกอบธุรกิจประกันภัย')).toBe('ผู้ใดประกอบธุรกิจประกันภัย');
  });

  it('encode อักขระพิเศษของ HTML ก่อน (& < > " \')', () => {
    expect(convertPlainTextToHtml(`a & b < c > d "e" 'f'`)).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;',
    );
  });

  it('tab → &nbsp; 4 ตัว', () => {
    expect(convertPlainTextToHtml('ก\tข')).toBe('ก&nbsp;&nbsp;&nbsp;&nbsp;ข');
  });

  it('ช่องว่างหัวบรรทัด (indent) และท้ายบรรทัด → &nbsp; ทีละตัว', () => {
    expect(convertPlainTextToHtml('   (1) ข้อความ  ')).toBe(
      '&nbsp;&nbsp;&nbsp;(1) ข้อความ&nbsp;&nbsp;',
    );
  });

  it('ช่องว่างเดี่ยวระหว่างคำคงเดิม · ช่องว่างซ้อนสลับ space/&nbsp; (4 ช่อง → "a &nbsp; &nbsp;b")', () => {
    expect(convertPlainTextToHtml('a b')).toBe('a b');
    expect(convertPlainTextToHtml('a    b')).toBe('a &nbsp; &nbsp;b');
    expect(convertPlainTextToHtml('a   b')).toBe('a &nbsp; b');
    expect(convertPlainTextToHtml('a  b')).toBe('a &nbsp;b');
  });

  it('จำลอง WebUtility.HtmlEncode ของ .NET: U+00A0-U+00FF → &#N; และ code point นอก BMP → &#N;', () => {
    expect(htmlEncodeDotNet('a b')).toBe('a&#160;b');
    expect(htmlEncodeDotNet('é')).toBe('&#233;');
    expect(htmlEncodeDotNet('ÿ')).toBe('&#255;');
    expect(htmlEncodeDotNet('Ā')).toBe('Ā'); // U+0100 ไม่ถูก encode
    expect(htmlEncodeDotNet('😀')).toBe('&#128512;');
    expect(htmlEncodeDotNet('฿ ๑๒๓')).toBe('฿ ๑๒๓');
  });

  it('ไม่ encode ซ้ำ: &nbsp; ที่ได้จากช่องว่างต้องไม่กลายเป็น &amp;nbsp;', () => {
    expect(convertPlainTextToHtml('  x')).not.toContain('&amp;');
  });

  it('idempotent ต่อผลลัพธ์เดิม: แปลงข้อความเดิมซ้ำได้ค่าเดียวกัน (re-upload ไม่สร้าง version เพิ่ม)', () => {
    const src = 'มาตรา ๑\r\n\t(๑) ผู้ใด  ทำ "ก" & ข\n  ';
    expect(convertPlainTextToHtml(src)).toBe(convertPlainTextToHtml(src));
  });
});

describe('toPlainText — เก็บตามที่พิมพ์ ปรับเฉพาะตัวขึ้นบรรทัดเป็น CRLF', () => {
  it('LF/CR/CRLF → CRLF (ไม่ HTML-encode ไม่ trim)', () => {
    expect(toPlainText('ก\nข\rค\r\nง')).toBe('ก\r\nข\r\nค\r\nง');
    expect(toPlainText('  a & b <c>  ')).toBe('  a & b <c>  ');
  });
  it('null คงเป็น null · ว่างคงว่าง', () => {
    expect(toPlainText(null)).toBeNull();
    expect(toPlainText(undefined)).toBeNull();
    expect(toPlainText('')).toBe('');
  });
});

describe('truncate', () => {
  it('ตัดที่ 200 ตัวโดยปริยาย', () => {
    expect(truncate('x'.repeat(300))).toHaveLength(200);
    expect(truncate('สั้น')).toBe('สั้น');
    expect(truncate(null)).toBe('');
  });
});
