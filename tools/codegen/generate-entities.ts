/**
 * สร้าง TypeORM entities จากผล export DDL จริง (docs/reference/db-export)
 *   npm run codegen:entities
 * - เขียนทับไฟล์ *.entity.ts ทุกครั้ง (อย่าแก้มือ — แก้ที่ tables.config.ts แล้วรันใหม่)
 * - ไม่สร้าง relation (@ManyToOne ฯลฯ) ตั้งใจให้ query ด้วย QueryBuilder/join ระบุชัดเจน และหลีกเลี่ยง circular import
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv';
import { toCamel, toKebab } from './naming';
import { COLUMN_NOTES, ManualColumn, TABLES, TableConfig } from './tables.config';

const ROOT = join(__dirname, '..', '..');
const DB = join(ROOT, 'docs', 'reference', 'db-export');
const SRC = join(ROOT, 'src');

interface Col {
  ordinal: number;
  name: string;
  sqlType: string;
  maxLength: number;
  precision: number;
  scale: number;
  nullable: boolean;
  identity: boolean;
  computed: boolean;
  default: string | null;
}
interface Fk {
  name: string;
  column: string;
  refTable: string;
  refColumn: string;
}

const read = (f: string) => parseCsv(readFileSync(join(DB, f), 'utf8'));

function loadColumns(): Map<string, Col[]> {
  const out = new Map<string, Col[]>();
  const add = (key: string, r: string[]) => {
    const list = out.get(key) ?? [];
    list.push({
      ordinal: +r[0],
      name: r[1],
      sqlType: r[2],
      maxLength: +r[3],
      precision: +r[4],
      scale: +r[5],
      nullable: r[6] === '1',
      identity: r[7] === '1',
      computed: r[8] === '1',
      default: r[9] === 'NULL' ? null : r[9],
    });
    out.set(key, list);
  };
  for (const r of read('CMS_DB_1.1_columns.csv')) add(`${r[0]}.${r[1]}`, r.slice(2));
  for (const r of read('BUI_RG_1.1_columns.csv')) {
    add(`BUI_RG.${r[0]}.${r[1]}`, r.slice(2));
    if (r[1] === 'RunningNumber') add('RunningNumber', r.slice(2));
  }
  return out;
}

function loadPks(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (key: string, r: string[]) => {
    // r = [index, type, is_pk, is_unique, keycols]
    if (r[2] === '1')
      out.set(
        key,
        r[4].split(',').map((s) => s.trim().replace(/ DESC$/i, '')),
      );
  };
  for (const r of read('CMS_DB_1.2_PK_unique_index.csv')) add(`${r[0]}.${r[1]}`, r.slice(2));
  for (const r of read('BUI_RG_1.2_PK_unique_index.csv')) {
    add(`BUI_RG.${r[0]}.${r[1]}`, r.slice(2));
    if (r[1] === 'RunningNumber') add('RunningNumber', r.slice(2));
  }
  return out;
}

function loadFks(): Map<string, Fk[]> {
  const out = new Map<string, Fk[]>();
  for (const r of read('CMS_DB_1.3_foreign_key.csv')) {
    const key = `${r[0]}.${r[1]}`;
    const list = out.get(key) ?? [];
    list.push({ name: r[2], column: r[3], refTable: `${r[4]}.${r[5]}`, refColumn: r[6] });
    out.set(key, list);
  }
  return out;
}

function loadRowCounts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of read('CMS_DB_1.4_check_rowcount.csv'))
    if (r[2] === 'ROWS') out.set(`${r[0]}.${r[1]}`, +r[4]);
  for (const r of read('BUI_RG_1.4_check_rowcount.csv'))
    if (r[2] === 'ROWS') out.set(`BUI_RG.${r[0]}.${r[1]}`, +r[4]);
  return out;
}

function manualToCols(manual: ManualColumn[]): { cols: Col[]; pks: string[] } {
  const cols: Col[] = manual.map((m, i) => {
    const mm = /^(\w+)(?:\((\w+)\))?$/.exec(m.type);
    const base = mm?.[1] ?? m.type;
    const len = mm?.[2] === 'max' ? -1 : mm?.[2] ? +mm[2] : 0;
    return {
      ordinal: i + 1,
      name: m.name,
      sqlType: base,
      maxLength: base.startsWith('n') ? len * 2 : len,
      precision: 0,
      scale: 0,
      nullable: !!m.nullable,
      identity: !!m.identity,
      computed: false,
      default: null,
    };
  });
  return { cols, pks: manual.filter((m) => m.pk).map((m) => m.name) };
}

interface TypeInfo {
  ts: string;
  orm: string;
  length?: number | 'MAX';
  precision?: number;
  scale?: number;
}
function mapType(c: Col): TypeInfo {
  const t = c.sqlType.toLowerCase();
  switch (t) {
    case 'int':
    case 'smallint':
    case 'tinyint':
      return { ts: 'number', orm: t };
    case 'bigint':
      return { ts: 'string', orm: 'bigint' };
    case 'bit':
      return { ts: 'boolean', orm: 'bit' };
    case 'decimal':
    case 'numeric':
      return { ts: 'string', orm: t, precision: c.precision, scale: c.scale };
    case 'float':
    case 'real':
      return { ts: 'number', orm: t };
    case 'money':
    case 'smallmoney':
      return { ts: 'string', orm: t };
    case 'char':
    case 'varchar':
      return { ts: 'string', orm: t, length: c.maxLength === -1 ? 'MAX' : c.maxLength };
    case 'nchar':
    case 'nvarchar':
      return { ts: 'string', orm: t, length: c.maxLength === -1 ? 'MAX' : c.maxLength / 2 };
    case 'text':
    case 'ntext':
      return { ts: 'string', orm: t };
    case 'date':
    case 'datetime':
    case 'smalldatetime':
      return { ts: 'Date', orm: t };
    case 'datetime2':
    case 'time':
    case 'datetimeoffset':
      return { ts: 'Date', orm: t, precision: c.scale };
    case 'uniqueidentifier':
      return { ts: 'string', orm: 'uniqueidentifier' };
    case 'timestamp':
    case 'rowversion':
      return { ts: 'Buffer', orm: 'rowversion' };
    case 'varbinary':
    case 'binary':
    case 'image':
      return { ts: 'Buffer', orm: t === 'image' ? 'image' : t };
    default:
      throw new Error(`ไม่รู้จักชนิดข้อมูล SQL: ${c.sqlType}`);
  }
}

function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderEntity(
  cfg: TableConfig,
  cols: Col[],
  pks: string[],
  fks: Fk[],
  rows: number | undefined,
): { code: string; fileBase: string } {
  const parts = cfg.key.split('.');
  const table = parts[parts.length - 1];
  const schema = parts.length >= 2 ? (parts.length === 3 ? parts[1] : parts[0]) : 'dbo';
  const props = new Map<string, string>();
  const imports = new Set<string>(['Column', 'Entity']);
  const usesExclude =
    (cfg.hidden ?? []).length > 0 || cols.some((c) => c.sqlType.toLowerCase() === 'timestamp');
  const body: string[] = [];
  const pkSet = new Set(pks);
  const fkByCol = new Map<string, Fk[]>();
  for (const f of fks) fkByCol.set(f.column, [...(fkByCol.get(f.column) ?? []), f]);

  for (const c of cols) {
    const prop = toCamel(c.name, cfg.stripRgpPrefix);
    if (props.has(prop))
      throw new Error(`property ซ้ำ ${prop} ใน ${cfg.key} (${props.get(prop)} / ${c.name})`);
    props.set(prop, c.name);
    const ti = mapType(c);
    const isPk = pkSet.has(c.name);
    const opts: string[] = [`name: ${q(c.name)}`, `type: ${q(ti.orm)}`];
    if (ti.length !== undefined) opts.push(`length: ${ti.length === 'MAX' ? "'MAX'" : ti.length}`);
    if (
      ti.precision !== undefined &&
      (ti.orm === 'decimal' || ti.orm === 'numeric' || ti.precision > 0)
    )
      opts.push(`precision: ${ti.precision}`);
    if (ti.scale !== undefined && (ti.orm === 'decimal' || ti.orm === 'numeric'))
      opts.push(`scale: ${ti.scale}`);
    if (c.nullable && !isPk) opts.push('nullable: true');
    const isRowVersion = ti.orm === 'rowversion';
    if (c.computed || isRowVersion) opts.push('insert: false', 'update: false');
    if (c.identity && !isPk) opts.push('insert: false', 'update: false');

    const doc: string[] = [];
    const note = COLUMN_NOTES[`${cfg.key}.${c.name}`];
    if (note) doc.push(note);
    if (c.default) doc.push(`DB default: ${c.default}`);
    if (c.computed) doc.push('computed column (อ่านอย่างเดียว)');
    for (const f of fkByCol.get(c.name) ?? []) doc.push(`FK → ${f.refTable}.${f.refColumn}`);
    if (doc.length) body.push(`  /** ${doc.join(' · ')} */`);

    if (cfg.hidden?.includes(c.name) || isRowVersion) {
      imports.add('Exclude');
      body.push('  @Exclude()');
    }
    const optional = c.nullable || !!c.default || c.identity || c.computed || isRowVersion;
    const tsType = c.nullable ? `${ti.ts} | null` : ti.ts;
    if (isPk && c.identity) {
      imports.add('PrimaryGeneratedColumn');
      body.push(
        `  @PrimaryGeneratedColumn('increment', { name: ${q(c.name)}, type: ${q(ti.orm)} as 'int' })`,
      );
      body.push(`  ${prop}: ${tsType};`);
    } else if (isPk) {
      imports.add('PrimaryColumn');
      body.push(`  @PrimaryColumn({ ${opts.join(', ')} })`);
      body.push(`  ${prop}: ${tsType};`);
    } else {
      body.push(`  @Column({ ${opts.join(', ')} })`);
      body.push(`  ${prop}${optional ? '?' : ''}: ${tsType};`);
    }
    body.push('');
  }

  const typeormImports = [...imports].filter((i) => i !== 'Exclude').sort();
  const lines: string[] = [];
  lines.push('/* eslint-disable */');
  lines.push(
    '// <auto-generated> สร้างโดย tools/codegen/generate-entities.ts — อย่าแก้มือ แก้ที่ tables.config.ts แล้วรัน npm run codegen:entities',
  );
  lines.push(`import { ${typeormImports.join(', ')} } from 'typeorm';`);
  if (usesExclude) lines.push("import { Exclude } from 'class-transformer';");
  lines.push('');
  lines.push('/**');
  lines.push(
    ` * ตาราง \`${cfg.key}\`${rows !== undefined ? ` (~${rows.toLocaleString('en-US')} แถว ณ วันที่ export)` : ''}`,
  );
  if (cfg.note) lines.push(` * ${cfg.note}`);
  lines.push(` * PK: ${pks.join(', ') || '(ไม่ทราบ)'}`);
  lines.push(' */');
  lines.push(`@Entity({ schema: ${q(schema)}, name: ${q(table)} })`);
  lines.push(`export class ${cfg.className} {`);
  lines.push(...body);
  while (lines[lines.length - 1] === '') lines.pop();
  lines.push('}');
  lines.push('');
  return { code: lines.join('\n'), fileBase: toKebab(cfg.className) };
}

