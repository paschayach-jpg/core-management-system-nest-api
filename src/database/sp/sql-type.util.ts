import type * as sql from 'mssql';

/** แปลงชนิดจาก catalog ('NVARCHAR(200)', 'DECIMAL(18,2)', 'INT' ...) เป็นชนิดของ mssql */
export function toMssqlType(
  mssql: typeof sql,
  sqlType: string,
): sql.ISqlType | (() => sql.ISqlType) {
  const m = /^\s*([A-Za-z0-9_]+)\s*(?:\(\s*([A-Za-z0-9]+)\s*(?:,\s*(\d+))?\s*\))?\s*$/.exec(
    sqlType,
  );
  if (!m) throw new Error(`ไม่รู้จักชนิด SQL: ${sqlType}`);
  const name = m[1].toUpperCase();
  const a = m[2];
  const b = m[3];
  const len = a && /^max$/i.test(a) ? mssql.MAX : a ? Number(a) : undefined;
  const T = mssql.TYPES;

  switch (name) {
    case 'INT':
      return T.Int;
    case 'BIGINT':
      return T.BigInt;
    case 'SMALLINT':
      return T.SmallInt;
    case 'TINYINT':
      return T.TinyInt;
    case 'BIT':
      return T.Bit;
    case 'VARCHAR':
      return T.VarChar(len ?? mssql.MAX);
    case 'NVARCHAR':
      return T.NVarChar(len ?? mssql.MAX);
    case 'CHAR':
      return T.Char(len ?? 1);
    case 'NCHAR':
      return T.NChar(len ?? 1);
    case 'TEXT':
      return T.Text;
    case 'NTEXT':
      return T.NText;
    case 'DATETIME':
      return T.DateTime;
    case 'DATETIME2':
      return T.DateTime2(a ? Number(a) : undefined);
    case 'SMALLDATETIME':
      return T.SmallDateTime;
    case 'DATE':
      return T.Date;
    case 'TIME':
      return T.Time(a ? Number(a) : undefined);
    case 'DECIMAL':
    case 'NUMERIC':
      return T.Decimal(a ? Number(a) : 18, b ? Number(b) : 0);
    case 'MONEY':
      return T.Money;
    case 'FLOAT':
      return T.Float;
    case 'REAL':
      return T.Real;
    case 'UNIQUEIDENTIFIER':
      return T.UniqueIdentifier;
    case 'VARBINARY':
      return T.VarBinary(len ?? mssql.MAX);
    case 'XML':
      return T.Xml;
    default:
      throw new Error(`ยังไม่รองรับชนิด SQL: ${sqlType}`);
  }
}
