import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import type { UserContext } from '../../../common/interfaces/user-context';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { SystemConfig } from '../entities/system-config.entity';

const SECRET_KEY = /token|password|secret|apikey|api_key|credential/i;
const cacheKey = (k: string) => `sysconfig:${k}`;

export interface SystemConfigItem {
  key: string;
  value: string | null;
  /** true = ค่าถูกปกปิด (เป็นความลับ) */
  masked: boolean;
  updatedByUserId?: number | null;
  updatedDate?: Date | null;
}

/**
 * ค่าตั้งระบบใน dbo.SystemConfig (แทน ConfigManager เดิม) — อ่านผ่าน SP + cache, เขียนผ่าน SP แล้วล้าง cache
 * module อื่นใช้ `get(key)` ได้ · รายการที่ส่งออก API จะปกปิดค่าของ key ที่ดูเป็นความลับ (token/password/...)
 */
@Injectable()
export class SystemConfigService extends CrudLoggedService {
  protected readonly logModule = 'SHARED' as const;
  protected readonly logEntity = 'SystemConfig';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(SystemConfig) private readonly repo: Repository<SystemConfig>,
    private readonly sp: SpExecutor,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    super(crudLog);
  }

  /** ค่าดิบ (ใช้ภายใน) — null ถ้าไม่มี key */
  async get(key: string): Promise<string | null> {
    const hit = await this.cache.get<{ v: string | null }>(cacheKey(key));
    if (hit) return hit.v;
    const row = await this.sp
      .call(Sp.dbo.getSystemConfig)
      .one<{ ConfigValue: string | null }>({ Key: key });
    const value = row?.ConfigValue ?? null;
    await this.cache.set(cacheKey(key), { v: value });
    return value;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.get(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.get(key);
    if (raw === null) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }

  async list(): Promise<SystemConfigItem[]> {
    const rows = await this.repo.find({ order: { configKey: 'ASC' } });
    return rows.map((r) => this.toItem(r.configKey, r.configValue ?? null, r));
  }

  async getItem(key: string): Promise<SystemConfigItem | null> {
    const r = await this.repo.findOneBy({ configKey: key });
    return r ? this.toItem(r.configKey, r.configValue ?? null, r) : null;
  }

  set(key: string, value: string, user: UserContext): Promise<SystemConfigItem> {
    return this.logged(
      {
        action: 'UPDATE',
        recordId: key,
        // ไม่เก็บค่าของ key ที่เป็นความลับลง log
        captureBefore: async () => ((await this.getItem(key)) ?? { key, value: null }) as unknown,
      },
      async () => {
        await this.sp
          .call(Sp.dbo.upsertSystemConfig)
          .exec({ Key: key, Value: value, UpdatedByUserId: user.userId });
        await this.cache.del(cacheKey(key));
        return (await this.getItem(key)) as SystemConfigItem;
      },
      (r) => ({ after: r }),
    );
  }

  private toItem(key: string, value: string | null, r: SystemConfig): SystemConfigItem {
    const masked = SECRET_KEY.test(key);
    return {
      key,
      value: masked && value ? '********' : value,
      masked,
      updatedByUserId: (r as { updatedByUserId?: number | null }).updatedByUserId,
      updatedDate: (r as { updatedDate?: Date | null }).updatedDate,
    };
  }
}
