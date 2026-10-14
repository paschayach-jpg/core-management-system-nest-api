import type { FolderRow } from '../../../src/modules/dms/core/folders/folder.types';
import { FoldersService } from '../../../src/modules/dms/core/folders/folders.service';
import { makeCrudLog } from '../../helpers/stubs';
import {
  admin,
  errorCode,
  errorStatus,
  FakeFolderRepo,
  fakeAccess,
  fakeTx,
  folderRow,
  fullAuthority,
  logEvents,
  manager,
  officer,
  srOfficer,
} from './helpers';

// โครงสร้างตัวอย่าง:  1(2SC root) → 2 → 3 → 4   ,   10(4PC root)
const sample = (): FolderRow[] => [
  folderRow({ folderId: 1, folderName: '2SC - A [2SC]', confidentialityLevel: 2, folderDepth: 1 }),
  folderRow({
    folderId: 2,
    folderName: 'งบประมาณ',
    parentFolderId: 1,
    confidentialityLevel: 2,
    folderDepth: 2,
  }),
  folderRow({
    folderId: 3,
    folderName: 'รายงาน',
    parentFolderId: 2,
    confidentialityLevel: 2,
    folderDepth: 3,
  }),
  folderRow({
    folderId: 4,
    folderName: 'ปี 2569',
    parentFolderId: 3,
    confidentialityLevel: 2,
    folderDepth: 4,
  }),
  folderRow({ folderId: 10, folderName: '4PC - A [4PC]', confidentialityLevel: 4, folderDepth: 1 }),
];

function make(
  opts: {
    rows?: FolderRow[];
    quota?: unknown;
    approvals?: unknown;
    rule?: Parameters<typeof fakeAccess>[0];
    visible?: number[];
  } = {},
) {
  const repo = new FakeFolderRepo(opts.rows ?? sample());
  const crud = makeCrudLog();
  const acl = { insertFolderPermission: jest.fn(async () => 77) };
  const tx = fakeTx();
  const visibility = {
    visibleOrgUnitIds: async () => ({ mode: 'role', ids: new Set(opts.visible ?? [1]) }),
  };
  const svc = new FoldersService(
    crud.service,
    repo as never,
    fakeAccess(opts.rule),
    visibility as never,
    acl as never,
    tx as never,
    opts.quota as never,
    opts.approvals as never,
  );
  return { svc, repo, crud, acl, tx };
}

