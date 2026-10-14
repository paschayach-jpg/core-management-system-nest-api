import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppRole } from '../../../common/constants/enums';
import type { JwtPayload, UserContext } from '../../../common/interfaces/user-context';
import { AppConfigService } from '../../../config';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { RequestContextService } from '../../../core/cls/request-context.service';
import { Sp } from '../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../database/sp/sp-executor.service';
import { UserAccount } from '../../shared/entities/user-account.entity';
import { AdAuthClient, AdAuthResult, AdEmployeeInfo } from '../clients/ad-auth.client';
import type { AuthTokenResponseDto, UserProfileDto } from '../dto/auth.dto';
import { UserContextService } from './user-context.service';

/**
 * ยืนยันตัวตนและออก JWT ของ API
 *  1) ส่ง username/password (หรือ access token) ไปให้ AD Auth API ตรวจ
 *  2) หา/สร้างแถวใน EMS.UserAccount (ผู้ใช้ใหม่ = Officer, OrgUnit เริ่มต้น, ยังไม่ให้ความยินยอม) — พฤติกรรมเดียวกับ Program.cs เดิม
 *  3) sync ข้อมูลพนักงานจาก AD ถ้าเปลี่ยน, บันทึกเวลา login ล่าสุด
 *  4) ออก JWT ของเราเอง (อายุ JWT_EXPIRES_IN) ใส่แค่ id/role/session — ข้อมูลอื่นโหลดสดทุกคำขอ
 */
