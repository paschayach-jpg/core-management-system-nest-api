import { AppRole } from '../../../src/common/constants/enums';
import {
  BusinessException,
  PermissionDeniedException,
} from '../../../src/common/exceptions/business.exception';
import {
  isGuid,
  verifySharePassword,
} from '../../../src/modules/dms/approvals/common/share-crypto';
import { fakeUser } from '../../helpers/stubs';
import { buildHarness } from './fakes';

const OWNER = fakeUser({ userId: 30, appRole: AppRole.Officer });
const MGR_A = fakeUser({ userId: 10, appRole: AppRole.Manager });
const MGR_B = fakeUser({ userId: 11, appRole: AppRole.Manager });
const ADMIN = fakeUser({ userId: 20, appRole: AppRole.Admin });
const OTHER = fakeUser({ userId: 31, appRole: AppRole.Officer });

function make(opts: Parameters<typeof buildHarness>[0] = {}) {
  const h = buildHarness(opts);
  for (const u of [OWNER, MGR_A, MGR_B, ADMIN, OTHER])
    h.db.user({ userId: u.userId, appRole: u.appRole });
  h.db.folder({ folderId: 1, confidentialityLevel: 3 });
  h.db.folder({ folderId: 2, confidentialityLevel: 1 }); // HC
  h.db.folder({ folderId: 4, confidentialityLevel: 4 }); // PC
  h.db.file({ fileId: 5, folderId: 1, uploadedBy: 99 });
  h.db.file({ fileId: 6, folderId: 2 });
  return h;
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: BusinessException) => (e.getResponse() as { code: string }).code,
  );
const DAY = 86_400_000;

