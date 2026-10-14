import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRole } from '../../src/common/constants/enums';
import { MIN_ROLE_KEY } from '../../src/common/decorators/auth.decorators';
import { MinRoleGuard } from '../../src/common/guards/min-role.guard';
import { fakeUser } from '../helpers/stubs';

function ctx(user: unknown, minRole?: AppRole): ExecutionContext {
  class H {
    handler() {
      return undefined;
    }
  }
  if (minRole !== undefined) Reflect.defineMetadata(MIN_ROLE_KEY, minRole, H.prototype.handler);
  return {
    getHandler: () => H.prototype.handler,
    getClass: () => H,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('MinRoleGuard', () => {
  const guard = new MinRoleGuard(new Reflector());

  it('ไม่มี @MinRole → ผ่าน', () => {
    expect(guard.canActivate(ctx(fakeUser({ appRole: AppRole.Officer })))).toBe(true);
  });

  it('role ต่ำกว่าที่กำหนด → 403', () => {
    expect(() =>
      guard.canActivate(ctx(fakeUser({ appRole: AppRole.SrOfficer }), AppRole.Manager)),
    ).toThrow(ForbiddenException);
  });

  it('role เท่ากับหรือสูงกว่า → ผ่าน', () => {
    expect(guard.canActivate(ctx(fakeUser({ appRole: AppRole.Manager }), AppRole.Manager))).toBe(
      true,
    );
    expect(guard.canActivate(ctx(fakeUser({ appRole: AppRole.Admin }), AppRole.Manager))).toBe(
      true,
    );
  });

  it('ไม่มี user ใน request แต่ต้องการ role → 403', () => {
    expect(() => guard.canActivate(ctx(undefined, AppRole.Officer))).toThrow(ForbiddenException);
  });
});
