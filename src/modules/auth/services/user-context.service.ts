import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import { AppRole } from '../../../common/constants/enums';
import type { FolderAuthority, UserContext } from '../../../common/interfaces/user-context';
import { AppConfigService } from '../../../config';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { UserAccount } from '../../shared/entities/user-account.entity';

interface AuthorityRow {
  ConfigID: number;
  ConfigLabel: string;
  LevelCode: string | null;
  ConfidentialityLevel: number;
  CanView: boolean;
  CanAdd: boolean;
  CanEdit: boolean;
  CanApprove: boolean;
  CanDownload: boolean;
}

const key = (userId: number) => `user-context:${userId}`;

/**
 * สร้าง UserContext ของผู้ใช้จาก DB (EMS.UserAccount + สิทธิ์ตามชั้นความลับ) — ทำทุกคำขอตอนตรวจ JWT
 * จึงมี cache สั้นๆ (CACHE_TTL_SEC) ถ้าแอดมินเปลี่ยนสิทธิ์/ปิดบัญชี จะมีผลภายในเวลานี้ หรือทันทีเมื่อเรียก invalidate()
 */
@Injectable()
export class UserContextService {
  constructor(
    @InjectRepository(UserAccount) private readonly users: Repository<UserAccount>,
    private readonly sp: SpExecutor,
    private readonly config: AppConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** null = ไม่พบผู้ใช้หรือบัญชีถูกปิด */
  async load(userId: number): Promise<UserContext | null> {
    const cached = await this.cache.get<UserContext>(key(userId));
    if (cached) return cached;

    const account = await this.users.findOneBy({ userId });
    if (!account || !account.isActive) return null;

    const ctx = await this.build(account);
    const ttlMs = this.config.get('CACHE_TTL_SEC') * 1000;
    if (ttlMs > 0) await this.cache.set(key(userId), ctx, ttlMs);
    return ctx;
  }

  async build(account: UserAccount): Promise<UserContext> {
    return {
      userId: account.userId,
      adUserName: account.adUserName,
      displayName: account.displayName,
      appRole: (account.appRole as AppRole) ?? AppRole.Officer,
      orgUnitId: account.orgUnitId,
      employeeCode: account.employeeCode,
      departmentId: account.departmentId,
      departmentCode: account.departmentCode,
      divisionId: account.divisionId,
      divisionCode: account.divisionCode,
      positionName: account.positionName,
      levelCode: account.levelCode,
      consentGiven: Boolean(account.consentGiven),
      authority: await this.resolveAuthority(account),
    };
  }

  async invalidate(userId: number): Promise<void> {
    await this.cache.del(key(userId));
  }

  /**
   * สิทธิ์ตามชั้นความลับ: EMS.sp_ResolveFolderAuthority เลือกชุดคอนฟิกที่เจาะจงที่สุดให้ (LevelCode+แผนก → LevelCode → ตำแหน่ง → แผนก → ฝ่าย)
   * ผลลัพธ์เป็นแถวต่อ ConfidentialityLevel (1–4) → เก็บเป็น dictionary ตามเลขชั้น เหมือน UserContext.Authority เดิม
   * ถ้า SP ยังไม่ถูก deploy ให้ถือว่าไม่มีสิทธิ์ (ไม่ทำให้ login ล้ม) — พฤติกรรมเดิม
   */
  private async resolveAuthority(account: UserAccount): Promise<Record<number, FolderAuthority>> {
    try {
      const rows = await this.sp.call(Sp.ems.resolveFolderAuthority).rows<AuthorityRow>({
        LevelCode: account.levelCode ?? null,
        PositionName: account.positionName ?? null,
        DepartmentCode: account.departmentCode ?? null,
        DivisionCode: account.divisionCode ?? null,
      });
      const dict: Record<number, FolderAuthority> = {};
      for (const r of rows) {
        dict[r.ConfidentialityLevel] = {
          configId: r.ConfigID,
          configLabel: r.ConfigLabel,
          confidentialityLevel: r.ConfidentialityLevel,
          levelCode: r.LevelCode,
          canView: Boolean(r.CanView),
          canAdd: Boolean(r.CanAdd),
          canEdit: Boolean(r.CanEdit),
          canApprove: Boolean(r.CanApprove),
          canDownload: Boolean(r.CanDownload),
        };
      }
      return dict;
    } catch {
      return {};
    }
  }
}
