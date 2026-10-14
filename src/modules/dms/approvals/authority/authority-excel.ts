import ExcelJS from 'exceljs';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { ImportIssue, ImportRow } from './authority-rules';

/**
 * ไฟล์ matrix สิทธิ์ (พอร์ตจาก AuthorityExcelParser / AuthorityExcelTemplate ที่ใช้ NPOI)
 * แถวหัว 2 แถว (กลุ่ม + ดู/เพิ่ม/แก้ไข/อนุมัติ) หาโดยสแกนหาหัว "รหัสพนักงาน" ใน 20 แถวแรก (มีแถวชื่อเรื่องด้านบนได้)
 * คอลัมน์ระบุจากข้อความหัว: รหัส ชื่อ level ตำแหน่ง แผนก ฝ่าย หมายเหตุ และกลุ่ม HC/SC/NC/PC (กลุ่มละ 4 ช่อง)
 */

export const TEMPLATE_SHEET_NAME = 'ชื่อพนักงาน';
const MAX_HEADER_SCAN_ROWS = 20;
const GROUP_NAMES = ['HC', 'SC', 'NC', 'PC'];
const ACTION_NAMES = ['ดู', 'เพิ่ม', 'แก้ไข', 'อนุมัติ'];

const norm = (s: string): string => s.replace(/\s+/g, '');

interface Layout {
  headerRow: number;
  dataStartRow: number;
  code: number;
  name: number;
  level: number;
  position: number;
  dept: number;
  div: number;
  remark: number;
  groupStart: number[];
}

function cellText(row: ExcelJS.Row | undefined, col: number): string {
  if (!row || col < 1) return '';
  const c = row.getCell(col);
  try {
    return (c.text ?? '').toString().trim();
  } catch {
    return '';
  }
}

function findColumn(row: ExcelJS.Row, from: number, label: string, last: number): number {
  const needle = label.toLowerCase();
  for (let c = Math.max(1, from); c <= last; c++) {
    if (norm(cellText(row, c)).toLowerCase().includes(needle)) return c;
  }
  return -1;
}

/** หาตำแหน่งหัวตาราง · คืนข้อความผิดพลาด หรือ layout */
function findLayout(sheet: ExcelJS.Worksheet): { layout?: Layout; error?: string } {
  const lastCol = Math.max(sheet.columnCount, 1);
  const lastRow = Math.min(sheet.rowCount, MAX_HEADER_SCAN_ROWS + 1);
  let h1: ExcelJS.Row | undefined;
  let h1Index = -1;
  for (let i = 1; i <= lastRow; i++) {
    const r = sheet.getRow(i);
    if (findColumn(r, 1, 'รหัสพนักงาน', lastCol) >= 0) {
      h1 = r;
      h1Index = i;
      break;
    }
  }
  if (!h1) return { error: 'ไม่พบหัวคอลัมน์ "รหัสพนักงาน"' };
  if (h1Index + 1 > sheet.rowCount)
    return { error: 'ไม่พบแถวหัวตารางย่อย (ดู/เพิ่ม/แก้ไข/อนุมัติ)' };
  const h2 = sheet.getRow(h1Index + 1);

  const code = findColumn(h1, 1, 'รหัสพนักงาน', lastCol);
  const position = findColumn(h1, 1, 'ตำแหน่ง', lastCol);
  if (position < 0) return { error: 'ไม่พบหัวคอลัมน์ "ตำแหน่ง"' };
  const name = findColumn(h1, 1, 'ชื่อพนักงาน', lastCol);
  const level = findColumn(h1, 1, 'level', lastCol);
  const dept = findColumn(h1, 1, 'แผนก', lastCol);
  const div = findColumn(h1, 1, 'ฝ่าย', lastCol);
  let remark = findColumn(h1, 1, 'หมายเหตุ', lastCol);
  if (remark < 0) remark = findColumn(h1, 1, 'remark', lastCol);

  const from = Math.max(position, dept, div) + 1;
  const groupStart: number[] = [];
  for (let g = 0; g < 4; g++) {
    const start = findColumn(h1, from, GROUP_NAMES[g], lastCol);
    if (start < 0) return { error: `ไม่พบกลุ่มสิทธิ์ ${GROUP_NAMES[g]}` };
    for (let a = 0; a < 4; a++) {
      if (norm(cellText(h2, start + a)) !== ACTION_NAMES[a]) {
        return { error: `หัวคอลัมน์ย่อยของ ${GROUP_NAMES[g]} ต้องเป็น ดู/เพิ่ม/แก้ไข/อนุมัติ` };
      }
    }
    groupStart.push(start);
  }
  if (remark < 0) remark = groupStart[3] + 4;
  return {
    layout: {
      headerRow: h1Index,
      dataStartRow: h1Index + 2,
      code,
      name,
      level,
      position,
      dept,
      div,
      remark,
      groupStart,
    },
  };
}

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch (err) {
    throw new BusinessException(
      `เปิดไฟล์ไม่ได้ (ต้องเป็น .xlsx ที่ไม่เสียหาย): ${err instanceof Error ? err.message : String(err)}`,
      'EXCEL_INVALID',
    );
  }
  return wb;
}

export async function listSheetNames(buffer: Buffer): Promise<string[]> {
  const wb = await load(buffer);
  return wb.worksheets.map((w) => w.name);
}

