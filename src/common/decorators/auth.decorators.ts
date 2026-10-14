import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { AppRole } from '../constants/enums';
import type { UserContext } from '../interfaces/user-context';

export const IS_PUBLIC_KEY = 'isPublic';
export const MIN_ROLE_KEY = 'minRole';

/** endpoint ที่ไม่ต้อง login (เช่น /auth/login, /health) — ค่าเริ่มต้นทุก endpoint ต้อง login */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** ต้องมี AppRole >= ค่าที่ระบุ (เช่น `@MinRole(AppRole.Manager)` ตรงกับกฎ `AppRole < 3` เดิม) */
export const MinRole = (role: AppRole) => SetMetadata(MIN_ROLE_KEY, role);

/** ดึงผู้ใช้ปัจจุบันเป็น parameter: `get(@CurrentUser() user: UserContext)` */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserContext => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: UserContext }>();
    return req.user as UserContext;
  },
);
