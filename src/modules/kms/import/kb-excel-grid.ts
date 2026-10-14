import * as ExcelJS from 'exceljs';
import { formatExcelDateText } from './kb-dates';

/** ค่าของ 1 เซลล์ที่แปลงเป็นข้อความแล้ว (เทียบกับ GetCellText ของ NPOI ในระบบเดิม) */
export interface GridCell {
  /** ข้อความของเซลล์ (ไม่ trim) · เซลล์วันที่ = dd/MM/yyyy · เซลล์ว่าง/error = '' */
  text: string;
  /** วันที่แบบ native เมื่อค่าในเซลล์เป็นวันที่ (ไม่ใช่ข้อความ) */
  date: Date | null;
  /** ที่อยู่ hyperlink ของเซลล์ (ถ้ามี) */
  hyperlink: string | null;
}

/**
 * ตารางของ sheet แรกที่ดึงออกจาก workbook แล้ว · `rows[i]` = แถวที่ i (เริ่ม 0 = แถวหัวตาราง) เป็น array ของเซลล์ตามคอลัมน์ (เริ่ม 0, อาจมีช่องว่าง)
 * ตรรกะอ่านไฟล์ทั้งหมดทำบนโครงสร้างนี้ (ไม่ผูกกับ exceljs) เพื่อเทสต์ง่าย
 */
export interface ExcelGrid {
  rows: (GridCell[] | null)[];
  /** เซลล์สูตรที่ไม่มีค่าที่ Excel คำนวณเก็บไว้ (exceljs คำนวณสูตรเองไม่ได้ ต่างจาก NPOI เดิมที่ประเมินสด) */
  uncachedFormulaCount: number;
}

/** จำลอง double.ToString(CultureInfo.InvariantCulture) ของ .NET Framework (ทศนิยม 15 หลักนัยสำคัญ, รูปแบบ E+XX) */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const g15 = Number(n.toPrecision(15));
  let s = String(g15);
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(s);
  if (m) s = `${m[1]}E${m[2]}${m[3].padStart(2, '0')}`;
  return s;
}

type Converted = { text: string; date: Date | null; uncachedFormula: boolean };

function convertPrimitive(v: unknown): Converted {
  if (v === null || v === undefined) return { text: '', date: null, uncachedFormula: false };
  if (typeof v === 'string') return { text: v, date: null, uncachedFormula: false };
  if (typeof v === 'number') return { text: formatNumber(v), date: null, uncachedFormula: false };
  if (typeof v === 'boolean')
    return { text: v ? 'True' : 'False', date: null, uncachedFormula: false };
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? { text: '', date: null, uncachedFormula: false }
      : { text: formatExcelDateText(v), date: v, uncachedFormula: false };
  return { text: '', date: null, uncachedFormula: false };
}

function richTextToString(rt: unknown): string {
  if (rt && typeof rt === 'object' && Array.isArray((rt as { richText?: unknown }).richText)) {
    return ((rt as { richText: { text?: string }[] }).richText ?? [])
      .map((p) => p.text ?? '')
      .join('');
  }
  return '';
}

/** แปลง cell.value ของ exceljs (รวมสูตร, rich text, hyperlink) เป็น GridCell */
export function convertCellValue(
  value: unknown,
): (Converted & { hyperlink: string | null }) | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || value instanceof Date) {
    return { ...convertPrimitive(value), hyperlink: null };
  }

  const obj = value as Record<string, unknown>;

  if ('formula' in obj || 'sharedFormula' in obj) {
    const result = obj.result;
    if (result === undefined || result === null) {
      return { text: '', date: null, uncachedFormula: true, hyperlink: null };
    }
    if (typeof result === 'object' && !(result instanceof Date)) {
      // { error: '#N/A' } → ว่าง
      return { text: '', date: null, uncachedFormula: false, hyperlink: null };
    }
    return { ...convertPrimitive(result), hyperlink: null };
  }
  if ('hyperlink' in obj) {
    const text =
      typeof obj.text === 'string' ? obj.text : richTextToString(obj.text) || String(obj.hyperlink);
    return {
      text,
      date: null,
      uncachedFormula: false,
      hyperlink: typeof obj.hyperlink === 'string' ? obj.hyperlink : null,
    };
  }
  if ('richText' in obj) {
    return { text: richTextToString(obj), date: null, uncachedFormula: false, hyperlink: null };
  }
  if ('error' in obj) {
    return { text: '', date: null, uncachedFormula: false, hyperlink: null };
  }
  return { text: '', date: null, uncachedFormula: false, hyperlink: null };
}

/** แปลง worksheet ของ exceljs เป็น ExcelGrid */
export function worksheetToGrid(ws: ExcelJS.Worksheet | undefined): ExcelGrid {
  const grid: ExcelGrid = { rows: [], uncachedFormulaCount: 0 };
  if (!ws) return grid;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: GridCell[] = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const c = convertCellValue(cell.value);
      if (!c) return;
      if (c.uncachedFormula) grid.uncachedFormulaCount++;
      cells[colNumber - 1] = { text: c.text, date: c.date, hyperlink: c.hyperlink };
    });
    while (grid.rows.length < rowNumber - 1) grid.rows.push(null);
    grid.rows[rowNumber - 1] = cells;
  });

  return grid;
}

/** อ่านไฟล์ .xlsx (sheet แรกเท่านั้น) เป็นตาราง — โยน Error พร้อมข้อความไทยถ้าไม่ใช่ .xlsx ที่ถูกต้อง */
export async function loadExcelGrid(source: string | Buffer): Promise<ExcelGrid> {
  const wb = new ExcelJS.Workbook();
  try {
    if (typeof source === 'string') await wb.xlsx.readFile(source);
    else await wb.xlsx.load(source as unknown as ExcelJS.Buffer);
  } catch (err) {
    throw new KbExcelOpenError(`ไฟล์ไม่ใช่รูปแบบ .xlsx ที่ถูกต้อง: ${(err as Error).message}`);
  }
  return worksheetToGrid(wb.worksheets[0]);
}

export class KbExcelOpenError extends Error {}
