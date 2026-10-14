import { SharedFileCache } from '../../../src/modules/kms/import/kb-shared-file-cache';
import { prepareImport } from '../../../src/modules/kms/import/kb-import-pipeline';
import { runImport } from '../../../src/modules/kms/import/kb-import-writer';
import type { KbImportRow, TemplateColumnRow } from '../../../src/modules/kms/import/kb-import-row';
import type {
  AttachmentLookup,
  AttachmentSource,
} from '../../../src/modules/kms/import/kb-staged-files';
import { convertPlainTextToHtml } from '../../../src/modules/kms/import/kb-text';
import { fakeUser } from '../../helpers/stubs';
import { FakeDms, MemoryImportStore } from './memory-import-store';
import { lawCode, nonLawCode, sampleCategories } from './kms-fixtures';
import {
  LAW_HEADER,
  NONLAW_HEADER,
  gridOf,
  lawRow,
  nonLawRow,
  type CellInput,
} from './xlsx-helper';

const t = (target: string, ref: string | null): TemplateColumnRow => ({
  targetColumnName: target,
  excelColumnRef: ref,
});
const lawTemplate = [t('ArticleCode', 'A'), t('LayoutType', 'Law'), t('ArticleType', '5')];
const lawWithFile = [...lawTemplate, t('Attachment', 'K')];
const decreeTemplate = [
  t('ArticleCode', 'A'),
  t('LayoutType', 'Decree'),
  t('ArticleType', '5'),
  t('LawReference', 'U'),
];
const nonLawTemplate = [
  t('ArticleCode', 'A'),
  t('Title', 'E'),
  t('TitleCategory', 'F'),
  t('PublishedDate', 'G'),
  t('EffectiveDate', 'H'),
  t('ContentHTML', 'I'),
  t('Summary', 'J'),
  t('Attachment', 'K'),
  t('LayoutType', 'NonLaw'),
  t('ArticleType', '3'),
];

const FOLDER = 437;
const user = fakeUser();

class MemSource implements AttachmentSource {
  constructor(private readonly files: Record<string, number> = {}) {}
  async lookup(name: string): Promise<AttachmentLookup> {
    const key = Object.keys(this.files).find((k) => k.toLowerCase() === name.trim().toLowerCase());
    if (!key)
      return {
        ok: false,
        error: `ไม่พบไฟล์ '${name}' ในไฟล์แนบที่อัปโหลดไว้กับงานนี้ (ชื่อต้องตรงกับไฟล์ครบนามสกุล)`,
      };
    return {
      ok: true,
      fileName: key,
      size: this.files[key],
      mimeType: 'application/pdf',
      read: async () => Buffer.alloc(this.files[key], 1),
    };
  }
}

async function run(opts: {
  store: MemoryImportStore;
  rows: CellInput[][];
  header: CellInput[];
  template: TemplateColumnRow[];
  dms?: FakeDms;
  files?: Record<string, number>;
  onlyPrepare?: boolean;
  shouldStop?: () => boolean;
}) {
  const grid = await gridOf([opts.header, ...opts.rows]);
  const prep = await prepareImport({
    grid,
    templateName: 'T',
    templateColumns: opts.template,
    store: opts.store,
  });
  if (!prep.ok) return { prep, rows: [] as KbImportRow[], summary: null };
  const dms = opts.dms ?? new FakeDms();
  const cache = new SharedFileCache({
    source: new MemSource(opts.files),
    dms,
    user,
    folderId: FOLDER,
  });
  if (opts.onlyPrepare) return { prep, rows: prep.rows, summary: null };
  const valid = prep.rows.filter((r) => r.status === 'Valid');
  const summary = await runImport(valid, opts.store, {
    user,
    articleType: prep.articleType,
    files: cache,
    dms,
    shouldStop: opts.shouldStop,
  });
  return { prep, rows: prep.rows, summary };
}

const pvi = (sec: string, y = '535') => lawCode('PVI00', sec, y);