describe('FoldersService.create — โฟลเดอร์ย่อย', () => {
  it('สร้างใต้ Root: depth+1, สืบทอดชั้นความลับ, InheritPermission=true และบันทึก CRUD-log', async () => {
    const { svc, repo, crud } = make();
    const r = await svc.create(manager(), { name: '  สัญญา  ', parentFolderId: 2 });
    expect(r.created).toBe(true);
    expect(r.folder).toMatchObject({
      folderName: 'สัญญา',
      parentFolderId: 2,
      folderDepth: 3,
      confidentialityLevel: 2,
      inheritPermission: true,
    });
    expect(repo.called('insert')[0].args[0]).toMatchObject({
      orgUnitId: 1,
      createdBy: manager().userId,
    });
    const ev = (await logEvents(crud)).find((e) => e.operation === 'CREATE_FOLDER');
    expect(ev).toMatchObject({ module: 'DMS', entity: 'Folder', action: 'CREATE', success: true });
    expect(ev?.recordId).toBe(r.folder?.folderId);
  });

  it('ระบุชั้นความลับเท่าแม่ → InheritPermission=false', async () => {
    const { svc } = make();
    const r = await svc.create(manager(), {
      name: 'x',
      parentFolderId: 2,
      confidentialityLevel: 2,
    });
    expect(r.folder?.inheritPermission).toBe(false);
  });

  it('ระบุชั้นความลับต่างจากแม่ → 422 FOLDER_LEVEL_MISMATCH', async () => {
    const { svc } = make();
    expect(
      await errorCode(
        svc.create(manager(), { name: 'x', parentFolderId: 2, confidentialityLevel: 4 }),
      ),
    ).toBe('FOLDER_LEVEL_MISMATCH');
  });

  it('ชื่อซ้ำในแม่เดียวกัน (ไม่สนตัวพิมพ์) → 409 FOLDER_NAME_DUPLICATE และ log success=false', async () => {
    const { svc, repo, crud } = make();
    expect(await errorCode(svc.create(manager(), { name: ' งบประมาณ ', parentFolderId: 1 }))).toBe(
      'FOLDER_NAME_DUPLICATE',
    );
    expect(await errorStatus(svc.create(manager(), { name: 'งบประมาณ', parentFolderId: 1 }))).toBe(
      409,
    );
    expect(repo.called('insert')).toHaveLength(0);
    const ev = (await logEvents(crud)).filter((e) => e.operation === 'CREATE_FOLDER');
    expect(ev.every((e) => e.success === false)).toBe(true);
    expect(ev[0].errorCode).toBe('HTTP_409');
  });

  it('ชื่อมีอักขระต้องห้าม → 422', async () => {
    const { svc } = make();
    expect(await errorCode(svc.create(manager(), { name: 'a/b', parentFolderId: 1 }))).toBe(
      'FOLDER_NAME_INVALID',
    );
  });

  it('ลึกเกิน 10 ชั้น → 422 FOLDER_DEPTH_EXCEEDED', async () => {
    const rows = sample();
    rows.push(
      folderRow({
        folderId: 5,
        parentFolderId: 4,
        folderName: 'ลึก',
        confidentialityLevel: 2,
        folderDepth: 10,
      }),
    );
    const { svc } = make({ rows });
    expect(await errorCode(svc.create(manager(), { name: 'ชั้น 11', parentFolderId: 5 }))).toBe(
      'FOLDER_DEPTH_EXCEEDED',
    );
  });

  it('แม่ถูกลบ/เก็บถาวร → 422 · ไม่พบแม่ → 404', async () => {
    const rows = sample();
    rows[1].isDeleted = true;
    rows[2].isArchived = true;
    const { svc } = make({ rows });
    expect(await errorCode(svc.create(manager(), { name: 'x', parentFolderId: 2 }))).toBe(
      'FOLDER_DELETED',
    );
    expect(await errorCode(svc.create(manager(), { name: 'x', parentFolderId: 3 }))).toBe(
      'FOLDER_ARCHIVED',
    );
    expect(await errorStatus(svc.create(manager(), { name: 'x', parentFolderId: 999 }))).toBe(404);
  });

  it('แม่ไม่ได้อยู่ใต้ Root หลัก → 422 FOLDER_NOT_UNDER_MAIN_ROOT', async () => {
    const rows = [
      folderRow({ folderId: 50, folderName: 'โฟลเดอร์ลอย', confidentialityLevel: 4 }),
      folderRow({ folderId: 51, parentFolderId: 50, folderName: 'ลูก', folderDepth: 2 }),
    ];
    const { svc } = make({ rows });
    expect(await errorCode(svc.create(manager(), { name: 'x', parentFolderId: 51 }))).toBe(
      'FOLDER_NOT_UNDER_MAIN_ROOT',
    );
  });

  it('ระบุหน่วยงานไม่ตรงกับแม่ → 422 ORG_UNIT_MISMATCH', async () => {
    const { svc } = make();
    expect(
      await errorCode(svc.create(manager(), { name: 'x', parentFolderId: 2, orgUnitId: 9 })),
    ).toBe('ORG_UNIT_MISMATCH');
  });

  it('ไม่มีสิทธิ์เพิ่ม (ไม่มี Authority และ ACL ปฏิเสธ) → 403 FOLDER_ADD_DENIED', async () => {
    const { svc, repo } = make({ rule: () => false });
    expect(await errorCode(svc.create(officer(), { name: 'x', parentFolderId: 2 }))).toBe(
      'FOLDER_ADD_DENIED',
    );
    expect(await errorStatus(svc.create(officer(), { name: 'x', parentFolderId: 2 }))).toBe(403);
    expect(repo.called('insert')).toHaveLength(0);
  });

  it('Authority.CanAdd ของชั้นนั้นทำให้ผ่านได้แม้ ACL ไม่ให้', async () => {
    const { svc } = make({ rule: () => false });
    const u = officer({ authority: fullAuthority() });
    expect((await svc.create(u, { name: 'ใหม่', parentFolderId: 2 })).created).toBe(true);
  });
});

