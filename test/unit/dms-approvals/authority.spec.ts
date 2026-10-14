import ExcelJS from 'exceljs';
import {
  buildAuthorityTemplate,
  listSheetNames,
  parseAuthorityWorkbook,
} from '../../../src/modules/dms/approvals/authority/authority-excel';
import {
  describeResolveMatch,
  ExistingConfig,
  ImportRow,
  planLevelImport,
  planPositionImport,
  validateConfigInput,
  validateImportRows,
} from '../../../src/modules/dms/approvals/authority/authority-rules';

const row = (
  n: number,
  code: string,
  position: string,
  perms: number[] = [],
  extra: Partial<ImportRow> = {},
): ImportRow => {
  const permissions = new Array<boolean>(16).fill(false);
  perms.forEach((i) => (permissions[i] = true));
  return {
    rowNumber: n,
    employeeCode: code,
    employeeName: '',
    level: '1A',
    position,
    department: '',
    division: '',
    remark: '',
    permissions,
    ...extra,
  };
};

const cfg = (
  id: number,
  label: string,
  level: number,
  flags: [boolean, boolean, boolean, boolean],
  extra: Partial<ExistingConfig> = {},
): ExistingConfig => ({
  configId: id,
  configLabel: label,
  positionName: label,
  departmentCode: null,
  divisionCode: null,
  confidentialityLevel: level,
  levelCode: null,
  canView: flags[0],
  canAdd: flags[1],
  canEdit: flags[2],
  canApprove: flags[3],
  canDownload: false,
  ...extra,
});

describe('ลำดับความสำคัญของการ resolve (describeResolveMatch)', () => {
  it('Level+แผนก → Level → ตำแหน่ง → แผนก → ฝ่าย', () => {
    expect(
      describeResolveMatch(
        { levelCode: '5C', departmentCode: 'D1' },
        { levelCode: '5C', departmentCode: 'D1' },
      ),
    ).toBe('LEVEL_DEPARTMENT');
    expect(
      describeResolveMatch(
        { levelCode: '5C', departmentCode: 'D1' },
        { levelCode: '5C', departmentCode: null },
      ),
    ).toBe('LEVEL');
    expect(
      describeResolveMatch({ levelCode: '5C', positionName: 'ผอ.' }, { positionName: 'ผอ.' }),
    ).toBe('POSITION');
    expect(
      describeResolveMatch(
        { departmentCode: 'D1' },
        { departmentCode: 'D1', positionName: null, levelCode: '' },
      ),
    ).toBe('DEPARTMENT');
    expect(describeResolveMatch({ divisionCode: 'V1' }, { divisionCode: 'V1' })).toBe('DIVISION');
    expect(describeResolveMatch({ divisionCode: 'V1' }, undefined)).toBe('NONE');
  });
});

describe('ตรวจข้อมูล config', () => {
  const base = { configLabel: 'ผู้จัดการ', positionName: 'ผู้จัดการ', confidentialityLevel: 2 };
  it('ผ่านเมื่อมีขอบเขตอย่างน้อยหนึ่งอย่าง', () => {
    expect(validateConfigInput(base)).toBeNull();
    expect(validateConfigInput({ ...base, positionName: null, levelCode: '5C' })).toBeNull(); // LevelCode ของพนักงานได้
  });
  it('ปฏิเสธ: ชื่อกลุ่มว่าง, ชั้นความลับนอก 1-4, ไม่มีขอบเขต, LevelCode ยาวเกิน', () => {
    expect(validateConfigInput({ ...base, configLabel: ' ' })?.code).toBe(
      'AUTHORITY_LABEL_REQUIRED',
    );
    expect(validateConfigInput({ ...base, confidentialityLevel: 5 })?.code).toBe(
      'AUTHORITY_LEVEL_INVALID',
    );
    expect(validateConfigInput({ ...base, positionName: '' })?.code).toBe(
      'AUTHORITY_SCOPE_REQUIRED',
    );
    expect(validateConfigInput({ ...base, levelCode: '12345678901' })?.code).toBe(
      'AUTHORITY_LEVELCODE_INVALID',
    );
  });
});