describe('KMS import — กฎหมาย (Law)', () => {
  it('นำเข้าใหม่: สถานะ Review, Title/Tags = "มาตรา N", version 1, ConfidentialityLevel 0, ArticleType จาก Template', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const { prep, rows, summary } = await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      rows: [
        lawRow({
          code: pvi('0110'),
          summary: 'ชื่อ มาตรา',
          published: '9/4/2535',
          content: '  (1) ข้อความ\n\t(2) "ถ้อยคำ" & อื่นๆ',
          titleCategory: 'พ.ร.บ. X',
        }),
      ],
    });
    expect(prep.ok && prep.counts).toEqual({
      total: 1,
      newCount: 1,
      updateCount: 0,
      skipCount: 0,
      errorCount: 0,
    });
    expect(summary).toMatchObject({ inserted: 1, updated: 0, failed: 0 });
    expect(rows[0]).toMatchObject({ status: 'Valid', statusNote: '' });

    const a = store.byCode(pvi('0110').substring(0, 24))!;
    expect(a).toMatchObject({
      title: 'มาตรา 110',
      tags: 'มาตรา 110',
      status: 2,
      articleType: 5,
      confidentialityLevel: 0,
      categoryId: 2,
      summary: 'ชื่อ มาตรา',
      titleCategory: 'พ.ร.บ. X',
      currentVersion: 1,
    });
    expect(a.articleCode).toHaveLength(24);
    expect(a.contentHtml).toBe(convertPlainTextToHtml('  (1) ข้อความ\n\t(2) "ถ้อยคำ" & อื่นๆ'));
    expect(a.contentHtml).toContain('&nbsp;&nbsp;(1)');
    expect(a.contentHtml).toContain('<br>');
    expect(a.contentHtml).toContain('&quot;ถ้อยคำ&quot; &amp;');
    expect(a.publishedDate!.getFullYear()).toBe(1992);
    expect(store.versions).toEqual([
      { articleId: a.articleId, versionNumber: 1, content: a.contentHtml, changeDescription: null },
    ]);
  });

  it('Title/Summary เป็นข้อความล้วน: ไม่ HTML-encode และขึ้นบรรทัดใหม่เป็น CRLF', async () => {
    const store = new MemoryImportStore(sampleCategories());
    await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      rows: [
        lawRow({
          code: pvi('0001'),
          summary: 'A & B\nบรรทัด 2',
          content: 'x',
          titleCategory: '  S  ',
        }),
      ],
    });
    const a = store.byCode(pvi('0001').substring(0, 24))!;
    expect(a.summary).toBe('A & B\r\nบรรทัด 2');
    expect(a.titleCategory).toBe('  S  ');
  });

  it('ข้ามแถว Code ว่าง (Skip) และแถวซ้ำในไฟล์ (Skip) · Code ผิดความยาว/ผิด suffix = Error', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const { rows } = await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      onlyPrepare: true,
      rows: [
        lawRow({ code: pvi('0001'), content: 'a' }),
        lawRow({ code: '', content: 'b' }),
        lawRow({ code: pvi('0001'), content: 'dup' }),
        lawRow({ code: pvi('0002').substring(0, 28), content: 'short' }),
        lawRow({ code: pvi('0003').substring(0, 24) + '00001', content: 'suffix' }),
      ],
    });
    expect(rows.map((r) => r.status)).toEqual(['Valid', 'Skip', 'Skip', 'Error', 'Error']);
    expect(rows[1].statusNote).toContain('ว่าง');
    expect(rows[2].statusNote).toContain('ซ้ำกับแถวก่อนหน้า');
    expect(rows[3].statusNote).toContain('ความยาวไม่ถูกต้อง');
    expect(rows[4].statusNote).toContain('5 ตัวสุดท้ายต้องเป็น 00000');
  });

  it('เนื้อหา (P) ว่างของบทความใหม่ = Error · เลขมาตรา 0000 = Error · วันที่แปลงไม่ได้ = Error', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const { rows } = await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      onlyPrepare: true,
      rows: [
        lawRow({ code: pvi('0001') }),
        lawRow({ code: pvi('0000'), content: 'x' }),
        lawRow({ code: pvi('0002'), content: 'x', published: 'ไม่ใช่วันที่' }),
      ],
    });
    expect(rows[0].statusNote).toContain('คอลัมน์ P (บัญญัติไว้ว่า): จำเป็นต้องระบุ');
    expect(rows[1].statusNote).toContain('เลขมาตราไม่ถูกต้อง');
    expect(rows[2].statusNote).toContain("ไม่สามารถแปลงวันที่ได้ — 'ไม่ใช่วันที่'");
  });

  it('กฎหมายแยกหมวดตามปี: เลือกหมวดปีจากตัวที่ 10-12 · ปีที่ไม่มีหมวด = Error + missingCategory (สรุปรวมต่อหมวด)', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const { prep, rows } = await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      onlyPrepare: true,
      rows: [
        lawRow({ code: lawCode('PLI00', '0001', '535'), content: 'a' }),
        lawRow({ code: lawCode('PLI00', '0001', '540'), content: 'b' }),
        lawRow({ code: lawCode('PLI00', '0002', '551'), content: 'c' }),
        lawRow({ code: lawCode('PLI00', '0003', '551'), content: 'd' }),
      ],
    });
    expect(rows[0].resolvedCategoryId).toBe(4);
    expect(rows[1].resolvedCategoryId).toBe(5);
    expect(rows[2].status).toBe('Error');
    expect(rows[2].missingCategory).toMatchObject({
      categoryCode: 'PLI002551',
      parentCategoryCode: 'PLI00',
    });
    expect(prep.ok && prep.missingCategories).toEqual([
      expect.objectContaining({ categoryCode: 'PLI002551', rowCount: 2 }),
    ]);
  });

  it('รหัสกฎหมายที่ไม่มีหมวด → Error ระบุรหัส', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const { rows } = await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      onlyPrepare: true,
      rows: [lawRow({ code: lawCode('ZZZ00', '0001', '535'), content: 'x' })],
    });
    expect(rows[0].status).toBe('Error');
    expect(rows[0].statusNote).toContain('ไม่พบหมวดกฎหมายรหัส "ZZZ00"');
  });
});

