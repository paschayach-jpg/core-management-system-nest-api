import 'reflect-metadata';
import { AppRole } from '../../../src/common/constants/enums';
import { IS_PUBLIC_KEY, MIN_ROLE_KEY } from '../../../src/common/decorators/auth.decorators';
import { ApprovalsController } from '../../../src/modules/dms/approvals/approvals/approvals.controller';
import { AuthorityController } from '../../../src/modules/dms/approvals/authority/authority.controller';
import { QuotaController } from '../../../src/modules/dms/approvals/quota/quota.controller';
import { PublicSharesController } from '../../../src/modules/dms/approvals/shares/public-shares.controller';
import { SharesController } from '../../../src/modules/dms/approvals/shares/shares.controller';

type Ctor = { prototype: object; name: string };
const handlers = (c: Ctor): string[] =>
  Object.getOwnPropertyNames(c.prototype).filter(
    (n) => n !== 'constructor' && typeof (c.prototype as Record<string, unknown>)[n] === 'function',
  );

const minRole = (c: Ctor, h: string): number | undefined =>
  (Reflect.getMetadata(MIN_ROLE_KEY, (c.prototype as Record<string, object>)[h]) as
    number | undefined) ?? (Reflect.getMetadata(MIN_ROLE_KEY, c as never) as number | undefined);
const isPublic = (c: Ctor, h: string): boolean =>
  Boolean(
    Reflect.getMetadata(IS_PUBLIC_KEY, (c.prototype as Record<string, object>)[h]) ??
    Reflect.getMetadata(IS_PUBLIC_KEY, c as never),
  );

describe('สิทธิ์ระดับ endpoint (@MinRole / @Public)', () => {
  it('มี endpoint ที่เป็น @Public เฉพาะลิงก์สาธารณะของผู้ใช้ภายนอก (2 ตัว) — ที่เหลือต้อง login ทั้งหมด', () => {
    const controllers: Ctor[] = [
      ApprovalsController,
      SharesController,
      QuotaController,
      AuthorityController,
      PublicSharesController,
    ];
    const publics = controllers.flatMap((c) =>
      handlers(c)
        .filter((h) => isPublic(c, h))
        .map((h) => `${c.name}.${h}`),
    );
    expect(publics.sort()).toEqual([
      'PublicSharesController.download',
      'PublicSharesController.open',
    ]);
  });

  it('ลงมติอนุมัติ/ปฏิเสธและยื่นคำขอสิทธิ์ต้อง Manager ขึ้นไป', () => {
    for (const h of ['approveStep', 'rejectStep', 'approveRequest', 'rejectRequest', 'submit']) {
      expect(minRole(ApprovalsController, h)).toBe(AppRole.Manager);
    }
  });

  it('คำขอดาวน์โหลด/ถอน/รายการของฉัน เปิดให้ทุก role (บังคับเจ้าของคำขอใน service)', () => {
    for (const h of [
      'submitDownload',
      'findApprovedDownload',
      'consume',
      'withdraw',
      'pending',
      'mine',
    ]) {
      expect(minRole(ApprovalsController, h)).toBeUndefined();
    }
  });

  it('แชร์: อนุมัติ/ปฏิเสธต้อง Manager+, รายการทั้งหมดเฉพาะ Admin, ที่เหลือบังคับเจ้าของใน service', () => {
    expect(minRole(SharesController, 'approveExternal')).toBe(AppRole.Manager);
    expect(minRole(SharesController, 'rejectExternal')).toBe(AppRole.Manager);
    expect(minRole(SharesController, 'allInternal')).toBe(AppRole.Admin);
    expect(minRole(SharesController, 'allExternal')).toBe(AppRole.Admin);
    for (const h of [
      'createInternal',
      'createExternal',
      'revokeExternal',
      'toggleExternal',
      'revokeInternal',
      'accessLog',
    ]) {
      expect(minRole(SharesController, h)).toBeUndefined();
    }
  });

  it('โควตา: ตั้ง/ลบ/อนุมัติ/ปฏิเสธ = Admin · ดูภาพรวม/รายการคำขอทั้งหมด = Manager+ · ยื่น/ยกเลิก/ของฉัน = ทุก role', () => {
    for (const h of ['set', 'clear', 'approve', 'reject'])
      expect(minRole(QuotaController, h)).toBe(AppRole.Admin);
    for (const h of ['list', 'requests']) expect(minRole(QuotaController, h)).toBe(AppRole.Manager);
    for (const h of ['submit', 'cancel', 'mine', 'usage'])
      expect(minRole(QuotaController, h)).toBeUndefined();
  });

  it('ระดับสิทธิ์ตามชั้นความลับ + นำเข้า Excel: Admin ทุก endpoint (ระดับคลาส)', () => {
    expect(Reflect.getMetadata(MIN_ROLE_KEY, AuthorityController)).toBe(AppRole.Admin);
  });
});
