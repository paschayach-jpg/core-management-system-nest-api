import { PrincipalType } from '../../../src/common/constants/enums';
import type { PermissionRow } from '../../../src/modules/dms/core/acl/acl.repository';
import { FilePermissionsService } from '../../../src/modules/dms/core/acl/file-permissions.service';
import {
  FolderPermissionsService,
  normalizePermission,
} from '../../../src/modules/dms/core/acl/folder-permissions.service';
import { FoldersService } from '../../../src/modules/dms/core/folders/folders.service';
import { makeCrudLog } from '../../helpers/stubs';
import {
  admin,
  errorCode,
  errorStatus,
  FakeFolderRepo,
  fakeAccess,
  fakeTx,
  fileRow,
  folderRow,
  logEvents,
  manager,
  officer,
} from './helpers';

const permRow = (over: Partial<PermissionRow> = {}): PermissionRow => ({
  id: 1,
  targetId: 5,
  principalType: PrincipalType.User,
  principalId: 9,
  principalName: null,
  canRead: true,
  canWrite: false,
  canDelete: false,
  canModify: false,
  canFullControl: false,
  canDownload: false,
  isDeny: false,
  expiryDate: null,
  grantedBy: 1,
  grantedByName: null,
  grantedDate: new Date('2026-01-01'),
  revokedBy: null,
  revokedDate: null,
  revokeReason: null,
  ...over,
});

class FakeAcl {
  calls: { name: string; args: unknown[] }[] = [];
  folderRows: PermissionRow[] = [];
  fileRows: PermissionRow[] = [];
  activeFolderIds: number[] = [];
  activeFileIds: number[] = [];
  principalOk = true;
  nextId = 900;
  rec(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }
  called(n: string) {
    return this.calls.filter((c) => c.name === n);
  }
  principalExists = async (...a: unknown[]) => {
    this.rec('principalExists', ...a);
    return this.principalOk;
  };
  listFolderPermissions = async (...a: unknown[]) => {
    this.rec('listFolderPermissions', ...a);
    return this.folderRows;
  };
  getFolderPermission = async (id: number) => this.folderRows.find((r) => r.id === id) ?? null;
  findActiveFolderEntries = async (...a: unknown[]) => {
    this.rec('findActiveFolderEntries', ...a);
    return this.activeFolderIds;
  };
  insertFolderPermission = async (folderId: number, p: Record<string, unknown>) => {
    this.rec('insertFolderPermission', folderId, p);
    const id = this.nextId++;
    this.folderRows.push(
      permRow({
        id,
        targetId: folderId,
        principalType: p.principalType as PrincipalType,
        principalId: p.principalId as number,
        isDeny: p.isDeny as boolean,
      }),
    );
    return id;
  };
  revokeFolderPermission = async (...a: unknown[]) => this.rec('revokeFolderPermission', ...a);
  listFilePermissions = async () => this.fileRows;
  getFilePermission = async (id: number) => this.fileRows.find((r) => r.id === id) ?? null;
  findActiveFileEntryIds = async () => this.activeFileIds;
  insertFilePermission = async (fileId: number, p: Record<string, unknown>) => {
    this.rec('insertFilePermission', fileId, p);
    const id = this.nextId++;
    this.fileRows.push(permRow({ id, targetId: fileId, canDownload: p.canDownload as boolean }));
    return id;
  };
  revokeFilePermission = async (...a: unknown[]) => this.rec('revokeFilePermission', ...a);
  propagateFolderToFiles = async (...a: unknown[]) => {
    this.rec('propagateFolderToFiles', ...a);
    return { files: 3, entries: 6 };
  };
}

function make(
  opts: { rule?: Parameters<typeof fakeAccess>[0]; folders?: ReturnType<typeof folderRow>[] } = {},
) {
  const crud = makeCrudLog();
  const folderRepo = new FakeFolderRepo(
    opts.folders ?? [
      folderRow({ folderId: 1, folderName: '2SC', confidentialityLevel: 2 }),
      folderRow({
        folderId: 5,
        folderName: 'เอกสาร',
        parentFolderId: 1,
        confidentialityLevel: 2,
        folderDepth: 2,
      }),
    ],
  );
  const access = fakeAccess(opts.rule);
  const tx = fakeTx();
  const acl = new FakeAcl();
  const folders = new FoldersService(
    crud.service,
    folderRepo as never,
    access,
    {} as never,
    acl as never,
    tx as never,
  );
  const perms = new FolderPermissionsService(
    crud.service,
    acl as never,
    folders,
    access,
    tx as never,
  );
  const files = {
    requireActive: async (id: number) => {
      if (id === 77) return fileRow({ fileId: 77, folderId: 5 });
      throw new Error('not found');
    },
  };
  const filePerms = new FilePermissionsService(
    crud.service,
    acl as never,
    files as never,
    folders,
    access,
    tx as never,
  );
  return { perms, filePerms, acl, tx, crud, folderRepo };
}