describe('KMS import — re-upload = update (ไม่เพิ่มซ้ำ)', () => {
  const header = LAW_HEADER;
  const code = pvi('0110');
  const stored = code.substring(0, 24);

  function seeded() {
    const store = new MemoryImportStore(sampleCategories());
    const a = store.seedArticle({
      articleCode: stored,
      categoryId: 2,
      title: 'มาตรา 110',
      tags: 'มาตรา 110',
      status: 3,
      currentVersion: 1,
      contentHtml: convertPlainTextToHtml('เนื้อหาเดิม'),
      confidentialityLevel: 2,
      createdBy: 'คนสร้าง',
    });
    store.versions.push({
      articleId: a.articleId,
      versionNumber: 1,
      content: a.contentHtml,
      changeDescription: null,
    });
    return { store, a };
  }

  it('เนื้อหาเหมือนเดิม → อัปเดตฟิลด์ แต่ไม่เพิ่ม version · ไม่แตะ ArticleCode/CategoryID/Status/ConfidentialityLevel/CreatedBy', async () => {
    const { store, a } = seeded();
    const { prep, rows, summary } = await run({
      store,
      header,
      template: lawTemplate,
      rows: [lawRow({ code, summary: 'ชื่อใหม่', content: 'เนื้อหาเดิม', published: '1/1/2540' })],
    });
    expect(prep.ok && prep.counts).toMatchObject({ newCount: 0, updateCount: 1 });
    expect(summary).toMatchObject({ inserted: 0, updated: 1 });
    expect(store.articles.size).toBe(1);

    expect(a).toMatchObject({
      articleCode: stored,
      categoryId: 2,
      status: 3,
      confidentialityLevel: 2,
      createdBy: 'คนสร้าง',
      updatedBy: 'system',
      summary: 'ชื่อใหม่',
      currentVersion: 1,
    });
    expect(a.publishedDate!.getFullYear()).toBe(1997);
    expect(store.versions).toHaveLength(1);
    expect(rows[0].statusNote).toMatch(
      /^อัปเดตแล้ว: Title, Tags, ContentHTML, Summary, PublishedDate, ArticleType/,
    );
    expect(rows[0].statusNote).not.toContain('version ใหม่');
  });

  it('ขั้น validate (preview) บอกว่าจะอัปเดตฟิลด์ไหนของบทความเดิม', async () => {
    const { store } = seeded();
    const { rows } = await run({
      store,
      header,
      template: lawTemplate,
      onlyPrepare: true,
      rows: [lawRow({ code, summary: 'ชื่อใหม่', content: 'x' })],
    });
    expect(rows[0].status).toBe('Valid');
    expect(rows[0].existingArticleId).toBeGreaterThan(0);
    expect(rows[0].statusNote).toBe(
      `ArticleCode '${stored}' มีในระบบแล้ว (ArticleID ${rows[0].existingArticleId}) — จะอัปเดต: Title, Tags, ContentHTML, Summary, ArticleType`,
    );
  });

  it('เนื้อหาเปลี่ยน → เพิ่ม version ใหม่ (เลข MAX+1) และ CurrentVersion ตาม', async () => {
    const { store, a } = seeded();
    const { rows } = await run({
      store,
      header,
      template: lawTemplate,
      rows: [lawRow({ code, content: 'เนื้อหาใหม่\nบรรทัด 2' })],
    });
    expect(a.currentVersion).toBe(2);
    expect(a.contentHtml).toBe('เนื้อหาใหม่<br>บรรทัด 2');
    expect(store.versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(store.versions[1].changeDescription).toBe('แก้ไขจาก Excel import');
    expect(rows[0].statusNote).toContain('(เพิ่ม version ใหม่)');
  });

  it('เซลล์ว่าง = คงค่าเดิม (ไม่เขียนทับ Summary/TitleCategory/ContentHTML/วันที่ ด้วยค่าว่าง)', async () => {
    const { store, a } = seeded();
    a.publishedDate = new Date(2000, 0, 1);
    await run({ store, header, template: lawTemplate, rows: [lawRow({ code })] });
    expect(a).toMatchObject({ summary: 'สรุปเดิม', titleCategory: 'อ้างอิงเดิม' });
    expect(a.contentHtml).toBe(convertPlainTextToHtml('เนื้อหาเดิม'));
    expect(a.publishedDate!.getFullYear()).toBe(2000);
    expect(store.versions).toHaveLength(1);
  });

  it('import ซ้ำสองรอบด้วยไฟล์เดิม ไม่ทำให้ version งอก (idempotent)', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const rows = [
      lawRow({ code, summary: 's', content: 'ข้อความ "a" & b\n\tc  d', published: '9/4/2535' }),
    ];
    await run({ store, header, template: lawTemplate, rows });
    await run({ store, header, template: lawTemplate, rows });
    await run({ store, header, template: lawTemplate, rows });
    expect(store.articles.size).toBe(1);
    expect(store.versions).toHaveLength(1);
  });

  it('หมวดที่ผู้ใช้ย้ายไปแล้ว ไม่ถูก import ย้ายกลับ (CategoryID ไม่ถูกอัปเดต)', async () => {
    const { store, a } = seeded();
    a.categoryId = 3; // ถูกย้ายไป PLI00 ด้วย "ย้ายบทความ"
    await run({ store, header, template: lawTemplate, rows: [lawRow({ code, content: 'x' })] });
    expect(a.categoryId).toBe(3);
  });

  it('รหัสที่ถูก soft delete = Error (นำเข้า/อัปเดตไม่ได้ และไม่สร้างซ้ำ)', async () => {
    const { store, a } = seeded();
    a.isDelete = true;
    const { rows } = await run({
      store,
      header,
      template: lawTemplate,
      rows: [lawRow({ code, content: 'x' })],
    });
    expect(rows[0].status).toBe('Error');
    expect(rows[0].statusNote).toContain('ถูกลบ (IsDelete)');
    expect(store.articles.size).toBe(1);
  });
});