describe('FoldersService.create — Root หลัก', () => {
  it('สร้าง 2SC ของหน่วยงานที่ยังไม่มี → สำเร็จ depth 1, InheritPermission=false', async () => {
    const { svc } = make({ rows: [] });
    const r = await svc.create(manager(), {
      name: '2SC - ฝ่าย ก [2SC]',
      orgUnitId: 1,
      confidentialityLevel: 2,
    });
    expect(r.folder).toMatchObject({
      parentFolderId: null,
      folderDepth: 1,
      confidentialityLevel: 2,
      inheritPermission: false,
    });
  });

  it('ไม่ระบุหน่วยงาน → 422 ORG_UNIT_REQUIRED · หน่วยงานใช้ไม่ได้ → 404', async () => {
    const a = make({ rows: [] });
    expect(
      await errorCode(a.svc.create(manager(), { name: '2SC - x', confidentialityLevel: 2 })),
    ).toBe('ORG_UNIT_REQUIRED');
    const b = make({ rows: [] });
    b.repo.orgUsable = false;
    expect(
      await errorStatus(
        b.svc.create(manager(), { name: '2SC - x', orgUnitId: 9, confidentialityLevel: 2 }),
      ),
    ).toBe(404);
  });

  it('Root ต้องระบุชั้นความลับ และชื่อต้องขึ้นต้นด้วยรหัส', async () => {
    const { svc } = make({ rows: [] });
    expect(await errorCode(svc.create(manager(), { name: 'อะไรก็ได้', orgUnitId: 1 }))).toBe(
      'ROOT_FOLDER_NOT_ALLOWED',
    );
    expect(
      await errorCode(
        svc.create(manager(), { name: 'อะไรก็ได้', orgUnitId: 1, confidentialityLevel: 3 }),
      ),
    ).toBe('ROOT_FOLDER_NAME_INVALID');
  });

  it('Root ระดับเดียวกันมีอยู่แล้ว → 409 ROOT_FOLDER_EXISTS', async () => {
    const { svc } = make();
    expect(
      await errorCode(
        svc.create(manager(), { name: '2SC - B', orgUnitId: 1, confidentialityLevel: 2 }),
      ),
    ).toBe('ROOT_FOLDER_EXISTS');
  });

  it('ผู้ใช้ทั่วไปที่ไม่มี Authority.CanAdd สร้าง Root ไม่ได้ → 403', async () => {
    const { svc } = make({ rows: [] });
    expect(
      await errorCode(
        svc.create(officer(), { name: '3NC - x', orgUnitId: 1, confidentialityLevel: 3 }),
      ),
    ).toBe('ROOT_FOLDER_CREATE_DENIED');
  });
});

describe('FoldersService.create — 1HC ต้องผ่านการอนุมัติ (CREATE_HC)', () => {
  it('ยื่นคำขอผ่าน DMS_APPROVAL_PORT ด้วย payload JSON แล้วตอบ created=false โดยยังไม่สร้างโฟลเดอร์', async () => {
    const submit = jest.fn(async () => ({ requestId: 55, requestStatus: 1 }));
    const { svc, repo, crud } = make({ rows: [], approvals: { submit } });
    const u = manager();
    const r = await svc.create(u, {
      name: '1HC - ลับมาก [1HC]',
      orgUnitId: 1,
      confidentialityLevel: 1,
      reason: 'จำเป็น',
    });
    expect(r).toEqual({ created: false, approval: { requestId: 55, requestStatus: 1 } });
    expect(repo.called('insert')).toHaveLength(0);
    expect(submit).toHaveBeenCalledWith(u, {
      requestType: 'CREATE_HC',
      subject: 'ขออนุมัติสร้าง Folder 1HC: 1HC - ลับมาก [1HC]',
      reason: 'จำเป็น',
      payload: {
        parentFolderId: null,
        orgUnitId: 1,
        folderName: '1HC - ลับมาก [1HC]',
        confidentialityLevel: 1,
        inheritPermission: false,
      },
    });
    const ev = (await logEvents(crud)).find((e) => e.operation === 'REQUEST_CREATE_HC');
    expect(ev).toMatchObject({ action: 'CREATE', success: true, recordId: 55 });
  });

  it('1HC มีได้หลายอัน (ไม่ตรวจชื่อ/ระดับซ้ำ) แม้มี 1HC อยู่แล้ว', async () => {
    const submit = jest.fn(async () => ({ requestId: 1, requestStatus: 1 }));
    const rows = [folderRow({ folderId: 9, folderName: '1HC - เดิม', confidentialityLevel: 1 })];
    const { svc } = make({ rows, approvals: { submit } });
    expect(
      (await svc.create(manager(), { name: '1HC - เดิม', orgUnitId: 1, confidentialityLevel: 1 }))
        .created,
    ).toBe(false);
  });

  it('ไม่มีระบบอนุมัติ → 503 APPROVAL_SERVICE_UNAVAILABLE', async () => {
    const { svc, crud } = make({ rows: [] });
    const p = svc.create(manager(), { name: '1HC - x', orgUnitId: 1, confidentialityLevel: 1 });
    expect(await errorCode(p)).toBe('APPROVAL_SERVICE_UNAVAILABLE');
    expect(
      await errorStatus(
        svc.create(manager(), { name: '1HC - x', orgUnitId: 1, confidentialityLevel: 1 }),
      ),
    ).toBe(503);
    expect((await logEvents(crud)).every((e) => e.success === false)).toBe(true);
  });
});