describe('normalizePermission', () => {
  const base = { principalType: PrincipalType.User, principalId: 9 };
  it('ต้องมีอย่างน้อยหนึ่งสิทธิ์', () => {
    expect(() => normalizePermission({ ...base }, 1)).toThrow(/อย่างน้อยหนึ่งสิทธิ์/);
    expect(normalizePermission({ ...base, canRead: true }, 4)).toMatchObject({
      canRead: true,
      canWrite: false,
      isDeny: false,
      grantedBy: 4,
    });
  });
  it('วันหมดอายุต้องเป็นอนาคต', () => {
    const now = new Date('2026-10-14');
    expect(() =>
      normalizePermission({ ...base, canRead: true, expiryDate: new Date('2026-10-13') }, 1, now),
    ).toThrow(/อนาคต/);
    expect(
      normalizePermission({ ...base, canRead: true, expiryDate: new Date('2027-01-01') }, 1, now)
        .expiryDate,
    ).toEqual(new Date('2027-01-01'));
  });
});

describe('FolderPermissionsService.set — ตั้งสิทธิ์โฟลเดอร์', () => {
  const dto = {
    principalType: PrincipalType.Department,
    principalId: 30,
    canRead: true,
    canWrite: true,
  };

  it('เพิกถอนรายการเดิมของ principal+folder+IsDeny เดียวกันแล้วเพิ่มใหม่ใน transaction เดียว + CRUD-log', async () => {
    const { perms, acl, tx, crud } = make();
    acl.activeFolderIds = [11, 12];
    const m = manager();
    const r = await perms.set(m, 5, dto);

    expect(acl.called('findActiveFolderEntries')[0].args.slice(0, 4)).toEqual([
      5,
      PrincipalType.Department,
      30,
      false,
    ]);
    expect(acl.called('revokeFolderPermission').map((c) => c.args.slice(0, 3))).toEqual([
      [11, m.userId, 'Replaced by new permission entry'],
      [12, m.userId, 'Replaced by new permission entry'],
    ]);
    expect(acl.called('insertFolderPermission')[0].args[1]).toMatchObject({
      principalType: PrincipalType.Department,
      principalId: 30,
      canRead: true,
      canWrite: true,
      isDeny: false,
      grantedBy: m.userId,
    });
    // revoke ทั้งหมดมาก่อน insert
    const names = acl.calls.map((c) => c.name);
    expect(names.indexOf('insertFolderPermission')).toBeGreaterThan(
      names.lastIndexOf('revokeFolderPermission'),
    );
    expect(tx.calls.runs).toBe(1);
    expect(r).toMatchObject({
      targetId: 5,
      principalType: PrincipalType.Department,
      isActive: true,
    });

    const ev = (await logEvents(crud)).find((e) => e.operation === 'GRANT_FOLDER_PERMISSION');
    expect(ev).toMatchObject({
      module: 'DMS',
      entity: 'FolderPermission',
      action: 'CREATE',
      success: true,
    });
  });

  it('Deny ใช้ชื่อ operation DENY_FOLDER_PERMISSION', async () => {
    const { perms, crud } = make();
    await perms.set(manager(), 5, { ...dto, isDeny: true });
    expect((await logEvents(crud)).some((e) => e.operation === 'DENY_FOLDER_PERMISSION')).toBe(
      true,
    );
  });

  it('ผู้ใช้ต่ำกว่า Manager ตั้งสิทธิ์ไม่ได้ (403) และไม่แตะข้อมูล', async () => {
    const { perms, acl, crud } = make();
    expect(await errorCode(perms.set(officer(), 5, dto))).toBe('ROLE_REQUIRED');
    expect(await errorStatus(perms.set(officer(), 5, dto))).toBe(403);
    expect(acl.called('insertFolderPermission')).toHaveLength(0);
    expect((await logEvents(crud)).every((e) => e.success === false)).toBe(true);
  });

  it('ตรวจค่า: ไม่มีสิทธิ์ใดเลือก / หมดอายุในอดีต / ไม่พบผู้ถือสิทธิ์ / โฟลเดอร์ถูกลบ / ไม่พบโฟลเดอร์', async () => {
    const a = make();
    expect(await errorCode(a.perms.set(manager(), 5, { principalType: 1, principalId: 9 }))).toBe(
      'PERMISSION_EMPTY',
    );
    expect(
      await errorCode(a.perms.set(manager(), 5, { ...dto, expiryDate: new Date('2020-01-01') })),
    ).toBe('PERMISSION_EXPIRY_PAST');
    a.acl.principalOk = false;
    expect(await errorStatus(a.perms.set(manager(), 5, dto))).toBe(404);

    const deleted = make({ folders: [folderRow({ folderId: 5, isDeleted: true })] });
    expect(await errorCode(deleted.perms.set(manager(), 5, dto))).toBe('FOLDER_DELETED');
    expect(await errorStatus(make().perms.set(manager(), 999, dto))).toBe(404);
  });
});