describe('KMS import — พระราชกฤษฎีกา (Decree)', () => {
  const header = [...LAW_HEADER, 'อ้างอิง'];
  const parentLaw = pvi('0029').substring(0, 24);
  const decreeCode = lawCode('ETR01', '0003', '540');
  const ref = (parents: string[]) => ['ETR00', ...parents].join('\n');

  const dRow = (code: string, reference: string, content = 'เนื้อหา') => [
    ...lawRow({ code, content }),
    reference,
  ];

  it('หมวดจากรหัส 5 ตัวของ Code กฎหมายอ้างอิง · link ไป-กลับกับมาตราที่อ้างอิง · label พระราชกฤษฎีกา', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const law = store.seedArticle({ articleCode: parentLaw, categoryId: 2 });
    const { prep, rows } = await run({
      store,
      header,
      template: decreeTemplate,
      rows: [dRow(decreeCode, ref([parentLaw]))],
    });
    expect(prep.ok && prep.fileLayout).toBe('Decree');
    const d = store.byCode(decreeCode.substring(0, 24))!;
    expect(d.categoryId).toBe(7); // ETR00
    expect(store.hasLink(d.articleId, 4, law.articleId)).toBe(true);
    expect(store.hasLink(law.articleId, 4, d.articleId)).toBe(true);
    expect(rows[0].documentTypeLabel).toBe('พระราชกฤษฎีกา');
  });

  it('มาตราที่อ้างอิงไม่มีในระบบ: บทความใหม่ = Error · บทความเดิม (re-upload) = Warn และข้าม link', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const first = await run({
      store,
      header,
      template: decreeTemplate,
      rows: [dRow(decreeCode, ref([parentLaw]))],
    });
    expect(first.rows[0].status).toBe('Error');
    expect(first.rows[0].statusNote).toContain('ไม่พบกฎหมายที่อ้างอิงในระบบ');

    store.seedArticle({ articleCode: decreeCode.substring(0, 24), categoryId: 7 });
    const second = await run({
      store,
      header,
      template: decreeTemplate,
      rows: [dRow(decreeCode, ref([parentLaw]))],
    });
    expect(second.rows[0].status).toBe('Warn');
    expect(second.rows[0].statusNote).toContain(`ข้ามลิงก์ '${parentLaw}'`);
  });

  it('Code กฎหมายอ้างอิงผิดรูปแบบ = Error รายแถว', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const { rows } = await run({
      store,
      header,
      template: decreeTemplate,
      onlyPrepare: true,
      rows: [dRow(decreeCode, 'ETR00')],
    });
    expect(rows[0].status).toBe('Error');
    expect(rows[0].statusNote).toContain('ไม่พบรหัสมาตรา');
  });
});