describe('SharesService — แชร์ภายนอก: สร้าง', () => {
  it('ต้องระบุ fileId หรือ folderId อย่างใดอย่างหนึ่ง (ไม่ทั้งคู่ ไม่ว่าง)', async () => {
    const { shares } = make();
    expect(await codeOf(shares.createExternalShare({}, OWNER))).toBe('SHARE_TARGET_INVALID');
    expect(await codeOf(shares.createExternalShare({ fileId: 5, folderId: 1 }, OWNER))).toBe(
      'SHARE_TARGET_INVALID',
    );
  });

  it('ห้ามแชร์ HC: ไฟล์ในโฟลเดอร์ HC และโฟลเดอร์ HC (ระดับไฟล์ใช้ระดับโฟลเดอร์ — OPEN_QUESTIONS C2)', async () => {
    const { shares, db } = make();
    expect(await codeOf(shares.createExternalShare({ fileId: 6 }, OWNER))).toBe(
      'SHARE_HC_FORBIDDEN',
    );
    expect(await codeOf(shares.createExternalShare({ folderId: 2 }, OWNER))).toBe(
      'SHARE_HC_FORBIDDEN',
    );
    expect(db.state.shares).toHaveLength(0);
  });

  it('อายุเกิน 90 วัน / อดีต → ปฏิเสธ · ไม่ระบุ → 90 วัน', async () => {
    const { shares, db } = make();
    expect(
      await codeOf(
        shares.createExternalShare(
          { fileId: 5, expiryDate: new Date(Date.now() + 91 * DAY) },
          OWNER,
        ),
      ),
    ).toBe('SHARE_EXPIRY_TOO_LONG');
    expect(
      await codeOf(
        shares.createExternalShare({ fileId: 5, expiryDate: new Date(Date.now() - DAY) }, OWNER),
      ),
    ).toBe('SHARE_EXPIRY_IN_PAST');
    await shares.createExternalShare({ fileId: 5 }, OWNER);
    const days = ((db.state.shares[0].expiryDate as Date).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);
  });

  it('สำเร็จ: Pending + token GUID + คำขอ EXTERNAL_SHARE (payload JSON) ให้ Manager ทุกคน · รหัสผ่านถูก hash · ไม่ส่ง hash/token ใน notification', async () => {
    const { shares, db, notif, sink, crud } = make();
    const dto = await shares.createExternalShare(
      {
        fileId: 5,
        password: 'secret99',
        downloadLimit: 3,
        sharePurpose: 'ส่งผู้ตรวจ',
        notifyOnAccess: false,
        expiryDate: new Date(Date.now() + 10 * DAY),
      },
      OWNER,
    );
    expect(dto).toMatchObject({
      status: 'Pending',
      effectiveStatus: 'Pending',
      hasPassword: true,
      downloadLimit: 3,
      notifyOnAccess: false,
      sharerUserId: 30,
    });
    expect(isGuid(dto.shareToken)).toBe(true); // เจ้าของเห็น token
    expect(JSON.stringify(dto)).not.toContain('passwordHash');

    const share = db.state.shares[0];
    expect(share.passwordHash).not.toBe('secret99');
    await expect(verifySharePassword('secret99', share.passwordHash)).resolves.toBe(true);

    const req = db.state.requests[0];
    expect(req).toMatchObject({
      requestType: 'EXTERNAL_SHARE',
      requestStatus: 1,
      requestedBy: 30,
      fileId: 5,
    });
    expect(req.remark).toContain(`"externalShareId":${share.externalShareId}`);
    expect(db.state.steps.map((s) => [s.stepOrder, s.approverId])).toEqual([
      [1, 10],
      [2, 11],
    ]); // Manager ทุกคน ไม่รวมผู้ขอ
    expect(notif.sent.filter((n) => n.eventType === 'ExternalShareCreated')).toHaveLength(1);
    expect(notif.sent.map((n) => n.messageText).join('\n')).not.toContain(share.shareToken);

    await crud.drain();
    expect(sink.events[0]).toMatchObject({
      operation: 'CREATE_EXTERNAL_SHARE',
      action: 'CREATE',
      entity: 'ExternalShare',
      module: 'DMS',
      success: true,
    });
    expect(JSON.stringify(sink.events[0])).not.toContain(share.shareToken); // token ไม่หลุดลง CRUD-log
  });

  it('ไม่มี Manager อื่น → ใช้ Admin; ไม่มีทั้งคู่ → NO_APPROVER และไม่สร้างอะไรเลย', async () => {
    const { shares, db } = make();
    db.state.users = db.state.users.filter((u) => u.appRole !== AppRole.Manager);
    await shares.createExternalShare({ fileId: 5 }, OWNER);
    expect(db.state.steps.map((s) => s.approverId)).toEqual([20]);

    db.state = { ...db.state, shares: [], requests: [], steps: [], tokens: [], users: [] };
    expect(await codeOf(shares.createExternalShare({ fileId: 5 }, OWNER))).toBe('NO_APPROVER');
    expect(db.state.shares).toHaveLength(0);
  });

  it('ขั้นตอนใดล้มกลางทาง (สร้างคำขอไม่สำเร็จ) → rollback แชร์ + token ที่เพิ่งสร้าง (เดิมค้าง Pending ไม่มีคำขอ)', async () => {
    const { shares, db } = make();
    db.failOn.add('insertStep');
    await expect(shares.createExternalShare({ fileId: 5 }, OWNER)).rejects.toThrow();
    expect(db.state.shares).toHaveLength(0);
    expect(db.state.requests).toHaveLength(0);
  });

  it('ไม่มีสิทธิ์ Read บนโฟลเดอร์ → ปฏิเสธ (ตรวจที่โฟลเดอร์ของไฟล์ ไม่ใช่ FileID — C4)', async () => {
    const asked: number[] = [];
    const perm = {
      check: async () => false,
      assert: async (_u: unknown, folderId: number) => {
        asked.push(folderId);
        throw new PermissionDeniedException('ไม่มีสิทธิ์', 'FOLDER_PERMISSION_DENIED');
      },
    };
    const { shares } = make({ perm });
    await expect(shares.createExternalShare({ fileId: 5 }, OWNER)).rejects.toMatchObject({
      status: 403,
    });
    expect(asked).toEqual([1]); // FolderID ของไฟล์ 5
  });
});