describe('FoldersService.create — โควตาผ่าน DMS_QUOTA_PORT', () => {
  it('เรียก enforceQuota ก่อนสร้าง และ sendAlertIfNeeded หลังสร้าง', async () => {
    const order: string[] = [];
    const quota = {
      enforceQuota: jest.fn(async () => void order.push('enforce')),
      sendAlertIfNeeded: jest.fn(async () => void order.push('alert')),
      validateBatch: jest.fn(),
    };
    const { svc, repo } = make({ quota });
    const origInsert = repo.insert;
    repo.insert = async (f) => {
      order.push('insert');
      return origInsert(f);
    };
    await svc.create(manager(), { name: 'ใหม่', parentFolderId: 2 });
    expect(quota.enforceQuota).toHaveBeenCalledWith(1);
    expect(order).toEqual(['enforce', 'insert', 'alert']);
  });

  it('พื้นที่เต็ม (QUOTA_FULL) → ไม่สร้างโฟลเดอร์ และ error ถูกส่งต่อ', async () => {
    const { BusinessException } = await import('../../../src/common/exceptions/business.exception');
    const quota = {
      enforceQuota: jest.fn(async () => {
        throw new BusinessException('พื้นที่ folder เต็ม', 'QUOTA_FULL');
      }),
      sendAlertIfNeeded: jest.fn(),
      validateBatch: jest.fn(),
    };
    const { svc, repo } = make({ quota });
    expect(await errorCode(svc.create(manager(), { name: 'ใหม่', parentFolderId: 2 }))).toBe(
      'QUOTA_FULL',
    );
    expect(repo.called('insert')).toHaveLength(0);
    expect(quota.sendAlertIfNeeded).not.toHaveBeenCalled();
  });

  it('แจ้งเตือนโควตาล้มเหลวไม่ทำให้การสร้างล้ม', async () => {
    const quota = {
      enforceQuota: jest.fn(async () => undefined),
      sendAlertIfNeeded: jest.fn(async () => {
        throw new Error('smtp down');
      }),
      validateBatch: jest.fn(),
    };
    const { svc } = make({ quota });
    expect((await svc.create(manager(), { name: 'ใหม่', parentFolderId: 2 })).created).toBe(true);
  });
});

describe('FoldersService.rename', () => {
  it('เปลี่ยนชื่อสำเร็จ + log ก่อน/หลัง', async () => {
    const { svc, repo, crud } = make();
    const r = await svc.rename(manager(), 2, ' งบ 2570 ');
    expect(r.folderName).toBe('งบ 2570');
    expect(repo.called('rename')[0].args.slice(0, 2)).toEqual([2, 'งบ 2570']);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'RENAME_FOLDER');
    expect(ev).toMatchObject({ action: 'UPDATE', recordId: 2, success: true });
  });

  it('เปลี่ยนชื่อ Root หลักไม่ได้', async () => {
    const { svc } = make();
    expect(await errorCode(svc.rename(admin(), 1, 'ชื่อใหม่'))).toBe('ROOT_FOLDER_IMMUTABLE');
  });

  it('ชื่อซ้ำกับพี่น้อง → 409 · ชื่อเดิมของตัวเองไม่นับว่าซ้ำ', async () => {
    const rows = sample();
    rows.push(
      folderRow({
        folderId: 6,
        parentFolderId: 1,
        folderName: 'บุคคล',
        confidentialityLevel: 2,
        folderDepth: 2,
      }),
    );
    const { svc } = make({ rows });
    expect(await errorCode(svc.rename(manager(), 6, 'งบประมาณ'))).toBe('FOLDER_NAME_DUPLICATE');
    expect((await svc.rename(manager(), 6, 'บุคคล')).folderName).toBe('บุคคล');
  });

  it('ไม่มีสิทธิ์แก้ไข → 403 · โฟลเดอร์ถูกลบ → 422', async () => {
    const a = make({ rule: () => false });
    expect(await errorCode(a.svc.rename(officer(), 2, 'x'))).toBe('FOLDER_EDIT_DENIED');
    const rows = sample();
    rows[1].isDeleted = true;
    const b = make({ rows });
    expect(await errorCode(b.svc.rename(manager(), 2, 'x'))).toBe('FOLDER_DELETED');
  });
});

