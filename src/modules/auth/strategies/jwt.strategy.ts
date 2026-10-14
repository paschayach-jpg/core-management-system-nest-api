import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload, UserContext } from '../../../common/interfaces/user-context';
import { AppConfigService } from '../../../config';
import { UserContextService } from '../services/user-context.service';

/** ตรวจ Bearer JWT แล้วโหลด UserContext สดจาก DB — ผลลัพธ์ถูกวางที่ `req.user` */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly userCtx: UserContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
      issuer: config.get('JWT_ISSUER'),
    });
  }

  async validate(payload: JwtPayload): Promise<UserContext> {
    const ctx = await this.userCtx.load(payload.sub);
    if (!ctx) throw new UnauthorizedException('บัญชีผู้ใช้ไม่พร้อมใช้งาน');
    return { ...ctx, sessionId: payload.sid };
  }
}