describe('SharesService — แชร์ภายนอก: จัดการ', () => {
  async function pending(h: ReturnType<typeof make>) {
    const dto = await h.shares.createExternalShare({ fileId: 5 }, OWNER);
    h.notif.sent.length = 0;
    return dto.externalShareId;
  }

  it('อนุมัติ: เฉพาะ Manager+, Pending เท่านั้น, ผู้แชร์อนุมัติเองไม่ได้ (Admin ได้) — คำขอใน Inbox ปิดตามด้วย', async () => {
    const h = make();
    const id = await pending(h);
    expect(await codeOf(h.shares.approveExternalShare(id, OTHER))).toBe('ROLE_REQUIRED');

    const selfMgr = fakeUser({ userId: 10, appRole: AppRole.Manager });
    const own = await h.shares.createExternalShare({ fileId: 5 }, selfMgr); // Manager 10 เป็นผู้แชร์เอง
    expect(await codeOf(h.shares.approveExternalShare(own.externalShareId, selfMgr))).toBe(
      'SELF_APPROVAL_FORBIDDEN',
    );

    const approved = await h.shares.approveExternalShare(id, MGR_A);
    expect(approved).toMatchObject({ status: 'Active', approverUserId: 10 });
    expect(h.db.state.tokens.find((t) => t.externalShareId === id)?.status).toBe('Active');
    const req = h.db.state.requests[0];
    expect(req.requestStatus).toBe(2);
    const stepsOfReq = h.db.state.steps.filter((s) => s.requestId === req.requestId);
    expect(stepsOfReq.find((s) => s.approverId === 10)?.stepStatus).toBe(2);
    expect(stepsOfReq.find((s) => s.approverId === 11)?.stepStatus).toBe(4); // Manager คนอื่นปิดอัตโนมัติ
    expect(h.notif.sent.find((n) => n.eventType === 'ExternalShareApproved')).toMatchObject({
      recipientUserId: 30,
    });

    expect(await codeOf(h.shares.approveExternalShare(id, MGR_A))).toBe('SHARE_NOT_PENDING');
  });

  it('ปฏิเสธ → Revoked + คำขอ Rejected + แจ้งผู้แชร์พร้อมเหตุผล', async () => {
    const h = make();
    const id = await pending(h);
    const r = await h.shares.rejectExternalShare(id, 'ข้อมูลอ่อนไหว', MGR_A);
    expect(r).toMatchObject({ status: 'Revoked', revocationReason: 'ข้อมูลอ่อนไหว' });
    expect(h.db.state.requests[0].requestStatus).toBe(3);
    expect(h.notif.sent[0].messageText).toContain('ข้อมูลอ่อนไหว');
  });

  it('ยกเลิก (Revoke): เจ้าของหรือ Admin; ระหว่าง Pending ปิดคำขอที่ค้าง; ยกเลิกซ้ำไม่ได้', async () => {
    const h = make();
    const id = await pending(h);
    expect(await codeOf(h.shares.revokeExternalShare(id, 'x', OTHER))).toBe('NOT_SHARE_OWNER');
    await h.shares.revokeExternalShare(id, 'เปลี่ยนใจ', OWNER);
    expect(h.db.state.shares[0].status).toBe('Revoked');
    expect(h.db.state.requests[0].requestStatus).toBe(4); // ถอน
    expect(await codeOf(h.shares.revokeExternalShare(id, 'อีก', ADMIN))).toBe(
      'SHARE_NOT_REVOCABLE',
    );
  });

  it('เปิด/ปิดชั่วคราว: Active↔Disabled เฉพาะเจ้าของ/Admin; Pending ใช้ไม่ได้ · ชื่อ operation ใน CRUD-log ตามผล', async () => {
    const h = make();
    const id = await pending(h);
    expect(await codeOf(h.shares.toggleExternalShare(id, OWNER))).toBe('SHARE_NOT_TOGGLEABLE');
    await h.shares.approveExternalShare(id, MGR_A);
    expect(await codeOf(h.shares.toggleExternalShare(id, OTHER))).toBe('NOT_SHARE_OWNER');
    expect((await h.shares.toggleExternalShare(id, OWNER)).status).toBe('Disabled');
    expect((await h.shares.toggleExternalShare(id, ADMIN)).status).toBe('Active');
    await h.crud.drain();
    expect(
      h.sink.events.filter((e) => e.entity === 'ExternalShare').map((e) => e.operation),
    ).toEqual(expect.arrayContaining(['DISABLE_EXTERNAL_SHARE', 'ENABLE_EXTERNAL_SHARE']));
  });

  it('รายการ: token เห็นเฉพาะเจ้าของ (Admin/Manager ไม่เห็น) · รายการทั้งหมดเฉพาะ Admin · access log เฉพาะเจ้าของ/Admin', async () => {
    const h = make();
    const id = await pending(h);
    const mine = await h.shares.listMyExternal(OWNER, {
      page: 1,
      pageSize: 10,
      sortDir: 'asc',
      skip: 0,
    } as never);
    expect(mine.items[0].shareToken).not.toBeNull();
    const all = await h.shares.listAllExternal(ADMIN, {
      page: 1,
      pageSize: 10,
      sortDir: 'asc',
      skip: 0,
    } as never);
    expect(all.items[0].shareToken).toBeNull();
    expect(await codeOf(h.shares.listAllExternal(MGR_A, { page: 1, pageSize: 10 } as never))).toBe(
      'ROLE_REQUIRED',
    );
    expect((await h.shares.getExternal(id, MGR_A)).shareToken).toBeNull(); // ผู้อนุมัติดูรายละเอียดได้ แต่ไม่เห็น token
    await expect(h.shares.getExternal(id, OTHER)).rejects.toMatchObject({ status: 403 });
    await expect(
      h.shares.listAccessLog(id, OTHER, { page: 1, pageSize: 10 } as never),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      h.shares.listAccessLog(id, ADMIN, {
        page: 1,
        pageSize: 10,
        sortDir: 'asc',
        skip: 0,
      } as never),
    ).resolves.toMatchObject({ total: 0 });
  });
});

