import * as ExcelJS from 'exceljs';
import { ExcelGrid, loadExcelGrid } from '../../../src/modules/kms/import/kb-excel-grid';

export type CellInput =
  | string
  | number
  | boolean
  | Date
  | null
  | { formula: string; result?: string | number | boolean | Date }
  | { text: string; hyperlink: string };

/** สร้างไฟล์ .xlsx สังเคราะห์ในหน่วยความจำ (ไม่ commit ไฟล์ xlsx ลง repo) — rows[0] = แถวหัวตาราง */
export async function xlsxBuffer(rows: CellInput[][], sheetName = 'Sheet1'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((r, i) => {
    const row = ws.getRow(i + 1);
    r.forEach((v, c) => {
      if (v !== null && v !== undefined) row.getCell(c + 1).value = v as ExcelJS.CellValue;
    });
    row.commit();
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function gridOf(rows: CellInput[][]): Promise<ExcelGrid> {
  return loadExcelGrid(await xlsxBuffer(rows));
}

/** แถว 20 คอลัมน์ของไฟล์กฎหมาย (law-matrix): A=Code รวม, M=ชื่อ, N=วันที่ประกาศ, O=วันที่มีผล, P=เนื้อหา, S=กฎหมายอ้างอิง */
export function lawRow(opts: {
  code: string;
  summary?: string;
  published?: CellInput;
  effective?: CellInput;
  content?: string;
  titleCategory?: string;
  extra?: Record<number, CellInput>;
}): CellInput[] {
  const r: CellInput[] = new Array(20).fill(null);
  r[0] = opts.code;
  r[12] = opts.summary ?? null;
  r[13] = opts.published ?? null;
  r[14] = opts.effective ?? null;
  r[15] = opts.content ?? null;
  r[18] = opts.titleCategory ?? null;
  for (const [i, v] of Object.entries(opts.extra ?? {})) r[Number(i)] = v;
  return r;
}

export const LAW_HEADER: CellInput[] = [
  'Code รวม',
  'Code กฎหมายแม่',
  'มาตรา',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'ชื่อ',
  'วันที่ประกาศ',
  'วันที่มีผลบังคับใช้',
  'บัญญัติไว้ว่า',
  'Q',
  'R',
  'กฎหมายอ้างอิง',
  'T',
];

/** แถว NonLaw: A=Code รวม E=ชื่อ F=คำสั่งที่ G=วันที่ประกาศ H=วันที่มีผล I=บัญญัติไว้ว่า J=ประเด็นสำคัญ K=ไฟล์ */
export const NONLAW_HEADER: CellInput[] = [
  'Code รวม',
  'Code กฎหมายแม่',
  'ประเภทลูก',
  'เอกสารลูก',
  'ชื่อ',
  'คำสั่งที่',
  'วันที่ประกาศ',
  'วันที่มีผลบังคับใช้',
  'บัญญัติไว้ว่า',
  'ประเด็นสำคัญ',
  'ไฟล์',
  'L',
];

export function nonLawRow(opts: {
  code: CellInput;
  title?: string;
  titleCategory?: string;
  published?: CellInput;
  effective?: CellInput;
  content?: string;
  summary?: string;
  file?: CellInput;
}): CellInput[] {
  const r: CellInput[] = new Array(12).fill(null);
  r[0] = opts.code;
  r[4] = opts.title ?? null;
  r[5] = opts.titleCategory ?? null;
  r[6] = opts.published ?? null;
  r[7] = opts.effective ?? null;
  r[8] = opts.content ?? null;
  r[9] = opts.summary ?? null;
  r[10] = opts.file ?? null;
  return r;
}
