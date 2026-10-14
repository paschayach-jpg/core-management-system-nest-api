import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fixMulterFileName,
  withUploadedBuffers,
} from '../../../src/modules/rgp/attachments/upload.util';

describe('fixMulterFileName', () => {
  it('ชื่อ ASCII คงเดิม', () => {
    expect(fixMulterFileName('report 2026.pdf')).toBe('report 2026.pdf');
  });

  it('ชื่อไทยที่ถูกถอดเป็น latin1 (เพี้ยน) ถูกแปลงกลับเป็นไทย', () => {
    const garbled = Buffer.from('เอกสาร.pdf', 'utf8').toString('latin1');
    expect(fixMulterFileName(garbled)).toBe('เอกสาร.pdf');
  });

  it('ชื่อไทยที่ถูกต้องอยู่แล้ว (UTF-8) ไม่ถูกแตะ', () => {
    expect(fixMulterFileName('เอกสาร.pdf')).toBe('เอกสาร.pdf');
  });

  it('ชื่อละตินมีสำเนียงที่ไม่ใช่ UTF-8 ที่ถูกต้อง คงเดิม', () => {
    expect(fixMulterFileName('café.pdf')).toBe('café.pdf');
  });
});

describe('withUploadedBuffers', () => {
  const makeFiles = () => {
    const dir = mkdtempSync(join(tmpdir(), 'rgp-upload-'));
    const a = join(dir, 'a.bin');
    const b = join(dir, 'b.bin');
    writeFileSync(a, 'AAA');
    writeFileSync(b, 'BB');
    return [
      { originalname: 'a.txt', path: a, mimetype: 'text/plain' },
      { originalname: 'b.txt', path: b },
    ];
  };

  it('อ่านเป็น buffer ส่งให้ผู้ใช้ แล้วลบไฟล์ชั่วคราวทั้งหมด', async () => {
    const files = makeFiles();
    const seen = await withUploadedBuffers(files, async (inputs) =>
      inputs.map((i) => [i.originalName, i.buffer.toString(), i.mimeType]),
    );
    expect(seen).toEqual([
      ['a.txt', 'AAA', 'text/plain'],
      ['b.txt', 'BB', undefined],
    ]);
    expect(files.some((f) => existsSync(f.path))).toBe(false);
  });

  it('งานล้ม → ยังลบไฟล์ชั่วคราว และ error ถูกโยนต่อ', async () => {
    const files = makeFiles();
    await expect(
      withUploadedBuffers(files, async () => {
        throw new Error('DMS ปฏิเสธ');
      }),
    ).rejects.toThrow('DMS ปฏิเสธ');
    expect(files.some((f) => existsSync(f.path))).toBe(false);
  });

  it('ไฟล์ที่หายไปแล้วไม่ทำให้การลบล้ม', async () => {
    const files = makeFiles();
    await expect(
      withUploadedBuffers(
        [{ originalname: 'x', path: join(tmpdir(), 'ไม่มีไฟล์นี้.bin') }],
        async () => 1,
      ),
    ).rejects.toBeDefined(); // อ่านไม่ได้ → error จากการอ่าน ไม่ใช่จากการลบ
    expect(files.length).toBe(2);
  });
});
