import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MIN_ROLE_KEY } from '../decorators/auth.decorators';
import type { AppRole } from '../constants/enums';
import type { UserContext } from '../interfaces/user-context';

/** guard ระดับ global: ตรวจ @MinRole(...) หลังยืนยันตัวตนแล้ว */
@Injectable()
export class MinRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole | undefined>(MIN_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) return true;
    const user = context.switchToHttp().getRequest<{ user?: UserContext }>().user;
    if (!user || user.appRole < required) {
      throw new ForbiddenException('สิทธิ์ของท่านไม่เพียงพอสำหรับการดำเนินการนี้');
    }
    return true;
  }
}
