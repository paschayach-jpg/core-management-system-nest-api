import type { SystemConfigService } from '../../shared/system-config/system-config.service';
import { WFE_CONFIG_KEY, WFE_DEFAULTS } from './wfe.constants';

/** ส่วนของ SystemConfigService ที่ WFE ใช้ (ทำให้เทสต์ส่งตัวปลอมได้ง่าย) */
export type WfeConfigReader = Pick<SystemConfigService, 'getNumber' | 'getBool'>;

export interface WfeSettings {
  slaDefaultHours: number;
  slaWarningThresholdPercent: number;
  slaJobIntervalMinutes: number;
  escalationEnabled: boolean;
  autoRejectOnOverdue: boolean;
  notificationEnabled: boolean;
  notificationInAppEnabled: boolean;
  notificationEmailEnabled: boolean;
}

/** อ่านค่าตั้ง WFE จาก dbo.SystemConfig (มี cache ใน SystemConfigService) — key ที่ไม่มีใช้ค่าเริ่มต้นของระบบเดิม */
export async function loadWfeSettings(cfg: WfeConfigReader): Promise<WfeSettings> {
  const [
    slaDefaultHours,
    slaWarningThresholdPercent,
    slaJobIntervalMinutes,
    escalationEnabled,
    autoRejectOnOverdue,
    notificationEnabled,
    notificationInAppEnabled,
    notificationEmailEnabled,
  ] = await Promise.all([
    cfg.getNumber(WFE_CONFIG_KEY.slaDefaultHours, WFE_DEFAULTS.slaDefaultHours),
    cfg.getNumber(
      WFE_CONFIG_KEY.slaWarningThresholdPercent,
      WFE_DEFAULTS.slaWarningThresholdPercent,
    ),
    cfg.getNumber(WFE_CONFIG_KEY.slaJobIntervalMinutes, WFE_DEFAULTS.slaJobIntervalMinutes),
    cfg.getBool(WFE_CONFIG_KEY.escalationEnabled, WFE_DEFAULTS.escalationEnabled),
    cfg.getBool(WFE_CONFIG_KEY.autoRejectOnOverdue, WFE_DEFAULTS.autoRejectOnOverdue),
    cfg.getBool(WFE_CONFIG_KEY.notificationEnabled, WFE_DEFAULTS.notificationEnabled),
    cfg.getBool(WFE_CONFIG_KEY.notificationInAppEnabled, WFE_DEFAULTS.notificationInAppEnabled),
    cfg.getBool(WFE_CONFIG_KEY.notificationEmailEnabled, WFE_DEFAULTS.notificationEmailEnabled),
  ]);
  return {
    slaDefaultHours: slaDefaultHours > 0 ? slaDefaultHours : WFE_DEFAULTS.slaDefaultHours,
    slaWarningThresholdPercent,
    slaJobIntervalMinutes:
      slaJobIntervalMinutes > 0 ? slaJobIntervalMinutes : WFE_DEFAULTS.slaJobIntervalMinutes,
    escalationEnabled,
    autoRejectOnOverdue,
    notificationEnabled,
    notificationInAppEnabled,
    notificationEmailEnabled,
  };
}