@Injectable()
export class AuthService extends CrudLoggedService {
  protected readonly logModule = 'AUTH' as const;
  protected readonly logEntity = 'UserAccount';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(UserAccount) private readonly users: Repository<UserAccount>,
    private readonly ad: AdAuthClient,
    private readonly jwt: JwtService,
    private readonly sp: SpExecutor,
    private readonly userCtx: UserContextService,
    private readonly config: AppConfigService,
    private readonly reqCtx: RequestContextService,
  ) {
    super(crudLog);
  }

  async login(username: string, password: string): Promise<AuthTokenResponseDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'LOGIN', meta: { username, method: 'password' } },
      async () => {
        const result = await this.ad.login(username.trim(), password);
        return this.completeLogin(result);
      },
      (r) => ({ recordId: r.user.userId }),
    );
  }

  async exchange(accessToken: string): Promise<AuthTokenResponseDto> {
    return this.logged(
      { action: 'EXECUTE', operation: 'LOGIN', meta: { method: 'ad-token' } },
      async () => {
        const result = await this.ad.validate(accessToken);
        return this.completeLogin(result);
      },
      (r) => ({ recordId: r.user.userId }),
    );
  }

  logout(user: UserContext): void {
    this.logEvent({ action: 'EXECUTE', operation: 'LOGOUT', recordId: user.userId });
  }

  async profile(userId: number): Promise<UserProfileDto> {
    const ctx = await this.userCtx.load(userId);
    if (!ctx) throw new UnauthorizedException('ไม่พบบัญชีผู้ใช้หรือบัญชีถูกปิดใช้งาน');
    return toProfile(ctx);
  }

  /** บันทึก/เพิกถอนความยินยอม PDPA */
  async setConsent(
    user: UserContext,
    consentGiven: boolean,
    email?: string,
  ): Promise<UserProfileDto> {
    return this.logged(
      {
        action: 'UPDATE',
        operation: consentGiven ? 'PDPA_CONSENT_GIVEN' : 'PDPA_CONSENT_REVOKED',
        recordId: user.userId,
      },
      async () => {
        const account = await this.users.findOneByOrFail({ userId: user.userId });
        await this.sp.call(Sp.ems.updateUserConsent).exec({
          UserID: user.userId,
          Email: email ?? account.email ?? '',
          ConsentGiven: consentGiven,
        });
        await this.userCtx.invalidate(user.userId);
        const fresh = await this.userCtx.load(user.userId);
        if (!fresh) throw new UnauthorizedException();
        return toProfile(fresh);
      },
    );
  }

  // ───────────────────────────────────────────────────────────────

  private async completeLogin(result: AdAuthResult): Promise<AuthTokenResponseDto> {
    if (!result.success || !result.adUserName) {
      throw new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    let account = await this.users.findOneBy({ adUserName: result.adUserName });
    if (!account) {
      if (!this.config.get('AUTH_AUTO_PROVISION')) {
        throw new ForbiddenException('ไม่พบบัญชีผู้ใช้ในระบบ กรุณาติดต่อผู้ดูแลระบบ');
      }
      account = await this.provision(result);
    }
    if (!account.isActive)
      throw new ForbiddenException('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');

    if (result.employee) await this.syncEmployee(account, result.employee);
    await this.sp.call(Sp.ems.updateLastLogin).exec({ UserID: account.userId });
    if (this.reqCtx.ip)
      await this.users.update(
        { userId: account.userId },
        { lastLoginIp: this.reqCtx.ip.slice(0, 50) },
      );

    await this.userCtx.invalidate(account.userId);
    const ctx = await this.userCtx.load(account.userId);
    if (!ctx) throw new ForbiddenException('บัญชีนี้ถูกปิดใช้งาน');

    return this.issueToken(ctx);
  }

  private async provision(result: AdAuthResult): Promise<UserAccount> {
    const emp = result.employee;
    const display =
      [emp?.titleNameTh, emp?.firstNameTh, emp?.lastNameTh].filter(Boolean).join('') ||
      result.adUserName!;
    const rows = await this.sp.call(Sp.ems.insertUserAccount).scalar<number>({
      ADUserName: result.adUserName!,
      DisplayName: display.slice(0, 200),
      Email: '',
      AppRole: AppRole.Officer,
      OrgUnitID: this.config.get('AUTH_DEFAULT_ORG_UNIT_ID'),
      CreatedBy: 0,
    });
    const created = await this.users.findOneBy({ userId: Number(rows) });
    if (!created) throw new Error('สร้างบัญชีผู้ใช้ไม่สำเร็จ');
    this.logEvent({
      action: 'CREATE',
      operation: 'AUTO_PROVISION_USER',
      recordId: created.userId,
      after: { adUserName: created.adUserName },
    });
    return created;
  }

  /** อัปเดต EMS.UserAccount เมื่อข้อมูลพนักงานจาก AD ต่างจากที่เก็บไว้ (เหมือน SyncEmployeeInfoFromAuthResult เดิม) */
  private async syncEmployee(account: UserAccount, e: AdEmployeeInfo): Promise<void> {
    const changed =
      account.employeeCode !== e.employeeCode ||
      account.employeeFirstNameTh !== e.firstNameTh ||
      account.employeeLastNameTh !== e.lastNameTh ||
      account.departmentCode !== e.departmentCode ||
      account.departmentName !== e.departmentNameTh ||
      account.divisionCode !== e.divisionCode ||
      account.divisionName !== e.divisionNameTh ||
      account.positionName !== e.position;
    if (!changed) return;

    await this.users.update(
      { userId: account.userId },
      {
        employeeCode: e.employeeCode ?? null,
        employeeTitleNameEn: e.titleNameEn ?? null,
        employeeFirstNameEn: e.firstNameEn ?? null,
        employeeLastNameEn: e.lastNameEn ?? null,
        employeeTitleNameTh: e.titleNameTh ?? null,
        employeeFirstNameTh: e.firstNameTh ?? null,
        employeeLastNameTh: e.lastNameTh ?? null,
        departmentCode: e.departmentCode ?? null,
        departmentNameEn: e.departmentNameEn ?? null,
        departmentName: e.departmentNameTh ?? null,
        divisionCode: e.divisionCode ?? null,
        divisionNameEn: e.divisionNameEn ?? null,
        divisionName: e.divisionNameTh ?? null,
        positionName: e.position ?? null,
        updatedAt: new Date(),
      },
    );
  }

  private async issueToken(ctx: UserContext): Promise<AuthTokenResponseDto> {
    const payload: JwtPayload = {
      sub: ctx.userId,
      username: ctx.adUserName,
      role: ctx.appRole,
      sid: randomUUID(),
    };
    const accessToken = await this.jwt.signAsync(payload);
    const decoded = this.jwt.decode<JwtPayload>(accessToken);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: decoded?.exp && decoded.iat ? decoded.exp - decoded.iat : 3600,
      requiresConsent: !ctx.consentGiven,
      user: toProfile(ctx),
    };
  }
}

export function toProfile(ctx: UserContext): UserProfileDto {
  return {
    userId: ctx.userId,
    adUserName: ctx.adUserName,
    displayName: ctx.displayName,
    appRole: ctx.appRole,
    orgUnitId: ctx.orgUnitId,
    employeeCode: ctx.employeeCode,
    departmentCode: ctx.departmentCode,
    divisionCode: ctx.divisionCode,
    positionName: ctx.positionName,
    consentGiven: ctx.consentGiven,
    authority: ctx.authority ?? {},
  };
}
