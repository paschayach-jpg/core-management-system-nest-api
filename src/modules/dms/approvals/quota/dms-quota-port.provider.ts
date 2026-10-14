import { Injectable } from '@nestjs/common';
import type { DmsQuotaPort } from '../../ports/dms-quota.port';
import { QuotaService } from './quota.service';

/** ตัว implement DMS_QUOTA_PORT ให้ DmsCoreModule — แปลงสัญญา (port) เป็นการเรียก QuotaService */
@Injectable()
export class DmsQuotaPortProvider implements DmsQuotaPort {
  constructor(private readonly quota: QuotaService) {}

  enforceQuota(orgUnitId: number): Promise<void> {
    return this.quota.enforce(orgUnitId);
  }

  validateBatch(orgUnitId: number, fileSizesBytes: number[]): Promise<void> {
    return this.quota.validateBatch(orgUnitId, fileSizesBytes);
  }

  sendAlertIfNeeded(orgUnitId: number): Promise<void> {
    return this.quota.sendAlertIfNeeded(orgUnitId);
  }
}
