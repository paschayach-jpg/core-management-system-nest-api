/**
 * รายการคอลัมน์เป้าหมายของ Import Template และคำอธิบาย — พอร์ตจาก KBArticleColumnCatalog
 * (metadata คงที่ ไม่เก็บลง DB)
 */

export const KbArticleColumn = {
  ArticleCode: 'ArticleCode',
  Title: 'Title',
  TitleCategory: 'TitleCategory',
  ContentHTML: 'ContentHTML',
  Summary: 'Summary',
  ArticleType: 'ArticleType',
  PublishedDate: 'PublishedDate',
  EffectiveDate: 'EffectiveDate',
  ExpiryDate: 'ExpiryDate',
  CategoryID: 'CategoryID',
  /** แถวเสมือน: คอลัมน์ Excel ที่เก็บชื่อไฟล์แนบ (ไฟล์อยู่ใน DMS) */
  Attachment: 'Attachment',
  /** แถวเสมือน: ประเภทไฟล์ของ Template (Law / Decree / NonLaw) — เลือกจาก dropdown ไม่ได้ map จาก Excel */
  LayoutType: 'LayoutType',
  /** แถวเสมือน: คอลัมน์ "Code กฎหมายอ้างอิง (ออกตาม)" ของพระราชกฤษฎีกา */
  LawReference: 'LawReference',
} as const;

/**
 * คอลัมน์จริงของ KMS.t_KBArticle ที่ map จาก Excel ได้ (ตามลำดับคอลัมน์ในตาราง) — ตัดคอลัมน์ที่ระบบตั้งเอง
 * (ArticleID, Status, ConfidentialityLevel, CurrentVersion, ReviewDueDate, ViewCount, LikeCount, IsOfficialPolicy, Tags,
 * Created/Reviewed/Updated ทั้งชุด, IsDelete) และ CategoryID (หาจาก ArticleCode ของแต่ละแถว ไม่เก็บใน Template) ออกแล้ว
 * หมายเหตุ: ExpiryDate ยังอยู่ในรายการตามระบบเดิม แต่ตัวอ่านไฟล์ไม่ได้อ่านคอลัมน์นี้ (mapping ไม่มีผล)
 */
export const IMPORTABLE_TARGET_COLUMNS: readonly string[] = [
  KbArticleColumn.ArticleCode,
  KbArticleColumn.Title,
  KbArticleColumn.TitleCategory,
  KbArticleColumn.ContentHTML,
  KbArticleColumn.Summary,
  KbArticleColumn.ArticleType,
  KbArticleColumn.EffectiveDate,
  KbArticleColumn.PublishedDate,
  KbArticleColumn.ExpiryDate,
];

/** แถวเสมือนที่ต่อท้ายตาราง mapping เสมอ */
export const VIRTUAL_TARGET_COLUMNS: readonly string[] = [
  KbArticleColumn.Attachment,
  KbArticleColumn.LawReference,
  KbArticleColumn.LayoutType,
];

const DESCRIPTIONS: Record<string, string> = {
  ArticleCode:
    'Code รวม 29 หลัก (กฎหมายลงท้าย 00000 / ประกาศ-คำสั่งตัวที่ 25 = รหัสประเภทเอกสาร 1-9) ใช้ตรวจประเภทไฟล์และหากฎหมายแม่ (24 ตัวแรก)',
  Attachment:
    'ไฟล์แนบ — คอลัมน์ Excel ที่เป็นชื่อไฟล์; Template ที่ไม่ใช่กฎหมายต้อง Map, กฎหมาย/พระราชกฤษฎีกา Map หรือไม่ก็ได้ (Map แล้วบทความใหม่ต้องมีไฟล์; ชื่อไฟล์เดียวกัน = ไฟล์เดียวกัน ใช้ร่วมกันหลายมาตรา)',
  LayoutType:
    'ประเภทไฟล์ของ Template: กฎหมาย (Law) / พระราชกฤษฎีกา (Decree) / ไม่ใช่กฎหมาย (NonLaw) — ใช้ตรวจว่า Excel ที่ upload ตรงชนิดกับ Template และกำหนดคอลัมน์ที่ต้อง Map',
  LawReference:
    'เฉพาะ Template ประเภทพระราชกฤษฎีกา (ต้อง Map) — คอลัมน์ Excel ที่มี Code หมวดกลุ่ม 5 ตัว (เช่น ETR00) 1 บรรทัด + Code มาตราของกฎหมายอ้างอิง 24 ตัวบรรทัดละ 1 มาตรา; ระบบหาหมวดจากรหัส 5 ตัว และ link ไป-กลับกับมาตราที่อ้างอิง (Template ประเภทอื่นห้าม Map)',
  Title:
    'ชื่อเรื่อง/หัวข้อบทความ — ถ้าต้องคำนวณจากคอลัมน์ Excel ให้ผสมข้อความคงที่กับคอลัมน์ในรูปแบบ {X} เช่น "มาตรา {C}" (กฎหมาย/พระราชกฤษฎีกา: ชื่อจริงคือ "มาตรา N" ที่คำนวณจาก Code รวมเสมอ)',
  ContentHTML: 'เนื้อหาบทความ (ข้อความล้วนจาก Excel ระบบแปลงเป็น HTML ให้)',
  Summary: 'สรุปย่อของบทความ',
  TitleCategory: 'หมวดหัวข้อ/เลขมาตรา',
  ArticleType:
    'ประเภทบทความ (เลือกค่าคงที่): 1=ขั้นตอนงาน 2=คำถามที่พบบ่อย 3=แนวทางปฏิบัติ 4=แม่แบบ 5=กฎ/นโยบาย',
  PublishedDate: 'วันที่เผยแพร่บทความ',
  EffectiveDate: 'วันที่มีผลบังคับใช้',
  ExpiryDate: 'วันที่หมดอายุ/สิ้นสุดการบังคับใช้ (ยังไม่ถูกอ่านตอน import)',
  CategoryID: 'รหัสหมวดหมู่ — ระบบหาจาก ArticleCode ของแต่ละแถวตอน import (ไม่ต้อง map)',
};