describe('KMS import — ไม่ใช่กฎหมาย (NonLaw) และไฟล์แนบ', () => {
  const parent = pvi('0110').substring(0, 24);
  const c1 = nonLawCode(parent, '2', '0001');
  const c2 = nonLawCode(parent, '2', '0002');

  function withParent() {
    const store = new MemoryImportStore(sampleCategories());
    const law = store.seedArticle({ articleCode: parent, categoryId: 2 });
    return { store, law };
  }

  it('บทความใหม่: หมวดปีของประเภท, ผูกไฟล์ (อัปโหลดเข้า DMS ครั้งเดียว), link กฎหมายแม่ไป-กลับ, ไม่มี version', async () => {
    const { store, law } = withParent();
    const dms = new FakeDms();
    const { rows, summary } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: { 'a.pdf': 5 },
      rows: [
        nonLawRow({
          code: c1,
          title: ' คำสั่งที่ 1 ',
          titleCategory: '1/2535',
          published: '9/4/2535',
          content: 'เนื้อหา',
          summary: 'สรุป',
          file: 'a.pdf',
        }),
      ],
    });
    expect(summary).toMatchObject({ inserted: 1, failed: 0 });
    expect(rows[0]).toMatchObject({
      status: 'Valid',
      documentTypeCode: 'OR002535',
      documentTypeLabel: 'คำสั่ง',
    });

    const a = store.byCode(c1)!;
    expect(a.articleCode).toHaveLength(29);
    expect(a).toMatchObject({ categoryId: 11, title: ' คำสั่งที่ 1 ', articleType: 3, status: 2 });
    expect(store.versions).toHaveLength(0);
    expect(store.hasLink(a.articleId, 4, law.articleId)).toBe(true);
    expect(store.hasLink(law.articleId, 4, a.articleId)).toBe(true);
    expect(dms.uploads).toEqual(['a.pdf']);
    const fileId = dms.files[0].fileId;
    expect(store.attachments).toEqual([{ articleId: a.articleId, fileId }]);
    expect(store.hasLink(a.articleId, 1, fileId)).toBe(true);
  });

  it('เซลล์หลาย Code (1 Code = 1 แถว) ใช้ไฟล์เดียวกัน ไม่สร้าง "copy(N)" · แต่ละ Code ผ่าน/ไม่ผ่านแยกกัน', async () => {
    const { store } = withParent();
    const dms = new FakeDms();
    const bad = nonLawCode(parent, '9', '0003'); // ประเภท 9 ไม่มีหมวด
    const { rows, summary } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: { 'a.pdf': 5 },
      rows: [
        nonLawRow({ code: `${c1}\n${c2}\n${bad}`, title: 'ชื่อ', content: 'x', file: 'a.pdf' }),
      ],
    });
    expect(rows.map((r) => r.status)).toEqual(['Valid', 'Valid', 'Error']);
    expect(rows[0].codeCount).toBe(3);
    expect(summary).toMatchObject({ inserted: 2 });
    expect(dms.uploads).toEqual(['a.pdf']);
    expect(dms.files.some((f) => f.originalFileName.includes('copy('))).toBe(false);
    expect(store.attachments.map((a) => a.fileId)).toEqual([
      dms.files[0].fileId,
      dms.files[0].fileId,
    ]);
  });

  it('ชื่อไฟล์เดียวกันคนละแถว Excel (หลายมาตรา) = FileID เดียว · ตัวพิมพ์เล็ก-ใหญ่ต่างกันก็ใช้ไฟล์เดียวกัน', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const dms = new FakeDms();
    const { summary } = await run({
      store,
      dms,
      header: LAW_HEADER,
      template: lawWithFile,
      files: { 'Law.pdf': 3 },
      rows: [
        lawRow({ code: pvi('0001'), content: 'a', extra: { 10: 'Law.pdf' } }),
        lawRow({ code: pvi('0002'), content: 'b', extra: { 10: 'law.PDF' } }),
        lawRow({ code: pvi('0003'), content: 'c', extra: { 10: ' Law.pdf ' } }),
      ],
    });
    expect(summary).toMatchObject({ inserted: 3 });
    expect(dms.uploads).toEqual(['Law.pdf']);
    expect(new Set(store.attachments.map((a) => a.fileId)).size).toBe(1);
  });

  it('ไฟล์ชื่อนั้นมีใน DMS โฟลเดอร์ปลายทางอยู่แล้ว → ใช้ FileID เดิม ไม่ต้องอัปโหลด ไม่ต้องแนบไฟล์มา', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const dms = new FakeDms();
    const existing = dms.seed(FOLDER, 'Shared.PDF');
    const { summary } = await run({
      store,
      dms,
      header: LAW_HEADER,
      template: lawWithFile,
      files: {},
      rows: [lawRow({ code: pvi('0001'), content: 'a', extra: { 10: 'shared.pdf' } })],
    });
    expect(summary).toMatchObject({ inserted: 1 });
    expect(dms.uploads).toEqual([]);
    expect(store.attachments[0].fileId).toBe(existing.fileId);
  });

  it('บทความใหม่หาไฟล์ไม่เจอ → Error และไม่สร้างบทความ (skipRowOnDownloadFailure)', async () => {
    const { store } = withParent();
    const dms = new FakeDms();
    const { rows } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: {},
      rows: [nonLawRow({ code: c1, title: 't', content: 'c', file: 'missing.pdf' })],
    });
    expect(rows[0].status).toBe('Error');
    expect(rows[0].statusNote).toContain("ไม่พบไฟล์ 'missing.pdf'");
    expect(store.byCode(c1)).toBeUndefined();
    expect(dms.uploads).toEqual([]);
  });

  it('รายการไฟล์ใน DMS โหลดไม่ได้ → แถวที่ใช้ไฟล์เป็น Error และไม่ถอยไปอัปโหลดซ้ำ (กัน copy(N))', async () => {
    const { store } = withParent();
    const dms = new FakeDms();
    dms.listError = new Error('ไม่มีสิทธิ์ดูโฟลเดอร์');
    const { rows } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: { 'a.pdf': 5 },
      rows: [nonLawRow({ code: c1, title: 't', content: 'c', file: 'a.pdf' })],
    });
    expect(rows[0].status).toBe('Error');
    expect(rows[0].statusNote).toContain('ตรวจรายการไฟล์ในโฟลเดอร์ปลายทาง DMS ไม่สำเร็จ');
    expect(dms.uploads).toEqual([]);
  });

  it('อัปโหลดเข้า DMS ไม่สำเร็จ → Error ไม่สร้างบทความ', async () => {
    const { store } = withParent();
    const dms = new FakeDms();
    dms.uploadError = () => new Error('โควตาเต็ม');
    const { rows } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: { 'a.pdf': 5 },
      rows: [nonLawRow({ code: c1, title: 't', content: 'c', file: 'a.pdf' })],
    });
    expect(rows[0].statusNote).toContain('อัปโหลดไฟล์แนบไม่สำเร็จ: โควตาเต็ม');
    expect(store.byCode(c1)).toBeUndefined();
  });

  it('สร้างบทความไม่สำเร็จหลังอัปโหลดไฟล์ใหม่ → ลบไฟล์ที่เพิ่งอัปโหลดออกจาก DMS (ไม่ทิ้งไฟล์ค้าง) และไม่เหลือบทความครึ่งๆ', async () => {
    const { store } = withParent();
    store.failInsertWhen = (w) => w.article.articleCode === c1;
    const dms = new FakeDms();
    const { rows } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: { 'a.pdf': 5, 'b.pdf': 5 },
      rows: [
        nonLawRow({ code: c1, title: 't1', content: 'c', file: 'a.pdf' }),
        nonLawRow({ code: c2, title: 't2', content: 'c', file: 'b.pdf' }),
      ],
    });
    expect(rows.map((r) => r.status)).toEqual(['Error', 'Valid']);
    expect(store.byCode(c1)).toBeUndefined();
    expect(dms.removed).toEqual([dms.files[0].fileId]);
    expect(store.attachments).toHaveLength(1);
  });

  it('ไฟล์ที่ใช้ร่วมกับบทความอื่นแล้ว ห้ามลบเมื่อบทความถัดไปล้มเหลว', async () => {
    const store = new MemoryImportStore(sampleCategories());
    store.failInsertWhen = (w) => w.article.articleCode === pvi('0002').substring(0, 24);
    const dms = new FakeDms();
    await run({
      store,
      dms,
      header: LAW_HEADER,
      template: lawWithFile,
      files: { 's.pdf': 3 },
      rows: [
        lawRow({ code: pvi('0001'), content: 'a', extra: { 10: 's.pdf' } }),
        lawRow({ code: pvi('0002'), content: 'b', extra: { 10: 's.pdf' } }),
      ],
    });
    expect(dms.removed).toEqual([]);
    expect(store.attachments).toHaveLength(1);
  });

  it('บทความเดิมที่มีไฟล์แนบแล้ว: ไม่อัปโหลดซ้ำ เติมเฉพาะ link ไฟล์/กฎหมายแม่ที่ขาด', async () => {
    const { store, law } = withParent();
    const dms = new FakeDms();
    const existing = store.seedArticle({ articleCode: c1, categoryId: 11 });
    store.attachments.push({ articleId: existing.articleId, fileId: 777 });
    const { rows, summary } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: { 'a.pdf': 5 },
      rows: [nonLawRow({ code: c1, title: 'ชื่อใหม่', content: 'ใหม่', file: 'a.pdf' })],
    });
    expect(summary).toMatchObject({ updated: 1 });
    expect(dms.uploads).toEqual([]);
    expect(store.attachments).toHaveLength(1);
    expect(store.hasLink(existing.articleId, 1, 777)).toBe(true);
    expect(store.hasLink(existing.articleId, 4, law.articleId)).toBe(true);
    expect(existing.title).toBe('ชื่อใหม่');
    expect(rows[0].statusNote).toContain('link ไฟล์ 1 รายการ');
    expect(store.versions).toHaveLength(0); // NonLaw ไม่มี version
  });

  it('บทความเดิมที่ยังไม่มีไฟล์แนบและหาไฟล์ไม่ได้ → Skip ทั้งแถว ไม่อัปเดตอะไร', async () => {
    const { store } = withParent();
    const existing = store.seedArticle({ articleCode: c1, categoryId: 11, title: 'เดิม' });
    const { rows, summary } = await run({
      store,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: {},
      rows: [nonLawRow({ code: c1, title: 'ชื่อใหม่', content: 'ใหม่', file: 'none.pdf' })],
    });
    expect(rows[0].status).toBe('Skip');
    expect(rows[0].statusNote).toContain('มีในระบบแล้วแต่ยังไม่มีไฟล์แนบ — ข้าม');
    expect(summary).toMatchObject({ skipped: 1, updated: 0 });
    expect(existing.title).toBe('เดิม');
  });

  it('บทความเดิมที่ยังไม่มีไฟล์แนบแต่มีไฟล์ให้ → อัปโหลดแล้วผูก (แถวเดียวได้ทั้งอัปเดตและเติมไฟล์)', async () => {
    const { store } = withParent();
    const dms = new FakeDms();
    const existing = store.seedArticle({ articleCode: c1, categoryId: 11 });
    const { rows } = await run({
      store,
      dms,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      files: { 'a.pdf': 5 },
      rows: [nonLawRow({ code: c1, title: 'ชื่อใหม่', content: 'x', file: 'a.pdf' })],
    });
    expect(rows[0].statusNote).toContain('เติม: ไฟล์แนบ');
    expect(store.attachments).toEqual([
      { articleId: existing.articleId, fileId: dms.files[0].fileId },
    ]);
  });

  it('กฎหมายแม่ไม่มีในระบบ: บทความใหม่ = Error (ระบุ Code) · หมวดปีขาด = Error พร้อม missingCategory', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const { rows } = await run({
      store,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      onlyPrepare: true,
      files: { 'a.pdf': 1 },
      rows: [
        nonLawRow({ code: c1, title: 't', content: 'c', file: 'a.pdf' }),
        nonLawRow({
          code: nonLawCode(lawCode('PVI00', '0110', '545').substring(0, 24), '2'),
          title: 't',
          content: 'c',
          file: 'a.pdf',
        }),
      ],
    });
    expect(rows[0].statusNote).toContain('ไม่พบกฎหมายแม่ในระบบ');
    expect(rows[1].missingCategory).toMatchObject({ categoryCode: 'OR002545' });
    expect(rows[1].statusNote).toContain('ตัวที่ 25 = 2 (OR00)');
  });

  it('ต้องมี Title / ContentHTML / ชื่อไฟล์สำหรับบทความใหม่ · ความยาว Title เกิน 500 = Error', async () => {
    const { store } = withParent();
    const { rows } = await run({
      store,
      header: NONLAW_HEADER,
      template: nonLawTemplate,
      onlyPrepare: true,
      rows: [
        nonLawRow({ code: c1 }),
        nonLawRow({ code: c2, title: 'ย'.repeat(501), content: 'x', file: 'a.pdf' }),
      ],
    });
    expect(rows[0].statusNote).toContain('Title (ชื่อ) ห้ามว่าง');
    expect(rows[0].statusNote).toContain('ContentHTML');
    expect(rows[0].statusNote).toContain('Attachment (ชื่อไฟล์แนบ) ห้ามว่าง');
    expect(rows[1].statusNote).toContain('Title (ชื่อ): ยาวเกิน 500');
  });
});

