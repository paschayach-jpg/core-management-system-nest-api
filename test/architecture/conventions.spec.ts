import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MODULES_DIR = join(ROOT, 'src', 'modules');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(MODULES_DIR).filter(
  (f) =>
    f.endsWith('.ts') &&
    !f.includes(`${join('src', 'modules')}${'/'}`.replace(/\/$/, '') + '/auth/strategies'),
);
const rel = (f: string) => relative(ROOT, f);

describe('สถาปัตยกรรม: ข้อกำหนดของโปรเจกต์', () => {
  const serviceFiles = files.filter(
    (f) => /\.(service|services)\.ts$/.test(f) && !f.includes('/entities/'),
  );

  it('มี service อย่างน้อยหนึ่งไฟล์ (กัน glob ผิดจนเทสต์ว่างเปล่า)', () => {
    expect(serviceFiles.length).toBeGreaterThan(5);
  });

  it('ทุก service ที่ @Injectable เป็นคลาสที่รองรับ CRUD-log (extends CrudLoggedService / EntityCrudService)', () => {
    const violations: string[] = [];
    // service ที่ไม่ใช่ "business service" (ตัวช่วยล้วน) ต้องขึ้นรายชื่อยกเว้นพร้อมเหตุผลที่นี่
    const EXEMPT: Record<string, string> = {
      'user-context.service.ts':
        'ตัวสร้าง UserContext (infrastructure ของ auth) ไม่ใช่ CRUD ของผู้ใช้',
    };
    for (const f of serviceFiles) {
      const src = readFileSync(f, 'utf8');
      const classes = [...src.matchAll(/@Injectable\(\)\s*export class (\w+)([^{]*)\{/g)];
      for (const [, name, heritage] of classes) {
        if (Object.keys(EXEMPT).some((k) => f.endsWith(k))) continue;
        if (!/extends\s+(CrudLoggedService|EntityCrudService)\b/.test(heritage))
          violations.push(`${rel(f)} → ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('ทุก controller ระบุ @ApiTags และ @ApiBearerAuth (ยกเว้น public)', () => {
    const controllers = files.filter(
      (f) => f.endsWith('.controller.ts') || f.endsWith('.controllers.ts'),
    );
    const violations: string[] = [];
    for (const f of controllers) {
      const src = readFileSync(f, 'utf8');
      const count = (src.match(/@Controller\(/g) ?? []).length;
      const tags = (src.match(/@ApiTags\(/g) ?? []).length;
      if (count !== tags) violations.push(`${rel(f)}: @Controller ${count} แต่ @ApiTags ${tags}`);
    }
    expect(violations).toEqual([]);
  });

  it('controller ไม่ import repository/entity manager โดยตรง (ต้องผ่าน service)', () => {
    const bad: string[] = [];
    for (const f of files.filter(
      (x) => x.endsWith('.controller.ts') || x.endsWith('.controllers.ts'),
    )) {
      const src = readFileSync(f, 'utf8');
      if (
        /InjectRepository|InjectDataSource|SpExecutor|from 'typeorm'/.test(
          src.replace(/import[^;]*entities[^;]*;/g, ''),
        )
      )
        bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });

  it('service ไม่ใช้ process.env ตรงๆ (ต้องผ่าน AppConfigService)', () => {
    const bad = serviceFiles.filter((f) => /process\.env\./.test(readFileSync(f, 'utf8'))).map(rel);
    expect(bad).toEqual([]);
  });
});
