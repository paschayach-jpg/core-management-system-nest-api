import { DmsCoreModule } from '../../../src/modules/dms/core/dms-core.module';
import {
  buildDmsCoreApprovalHandlers,
  ChangePermissionApprovalHandler,
  CreateHcApprovalHandler,
  DeleteFolderApprovalHandler,
} from '../../../src/modules/dms/core/approval-handlers/approval-handlers';
import type {
  ApprovalHandlerRegistry,
  ApprovalOutcomeHandler,
  ApprovalRecord,
} from '../../../src/modules/dms/ports/dms-approval.port';
import { admin } from './helpers';

const record = (over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  requestId: 5,
  requestType: 'CREATE_HC',
  folderId: null,
  fileId: null,
  requestedBy: 9,
  subject: 'x',
  payload: null,
  ...over,
});

function fakeServices() {
  return {
    folders: {
      createAfterApproval: jest.fn(async () => undefined),
      deleteAfterApproval: jest.fn(async () => undefined),
    },
    perms: { setAfterApproval: jest.fn(async () => undefined) },
  };
}

class FakeRegistry implements ApprovalHandlerRegistry {
  readonly handlers = new Map<string, ApprovalOutcomeHandler>();
  register(h: ApprovalOutcomeHandler): void {
    this.handlers.set(h.requestType, h);
  }
  get(type: string): ApprovalOutcomeHandler | undefined {
    return this.handlers.get(type);
  }
}

describe('approval handlers — ส่งต่อให้ service พร้อม scope', () => {
  it('CREATE_HC → FoldersService.createAfterApproval(request, approver, scope)', async () => {
    const { folders } = fakeServices();
    const scope = { tx: true } as never;
    const req = record();
    const approver = admin();
    await new CreateHcApprovalHandler(folders as never).onApproved(req, approver, scope);
    expect(folders.createAfterApproval).toHaveBeenCalledWith(req, approver, scope);
  });

  it('DELETE_FOLDER → FoldersService.deleteAfterApproval(request, approver, scope)', async () => {
    const { folders } = fakeServices();
    const req = record({ requestType: 'DELETE_FOLDER', folderId: 3 });
    await new DeleteFolderApprovalHandler(folders as never).onApproved(req, admin());
    expect(folders.deleteAfterApproval).toHaveBeenCalledWith(req, expect.anything(), undefined);
  });

  it('CHANGE_PERMISSION → FolderPermissionsService.setAfterApproval(request, approver, scope)', async () => {
    const { perms } = fakeServices();
    const scope = { tx: true } as never;
    const req = record({ requestType: 'CHANGE_PERMISSION', folderId: 3 });
    const approver = admin();
    await new ChangePermissionApprovalHandler(perms as never).onApproved(req, approver, scope);
    expect(perms.setAfterApproval).toHaveBeenCalledWith(req, approver, scope);
  });

  it('error จาก service ถูกโยนต่อ (ให้ module อนุมัติย้อนทั้งคำขอ ไม่กลืนเหมือนระบบเดิม)', async () => {
    const { folders } = fakeServices();
    folders.createAfterApproval.mockRejectedValueOnce(new Error('ชื่อซ้ำ'));
    await expect(
      new CreateHcApprovalHandler(folders as never).onApproved(record(), admin()),
    ).rejects.toThrow('ชื่อซ้ำ');
  });

  it('buildDmsCoreApprovalHandlers สร้างครบ 3 ชนิดคำขอ', () => {
    const { folders, perms } = fakeServices();
    const types = buildDmsCoreApprovalHandlers(folders as never, perms as never).map(
      (h) => h.requestType,
    );
    expect(types.sort()).toEqual(['CHANGE_PERMISSION', 'CREATE_HC', 'DELETE_FOLDER']);
  });
});

describe('DmsCoreModule.onModuleInit — ลงทะเบียน handler', () => {
  it('ลงทะเบียน CREATE_HC / DELETE_FOLDER / CHANGE_PERMISSION กับ DMS_APPROVAL_HANDLERS', () => {
    const { folders, perms } = fakeServices();
    const registry = new FakeRegistry();
    new DmsCoreModule(folders as never, perms as never, registry).onModuleInit();
    expect([...registry.handlers.keys()].sort()).toEqual([
      'CHANGE_PERMISSION',
      'CREATE_HC',
      'DELETE_FOLDER',
    ]);
    expect(registry.get('CREATE_HC')).toBeInstanceOf(CreateHcApprovalHandler);
    expect(registry.get('DELETE_FOLDER')).toBeInstanceOf(DeleteFolderApprovalHandler);
    expect(registry.get('CHANGE_PERMISSION')).toBeInstanceOf(ChangePermissionApprovalHandler);
  });

  it('handler ที่ลงทะเบียนเรียก service จริง', async () => {
    const { folders, perms } = fakeServices();
    const registry = new FakeRegistry();
    new DmsCoreModule(folders as never, perms as never, registry).onModuleInit();
    await registry
      .get('DELETE_FOLDER')
      ?.onApproved(record({ requestType: 'DELETE_FOLDER' }), admin());
    expect(folders.deleteAfterApproval).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี registry (module อนุมัติยังไม่พร้อม) → ไม่ throw', () => {
    const { folders, perms } = fakeServices();
    expect(() =>
      new DmsCoreModule(folders as never, perms as never, undefined).onModuleInit(),
    ).not.toThrow();
  });
});
