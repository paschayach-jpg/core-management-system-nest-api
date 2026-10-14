import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { AppConfigService } from '../../../config';

/** ข้อมูลพนักงานจาก AD Auth API (ชื่อ field ตามที่ API ภายนอกส่งมา) */
export interface AdEmployeeInfo {
  employeeCode?: string;
  titleNameEn?: string;
  firstNameEn?: string;
  lastNameEn?: string;
  titleNameTh?: string;
  firstNameTh?: string;
  lastNameTh?: string;
  position?: string;
  divisionCode?: string;
  divisionNameEn?: string;
  divisionNameTh?: string;
  departmentCode?: string;
  departmentNameEn?: string;
  departmentNameTh?: string;
}

export interface AdAuthResult {
  success: boolean;
  /** true = AD API ปฏิเสธ credential/token; false + success=false = ติดต่อ AD ไม่ได้ (โยน 503 แทน) */
  accessToken?: string;
  /** ชื่อผู้ใช้ AD ที่ใช้ผูกกับ EMS.UserAccount.ADUserName */
  adUserName?: string;
  employee?: AdEmployeeInfo;
}

interface RawEmployee {
  employee_Code?: string;
  employee_Title_Name_En?: string;
  employee_First_Name_En?: string;
  employee_Last_Name_En?: string;
  employee_Title_Name_Th?: string;
  employee_First_Name_Th?: string;
  employee_Last_Name_Th?: string;
  position?: string;
  division_Code?: string;
  division_Name_En?: string;
  division_Name_Th?: string;
  department_Code?: string;
  department_Name_En?: string;
  department_Name_Th?: string;
}
interface RawLogin {
  accessToken?: string;
  refreshToken?: string;
  employee_Info?: RawEmployee;
}
interface RawValidate {
  userInfo?: { userId?: string; userName?: string };
  employee_Info?: RawEmployee;
}

/**
 * client ของบริการ AD Auth ภายนอก (ตัวเดียวกับที่ WinForms เรียกผ่าน AdAuthService)
 *  POST {base}{loginPath}    { username, password }  → { accessToken, refreshToken, employee_Info }
 *  POST {base}{validatePath} { accessToken }         → { userInfo{userId,userName}, employee_Info }
 * ข้อแตกต่างจากเดิม: แยก "รหัสผ่านผิด" (คืน success:false → 401) ออกจาก "ติดต่อ AD ไม่ได้" (503)
 */
@Injectable()
export class AdAuthClient {
  private readonly logger = new Logger(AdAuthClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: AppConfigService,
  ) {}

  async login(username: string, password: string): Promise<AdAuthResult> {
    const body = await this.post<RawLogin>(this.config.get('AD_AUTH_LOGIN_PATH'), {
      username,
      password,
    });
    if (!body) return { success: false };
    return {
      success: true,
      accessToken: body.accessToken,
      adUserName: username, // ใช้ username ที่ผู้ใช้กรอก (ไม่ใช่ EmployeeCode) ตามพฤติกรรมเดิม
      employee: mapEmployee(body.employee_Info),
    };
  }

  async validate(accessToken: string): Promise<AdAuthResult> {
    const body = await this.post<RawValidate>(this.config.get('AD_AUTH_VALIDATE_PATH'), {
      accessToken,
    });
    if (!body?.userInfo?.userName) return { success: false };
    return {
      success: true,
      accessToken,
      adUserName: body.userInfo.userName,
      employee: mapEmployee(body.employee_Info),
    };
  }

  /** null = AD ปฏิเสธ (4xx) · throw 503 = ติดต่อ AD ไม่ได้/AD ล่ม */
  private async post<T>(path: string, payload: unknown): Promise<T | null> {
    const url = this.config.get('AD_AUTH_BASE_URL').replace(/\/+$/, '') + path;
    try {
      const res = await firstValueFrom(
        this.http.post<T>(url, payload, {
          timeout: this.config.get('AD_AUTH_TIMEOUT_MS'),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      return res.data ?? null;
    } catch (err) {
      if (isAxiosError(err) && err.response && err.response.status < 500) return null;
      this.logger.error(`เรียก AD Auth ไม่สำเร็จ (${path}): ${(err as Error).message}`);
      throw new ServiceUnavailableException('ไม่สามารถติดต่อระบบยืนยันตัวตน (AD) ได้ในขณะนี้');
    }
  }
}

function mapEmployee(e?: RawEmployee): AdEmployeeInfo | undefined {
  if (!e) return undefined;
  return {
    employeeCode: e.employee_Code,
    titleNameEn: e.employee_Title_Name_En,
    firstNameEn: e.employee_First_Name_En,
    lastNameEn: e.employee_Last_Name_En,
    titleNameTh: e.employee_Title_Name_Th,
    firstNameTh: e.employee_First_Name_Th,
    lastNameTh: e.employee_Last_Name_Th,
    position: e.position,
    divisionCode: e.division_Code,
    divisionNameEn: e.division_Name_En,
    divisionNameTh: e.division_Name_Th,
    departmentCode: e.department_Code,
    departmentNameEn: e.department_Name_En,
    departmentNameTh: e.department_Name_Th,
  };
}