describe('FolderPermissionsService — เพิกถอน/กระจาย/ดู', () => {
  it('เพิกถอน: ต้องเป็นสิทธิ์ของโฟลเดอร์นั้น · ถูกเพิกถอนแล้ว → 409 · สำเร็จบันทึก log', async () => {
    const { perms, acl, crud } = make();
    acl.folderRows = [
      permRow({ id: 1, targetId: 5 }),
      permRow({ id: 2, targetId: 5, revokedDate: new Date() }),
      permRow({ id: 3, targetId: 99 }),
    ];
    const m = manager();
    await perms.revoke(m, 5, 1, ' หมดสัญญา ');
    expect(acl.called('revokeFolderPermission')[0].args.slice(0, 3)).toEqual([
      1,
      m.userId,
      'หมดสัญญา',
    ]);
    expect(await errorCode(perms.revoke(m, 5, 2))).toBe('PERMISSION_ALREADY_REVOKED');
    expect(await errorStatus(perms.revoke(m, 5, 3))).toBe(404); // ของโฟลเดอร์อื่น
    expect(await errorStatus(perms.revoke(m, 5, 404))).toBe(404);
    expect(await errorCode(perms.revoke(officer(), 5, 1))).toBe('ROLE_REQUIRED');
    expect(
      (await logEvents(crud)).find((e) => e.operation === 'REVOKE_FOLDER_PERMISSION'),
    ).toMatchObject({
      action: 'DELETE',
      recordId: 1,
      success: true,
    });
  });

  it('กระจายสิทธิ์ลงไฟล์ (PROPAGATE_TO_FILES): Manager+ เท่านั้น, ใน transaction เดียว, log entity FilePermission', async () => {
    const { perms, acl, tx, crud } = make();
    const r = await perms.propagateToFiles(manager(), 5);
    expect(r).toEqual({ files: 3, entries: 6 });
    expect(acl.called('propagateFolderToFiles')[0].args.slice(0, 2)).toEqual([5, manager().userId]);
    expect(tx.calls.runs).toBe(1);
    expect(await errorCode(perms.propagateToFiles(officer(), 5))).toBe('ROLE_REQUIRED');
    expect((await logEvents(crud)).find((e) => e.operation === 'PROPAGATE_TO_FILES')).toMatchObject(
      {
        action: 'EXECUTE',
        entity: 'FilePermission',
        recordId: 5,
        success: true,
      },
    );
  });

  it('ดู ACL: Manager+ ดูได้ · ผู้ที่ไม่มี Modify ดูไม่ได้ · ผู้ที่มี Modify ดูได้', async () => {
    const a = make();
    a.acl.folderRows = [permRow()];
    expect(await a.perms.list(manager(), 5, false)).toHaveLength(1);
    const b = make({ rule: () => false });
    expect(await errorCode(b.perms.list(officer(), 5, false))).toBe('ACL_VIEW_DENIED');
    const c = make({ rule: (_u, _f, perm) => perm === 'Modify' });
    c.acl.folderRows = [permRow()];
    expect(await c.perms.list(officer(), 5, true)).toHaveLength(1);
    expect(c.acl.called('listFolderPermissions')[0].args.slice(0, 2)).toEqual([5, true]);
  });

  it('สิทธิ์ของฉัน: รวม ACL ทั้ง 5 ระดับและสิทธิ์ที่คำนวณจาก Authority', async () => {
    const { perms } = make({ rule: (_u, _f, perm) => perm === 'Read' || perm === 'Write' });
    const r = await perms.mine(manager(), 5);
    expect(r).toMatchObject({
      folderId: 5,
      read: true,
      write: true,
      delete: false,
      modify: false,
      fullControl: false,
      canView: true,
      canAdd: true,
      canEdit: true,
      canDeleteFolder: false,
      canDeleteFile: false,
    });
  });
});

