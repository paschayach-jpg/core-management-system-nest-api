import { Global, Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BASE_ENV } from '../../helpers/stubs';
import { fakeDataSource } from '../../helpers/fake-datasource';
import {
  ApprovalHandlerRegistry,
  ApprovalOutcomeHandler,
  DMS_APPROVAL_HANDLERS,
  DMS_APPROVAL_PORT,
  DmsApprovalPort,
} from '../../../src/modules/dms/ports/dms-approval.port';
import { DMS_QUOTA_PORT, DmsQuotaPort } from '../../../src/modules/dms/ports/dms-quota.port';
import { DMS_FILE_UNCHECKED_PORT } from '../../../src/modules/dms/ports/dms-file.port';

// ตั้งค่า env ก่อน import AppModule (ConfigModule ตรวจ env ตอน import)
Object.assign(process.env, BASE_ENV, {
  LOG_LEVEL: 'silent',
  CRUD_LOG_CONSOLE: 'false',
  SWAGGER_ENABLED: 'false',
});

/* eslint-disable @typescript-eslint/no-require-imports */

const createHc: ApprovalOutcomeHandler = {
  requestType: 'CREATE_HC',
  onApproved: async () => undefined,
};

/** จำลอง DmsCoreModule: ไม่ import DmsApprovalsModule แต่ฉีด token ที่ module นั้น export แบบ @Global */
@Injectable()
class FakeCore implements OnModuleInit {
  constructor(
    @Inject(DMS_APPROVAL_HANDLERS) readonly registry: ApprovalHandlerRegistry,
    @Inject(DMS_APPROVAL_PORT) readonly approvalPort: DmsApprovalPort,
    @Inject(DMS_QUOTA_PORT) readonly quotaPort: DmsQuotaPort,
  ) {}
  onModuleInit(): void {
    this.registry.register(createHc);
  }
}

@Module({ providers: [FakeCore], exports: [FakeCore] })
class FakeCoreModule {}

const fileHandle = {
  openReadUnchecked: async () => {
    throw new Error('ไม่ได้ใช้');
  },
};
@Global()
@Module({
  providers: [{ provide: DMS_FILE_UNCHECKED_PORT, useValue: fileHandle }],
  exports: [DMS_FILE_UNCHECKED_PORT],
})
class FakeFileModule {}

async function boot(extra: unknown[]) {
  const { AppModule } = require('../../../src/app.module');
  const ref = await Test.createTestingModule({
    imports: [AppModule, FakeCoreModule, ...(extra as never[])],
  })
    .overrideProvider(getDataSourceToken())
    .useValue(fakeDataSource())
    .overrideProvider(getDataSourceToken('project'))
    .useValue(fakeDataSource())
    .compile();
  const app = ref.createNestApplication();
  await app.init();
  return app;
}

describe('การต่อสาย DmsApprovalsModule ↔ DmsCoreModule (ผ่าน port เท่านั้น)', () => {
  it('Core ฉีด DMS_APPROVAL_PORT / DMS_APPROVAL_HANDLERS / DMS_QUOTA_PORT ได้โดยไม่ import module (global) และลงทะเบียน handler ได้จริง', async () => {
    const app = await boot([]);
    try {
      const {
        InMemoryApprovalHandlerRegistry,
      } = require('../../../src/modules/dms/approvals/approvals/approval-handler.registry');
      const {
        DmsApprovalPortProvider,
      } = require('../../../src/modules/dms/approvals/approvals/dms-approval-port.provider');
      const {
        DmsQuotaPortProvider,
      } = require('../../../src/modules/dms/approvals/quota/dms-quota-port.provider');
      const {
        ApprovalsService,
      } = require('../../../src/modules/dms/approvals/approvals/approvals.service');

      const core = app.get(FakeCore);
      expect(core.approvalPort).toBeInstanceOf(DmsApprovalPortProvider);
      expect(core.quotaPort).toBeInstanceOf(DmsQuotaPortProvider);
      expect(core.registry).toBeInstanceOf(InMemoryApprovalHandlerRegistry);

      // registry ที่ Core เห็น = ตัวเดียวกับที่ ApprovalsService ใช้เรียก handler กลับ
      const approvals = app.get(ApprovalsService) as { handlers: { get(t: string): unknown } };
      expect(approvals.handlers).toBe(core.registry);
      expect(approvals.handlers.get('CREATE_HC')).toBe(createHc);
      expect(approvals.handlers.get('DELETE_FOLDER')).toBeUndefined();

      // ไม่มี DMS_FILE_UNCHECKED_PORT → @Optional() เป็น undefined (ลิงก์สาธารณะตอบ 503)
      const pub = app.get(
        require('../../../src/modules/dms/approvals/shares/public-share-access.service')
          .PublicShareAccessService,
      ) as { filePort?: unknown };
      expect(pub.filePort).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('มี DMS_FILE_UNCHECKED_PORT จาก module อื่น → PublicShareAccessService ได้รับไปใช้', async () => {
    const app = await boot([FakeFileModule]);
    try {
      const pub = app.get(
        require('../../../src/modules/dms/approvals/shares/public-share-access.service')
          .PublicShareAccessService,
      ) as { filePort?: unknown };
      expect(pub.filePort).toBe(fileHandle);
    } finally {
      await app.close();
    }
  });
});