describe('FoldersService.remove / requestDelete — ลบโฟลเดอร์', () => {
  it('ไม่มีไฟล์ → soft delete ทั้งต้นไม้ย่อยผ่าน sp_SoftDeleteFolder และ log', async () => {
    const { svc, repo, crud } = make();
    await svc.remove(manager(), 2);
    expect(repo.called('softDeleteTree')[0].args).toEqual([2, manager().userId]);
    expect(repo.rows.filter((r) => r.isDeleted).map((r) => r.folderId)).toEqual([2, 3, 4]);
    const ev = (await logEvents(crud)).find((e) => e.operation === 'DELETE_FOLDER');
    expect(ev).toMatchObject({ action: 'DELETE', recordId: 2, success: true });
  });

  it('มีไฟล์ในต้นไม้ย่อย → 409 FOLDER_HAS_FILES พร้อมจำนวนไฟล์ และไม่ลบ', async () => {
    const { svc, repo } = make();
    repo.filesInSubtree = 3;
    const p = svc.remove(manager(), 2);
    expect(await errorStatus(p)).toBe(409);
    const e = await p.catch((x) => x);
    expect(e.getResponse()).toMatchObject({
      code: 'FOLDER_HAS_FILES',
      details: { folderId: 2, fileCount: 3 },
    });
    expect(repo.called('softDeleteTree')).toHaveLength(0);
  });

  it('Root หลัก: ผู้ใช้ทั่วไปลบไม่ได้ · Manager ลบได้ (ถ้าไม่มีไฟล์)', async () => {
    const a = make();
    expect(await errorCode(a.svc.remove(srOfficer({ authority: fullAuthority() }), 1))).toBe(
      'ROOT_FOLDER_DELETE_DENIED',
    );
    const b = make();
    await b.svc.remove(manager(), 1);
    expect(b.repo.called('softDeleteTree')).toHaveLength(1);
  });

  it('อยู่ในถังขยะแล้ว → 409 · ไม่มีสิทธิ์ Modify → 403', async () => {
    const rows = sample();
    rows[1].isDeleted = true;
    expect(await errorCode(make({ rows }).svc.remove(manager(), 2))).toBe('FOLDER_ALREADY_DELETED');
    expect(await errorCode(make({ rule: () => false }).svc.remove(officer(), 2))).toBe(
      'FOLDER_DELETE_DENIED',
    );
  });

  it('requestDelete: ไม่มีไฟล์ → บอกให้ลบตรง (FOLDER_HAS_NO_FILES)', async () => {
    const { svc } = make({ approvals: { submit: jest.fn() } });
    expect(await errorCode(svc.requestDelete(manager(), 2, {}))).toBe('FOLDER_HAS_NO_FILES');
  });

  it('requestDelete: ยื่น DELETE_FOLDER ไปยัง Admin ทุกคนยกเว้นผู้ขอ', async () => {
    const submit = jest.fn(async () => ({ requestId: 9, requestStatus: 1 }));
    const { svc, repo, crud } = make({ approvals: { submit } });
    repo.filesInSubtree = 4;
    repo.admins = [4, 5, manager().userId];
    const u = manager();
    const r = await svc.requestDelete(u, 2, { reason: 'เลิกใช้' });
    expect(r).toEqual({ requestId: 9, requestStatus: 1 });
    expect(submit).toHaveBeenCalledWith(u, {
      requestType: 'DELETE_FOLDER',
      subject: 'ขออนุมัติลบ Folder: งบประมาณ',
      folderId: 2,
      reason: 'เลิกใช้',
      approverUserIds: [4, 5, u.userId].filter((id) => id !== u.userId),
    });
    expect(
      (await logEvents(crud)).find((e) => e.operation === 'REQUEST_DELETE_FOLDER'),
    ).toMatchObject({
      action: 'EXECUTE',
      success: true,
    });
  });

  it('requestDelete: มี Admin เพียงคนเดียวและเป็นผู้ขอ → อนุมัติเองได้ · ไม่มี Admin → 422', async () => {
    const submit = jest.fn(async (_u: unknown, _i: unknown) => ({
      requestId: 1,
      requestStatus: 1,
    }));
    const a = make({ approvals: { submit } });
    a.repo.filesInSubtree = 1;
    const adm = admin();
    a.repo.admins = [adm.userId];
    await a.svc.requestDelete(adm, 2, {});
    expect(submit.mock.calls[0][1]).toMatchObject({ approverUserIds: [adm.userId] });

    const b = make({ approvals: { submit } });
    b.repo.filesInSubtree = 1;
    b.repo.admins = [];
    expect(await errorCode(b.svc.requestDelete(manager(), 2, {}))).toBe('NO_ACTIVE_ADMIN');
  });

  it('requestDelete: ไม่มีระบบอนุมัติ → 503', async () => {
    const { svc, repo } = make();
    repo.filesInSubtree = 1;
    expect(await errorStatus(svc.requestDelete(manager(), 2, {}))).toBe(503);
  });
});

