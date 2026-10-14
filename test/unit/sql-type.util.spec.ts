import * as mssql from 'mssql';
import { toMssqlType } from '../../src/database/sp/sql-type.util';

describe('toMssqlType', () => {
  it.each([
    ['INT', mssql.Int],
    ['TINYINT', mssql.TinyInt],
    ['BIT', mssql.Bit],
    ['DATETIME', mssql.DateTime],
    ['UNIQUEIDENTIFIER', mssql.UniqueIdentifier],
  ])('%s → ชนิดตรงกัน', (name, expected) => {
    expect(toMssqlType(mssql, name)).toBe(expected);
  });

  it('NVARCHAR(200) / NVARCHAR(MAX) / VARCHAR(50)', () => {
    expect(toMssqlType(mssql, 'NVARCHAR(200)')).toMatchObject({
      type: mssql.NVarChar,
      length: 200,
    });
    expect(toMssqlType(mssql, 'NVARCHAR(MAX)')).toMatchObject({
      type: mssql.NVarChar,
      length: mssql.MAX,
    });
    expect(toMssqlType(mssql, 'varchar(50)')).toMatchObject({ type: mssql.VarChar, length: 50 });
  });

  it('DECIMAL(18,2)', () => {
    expect(toMssqlType(mssql, 'DECIMAL(18,2)')).toMatchObject({
      type: mssql.Decimal,
      precision: 18,
      scale: 2,
    });
  });

  it('ชนิดที่ไม่รู้จัก → throw', () => {
    expect(() => toMssqlType(mssql, 'GEOGRAPHY')).toThrow(/ยังไม่รองรับ/);
  });
});
