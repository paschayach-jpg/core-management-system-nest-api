import { Injectable } from '@nestjs/common';
import { ClsService, ClsStore } from 'nestjs-cls';
import type { UserContext } from '../../common/interfaces/user-context';

export interface RequestContextStore extends ClsStore {
  ip?: string;
  userAgent?: string;
  user?: UserContext;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * ข้อมูลของคำขอปัจจุบัน (AsyncLocalStorage ผ่าน nestjs-cls) — เทียบได้กับ HttpContext.Current ใน .NET
 * ใช้ได้ในทุกชั้นโดยไม่ต้องส่ง parameter ต่อกันลงไป (CRUD-log ใช้ดึง user/ip/requestId)
 */
@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService<RequestContextStore>) {}

  get requestId(): string | undefined {
    return this.cls.isActive() ? (this.cls.getId() as string | undefined) : undefined;
  }

  get ip(): string | undefined {
    return this.cls.isActive() ? this.cls.get('ip') : undefined;
  }

  get userAgent(): string | undefined {
    return this.cls.isActive() ? this.cls.get('userAgent') : undefined;
  }

  get sessionId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('sessionId') : undefined;
  }

  /** ผู้ใช้ปัจจุบัน (undefined ถ้าเป็น endpoint สาธารณะ/งานเบื้องหลัง) */
  get user(): UserContext | undefined {
    return this.cls.isActive() ? this.cls.get('user') : undefined;
  }

  /** เหมือน `user` แต่ throw ถ้าไม่มี — ใช้ใน service ที่ต้องมีผู้ใช้เสมอ */
  requireUser(): UserContext {
    const u = this.user;
    if (!u) throw new Error('ไม่พบ UserContext ในคำขอนี้ (endpoint ต้องผ่าน JwtAuthGuard)');
    return u;
  }

  setUser(user: UserContext, sessionId?: string): void {
    if (!this.cls.isActive()) return;
    this.cls.set('user', user);
    if (sessionId) this.cls.set('sessionId', sessionId);
  }

  /** รันงานเบื้องหลัง (cron/event) ให้มี context ของตัวเอง */
  run<T>(fn: () => T, init: Partial<RequestContextStore> = {}): T {
    return this.cls.run(() => {
      for (const [k, v] of Object.entries(init)) this.cls.set(k, v);
      return fn();
    });
  }
}