describe('KMS import — ควบคุมการทำงาน', () => {
  it('ยกเลิกกลางคัน: แถวที่เหลือเป็น Skip (ไม่แตะ DB)', async () => {
    const store = new MemoryImportStore(sampleCategories());
    let n = 0;
    const { summary, rows } = await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      shouldStop: () => n++ >= 1,
      rows: [
        lawRow({ code: pvi('0001'), content: 'a' }),
        lawRow({ code: pvi('0002'), content: 'b' }),
        lawRow({ code: pvi('0003'), content: 'c' }),
      ],
    });
    expect(summary).toMatchObject({ inserted: 1, cancelled: 2 });
    expect(rows.map((r) => r.status)).toEqual(['Valid', 'Skip', 'Skip']);
    expect(store.articles.size).toBe(1);
  });

  it('แถวหนึ่งล้มเหลวไม่ทำให้แถวอื่นล้ม (ล้มแยกกัน)', async () => {
    const store = new MemoryImportStore(sampleCategories());
    store.failInsertWhen = (w) => w.article.title === 'มาตรา 2';
    const { summary, rows } = await run({
      store,
      header: LAW_HEADER,
      template: lawTemplate,
      rows: [
        lawRow({ code: pvi('0001'), content: 'a' }),
        lawRow({ code: pvi('0002'), content: 'b' }),
        lawRow({ code: pvi('0003'), content: 'c' }),
      ],
    });
    expect(summary).toMatchObject({ inserted: 2, failed: 1 });
    expect(rows.map((r) => r.status)).toEqual(['Valid', 'Error', 'Valid']);
    expect(rows[1].statusNote).toContain('จำลอง: insert ล้มเหลว');
    expect(store.byCode(pvi('0002').substring(0, 24))).toBeUndefined();
  });

  it('รายงานความคืบหน้าทุกแถว', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({ code: pvi('0001'), content: 'a' }),
      lawRow({ code: pvi('0002'), content: 'b' }),
    ]);
    const prep = await prepareImport({
      grid,
      templateName: 'T',
      templateColumns: lawTemplate,
      store,
    });
    if (!prep.ok) throw new Error('prepare ล้ม');
    const seen: [number, number][] = [];
    const dms = new FakeDms();
    await runImport(prep.rows, store, {
      user,
      articleType: prep.articleType,
      dms,
      files: new SharedFileCache({ source: null, dms, user, folderId: null }),
      onProgress: (d, tt) => seen.push([d, tt]),
    });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('articleType นอก 1-5 → ปฏิเสธก่อนเริ่ม', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const dms = new FakeDms();
    await expect(
      runImport([], store, {
        user,
        articleType: 0,
        dms,
        files: new SharedFileCache({ source: null, dms, user, folderId: null }),
      }),
    ).rejects.toThrow('articleType');
  });
});

