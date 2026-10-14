import type { Env } from '../../src/config/env.schema';
import { validateEnv } from '../../src/config/env.schema';
import type { UserContext } from '../../src/common/interfaces/user-context';
import { AppRole } from '../../src/common/constants/enums';
import { CrudLogRegistry } from '../../src/core/crud-log/crud-log.registry';
import { CrudLogService } from '../../src/core/crud-log/crud-log.service';
import type { CrudLogEvent, CrudLogSink } from '../../src/core/crud-log/crud-log.types';

export const BASE_ENV: Record<string, string> = {
  DB_HOST: 'localhost',
  DB_USER: 'sa',
  DB_PASSWORD: 'x',
  JWT_SECRET: 'a'.repeat(40),
  AD_AUTH_BASE_URL: 'http://ad.local',
};

export function fakeEnv(overrides: Record<string, unknown> = {}): Env {
  return validateEnv({ ...BASE_ENV, ...overrides });
}

/** แทน AppConfigService ที่อ่านจากชุด env ที่ตรวจแล้ว */
export function fakeConfig(overrides: Record<string, unknown> = {}) {
  const env = fakeEnv(overrides);
  return {
    get: <K extends keyof Env>(k: K) => env[k],
    isProduction: env.NODE_ENV === 'production',
    corsOrigins: [] as string[],
  } as never;
}

export function fakeUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 7,
    adUserName: 'DOM\\tester',
    displayName: 'Tester',
    appRole: AppRole.Manager,
    orgUnitId: 1,
    consentGiven: true,
    ...overrides,
  };
}

/** แทน RequestContextService */
export function fakeRequestContext(user?: UserContext) {
  return {
    requestId: 'req-123',
    ip: '10.0.0.5',
    userAgent: 'jest',
    sessionId: 'sid-1',
    user,
    requireUser: () => {
      if (!user) throw new Error('no user');
      return user;
    },
    setUser: () => undefined,
  } as never;
}

export class MemorySink implements CrudLogSink {
  readonly name = 'memory';
  events: CrudLogEvent[] = [];
  write(e: CrudLogEvent): void {
    this.events.push(e);
  }
}

/** CrudLogService จริง + sink ในหน่วยความจำ — ใช้ตรวจว่า service เขียน event อะไร */
export function makeCrudLog(opts: { level?: 'off' | 'write' | 'all'; user?: UserContext } = {}) {
  const registry = new CrudLogRegistry();
  const sink = new MemorySink();
  registry.register(sink);
  const service = new CrudLogService(
    registry,
    fakeRequestContext(opts.user ?? fakeUser()),
    fakeConfig({ CRUD_LOG_LEVEL: opts.level ?? 'write' }),
  );
  return { service, sink, registry };
}