describe('FolderPermissionsService.setAfterApproval — CHANGE_PERMISSION', () => {
  const record = (payload: Record<string, unknown> | null, folderId: number | null = 5) => ({
    requestId: 12,
    requestType: 'CHANGE_PERMISSION' as const,
    folderId,
    fileId: null,
    requestedBy: 3,
    subject: 's',
    payload,
  });

  it('ตั้งสิทธิ์ตาม payload JSON ในนามผู้อนุมัติ และใช้ transaction ที่ส่งมา', async () => {
    const { perms, acl, tx } = make();
    acl.activeFolderIds = [31];
    const approver = admin();
    const outer = { manager: {}, sp: {}, queryRunner: {} };
    await perms.setAfterApproval(
      record({ principalType: 3, principalId: 30, canRead: true, canWrite: true, isDeny: false }),
      approver,
      outer as never,
    );
    expect(tx.calls.runs).toBe(0);
    expect(acl.called('revokeFolderPermission')[0].args.slice(0, 2)).toEqual([31, approver.userId]);
    expect(acl.called('insertFolderPermission')[0].args[1]).toMatchObject({
      principalType: 3,
      principalId: 30,
      canRead: true,
      canWrite: true,
      grantedBy: approver.userId,
    });
  });

  it('อ่าน Remark รูปแบบเดิมได้ (Key:Value)', async () => {
    const { perms, acl } = make();
    await perms.setAfterApproval(
      record({
        remark:
          'PrincipalType:1 PrincipalID:9 Read:True Write:False Delete:False Modify:False FullControl:False IsDeny:False',
      }),
      manager(),
    );
    expect(acl.called('insertFolderPermission')[0].args[1]).toMatchObject({
      principalType: 1,
      principalId: 9,
      canRead: true,
    });
  });

  it('payload เสีย/ไม่มีโฟลเดอร์/ผู้อนุมัติไม่ใช่ Manager+ → error (ย้อนทั้งคำขอ)', async () => {
    const { perms } = make();
    expect(await errorCode(perms.setAfterApproval(record(null), manager()))).toBe(
      'APPROVAL_PAYLOAD_INVALID',
    );
    expect(
      await errorCode(
        perms.setAfterApproval(
          record({ principalType: 1, principalId: 9, canRead: true }, null),
          manager(),
        ),
      ),
    ).toBe('APPROVAL_PAYLOAD_INVALID');
    expect(
      await errorCode(
        perms.setAfterApproval(
          record({ principalType: 1, principalId: 9, canRead: true }),
          officer(),
        ),
      ),
    ).toBe('ROLE_REQUIRED');
  });
});

describe('FilePermissionsService', () => {
  const dto = {
    principalType: PrincipalType.User,
    principalId: 9,
    canRead: true,
    canDownload: true,
  };

  it('ตั้งสิทธิ์ไฟล์: เพิกถอนของเดิม แล้วเพิ่มใหม่ (รวม canDownload) · log SET_FILE_PERMISSION', async () => {
    const { filePerms, acl, tx, crud } = make();
    acl.activeFileIds = [4];
    const r = await filePerms.set(manager(), 77, dto);
    expect(acl.called('revokeFilePermission')[0].args.slice(0, 3)).toEqual([
      4,
      manager().userId,
      'แทนที่ด้วยรายการสิทธิ์ใหม่',
    ]);
    expect(acl.called('insertFilePermission')[0].args[1]).toMatchObject({
      canRead: true,
      canDownload: true,
    });
    expect(r.canDownload).toBe(true);
    expect(tx.calls.runs).toBe(1);
    expect(
      (await logEvents(crud)).find((e) => e.operation === 'SET_FILE_PERMISSION'),
    ).toMatchObject({
      entity: 'FilePermission',
      action: 'CREATE',
      recordId: 77,
      success: true,
    });
  });

  it('Manager+ เท่านั้นที่ตั้ง/ดู/เพิกถอน', async () => {
    const { filePerms } = make();
    expect(await errorCode(filePerms.set(officer(), 77, dto))).toBe('ROLE_REQUIRED');
    expect(await errorCode(filePerms.list(officer(), 77, false))).toBe('ROLE_REQUIRED');
    expect(await errorCode(filePerms.revoke(officer(), 77, 1))).toBe('ROLE_REQUIRED');
  });

  it('เพิกถอน: ต้องเป็นสิทธิ์ของไฟล์นั้น · ซ้ำ → 409', async () => {
    const { filePerms, acl } = make();
    acl.fileRows = [
      permRow({ id: 1, targetId: 77 }),
      permRow({ id: 2, targetId: 77, revokedDate: new Date() }),
      permRow({ id: 3, targetId: 5 }),
    ];
    await filePerms.revoke(manager(), 77, 1, 'x');
    expect(acl.called('revokeFilePermission')[0].args.slice(0, 3)).toEqual([
      1,
      manager().userId,
      'x',
    ]);
    expect(await errorCode(filePerms.revoke(manager(), 77, 2))).toBe('PERMISSION_ALREADY_REVOKED');
    expect(await errorStatus(filePerms.revoke(manager(), 77, 3))).toBe(404);
  });
});