describe('FoldersService — ย้าย / คัดลอกโครงสร้าง / เปลี่ยนชั้นความลับ', () => {
  it('ย้าย: Officer ถูกปฏิเสธด้วยบทบาท', async () => {
    const { svc } = make();
    expect(await errorCode(svc.move(officer(), 3, 10))).toBe('ROLE_REQUIRED');
  });

  it('ย้ายสำเร็จ: ส่งส่วนต่างความลึก + หน่วยงาน/ชั้นความลับของปลายทาง + ลูกหลานทั้งหมดให้ repository', async () => {
    const rows = sample();
    rows.push(
      folderRow({
        folderId: 20,
        folderName: '3NC - A',
        confidentialityLevel: 3,
        folderDepth: 1,
        orgUnitId: 2,
      }),
      folderRow({
        folderId: 21,
        folderName: 'ปลายทาง',
        parentFolderId: 20,
        confidentialityLevel: 3,
        folderDepth: 2,
        orgUnitId: 2,
      }),
    );
    const { svc, repo, tx } = make({ rows });
    await svc.move(srOfficer(), 3, 21);
    const args = repo.called('reparent')[0].args[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      sourceId: 3,
      newParentId: 21,
      depthDelta: 0, // เดิม depth 3 → ใหม่ 21.depth(2)+1 = 3
      orgUnitId: 2,
      confidentialityLevel: 3,
      descendantIds: [4],
      updatedBy: srOfficer().userId,
    });
    expect(tx.calls.runs).toBe(1);
  });

  it('ย้ายเข้าลูกหลานของตัวเอง/เข้าตัวเอง/ชื่อซ้ำ/ลึกเกิน ถูกปฏิเสธ', async () => {
    const { svc, repo } = make();
    expect(await errorCode(svc.move(manager(), 2, 4))).toBe('FOLDER_MOVE_INTO_DESCENDANT');
    expect(await errorCode(svc.move(manager(), 2, 2))).toBe('FOLDER_MOVE_SELF');
    expect(await errorCode(svc.move(manager(), 1, 10))).toBe('ROOT_FOLDER_IMMUTABLE');
    expect(repo.called('reparent')).toHaveLength(0);

    const rows = sample();
    rows.push(
      folderRow({ folderId: 30, parentFolderId: 10, folderName: 'รายงาน', folderDepth: 2 }),
    );
    const dup = make({ rows });
    expect(await errorCode(dup.svc.move(manager(), 3, 10))).toBe('FOLDER_NAME_DUPLICATE');

    const deep = sample();
    deep.push(
      folderRow({
        folderId: 40,
        parentFolderId: 10,
        folderName: 'ลึก',
        folderDepth: 9,
        confidentialityLevel: 4,
      }),
    );
    const d = make({ rows: deep });
    // ย้าย 2 (สูง 3 ชั้น: 2→3→4) ไปใต้ 40 (depth 9) → สูงสุด 9+1+2 = 12 > 10
    expect(await errorCode(d.svc.move(manager(), 2, 40))).toBe('FOLDER_DEPTH_EXCEEDED');
  });

  it('ย้ายไปแม่เดิม = ไม่ทำอะไร (ไม่เรียก repository)', async () => {
    const { svc, repo } = make();
    await svc.move(manager(), 3, 2);
    expect(repo.called('reparent')).toHaveLength(0);
  });

  it('ต้องมีสิทธิ์ทั้งต้นทางและปลายทาง (Admin ข้าม)', async () => {
    const rule = (_u: number, folderId: number) => folderId !== 10; // ไม่มีสิทธิ์บนปลายทาง
    const a = make({ rule });
    expect(await errorCode(a.svc.move(manager(), 3, 10))).toBe('FOLDER_MOVE_DENIED');
    const b = make({ rule });
    await b.svc.move(admin(), 3, 10);
    expect(b.repo.called('reparent')).toHaveLength(1);
  });

  it('คัดลอกโครงสร้าง: Manager+ เท่านั้น · สร้างทั้งต้นไม้ในทรานแซกชันเดียวด้วยความลึกที่เลื่อนตามปลายทาง', async () => {
    const { svc, repo, tx } = make();
    expect(await errorCode(svc.copyStructure(srOfficer(), 2, 10))).toBe('ROLE_REQUIRED');
    const r = await svc.copyStructure(manager(), 2, 10);
    expect(r.createdCount).toBe(3);
    const inserts = repo.called('insert').map((c) => c.args[0] as Record<string, unknown>);
    expect(inserts.map((i) => [i.folderName, i.folderDepth, i.confidentialityLevel])).toEqual([
      ['งบประมาณ', 2, 4],
      ['รายงาน', 3, 4],
      ['ปี 2569', 4, 4],
    ]);
    expect(tx.calls.runs).toBe(1);
  });

  it('คัดลอกโครงสร้างไว้ใต้ตัวเอง → ปฏิเสธ · ลึกเกิน → ปฏิเสธก่อนสร้าง', async () => {
    const a = make();
    expect(await errorCode(a.svc.copyStructure(manager(), 2, 3))).toBe('FOLDER_COPY_INTO_SELF');
    const deep = sample();
    deep.push(folderRow({ folderId: 40, parentFolderId: 10, folderName: 'ลึก', folderDepth: 9 }));
    const b = make({ rows: deep });
    expect(await errorCode(b.svc.copyStructure(manager(), 2, 40))).toBe('FOLDER_DEPTH_EXCEEDED');
    expect(b.repo.called('insert')).toHaveLength(0);
  });

  it('เปลี่ยนชั้นความลับ: Root ถูกล็อก · ต้องเป็นลูกโดยตรงของ Root · ต้องมี Root ปลายทาง', async () => {
    const { svc } = make();
    expect(await errorCode(svc.changeConfidentiality(srOfficer(), 2, 4))).toBe('ROLE_REQUIRED');
    expect(await errorCode(svc.changeConfidentiality(manager(), 1, 4))).toBe('CONF_ROOT_LOCKED');
    expect(await errorCode(svc.changeConfidentiality(manager(), 3, 4))).toBe(
      'CONF_CHANGE_NOT_DIRECT_CHILD',
    );
    expect(await errorCode(svc.changeConfidentiality(manager(), 2, 3))).toBe('CONF_ROOT_NOT_FOUND');
    expect(await errorCode(svc.changeConfidentiality(manager(), 2, 9 as never))).toBe(
      'CONFIDENTIALITY_INVALID',
    );
  });

  it('เปลี่ยนชั้นความลับสำเร็จ: ย้ายไปใต้ Root ของชั้นใหม่ และทั้งต้นไม้ย่อยเปลี่ยนชั้นตาม', async () => {
    const { svc, repo, crud } = make();
    const r = await svc.changeConfidentiality(manager(), 2, 4);
    expect(r).toMatchObject({ folderId: 2, parentFolderId: 10, confidentialityLevel: 4 });
    expect(repo.called('changeConfidentiality')[0].args[0]).toMatchObject({
      folderId: 2,
      newRootId: 10,
      newLevel: 4,
      descendantIds: [3, 4],
    });
    expect((await logEvents(crud)).find((e) => e.operation === 'CHANGE_CONF_LEVEL')).toMatchObject({
      action: 'UPDATE',
      success: true,
    });
  });
});

