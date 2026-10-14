import {
  baseNameOf,
  buildStoredFileName,
  checkUploadCandidate,
  contentDisposition,
  extensionOf,
  isAllowedExtension,
  MAX_FILE_SIZE_BYTES,
  mimeTypeFor,
  resolveCopyName,
  validateFileName,
} from '../../../src/modules/dms/core/rules/file.rules';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { getResponse(): { code: string } }).getResponse().code;
  }
  return undefined;
};

describe('file.rules — ชนิดและขนาดไฟล์', () => {
  it.each(['a.pdf', 'a.DOC', 'a.docx', 'a.xls', 'a.xlsx', 'a.ppt', 'a.pptx', 'a.jpg', 'a.png', 'a.gif', 'a.zip'])(
    'อนุญาต %s',
    (name) => {
      expect(checkUploadCandidate({ name, sizeBytes: 10 })).toBeNull();
    },
  );

  it.each(['a.exe', 'a.bat', 'a.html', 'a.js', 'a.svg', 'noext', '.pdf'])(
    'ไม่อนุญาต %s → FILE_EXTENSION_NOT_ALLOWED',
    (name) => {
      expect(checkUploadCandidate({ name, sizeBytes: 10 })?.code).toBe('FILE_EXTENSION_NOT_ALLOWED');
    },
  );

  it('ขนาดเกิน 100 MB ถูกปฏิเสธ · พอดี 100 MB ผ่าน', () => {
    expect(checkUploadCandidate({ name: 'a.pdf', sizeBytes: MAX_FILE_SIZE_BYTES })).toBeNull();
    expect(checkUploadCandidate({ name: 'a.pdf', sizeBytes: MAX_FILE_SIZE_BYTES + 1 })?.code).toBe(
      'FILE_TOO_LARGE',
    );
  });

  it('เพดานที่ตั้งต่ำกว่า 100 MB ใช้ได้', () => {
    expect(checkUploadCandidate({ name: 'a.pdf', sizeBytes: 2 * 1024 * 1024, maxBytes: 1024 * 1024 })?.code).toBe(
      'FILE_TOO_LARGE',
    );
  });

  it('ชื่อที่มี path/อักขระต้องห้ามถูกปฏิเสธ', () => {
    expect(checkUploadCandidate({ name: '../a.pdf', sizeBytes: 1 })?.code).toBe('FILE_NAME_INVALID');
    expect(checkUploadCandidate({ name: 'a:b.pdf', sizeBytes: 1 })?.code).toBe('FILE_NAME_INVALID');
    expect(code(() => validateFileName('  '))).toBe('FILE_NAME_REQUIRED');
    expect(code(() => validateFileName('ก'.repeat(261)))).toBe('FILE_NAME_TOO_LONG');
  });

  it('นามสกุล/ชื่อฐาน/MIME', () => {
    expect(extensionOf('รายงาน.ประจำปี.PDF')).toBe('.pdf');
    expect(extensionOf('C:\\x\\y.docx')).toBe('.docx');
    expect(extensionOf('noext')).toBe('');
    expect(baseNameOf('a.b.pdf')).toBe('a.b');
    expect(isAllowedExtension('.PDF')).toBe(true);
    expect(mimeTypeFor('.pdf')).toBe('application/pdf');
    expect(mimeTypeFor('.bin')).toBe('application/octet-stream');
  });
});

describe('file.rules — ชื่อซ้ำ copy(N)', () => {
  it('ไม่ซ้ำ → ใช้ชื่อเดิม', () => {
    expect(resolveCopyName('a.pdf', [])).toBe('a.pdf');
    expect(resolveCopyName('a.pdf', ['b.pdf'])).toBe('a.pdf');
  });

  it('ซ้ำครั้งแรก → name copy(1).ext', () => {
    expect(resolveCopyName('a.pdf', ['a.pdf'])).toBe('a copy(1).pdf');
  });

  it('N เริ่มที่ (จำนวนไฟล์ที่ขึ้นต้น "name copy") + 1', () => {
    expect(resolveCopyName('a.pdf', ['a.pdf', 'a copy(1).pdf'])).toBe('a copy(2).pdf');
    expect(resolveCopyName('a.pdf', ['a.pdf', 'a copy(1).pdf', 'a copy(2).pdf'])).toBe('a copy(3).pdf');
  });

  it('เจอช่องว่างในลำดับ (ถูกลบไปบางตัว) ยังหาชื่อที่ว่างได้และไม่ชน', () => {
    // มีแค่ copy(2) → นับ 1 ตัว → เริ่มที่ 2 → ชน → เพิ่มเป็น 3
    expect(resolveCopyName('a.pdf', ['a.pdf', 'a copy(2).pdf'])).toBe('a copy(3).pdf');
  });

  it('เทียบชื่อแบบไม่สนตัวพิมพ์ (เหมือน SQL Server)', () => {
    expect(resolveCopyName('Report.PDF', ['report.pdf'])).toBe('Report copy(1).PDF');
  });

  it('ไฟล์ไม่มีนามสกุลและชื่อไทย', () => {
    expect(resolveCopyName('สรุป.pdf', ['สรุป.pdf'])).toBe('สรุป copy(1).pdf');
  });
});

describe('file.rules — ชื่อไฟล์จริงบนที่เก็บ', () => {
  const now = new Date('2026-10-14T08:09:10.123');

  it('รูปแบบ <ชื่อ>_<yyyyMMddHHmmssfff>_<สุ่ม><ext> และไม่มี path separator', () => {
    const n = buildStoredFileName('รายงาน ประจำปี.pdf', now, () => 'abc123');
    expect(n).toBe('รายงาน_ประจำปี_20261014080910123_abc123.pdf');
    expect(n).not.toMatch(/[\\/]/);
  });

  it('ชื่อที่มี .. / อักขระต้องห้ามถูกแปลงให้ปลอดภัย', () => {
    const n = buildStoredFileName('..\\..\\evil:x.pdf', now, () => 'r');
    expect(n).not.toMatch(/[\\/:]/);
    expect(n.startsWith('..')).toBe(false);
    expect(n.endsWith('.pdf')).toBe(true);
  });

  it('สองครั้งที่ต่างเวลา/สุ่มไม่ซ้ำกัน', () => {
    const a = buildStoredFileName('a.pdf');
    const b = buildStoredFileName('a.pdf');
    expect(a).not.toBe(b);
  });

  it('Content-Disposition รองรับชื่อไทยด้วย filename*', () => {
    const h = contentDisposition('รายงาน "ลับ".pdf');
    expect(h).toContain("filename*=UTF-8''");
    expect(h).toContain(encodeURIComponent('รายงาน'));
    expect(h).not.toMatch(/filename="[^"]*"[^;]*"/); // ไม่มี double quote หลุดในค่า filename ธรรมดา
  });
});