describe('SharesService — แชร์ภายใน', () => {
  const base = {
    fileId: 5,
    principalType: 1,
    principalId: 31,
    canRead: true,
    canWrite: false,
    canDelete: false,
  };

  it('Officer แชร์ → ต้องอนุมัติ (สร้างคำขอ INTERNAL_SHARE ยังไม่มีสิทธิ์) · Manager แชร์ให้ User → มีผลทันทีและแจ้งผู้รับ', async () => {
    const h = make();
    const a = await h.shares.createInternalShare(base, OWNER);
    expect(a).toMatchObject({ requiresApproval: true, filePermissionId: null });
    expect(h.db.state.requests[0]).toMatchObject({ requestType: 'INTERNAL_SHARE', fileId: 5 });
    expect(h.db.state.filePermissions).toHaveLength(0);

    h.notif.sent.length = 0;
    const b = await h.shares.createInternalShare(base, MGR_A);
    expect(b.requiresApproval).toBe(false);
    expect(h.db.state.filePermissions[0]).toMatchObject({
      fileId: 5,
      principalId: 31,
      grantedBy: 10,
      canRead: true,
    });
    expect(h.notif.sent[0]).toMatchObject({
      recipientUserId: 31,
      eventType: 'InternalShareCreated',
    });
  });

  it('Manager แชร์ให้แผนก (PrincipalType=3) ก็ต้องอนุมัติ', async () => {
    const h = make();
    const r = await h.shares.createInternalShare(
      { ...base, principalType: 3, principalId: 7 },
      MGR_A,
    );
    expect(r.requiresApproval).toBe(true);
  });

  it('ตรวจกฎ: อายุเกิน 1 ปี, ย้อนหลัง, ไม่เลือกสิทธิ์ใดเลย, ผู้รับไม่มีอยู่, ไฟล์ไม่มี', async () => {
    const h = make();
    expect(
      await codeOf(
        h.shares.createInternalShare(
          { ...base, expiryDate: new Date(Date.now() + 400 * DAY) },
          MGR_A,
        ),
      ),
    ).toBe('SHARE_EXPIRY_TOO_LONG');
    expect(
      await codeOf(
        h.shares.createInternalShare(
          { ...base, expiryDate: new Date(Date.now() - 2 * DAY) },
          MGR_A,
        ),
      ),
    ).toBe('SHARE_EXPIRY_IN_PAST');
    expect(await codeOf(h.shares.createInternalShare({ ...base, canRead: false }, MGR_A))).toBe(
      'PERMISSION_FLAGS_EMPTY',
    );
    expect(await codeOf(h.shares.createInternalShare({ ...base, principalId: 999 }, MGR_A))).toBe(
      'PRINCIPAL_NOT_FOUND',
    );
    await expect(
      h.shares.createInternalShare({ ...base, fileId: 404 }, MGR_A),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('ผู้แชร์ต้องเข้าถึงไฟล์ได้: ไม่มีสิทธิ์ → ปฏิเสธ · ผู้อัปโหลด/โฟลเดอร์ PC/สิทธิ์ระดับไฟล์ → ผ่าน', async () => {
    const h = make({ perm: { check: async () => false, assert: async () => undefined } });
    expect(await codeOf(h.shares.createInternalShare(base, MGR_A))).toBe('SHARE_PERMISSION_DENIED');

    h.db.file({ fileId: 7, folderId: 1, uploadedBy: MGR_A.userId });
    await expect(
      h.shares.createInternalShare({ ...base, fileId: 7 }, MGR_A),
    ).resolves.toBeDefined(); // ผู้อัปโหลด

    h.db.file({ fileId: 8, folderId: 4 }); // โฟลเดอร์ PC
    await expect(
      h.shares.createInternalShare({ ...base, fileId: 8 }, MGR_A),
    ).resolves.toBeDefined();

    h.db.state.filePermissions.push({
      filePermissionId: 1,
      fileId: 5,
      principalType: 1,
      principalId: MGR_B.userId,
      canRead: true,
      canWrite: false,
      canDelete: false,
      isDeny: false,
      expiryDate: null,
      grantedBy: 1,
      grantedDate: new Date(),
      revokedBy: null,
      revokedDate: null,
      revokeReason: null,
      fileName: null,
      grantedByName: null,
    });
    await expect(h.shares.createInternalShare(base, MGR_B)).resolves.toBeDefined(); // ได้สิทธิ์ระดับไฟล์มาก่อน
  });

  it('ยกเลิก: ผู้ให้สิทธิ์หรือ Admin เท่านั้น · ซ้ำไม่ได้ · บันทึก CRUD-log', async () => {
    const h = make();
    const r = await h.shares.createInternalShare(base, MGR_A);
    const id = r.filePermissionId as number;
    await expect(h.shares.revokeInternalShare(id, MGR_B)).rejects.toMatchObject({ status: 403 });
    await h.shares.revokeInternalShare(id, MGR_A);
    expect(h.db.state.filePermissions[0].revokedBy).toBe(10);
    await expect(h.shares.revokeInternalShare(id, ADMIN)).rejects.toMatchObject({ status: 409 });
    await h.crud.drain();
    expect(h.sink.events.map((e) => [e.operation, e.success])).toEqual(
      expect.arrayContaining([
        ['REVOKE_INTERNAL_SHARE', true],
        ['REVOKE_INTERNAL_SHARE', false],
      ]),
    );
  });

  it('ขอแชร์โฟลเดอร์: สร้างคำขอ CHANGE_PERMISSION (payload JSON) ให้ Manager ทุกคนที่ไม่ใช่ผู้ขอ', async () => {
    const h = make();
    const r = await h.shares.requestFolderShareApproval(
      {
        folderId: 1,
        principalType: 1,
        principalId: 31,
        canRead: true,
        canWrite: false,
        canDelete: false,
        canModify: false,
        canFullControl: false,
        isDeny: false,
      },
      OWNER,
    );
    expect(h.db.state.requests[0]).toMatchObject({
      requestId: r.approvalRequestId,
      requestType: 'CHANGE_PERMISSION',
      folderId: 1,
    });
    expect(h.db.state.steps.map((s) => s.approverId)).toEqual([10, 11]);
    expect(h.notif.sent.filter((n) => n.eventType === 'FolderShareApprovalRequested')).toHaveLength(
      2,
    );
  });
});