describe('KMS import — ตรวจชนิดไฟล์เทียบ Template ก่อนทุกอย่าง', () => {
  it('ไฟล์กฎหมายแต่ Template เป็น NonLaw → ข้อความ mismatch + แนะนำ Template ที่ตรง', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const grid = await gridOf([LAW_HEADER, lawRow({ code: pvi('0001'), content: 'a' })]);
    const prep = await prepareImport({
      grid,
      templateName: 'ประกาศ',
      templateColumns: nonLawTemplate,
      store,
      loadActiveTemplateLayouts: async () => [
        { templateName: 'กฎหมายมาตรฐาน', layout: 'Law' },
        { templateName: 'พ.ร.ฎ.', layout: 'Decree' },
        { templateName: 'กฎหมายอีกชุด', layout: 'Law' },
      ],
    });
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(prep.code).toBe('LAYOUT_MISMATCH');
      expect(prep.message).toBe(
        'ไฟล์ที่ upload เป็นรูปแบบ กฎหมาย แต่ Template "ประกาศ" เป็นประเภท ที่ไม่ใช่กฎหมาย\n\nTemplate ที่ตรงกับไฟล์นี้: กฎหมายมาตรฐาน, กฎหมายอีกชุด\nกรุณาเลือก Template ให้ถูกต้อง',
      );
    }
  });

  it('ไม่มี Template ที่ตรงกับไฟล์ → บอกให้สร้าง · การหา Template แนะนำล้มเหลวไม่บดบังข้อความหลัก', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const grid = await gridOf([
      LAW_HEADER,
      lawRow({ code: lawCode('ETR01', '0003', '540'), content: 'a' }),
    ]);
    const prep = await prepareImport({
      grid,
      templateName: 'กฎหมาย',
      templateColumns: lawTemplate,
      store,
      loadActiveTemplateLayouts: async () => {
        throw new Error('db down');
      },
    });
    expect(!prep.ok && prep.message).toContain(
      'ไฟล์ที่ upload เป็นรูปแบบ พระราชกฤษฎีกา แต่ Template "กฎหมาย" เป็นประเภท กฎหมาย',
    );
    expect(!prep.ok && prep.message).toContain(
      'ยังไม่มี Template ประเภทพระราชกฤษฎีกาที่ใช้งานอยู่',
    );
  });

  it('ตรวจชนิดก่อนตรวจ mapping (เลือก Template ผิดประเภทต้องเห็นสาเหตุจริง ไม่ใช่รายการคอลัมน์ที่ขาด)', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const grid = await gridOf([LAW_HEADER, lawRow({ code: pvi('0001'), content: 'a' })]);
    const prep = await prepareImport({
      grid,
      templateName: 'X',
      templateColumns: [...nonLawTemplate, t('Summary', 'Z')],
      store,
    });
    expect(!prep.ok && prep.code).toBe('LAYOUT_MISMATCH');
  });

  it('Template ตั้งค่าไม่ครบ → TEMPLATE_INCOMPLETE พร้อมรายการปัญหา', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const grid = await gridOf([LAW_HEADER, lawRow({ code: pvi('0001'), content: 'a' })]);
    const prep = await prepareImport({
      grid,
      templateName: 'X',
      templateColumns: [t('ArticleCode', 'A')],
      store,
    });
    expect(!prep.ok && prep.code).toBe('TEMPLATE_INCOMPLETE');
    expect(!prep.ok && prep.message).toContain('ยังไม่ได้เลือกประเภทไฟล์');
    expect(!prep.ok && prep.message).toContain('ยังไม่ได้เลือกประเภทบทความ');
  });

  it('mapping ชี้คอลัมน์ที่ไม่มีในไฟล์ → MAPPING_MISMATCH', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const grid = await gridOf([LAW_HEADER, lawRow({ code: pvi('0001'), content: 'a' })]);
    const prep = await prepareImport({
      grid,
      templateName: 'X',
      templateColumns: [...lawTemplate, t('Summary', 'Z')],
      store,
    });
    expect(!prep.ok && prep.code).toBe('MAPPING_MISMATCH');
  });

  it('ไฟล์ว่าง → IMPORT_NO_ROWS · Code แรกผิดรูปแบบ → EXCEL_READ_FAILED', async () => {
    const store = new MemoryImportStore(sampleCategories());
    const empty = await prepareImport({
      grid: await gridOf([LAW_HEADER]),
      templateName: 'X',
      templateColumns: lawTemplate,
      store,
    });
    expect(!empty.ok && empty.code).toBe('IMPORT_NO_ROWS');
    const bad = await prepareImport({
      grid: await gridOf([LAW_HEADER, lawRow({ code: 'XX' })]),
      templateName: 'X',
      templateColumns: lawTemplate,
      store,
    });
    expect(!bad.ok && bad.code).toBe('EXCEL_READ_FAILED');
  });
});
