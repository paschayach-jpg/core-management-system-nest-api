import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { RequestContextService } from '../../core/cls/request-context.service';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import type { UserContext } from '../interfaces/user-context';

/** guard ระดับ global: ทุก endpoint ต้องมี Bearer JWT ที่ถูกต้อง เว้นแต่ติด @Public() */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: RequestContextService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const ok = (await super.canActivate(context)) as boolean;
    if (ok) {
      const req = context.switchToHttp().getRequest<{ user?: UserContext }>();
      if (req.user) this.ctx.setUser(req.user, req.user.sessionId);
    }
    return ok;
  }

  override handleRequest<TUser = UserContext>(err: unknown, user: TUser | false): TUser {
    if (err instanceof Error) throw err;
    if (!user) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ');
    return user;
  }
}