describe('FoldersService — อ่าน/กรองตามการมองเห็นและสิทธิ์ดู', () => {
  const rows = (): FolderRow[] => [
    ...sample(),
    folderRow({ folderId: 90, folderName: 'หน่วยอื่น', orgUnitId: 2, confidentialityLevel: 4 }),
    folderRow({
      folderId: 91,
      folderName: 'เก็บถาวร',
      parentFolderId: 10,
      orgUnitId: 1,
      isArchived: true,
      folderDepth: 2,
    }),
  ];

  it('กรองตามหน่วยงานที่มองเห็น + ตัดโฟลเดอร์ที่ถูกลบ/เก็บถาวร', async () => {
    const r = rows();
    r[2].isDeleted = true;
    const { svc } = make({ rows: r, visible: [1] });
    const list = await svc.listAccessible(manager(), {});
    expect(list.map((f) => f.folderId).sort((a, b) => a - b)).toEqual([1, 2, 4, 10]);
  });

  it('หน่วยงานที่ขอไม่อยู่ในการมองเห็น → ว่าง', async () => {
    const { svc } = make({ rows: rows(), visible: [1] });
    expect(await svc.listAccessible(manager(), { orgUnitId: 2 })).toEqual([]);
  });

  it('กรองตามสิทธิ์ดู: ไม่มี Authority/ACL → เห็นเฉพาะชั้น PC (4) ตามกฎเดิม', async () => {
    const { svc } = make({ rows: rows(), visible: [1], rule: () => false });
    const list = await svc.listAccessible(officer(), {});
    expect(list.map((f) => f.folderId)).toEqual([10]); // 4PC เท่านั้น (91 ถูกเก็บถาวร)
  });

  it('rootsOnly คืนเฉพาะ Root · parentFolderId คืนเฉพาะลูก', async () => {
    const { svc } = make({ rows: rows(), visible: [1] });
    expect(
      (await svc.listAccessible(manager(), { rootsOnly: true }))
        .map((f) => f.folderId)
        .sort((a, b) => a - b),
    ).toEqual([1, 10]);
    expect(
      (await svc.listAccessible(manager(), { parentFolderId: 1 })).map((f) => f.folderId),
    ).toEqual([2]);
  });

  it('get: คืนเส้นทางจาก Root · ไม่มีสิทธิ์ดู → 403', async () => {
    const a = make();
    const d = await a.svc.get(manager(), 3);
    expect(d.path.map((p) => p.folderName)).toEqual(['2SC - A [2SC]', 'งบประมาณ', 'รายงาน']);
    const b = make({ rule: () => false });
    expect(await errorCode(b.svc.get(officer(), 3))).toBe('FOLDER_VIEW_DENIED');
  });

  it('stats: นับสดจาก repository', async () => {
    const { svc, repo } = make();
    repo.filesInSubtree = 7;
    expect(await svc.stats(manager(), 2)).toMatchObject({
      folderId: 2,
      subfolderCount: 2,
      subtreeFileCount: 7,
    });
  });
});