/** คำอธิบายคอลัมน์ ถ้าไม่มีในรายการจะแปลงชื่อ PascalCase ให้อ่านง่ายแทน */
export function describeColumn(columnName: string): string {
  if (!columnName) return '';
  return DESCRIPTIONS[columnName] ?? columnName.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** ตัวเลือก ArticleType ที่ Template เลือกได้ (1-5) */
export const ARTICLE_TYPE_OPTIONS: { articleType: number; description: string }[] = [
  { articleType: 1, description: 'SOP' },
  { articleType: 2, description: 'FAQ' },
  { articleType: 3, description: 'Guideline' },
  { articleType: 4, description: 'Template' },
  { articleType: 5, description: 'Policy (กฎหมาย/บทความ)' },
];

/** slot ของ Article Display Profile (KBArticleDisplaySlotCatalog) */
export const DISPLAY_SLOTS: {
  slotKey: string;
  defaultLabel: string;
  defaultVisible: boolean;
  description: string;
}[] = [
  {
    slotKey: 'Title',
    defaultLabel: 'อ้างอิง',
    defaultVisible: true,
    description: 'หัวเรื่อง/ชื่ออ้างอิงหลักของบทความ — คอลัมน์ colTitle ใน grid',
  },
  {
    slotKey: 'TitleCategory',
    defaultLabel: '',
    defaultVisible: true,
    description:
      'เลขมาตรา/รหัสอ้างอิงย่อย — คอลัมน์ colCode ใน grid, prefix ของ lblTitleCategory ใน card',
  },
  {
    slotKey: 'ContentHTML',
    defaultLabel: 'สาระ',
    defaultVisible: true,
    description: 'เนื้อหาบทความแบบย่อ — คอลัมน์ colContentHtml ใน grid, lblContent ใน card',
  },
  {
    slotKey: 'PublishedDate',
    defaultLabel: 'วันที่เผยแพร่',
    defaultVisible: true,
    description: 'วันที่เผยแพร่บทความ — แสดงเฉพาะใน card (label2 + lblPublishedDate)',
  },
  {
    slotKey: 'EffectiveDate',
    defaultLabel: 'วันที่มีผลบังคับใช้',
    defaultVisible: true,
    description: 'วันที่มีผลบังคับใช้ — แสดงเฉพาะใน grid (colEffectiveDate)',
  },
  {
    slotKey: 'ExpiryDate',
    defaultLabel: 'วันที่ยกเลิก',
    defaultVisible: true,
    description: 'วันที่ยกเลิก/สิ้นสุดการบังคับใช้ — คอลัมน์ colExpiryDate ใน grid, label3 ใน card',
  },
  {
    slotKey: 'LinkedEntities',
    defaultLabel: 'Org./Div./Dept.',
    defaultVisible: true,
    description: 'หน่วยงาน/กอง/แผนกที่เกี่ยวข้อง — คอลัมน์ colOrgDivDept ใน grid, label4 ใน card',
  },
];