export async function parseAuthorityWorkbook(
  buffer: Buffer,
  sheetName?: string,
): Promise<{ rows: ImportRow[]; issues: ImportIssue[]; sheetName: string }> {
  const wb = await load(buffer);
  const issues: ImportIssue[] = [];
  const add = (rowNumber: number, severity: 'Warning' | 'Error', code: string, message: string) =>
    issues.push({ rowNumber, severity, code, message });

  const sheet = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!sheet) {
    add(0, 'Error', 'SHEET_NOT_FOUND', 'ไม่พบ sheet ที่เลือก');
    return { rows: [], issues, sheetName: sheetName ?? '' };
  }
  const { layout, error } = findLayout(sheet);
  if (!layout) {
    add(0, 'Error', 'TEMPLATE_MISMATCH', `ไม่ใช่ template ที่รองรับ: ${error}`);
    return { rows: [], issues, sheetName: sheet.name };
  }

  const rows: ImportRow[] = [];
  for (let i = layout.dataStartRow; i <= sheet.rowCount; i++) {
    const r = sheet.getRow(i);
    const code = cellText(r, layout.code);
    const position = cellText(r, layout.position);
    const perms = new Array<boolean>(16).fill(false);
    let anyMark = false;
    for (let g = 0; g < 4; g++) {
      for (let a = 0; a < 4; a++) {
        const t = cellText(r, layout.groupStart[g] + a);
        if (t.length === 0) continue;
        if (t.toLowerCase() === 'x') {
          perms[g * 4 + a] = true;
          anyMark = true;
        } else {
          add(
            i,
            'Warning',
            'UNEXPECTED_CELL',
            `ค่าในช่องสิทธิ์ไม่ใช่ X ("${t}") ถือเป็นไม่มีสิทธิ์`,
          );
        }
      }
    }
    if (code.length === 0 && position.length === 0 && !anyMark) continue;
    if (code.length === 0) {
      add(i, 'Warning', 'SKIPPED_ROW', 'ไม่มีรหัสพนักงาน ข้ามแถวนี้');
      continue;
    }
    if (r.getCell(layout.code).type === ExcelJS.ValueType.Number) {
      add(i, 'Warning', 'NUMERIC_EMPLOYEE_CODE', 'รหัสพนักงานเป็นตัวเลข เลข 0 นำหน้าอาจหายไป');
    }
    rows.push({
      rowNumber: i,
      employeeCode: code,
      employeeName: cellText(r, layout.name),
      level: cellText(r, layout.level).toUpperCase(),
      position,
      department: cellText(r, layout.dept),
      division: cellText(r, layout.div),
      remark: cellText(r, layout.remark),
      permissions: perms,
    });
  }
  if (rows.length === 0) add(0, 'Error', 'NO_DATA', 'ไม่พบข้อมูลพนักงานใน sheet นี้');
  return { rows, issues, sheetName: sheet.name };
}

/** ไฟล์เปล่า (template) ที่ parser ข้างบนอ่านได้ — แถว 1-2 หัวตาราง ข้อมูลเริ่มแถว 3 พร้อมแถวตัวอย่าง 1 แถว */
export async function buildAuthorityTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(TEMPLATE_SHEET_NAME);
  const fixed = [
    'No',
    'รหัสพนักงาน',
    'ชื่อพนักงาน',
    'Name (Eng)',
    'Level',
    'ตำแหน่ง',
    'แผนก/ส่วนงาน',
    'ฝ่าย',
  ];
  const groups = ['1.HC\nสูงสุด', '2.SC\nลับมาก', '3.NC\nปกติ', '4.PC\nทั่วไป'];
  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' },
  };
  const headStyle = (c: ExcelJS.Cell) => {
    c.font = { bold: true };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    c.border = border;
  };

  const r1 = sheet.getRow(1);
  const r2 = sheet.getRow(2);
  r1.height = 32;
  fixed.forEach((h, i) => {
    r1.getCell(i + 1).value = h;
    headStyle(r1.getCell(i + 1));
    headStyle(r2.getCell(i + 1));
    sheet.mergeCells(1, i + 1, 2, i + 1);
  });
  groups.forEach((g, gi) => {
    const start = fixed.length + gi * 4 + 1;
    r1.getCell(start).value = g;
    for (let a = 0; a < 4; a++) {
      headStyle(r1.getCell(start + a));
      r2.getCell(start + a).value = ACTION_NAMES[a];
      headStyle(r2.getCell(start + a));
    }
    sheet.mergeCells(1, start, 1, start + 3);
  });

  // แถวตัวอย่าง (ค่าสมมติ: แก้หรือลบก่อนนำเข้าจริง)
  const s = sheet.getRow(3);
  const sample: (string | null)[] = [
    '1',
    '00000',
    'ตัวอย่าง ชื่อ นามสกุล',
    'Sample Name',
    '1A',
    'ชื่อตำแหน่ง (ต้องตรงกับ Config สิทธิ์)',
    'ชื่อแผนก',
    'ชื่อฝ่าย',
  ];
  sample.forEach((v, i) => {
    const c = s.getCell(i + 1);
    c.value = v;
    c.numFmt = '@'; // รักษาเลข 0 นำหน้าของรหัสพนักงาน
    c.border = border;
  });
  for (let c = fixed.length + 1; c <= fixed.length + 16; c++) {
    s.getCell(c).border = border;
    s.getCell(c).alignment = { horizontal: 'center' };
  }
  s.getCell(fixed.length + 1).value = 'X'; // HC ดู

  [6, 14, 28, 28, 8, 36, 22, 28].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  for (let c = fixed.length + 1; c <= fixed.length + 16; c++) sheet.getColumn(c).width = 9;
  sheet.views = [{ state: 'frozen', ySplit: 2 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