describe('นำเข้า — ตรวจแถว/วางแผน', () => {
  it('รหัสพนักงานซ้ำ = Error · Level ผิดรูปแบบ = Error (เฉพาะโหมดอัปเดต Level)', () => {
    const issues = validateImportRows([row(3, 'E1', 'A'), row(4, 'e1', 'B', [], { level: 'XX' })], {
      checkLevel: true,
      checkPositions: false,
    });
    expect(issues.map((i) => i.code).sort()).toEqual(['DUPLICATE_EMPLOYEE', 'INVALID_LEVEL']);
    expect(issues.every((i) => i.severity === 'Error')).toBe(true);
  });

  it('อนุมัติโดยไม่มีสิทธิ์ดู = เตือน · ไม่มีตำแหน่ง = เตือน', () => {
    const issues = validateImportRows([row(3, 'E1', '', [3])], {
      checkLevel: false,
      checkPositions: true,
    });
    expect(issues.map((i) => i.code).sort()).toEqual(['APPROVE_WITHOUT_VIEW', 'MISSING_POSITION']);
  });

  it('ตำแหน่งที่ไม่มี config → ข้ามพร้อมเตือน (ไม่สร้างใหม่)', () => {
    const r = planPositionImport(
      [row(3, 'E1', 'ตำแหน่งใหม่', [0])],
      [cfg(1, 'ผู้จัดการ', 1, [true, false, false, false])],
    );
    expect(r.plans).toEqual([]);
    expect(r.issues[0].code).toBe('POSITION_NOT_FOUND');
  });

  it('ตำแหน่งที่มี config: สิทธิ์เท่าเดิม = Unchanged, ต่างไป = Updated (จับคู่ไม่สนตัวพิมพ์/คงแผนกเดิม)', () => {
    const existing = [
      cfg(1, 'ผู้จัดการ', 1, [true, false, false, false], { departmentCode: 'D1' }),
      cfg(2, 'ผู้จัดการ', 2, [false, false, false, false]),
    ];
    const same = planPositionImport([row(3, 'E1', 'ผู้จัดการ', [0])], existing);
    expect(same.plans[0].status).toBe('Unchanged');
    const diff = planPositionImport([row(3, 'E1', 'ผู้จัดการ', [0, 4])], existing);
    expect(diff.plans[0]).toMatchObject({
      status: 'Updated',
      label: 'ผู้จัดการ',
      departmentCode: 'D1',
    });
    expect(diff.plans[0].permissions[4]).toBe(true);
  });

  it('หลายแถวของตำแหน่งเดียวกันที่สิทธิ์ไม่ตรงกัน → รวม (OR) พร้อมเตือน POSITION_MERGED', () => {
    const r = planPositionImport(
      [row(3, 'E1', 'ผอ.', [0]), row(4, 'E2', 'ผอ.', [1])],
      [cfg(1, 'ผอ.', 1, [false, false, false, false])],
    );
    expect(r.plans[0].permissions.slice(0, 2)).toEqual([true, true]);
    expect(r.issues.map((i) => i.code)).toContain('POSITION_MERGED');
  });

  it('แผน Level: จับคู่ด้วยรหัสพนักงาน · เท่าเดิม=Unchanged · ไม่พบ=NotFound+เตือน', () => {
    const r = planLevelImport(
      [
        row(3, ' e1 '.trim(), 'A', [], { level: '2B' }),
        row(4, 'E2', 'A', [], { level: '3C' }),
        row(5, 'E9', 'A', [], { level: '1A' }),
      ],
      [
        { userId: 1, employeeCode: 'E1', levelCode: '1A' },
        { userId: 2, employeeCode: 'e2', levelCode: '3c' },
      ],
    );
    expect(r.plans.map((p) => [p.employeeCode, p.status])).toEqual([
      ['e1', 'Updated'],
      ['E2', 'Unchanged'],
      ['E9', 'NotFound'],
    ]);
    expect(r.issues.map((i) => i.code)).toEqual(['USER_NOT_FOUND']);
  });
});