describe('FoldersService — handler หลังอนุมัติ', () => {
  const record = (over: Record<string, unknown> = {}) => ({
    requestId: 5,
    requestType: 'CREATE_HC' as const,
    folderId: null,
    fileId: null,
    requestedBy: 42,
    subject: 'x',
    payload: {
      parentFolderId: null,
      orgUnitId: 1,
      folderName: '1HC - ลับมาก [1HC]',
      confidentialityLevel: 1,
      inheritPermission: false,
    },
    ...over,
  });

  it('createAfterApproval: สร้างในนามผู้ขอ + ให้ผู้ขออ่านได้ทันที (grantedBy = ผู้อนุมัติ) ใน transaction ของตัวเอง', async () => {
    const { svc, repo, acl, tx, crud } = make({ rows: [] });
    const approver = admin();
    const f = await svc.createAfterApproval(record(), approver);
    expect(f).toMatchObject({
      folderName: '1HC - ลับมาก [1HC]',
      confidentialityLevel: 1,
      folderDepth: 1,
      createdBy: 42,
    });
    expect(acl.insertFolderPermission).toHaveBeenCalledWith(
      f.folderId,
      expect.objectContaining({
        principalType: 1,
        principalId: 42,
        canRead: true,
        canWrite: false,
        grantedBy: approver.userId,
      }),
      tx.scope,
    );
    expect(tx.calls.runs).toBe(1);
    expect(repo.called('insert')).toHaveLength(1);
    expect((await logEvents(crud)).find((e) => e.operation === 'CREATE_HC_APPROVED')).toMatchObject(
      {
        action: 'CREATE',
        success: true,
      },
    );
  });

  it('createAfterApproval: ใช้ transaction ที่ส่งมา (ไม่เปิดใหม่)', async () => {
    const { svc, tx } = make({ rows: [] });
    const outer = { manager: {}, sp: {}, queryRunner: {} };
    await svc.createAfterApproval(record(), admin(), outer as never);
    expect(tx.calls.runs).toBe(0);
  });

  it('createAfterApproval: ชื่อซ้ำที่เกิดระหว่างรออนุมัติ → โยน error (ย้อนทั้งคำขอ) · payload เสีย → APPROVAL_PAYLOAD_INVALID', async () => {
    const rows = [
      folderRow({ folderId: 9, folderName: '1HC - ลับมาก [1HC]', confidentialityLevel: 1 }),
    ];
    const a = make({ rows });
    expect(await errorCode(a.svc.createAfterApproval(record(), admin()))).toBe(
      'FOLDER_NAME_DUPLICATE',
    );
    expect(a.repo.called('insert')).toHaveLength(0);
    const b = make({ rows: [] });
    expect(await errorCode(b.svc.createAfterApproval(record({ payload: null }), admin()))).toBe(
      'APPROVAL_PAYLOAD_INVALID',
    );
  });

  it('createAfterApproval: อ่าน payload รูปแบบ Remark เดิมได้', async () => {
    const { svc } = make({ rows: [] });
    const f = await svc.createAfterApproval(
      record({
        payload: {
          remark:
            'ParentFolderId=|OrgUnitId=1|FolderName=1HC - เก่า|FolderDepth=1|ConfidentialityLevel=1|InheritPermission=False',
        },
      }),
      admin(),
    );
    expect(f.folderName).toBe('1HC - เก่า');
  });

  it('deleteAfterApproval: soft delete ในนามผู้อนุมัติ · ถูกลบอยู่แล้ว = ไม่ทำซ้ำ', async () => {
    const { svc, repo, crud } = make();
    const approver = admin();
    await svc.deleteAfterApproval(record({ requestType: 'DELETE_FOLDER', folderId: 2 }), approver);
    expect(repo.called('softDeleteTree')[0].args).toEqual([2, approver.userId]);
    await svc.deleteAfterApproval(record({ requestType: 'DELETE_FOLDER', folderId: 2 }), approver);
    expect(repo.called('softDeleteTree')).toHaveLength(1);
    expect(
      (await logEvents(crud)).filter((e) => e.operation === 'DELETE_FOLDER_APPROVED'),
    ).toHaveLength(2);
  });

  it('deleteAfterApproval: คำขอไม่ระบุโฟลเดอร์ → error', async () => {
    const { svc } = make();
    expect(await errorCode(svc.deleteAfterApproval(record({ folderId: null }), admin()))).toBe(
      'APPROVAL_PAYLOAD_INVALID',
    );
  });
});