function main() {
  const columns = loadColumns();
  const pkMap = loadPks();
  const fkMap = loadFks();
  const rowMap = loadRowCounts();

  // เคลียร์ entities เดิม
  for (const m of ['shared', 'dms', 'kms', 'rgp', 'wfe']) {
    const dir = join(SRC, 'modules', m, 'entities');
    if (existsSync(dir))
      for (const f of readdirSync(dir))
        if (f.endsWith('.entity.ts') || f === 'index.ts') rmSync(join(dir, f));
    mkdirSync(dir, { recursive: true });
  }

  const byModule = new Map<string, TableConfig[]>();
  const mainList: TableConfig[] = [];
  const projectList: TableConfig[] = [];
  for (const cfg of TABLES) {
    let cols: Col[] | undefined = columns.get(cfg.key);
    let pks: string[] = pkMap.get(cfg.key) ?? [];
    if (cfg.manual) {
      const m = manualToCols(cfg.manual);
      cols = m.cols;
      pks = m.pks;
    }
    if (!cols)
      throw new Error(
        `ไม่พบคอลัมน์ของ ${cfg.key} ใน export (ถ้าไม่มี DDL ให้ระบุ manual ใน tables.config.ts)`,
      );
    if (pks.length === 0 && cfg.fallbackPk) pks = cfg.fallbackPk;
    if (pks.length === 0) {
      const idCol = cols.find((c) => c.identity);
      if (idCol) {
        pks = [idCol.name];
        console.warn(
          `⚠ ${cfg.key}: ไม่มี PK constraint ใน DB — ใช้คอลัมน์ identity ${idCol.name} เป็น PK ของ entity`,
        );
      }
    }
    if (pks.length === 0)
      throw new Error(
        `ไม่พบ PK ของ ${cfg.key} (ระบุ fallbackPk ใน tables.config.ts ได้ถ้าตารางไม่มี PK จริง)`,
      );
    const { code, fileBase } = renderEntity(
      cfg,
      [...cols].sort((a, b) => a.ordinal - b.ordinal),
      pks,
      fkMap.get(cfg.key) ?? [],
      rowMap.get(cfg.key),
    );
    writeFileSync(join(SRC, 'modules', cfg.module, 'entities', `${fileBase}.entity.ts`), code);
    byModule.set(cfg.module, [...(byModule.get(cfg.module) ?? []), cfg]);
    (cfg.dataSource === 'project' ? projectList : mainList).push(cfg);
  }

  for (const [mod, list] of byModule) {
    const idx = list
      .sort((a, b) => a.className.localeCompare(b.className))
      .map((c) => `export * from './${toKebab(c.className)}.entity';`)
      .join('\n');
    writeFileSync(
      join(SRC, 'modules', mod, 'entities', 'index.ts'),
      `/* eslint-disable */\n// <auto-generated>\n${idx}\n`,
    );
  }

  const imp = (list: TableConfig[]) =>
    list
      .map(
        (c) =>
          `import { ${c.className} } from '../modules/${c.module}/entities/${toKebab(c.className)}.entity';`,
      )
      .join('\n');
  const arr = (name: string, list: TableConfig[]) =>
    `export const ${name} = [\n${list.map((c) => `  ${c.className},`).join('\n')}\n];`;
  writeFileSync(
    join(SRC, 'database', 'entities.generated.ts'),
    `/* eslint-disable */\n// <auto-generated> สร้างโดย tools/codegen/generate-entities.ts\n${imp([...mainList, ...projectList])}\n\n` +
      `/** entities ของฐานหลัก (CMS_DB) */\n${arr('MAIN_ENTITIES', mainList)}\n\n` +
      `/** entities ของฐาน BUI_RG (ProjectDb) */\n${arr('PROJECT_ENTITIES', projectList)}\n`,
  );
  console.log(
    `generated ${TABLES.length} entities (${mainList.length} main, ${projectList.length} project)`,
  );
}

main();