describe('อ่านไฟล์ Excel (exceljs)', () => {
  it('template ที่ระบบสร้าง → parser อ่านกลับได้ (1 แถวตัวอย่าง: HC ดู)', async () => {
    const buf = await buildAuthorityTemplate();
    expect(await listSheetNames(buf)).toEqual(['ชื่อพนักงาน']);
    const r = await parseAuthorityWorkbook(buf);
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      employeeCode: '00000',
      level: '1A',
      position: 'ชื่อตำแหน่ง (ต้องตรงกับ Config สิทธิ์)',
    });
    expect(r.rows[0].permissions.filter(Boolean)).toHaveLength(1);
    expect(r.rows[0].permissions[0]).toBe(true);
  });

  /** สร้าง workbook ที่มีแถวชื่อเรื่องนำหน้า หัวตารางห่อบรรทัด และข้อมูลหลายแบบ */
  async function sample(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('สิทธิ์');
    ws.getCell('A1').value = 'ตารางสิทธิ์ ปี 2569'; // แถวชื่อเรื่อง
    const h1 = ws.getRow(3);
    const heads = ['รหัส\nพนักงาน', 'ชื่อพนักงาน', 'Level', 'ตำแหน่ง', 'แผนก', 'ฝ่าย'];
    heads.forEach((h, i) => (h1.getCell(i + 1).value = h));
    ['HC', 'SC', 'NC', 'PC'].forEach((g, gi) => (h1.getCell(7 + gi * 4).value = g));
    h1.getCell(23).value = 'หมายเหตุ';
    const h2 = ws.getRow(4);
    for (let g = 0; g < 4; g++)
      ['ดู', 'เพิ่ม', 'แก้ไข', 'อนุมัติ'].forEach((a, i) => (h2.getCell(7 + g * 4 + i).value = a));
    const put = (r: number, vals: Record<number, string | number>) =>
      Object.entries(vals).forEach(([c, v]) => (ws.getRow(r).getCell(Number(c)).value = v));
    put(5, { 1: '001', 2: 'สมชาย', 3: '3b', 4: 'ผู้จัดการ', 7: 'X', 8: 'x', 10: 'X', 11: 'ใช่' }); // 'ใช่' ไม่ใช่ X
    put(6, { 1: 12345, 4: 'เจ้าหน้าที่', 7: 'X', 23: 'หมายเหตุ' }); // รหัสเป็นตัวเลข
    put(7, { 4: 'ไม่มีรหัส', 7: 'X' }); // ไม่มีรหัสพนักงาน → ข้าม
    // แถว 8 ว่างทั้งแถว → ข้ามเงียบๆ
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('หาหัวตารางเองแม้มีแถวชื่อเรื่อง · ตัวพิมพ์เล็ก x ใช้ได้ · Level เป็นตัวพิมพ์ใหญ่', async () => {
    const r = await parseAuthorityWorkbook(await sample());
    expect(r.rows.map((x) => x.employeeCode)).toEqual(['001', '12345']);
    const first = r.rows[0];
    expect(first.level).toBe('3B');
    // คอลัมน์ G..J = HC ดู/เพิ่ม/แก้ไข/อนุมัติ · K..N = SC …
    expect(first.permissions.slice(0, 4)).toEqual([true, true, false, true]); // 'X','x',ว่าง,'X'
    expect(first.permissions[4]).toBe(false); // SC ดู = 'ใช่' ไม่ใช่ X → ไม่มีสิทธิ์ (และมีคำเตือน)
    expect(first.permissions.filter(Boolean)).toHaveLength(3);
  });

  it('เตือนค่าที่ไม่ใช่ X / รหัสเป็นตัวเลข / ข้ามแถวไม่มีรหัส', async () => {
    const r = await parseAuthorityWorkbook(await sample());
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(['UNEXPECTED_CELL', 'NUMERIC_EMPLOYEE_CODE', 'SKIPPED_ROW']),
    );
    expect(r.issues.every((i) => i.severity === 'Warning')).toBe(true);
  });

  it('ไม่ใช่ template → Error TEMPLATE_MISMATCH · sheet ที่ไม่มี → SHEET_NOT_FOUND · ไม่มีข้อมูล → NO_DATA', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').getCell('A1').value = 'อะไรก็ไม่รู้';
    const bad = await parseAuthorityWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(bad.issues[0]).toMatchObject({ severity: 'Error', code: 'TEMPLATE_MISMATCH' });

    const tpl = await buildAuthorityTemplate();
    expect((await parseAuthorityWorkbook(tpl, 'ไม่มีชีตนี้')).issues[0].code).toBe(
      'SHEET_NOT_FOUND',
    );

    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(tpl as unknown as ExcelJS.Buffer);
    wb2.worksheets[0].spliceRows(3, 1); // ลบแถวตัวอย่าง
    const empty = await parseAuthorityWorkbook(Buffer.from(await wb2.xlsx.writeBuffer()));
    expect(empty.issues.map((i) => i.code)).toContain('NO_DATA');
  });

  it('ไฟล์ที่ไม่ใช่ xlsx → BusinessException EXCEL_INVALID', async () => {
    await expect(parseAuthorityWorkbook(Buffer.from('ไม่ใช่ excel'))).rejects.toMatchObject({
      response: { code: 'EXCEL_INVALID' },
    });
  });
});
