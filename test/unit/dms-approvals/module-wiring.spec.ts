import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BASE_ENV } from '../../helpers/stubs';
import { fakeDataSource } from '../../helpers/fake-datasource';
import {
  ApprovalHandlerRegistry,
  DMS_APPROVAL_HANDLERS,
  DMS_APPROVAL_PORT,
} from '../../../src/modules/dms/ports/dms-approval.port';
import { DMS_QUOTA_PORT } from '../../../src/modules/dms/ports/dms-quota.port';
import { DMS_FILE_UNCHECKED_PORT } from '../../../src/modules/dms/ports/dms-file.port';

// ตั้งค่า env ก่อน import AppModule (ConfigModule ตรวจ env ตอน import)
Object.assign(process.env, BASE_ENV, {
  LOG_LEVEL: 'silent',
  CRUD_LOG_CONSOLE: 'false',
  SWAGGER_ENABLED: 'false',
});

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * ทดสอบการต่อสายจริงของ DMS ทั้งสองส่วน (core ↔ approvals) ผ่าน port เท่านั้น:
 * บูต AppModule จริง (DataSource ปลอม) แล้วตรวจว่า token ที่ approvals export เป็น @Global ถูกฉีดเข้า core,
 * core ลงทะเบียน handler ครบ และ approvals เรียก registry ตัวเดียวกัน
 */
describe('การต่อสาย DmsApprovalsModule ↔ DmsCoreModule (ผ่าน port เท่านั้น)', () => {
  let app: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeAll(async () => {
    const { AppModule } = require('../../../src/app.module');
    app = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource())
      .overrideProvider(getDataSourceToken('project'))
      .useValue(fakeDataSource())
      .compile();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registry เป็นตัวเดียวกันที่ ApprovalsService ใช้ และมี handler ของ Core ครบ 3 ชนิด', () => {
    const {
      InMemoryApprovalHandlerRegistry,
    } = require('../../../src/modules/dms/approvals/approvals/approval-handler.registry');
    const {
      ApprovalsService,
    } = require('../../../src/modules/dms/approvals/approvals/approvals.service');

    const registry = app.get<ApprovalHandlerRegistry>(DMS_APPROVAL_HANDLERS, { strict: false });
    expect(registry).toBeInstanceOf(InMemoryApprovalHandlerRegistry);

    const approvals = app.get(ApprovalsService, { strict: false }) as {
      handlers: ApprovalHandlerRegistry;
    };
    expect(approvals.handlers).toBe(registry);

    for (const type of ['CREATE_HC', 'DELETE_FOLDER', 'CHANGE_PERMISSION'] as const) {
      expect(registry.get(type)?.requestType).toBe(type);
    }
  });

  it('port ของ approvals/quota ถูก provide เป็น global และ DMS_FILE_UNCHECKED_PORT ของ Core ถูกฉีดให้ลิงก์สาธารณะ', () => {
    const {
      DmsApprovalPortProvider,
    } = require('../../../src/modules/dms/approvals/approvals/dms-approval-port.provider');
    const {
      DmsQuotaPortProvider,
    } = require('../../../src/modules/dms/approvals/quota/dms-quota-port.provider');
    const {
      PublicShareAccessService,
    } = require('../../../src/modules/dms/approvals/shares/public-share-access.service');

    expect(app.get(DMS_APPROVAL_PORT, { strict: false })).toBeInstanceOf(DmsApprovalPortProvider);
    expect(app.get(DMS_QUOTA_PORT, { strict: false })).toBeInstanceOf(DmsQuotaPortProvider);

    const filePort = app.get(DMS_FILE_UNCHECKED_PORT, { strict: false }) as {
      openReadUnchecked: unknown;
    };
    expect(typeof filePort.openReadUnchecked).toBe('function');
    const pub = app.get(PublicShareAccessService, { strict: false }) as { filePort?: unknown };
    expect(pub.filePort).toBe(filePort);
  });
});
