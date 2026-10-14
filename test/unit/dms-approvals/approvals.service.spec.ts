import { AppRole } from '../../../src/common/constants/enums';
import { BusinessException } from '../../../src/common/exceptions/business.exception';
import { InMemoryApprovalHandlerRegistry } from '../../../src/modules/dms/approvals/approvals/approval-handler.registry';
import { ApprovalsService } from '../../../src/modules/dms/approvals/approvals/approvals.service';
import { ShareApprovalOutcomes } from '../../../src/modules/dms/approvals/approvals/share-approval-outcomes';
import { encodeRemark } from '../../../src/modules/dms/approvals/common/approval-remark';
import type { ApprovalOutcomeHandler } from '../../../src/modules/dms/ports/dms-approval.port';
import { fakeUser, makeCrudLog } from '../../helpers/stubs';
import {
  allowAllPerm,
  FakeDb,
  fakeApprovalsStore,
  fakeLookup,
  fakeNotifications,
  fakeSharesStore,
  fakeTx,
} from './fakes';

const MGR_A = fakeUser({ userId: 10, appRole: AppRole.Manager, displayName: 'ผู้จัดการ A' });
const MGR_B = fakeUser({ userId: 11, appRole: AppRole.Manager });
const ADMIN = fakeUser({ userId: 20, appRole: AppRole.Admin });
const ADMIN2 = fakeUser({ userId: 21, appRole: AppRole.Admin });
const OFFICER = fakeUser({ userId: 30, appRole: AppRole.Officer });

function make() {
  const db = new FakeDb();
  for (const u of [MGR_A, MGR_B, ADMIN, ADMIN2, OFFICER]) {
    db.user({ userId: u.userId, appRole: u.appRole, displayName: u.displayName });
  }
  db.folder({ folderId: 1, confidentialityLevel: 2 });
  db.file({ fileId: 5, folderId: 1 });
  const { service: crud, sink } = makeCrudLog();
  const registry = new InMemoryApprovalHandlerRegistry();
  const notif = fakeNotifications();
  const lookup = fakeLookup(db);
  const sharesStore = fakeSharesStore(db);
  const svc = new ApprovalsService(
    crud,
    fakeApprovalsStore(db) as never,
    lookup as never,
    fakeTx(db) as never,
    notif as never,
    registry,
    new ShareApprovalOutcomes(sharesStore as never, lookup as never),
    allowAllPerm() as never,
  );
  return { db, svc, registry, notif, sink, crud };
}

const handler = (
  type: ApprovalOutcomeHandler['requestType'],
  over: Partial<ApprovalOutcomeHandler> = {},
) => {
  const calls: { kind: string; requestId: number; payload: unknown; by: number }[] = [];
  const h: ApprovalOutcomeHandler = {
    requestType: type,
    onApproved: async (r, by) =>
      void calls.push({
        kind: 'approved',
        requestId: r.requestId,
        payload: r.payload,
        by: by.userId,
      }),
    onRejected: async (r, by) =>
      void calls.push({
        kind: 'rejected',
        requestId: r.requestId,
        payload: r.payload,
        by: by.userId,
      }),
    ...over,
  };
  return { h, calls };
};

const legacyPerm =
  'FolderID:1 PrincipalType:1 PrincipalID:30 Read:True Write:True Delete:False Modify:False FullControl:False IsDeny:False';

/** คำขอ CHANGE_PERMISSION 2 step: A(1) แล้ว B(2) */
function twoStepRequest(db: FakeDb) {
  const req = db.request({
    requestType: 'CHANGE_PERMISSION',
    requestedBy: OFFICER.userId,
    folderId: 1,
    remark: legacyPerm,
  });
  const s1 = db.step(req.requestId, 1, MGR_A.userId);
  const s2 = db.step(req.requestId, 2, MGR_B.userId);
  return { req, s1, s2 };
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: BusinessException) => (e.getResponse() as { code: string }).code,
  );

describe('ApprovalsService — ลงมติ + ผลข้างเคียงใน transaction เดียว', () => {
  it('step แรกอนุมัติ → ยังไม่จบ แจ้งผู้อนุมัติถัดไป; step สุดท้าย → Approved + เรียก handler + แจ้งผู้ขอ (หลัง commit)', async () => {
    const { db, svc, registry, notif, crud, sink } = make();
    const { h, calls } = handler('CHANGE_PERMISSION');
    registry.register(h);
    const { req, s1, s2 } = twoStepRequest(db);

    const first = await svc.approveStep(s1.stepId, 'ok', MGR_A);
    expect(first).toMatchObject({ finalized: false, requestStatus: 1, nextApproverId: 11 });
    expect(calls).toHaveLength(0);
    expect(notif.sent.map((n) => [n.recipientUserId, n.eventType])).toEqual([
      [11, 'ApprovalRequestPending'],
    ]);

    const last = await svc.approveStep(s2.stepId, 'ok2', MGR_B);
    expect(last).toMatchObject({ finalized: true, requestStatus: 2 });
    expect(db.state.requests[0]).toMatchObject({
      requestStatus: 2,
      resolvedBy: 11,
      resolveRemark: 'ok2',
    });
    expect(calls).toEqual([
      {
        kind: 'approved',
        requestId: req.requestId,
        by: 11,
        // payload ถอดจาก Remark รูปแบบเก่า → ชื่อ key camelCase
        payload: expect.objectContaining({
          folderId: 1,
          principalType: 1,
          principalId: 30,
          canRead: true,
          canWrite: true,
          isDeny: false,
        }),
      },
    ]);
    expect(notif.sent.at(-1)).toMatchObject({
      recipientUserId: OFFICER.userId,
      eventType: 'ApprovalRequestApproved',
    });

    await crud.drain();
    expect(sink.events.map((e) => [e.operation, e.action, e.success, e.entity, e.module])).toEqual([
      ['APPROVE_STEP', 'EXECUTE', true, 'ApprovalRequest', 'DMS'],
      ['APPROVE_STEP', 'EXECUTE', true, 'ApprovalRequest', 'DMS'],
    ]);
  });

  it('ผลข้างเคียงล้ม (Error ทั่วไป) → rollback ทั้งก้อน: คำขอยัง Pending, step ไม่เปลี่ยน, ไม่แจ้งเตือน, บันทึกความล้มเหลว', async () => {
    const { db, svc, registry, notif, crud, sink } = make();
    registry.register(
      handler('CHANGE_PERMISSION', {
        onApproved: async () => {
          throw new Error('ตั้งสิทธิ์ไม่ได้');
        },
      }).h,
    );
    const { req, s1, s2 } = twoStepRequest(db);
    await svc.approveStep(s1.stepId, null as never, MGR_A);
    notif.sent.length = 0;

    await expect(svc.approveStep(s2.stepId, 'อนุมัติ', MGR_B)).rejects.toMatchObject({
      response: { code: 'APPROVAL_SIDE_EFFECT_FAILED' },
    });

    expect(db.state.requests.find((r) => r.requestId === req.requestId)).toMatchObject({
      requestStatus: 1,
      resolvedBy: null,
    });
    expect(db.state.steps.find((s) => s.stepId === s2.stepId)?.stepStatus).toBe(1); // ถูก rollback กลับเป็น Pending
    expect(db.state.steps.find((s) => s.stepId === s1.stepId)?.stepStatus).toBe(2); // รอบก่อนหน้าที่สำเร็จยังคงอยู่
    expect(notif.sent).toEqual([]);
    await crud.drain();
    expect(sink.events.at(-1)).toMatchObject({ operation: 'APPROVE_STEP', success: false });
  });

  it('handler โยน BusinessException ของตัวเอง → ส่งต่อรหัสเดิม (ไม่ห่อซ้ำ) และ rollback', async () => {
    const { db, svc, registry } = make();
    registry.register(
      handler('DELETE_FOLDER', {
        onApproved: async () => {
          throw new BusinessException('โฟลเดอร์มีไฟล์ใหม่', 'FOLDER_HAS_FILES');
        },
      }).h,
    );
    const req = db.request({
      requestType: 'DELETE_FOLDER',
      requestedBy: OFFICER.userId,
      folderId: 1,
      remark: 'ลบ',
    });
    const s = db.step(req.requestId, 1, ADMIN.userId);
    expect(await codeOf(svc.approveStep(s.stepId, 'ok', ADMIN))).toBe('FOLDER_HAS_FILES');
    expect(db.state.requests[0].requestStatus).toBe(1);
    expect(db.state.steps[0].stepStatus).toBe(1);
  });

  it.each(['CREATE_HC', 'DELETE_FOLDER', 'CHANGE_PERMISSION'])(
    'ยังไม่มี handler ของ %s → 503 APPROVAL_HANDLER_MISSING และไม่ตั้ง Approved ลอยๆ',
    async (type) => {
      const { db, svc } = make();
      const req = db.request({
        requestType: type,
        requestedBy: OFFICER.userId,
        folderId: 1,
        remark: type === 'CREATE_HC' ? 'ParentFolderId=0|OrgUnitId=1|FolderName=1HC-x' : legacyPerm,
      });
      const s = db.step(req.requestId, 1, ADMIN.userId);
      await expect(svc.approveStep(s.stepId, 'ok', ADMIN)).rejects.toMatchObject({
        status: 503,
        response: { code: 'APPROVAL_HANDLER_MISSING' },
      });
      expect(db.state.requests[0].requestStatus).toBe(1);
    },
  );

  it('Remark ของ CHANGE_PERMISSION อ่านไม่ได้ → ไม่ยอมอนุมัติเงียบๆ (เดิม log แล้วตั้ง Approved ทั้งที่ไม่มีผล)', async () => {
    const { db, svc, registry } = make();
    registry.register(handler('CHANGE_PERMISSION').h);
    const req = db.request({
      requestType: 'CHANGE_PERMISSION',
      requestedBy: OFFICER.userId,
      folderId: 1,
      remark: 'ข้อความอะไรไม่รู้',
    });
    const s = db.step(req.requestId, 1, MGR_A.userId);
    expect(await codeOf(svc.approveStep(s.stepId, 'ok', MGR_A))).toBe('APPROVAL_PAYLOAD_INVALID');
    expect(db.state.requests[0].requestStatus).toBe(1);
  });

  it('CREATE_HC: Admin คนแรกจบ — ปิด step ที่เหลือเป็น 4 และสร้างผ่าน handler (payload รูปแบบเก่า)', async () => {
    const { db, svc, registry } = make();
    const { h, calls } = handler('CREATE_HC');
    registry.register(h);
    const req = db.request({
      requestType: 'CREATE_HC',
      requestedBy: MGR_A.userId,
      remark:
        'ParentFolderId=0|OrgUnitId=5|FolderName=1HC-ลับ|FolderDepth=1|ConfidentialityLevel=1|InheritPermission=False',
    });
    db.step(req.requestId, 1, ADMIN.userId);
    const s2 = db.step(req.requestId, 2, ADMIN2.userId);

    // ADMIN2 ลงมติผ่านเลขคำขอ (ไม่ใช่ step แรก) → ระบบเลือก step ของตนเอง
    const r = await svc.approveRequest(req.requestId, 'ok', ADMIN2);
    expect(r).toMatchObject({ finalized: true, requestStatus: 2 });
    expect(db.state.steps.find((s) => s.stepId === s2.stepId)?.stepStatus).toBe(2);
    expect(db.state.steps.filter((s) => s.stepStatus === 4)).toHaveLength(1); // step ของ ADMIN ถูกปิดอัตโนมัติ
    expect(calls[0].payload).toMatchObject({
      orgUnitId: 5,
      folderName: '1HC-ลับ',
      parentFolderId: null,
      confidentialityLevel: 1,
    });
  });

  it('สิทธิ์ลงมติ: Officer 403 · Manager ที่ไม่ใช่เจ้าของ step 403 · step ที่ลงมติแล้ว/คำขอที่จบแล้วลงซ้ำไม่ได้', async () => {
    const { db, svc, registry } = make();
    registry.register(handler('CHANGE_PERMISSION').h);
    const { s1, s2 } = twoStepRequest(db);

    await expect(svc.approveStep(s1.stepId, 'x', OFFICER)).rejects.toMatchObject({ status: 403 });
    expect(await codeOf(svc.approveStep(s1.stepId, 'x', MGR_B))).toBe('NOT_STEP_APPROVER');
    await svc.approveStep(s1.stepId, 'ok', MGR_A);
    expect(await codeOf(svc.approveStep(s1.stepId, 'อีกครั้ง', MGR_A))).toBe('STEP_NOT_ACTIONABLE');
    await svc.approveStep(s2.stepId, 'ok', MGR_B);
    expect(await codeOf(svc.approveStep(s2.stepId, 'ซ้ำ', MGR_B))).toBe('APPROVAL_NOT_PENDING');
    await expect(svc.approveStep(99999, 'x', MGR_A)).rejects.toMatchObject({ status: 404 });
  });

  it('แชร์ภายนอก: อนุมัติแล้วแชร์ Pending → Active (+token) ในธุรกรรมเดียวกัน; แชร์ที่ไม่ Pending แล้ว → rollback', async () => {
    const { db, svc } = make();
    const share = db.share({ sharerUserId: OFFICER.userId, status: 'Pending', fileId: 5 });
    const req = db.request({
      requestType: 'EXTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      fileId: 5,
      remark: `ExternalShareID:${share.externalShareId}`, // รูปแบบเก่า
    });
    const s = db.step(req.requestId, 1, MGR_A.userId);
    await svc.approveStep(s.stepId, 'ok', MGR_A);
    expect(db.state.shares[0]).toMatchObject({ status: 'Active', approverUserId: MGR_A.userId });
    expect(db.state.tokens[0].status).toBe('Active');

    // อีกคำขอหนึ่งที่แชร์ถูกยกเลิกไปก่อน
    const revoked = db.share({
      sharerUserId: OFFICER.userId,
      status: 'Revoked',
      shareToken: '99999999-2222-3333-4444-555555555555',
    });
    const req2 = db.request({
      requestType: 'EXTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      remark: encodeRemark({ payload: { externalShareId: revoked.externalShareId } }), // รูปแบบใหม่
    });
    const s2 = db.step(req2.requestId, 1, MGR_A.userId);
    expect(await codeOf(svc.approveStep(s2.stepId, 'ok', MGR_A))).toBe('SHARE_NOT_PENDING');
    expect(db.state.requests.find((r) => r.requestId === req2.requestId)?.requestStatus).toBe(1);
  });

  it('DB รุ่นเก่าที่บันทึกแชร์ภายนอกเป็น CHANGE_PERMISSION ก็ยังเปิดใช้ลิงก์ (ไม่เรียก handler สิทธิ์)', async () => {
    const { db, svc, registry } = make();
    const { h, calls } = handler('CHANGE_PERMISSION');
    registry.register(h);
    const share = db.share({ sharerUserId: OFFICER.userId, status: 'Pending', fileId: 5 });
    const req = db.request({
      requestType: 'CHANGE_PERMISSION',
      requestedBy: OFFICER.userId,
      folderId: 1,
      remark: `ExternalShareID:${share.externalShareId}`,
    });
    const s = db.step(req.requestId, 1, MGR_A.userId);
    await svc.approveStep(s.stepId, 'ok', MGR_A);
    expect(db.state.shares[0].status).toBe('Active');
    expect(calls).toHaveLength(0);
  });

  it('แชร์ภายใน: อนุมัติแล้วสร้าง FilePermission โดย GrantedBy = ผู้ขอ; วันหมดอายุที่ผ่านไปแล้ว → rollback', async () => {
    const { db, svc } = make();
    const req = db.request({
      requestType: 'INTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      fileId: 5,
      remark:
        'InternalShareFile FileID:5 PrincipalType:1 PrincipalID:11 Read:True Write:False Delete:False Expiry:2099-12-31',
    });
    const s = db.step(req.requestId, 1, MGR_A.userId);
    await svc.approveStep(s.stepId, 'ok', MGR_A);
    expect(db.state.filePermissions[0]).toMatchObject({
      fileId: 5,
      principalId: 11,
      canRead: true,
      grantedBy: OFFICER.userId,
    });

    const old = db.request({
      requestType: 'INTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      remark:
        'InternalShareFile FileID:5 PrincipalType:1 PrincipalID:11 Read:True Write:False Delete:False Expiry:2020-01-01',
    });
    const s2 = db.step(old.requestId, 1, MGR_A.userId);
    expect(await codeOf(svc.approveStep(s2.stepId, 'ok', MGR_A))).toBe('SHARE_EXPIRY_IN_PAST');
    expect(db.state.filePermissions).toHaveLength(1);
  });

  it('ปฏิเสธ: step=3, คำขอ=3, เรียก onRejected, แจ้งผู้ขอ; แชร์ภายนอกที่ค้างถูกยกเลิก (เดิมค้าง Pending)', async () => {
    const { db, svc, registry, notif } = make();
    const { h, calls } = handler('CHANGE_PERMISSION');
    registry.register(h);
    const { req, s1 } = twoStepRequest(db);
    const r = await svc.rejectStep(s1.stepId, 'ไม่เหมาะสม', MGR_A);
    expect(r).toMatchObject({ requestStatus: 3, finalized: true });
    expect(db.state.steps[0]).toMatchObject({ stepStatus: 3, actionRemark: 'ไม่เหมาะสม' });
    expect(db.state.requests[0]).toMatchObject({
      requestStatus: 3,
      resolveRemark: 'ไม่เหมาะสม',
      resolvedBy: 10,
    });
    expect(calls[0]).toMatchObject({ kind: 'rejected', requestId: req.requestId });
    expect(notif.sent[0]).toMatchObject({
      recipientUserId: OFFICER.userId,
      eventType: 'ApprovalRequestRejected',
    });

    const share = db.share({ sharerUserId: OFFICER.userId, status: 'Pending', fileId: 5 });
    const r2 = db.request({
      requestType: 'EXTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      remark: `ExternalShareID:${share.externalShareId}`,
    });
    const s2 = db.step(r2.requestId, 1, MGR_A.userId);
    await svc.rejectStep(s2.stepId, 'ไม่อนุญาต', MGR_A);
    expect(db.state.shares[0]).toMatchObject({ status: 'Revoked', revocationReason: 'ไม่อนุญาต' });
    expect(notif.sent.some((n) => n.eventType === 'ExternalShareRejected')).toBe(true);
  });

  it('ผู้ลงมติที่ไม่ใช่เจ้าของ step (fallback DELETE_FOLDER) ถูกบันทึกชื่อไว้ใน ActionRemark', async () => {
    const { db, svc, registry } = make();
    registry.register(handler('DELETE_FOLDER').h);
    const req = db.request({
      requestType: 'DELETE_FOLDER',
      requestedBy: OFFICER.userId,
      folderId: 1,
      remark: 'ลบ',
    });
    db.step(req.requestId, 1, ADMIN.userId);
    await svc.approveRequest(req.requestId, 'เห็นชอบ', MGR_A);
    expect(db.state.steps[0].actionRemark).toBe('[ผู้จัดการ A] เห็นชอบ');
    expect(db.state.requests[0].requestStatus).toBe(2);
  });
});

describe('ApprovalsService — ถอนคำขอ', () => {
  it('เฉพาะผู้ขอ: step ที่ค้าง→3, คำขอ→4 (ความหมายเดิมของ 4) และถอนซ้ำไม่ได้', async () => {
    const { db, svc } = make();
    const { req } = twoStepRequest(db);
    await expect(svc.withdraw(req.requestId, MGR_A)).rejects.toMatchObject({ status: 403 });
    const r = await svc.withdraw(req.requestId, OFFICER);
    expect(r.requestStatus).toBe(4);
    expect(db.state.steps.map((s) => s.stepStatus)).toEqual([3, 3]);
    expect(db.state.requests[0]).toMatchObject({
      requestStatus: 4,
      resolveRemark: 'Withdrawn by requestor.',
    });
    expect(await codeOf(svc.withdraw(req.requestId, OFFICER))).toBe('APPROVAL_NOT_PENDING');
  });

  it('คำขอแชร์ภายนอก: ถอนแล้วแชร์ที่ค้าง Pending ถูกยกเลิกด้วย', async () => {
    const { db, svc } = make();
    const share = db.share({ sharerUserId: OFFICER.userId, status: 'Pending', fileId: 5 });
    const req = db.request({
      requestType: 'EXTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      remark: `ExternalShareID:${share.externalShareId}`,
    });
    db.step(req.requestId, 1, MGR_A.userId);
    await svc.withdraw(req.requestId, OFFICER);
    expect(db.state.shares[0].status).toBe('Revoked');
  });
});

describe('ApprovalsService — ยื่นคำขอ', () => {
  it('port.submit CREATE_HC: ผู้อนุมัติ = Admin ทุกคนตามลำดับ, payload เป็น JSON มี prefix, แจ้งทุกคน', async () => {
    const { db, svc, notif, sink, crud } = make();
    const ref = await svc.submit(MGR_A, {
      requestType: 'CREATE_HC',
      subject: 'ขอสร้าง 1HC',
      reason: 'จำเป็น',
      payload: { orgUnitId: 5, folderName: '1HC-x' },
    });
    expect(ref).toMatchObject({ requestStatus: 1 });
    expect(db.state.steps.map((s) => [s.stepOrder, s.approverId])).toEqual([
      [1, 20],
      [2, 21],
    ]);
    expect(db.state.requests[0].remark?.startsWith('CMS-PAYLOAD/1:')).toBe(true);
    expect(notif.sent.map((n) => n.recipientUserId)).toEqual([20, 21]);
    await crud.drain();
    expect(sink.events[0]).toMatchObject({
      operation: 'SUBMIT_APPROVAL',
      action: 'CREATE',
      recordId: ref.requestId,
    });
  });

  it('ผู้อนุมัติที่ระบุเองต้องเป็น Manager+ ที่ใช้งานอยู่; ชนิดผิด/ไม่มีหัวข้อ/ไม่มีผู้อนุมัติ → ปฏิเสธ', async () => {
    const { db, svc } = make();
    expect(
      await codeOf(
        svc.submit(MGR_A, {
          requestType: 'DOWNLOAD_FILE',
          subject: 'x',
          approverUserIds: [OFFICER.userId],
        }),
      ),
    ).toBe('APPROVER_INVALID');
    expect(await codeOf(svc.submit(MGR_A, { requestType: 'BOGUS' as never, subject: 'x' }))).toBe(
      'APPROVAL_TYPE_INVALID',
    );
    expect(await codeOf(svc.submit(MGR_A, { requestType: 'CREATE_HC', subject: '  ' }))).toBe(
      'APPROVAL_SUBJECT_REQUIRED',
    );
    db.state.users = db.state.users.filter((u) => u.appRole < 3); // ไม่มี Manager/Admin เลย
    expect(await codeOf(svc.submit(OFFICER, { requestType: 'CREATE_HC', subject: 'x' }))).toBe(
      'NO_APPROVER',
    );
    expect(db.state.requests).toHaveLength(0); // ไม่สร้างคำขอค้างแบบไม่มีผู้อนุมัติ
  });

  it('ยื่นคำขอเปลี่ยนสิทธิ์: Manager+ เท่านั้น, โฟลเดอร์ต้อง HC/SC, สิทธิ์ต้องเลือกอย่างน้อยหนึ่ง', async () => {
    const { db, svc } = make();
    const dto = {
      folderId: 1,
      subject: 'ขอสิทธิ์',
      principalType: 1,
      principalId: OFFICER.userId,
      canRead: true,
      canWrite: false,
      canDelete: false,
      canModify: false,
      canFullControl: false,
      isDeny: false,
      approverUserIds: [MGR_B.userId, ADMIN.userId],
    };
    expect(await codeOf(svc.submitPermissionRequest(dto, OFFICER))).toBe('ROLE_REQUIRED');
    db.folder({ folderId: 2, confidentialityLevel: 3 });
    expect(await codeOf(svc.submitPermissionRequest({ ...dto, folderId: 2 }, MGR_A))).toBe(
      'APPROVAL_FOLDER_LEVEL',
    );
    expect(await codeOf(svc.submitPermissionRequest({ ...dto, canRead: false }, MGR_A))).toBe(
      'PERMISSION_FLAGS_EMPTY',
    );

    const created = await svc.submitPermissionRequest(dto, MGR_A);
    expect(created).toMatchObject({
      requestType: 'CHANGE_PERMISSION',
      requestStatus: 1,
      folderId: 1,
    });
    expect(created.payload).toMatchObject({ principalId: OFFICER.userId, canRead: true });
    expect(db.state.steps.map((s) => s.approverId)).toEqual([11, 20]);
    // วันหมดอายุเริ่มต้น = +1 วัน
    const hours = ((db.state.requests[0].expiryDate as Date).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24.1);
  });
});

describe('ApprovalsService — คำขอดาวน์โหลด (ใช้ครั้งเดียว)', () => {
  it('ยื่น → อนุมัติ → พบ → ใช้สิทธิ์ได้ครั้งเดียว', async () => {
    const { db, svc } = make();
    const dto = { fileId: 5, reason: 'ใช้ตรวจสอบ', approverId: MGR_A.userId };
    expect(
      await codeOf(svc.submitDownloadRequest({ ...dto, approverId: OFFICER.userId }, OFFICER)),
    ).toBe('APPROVER_INVALID');
    expect(
      await codeOf(svc.submitDownloadRequest({ ...dto, approverId: MGR_A.userId }, MGR_A)),
    ).toBe('APPROVER_INVALID'); // เลือกตัวเอง
    await expect(svc.submitDownloadRequest({ ...dto, fileId: 404 }, OFFICER)).rejects.toMatchObject(
      { status: 404 },
    );

    const created = await svc.submitDownloadRequest(dto, OFFICER);
    expect(created).toMatchObject({
      requestType: 'DOWNLOAD_FILE',
      fileId: 5,
      reason: 'ใช้ตรวจสอบ',
    });
    expect(await svc.findApprovedDownload(OFFICER, 5)).toBeNull(); // ยังไม่อนุมัติ

    await svc.approveRequest(created.requestId, 'ok', MGR_A);
    const ref = await svc.findApprovedDownload(OFFICER, 5);
    expect(ref).toEqual({ requestId: created.requestId, requestStatus: 2 });
    expect(await svc.findApprovedDownload(MGR_B, 5)).toBeNull(); // ของคนอื่นใช้ไม่ได้

    await expect(svc.consumeDownload(MGR_B, created.requestId)).rejects.toMatchObject({
      status: 404,
    });
    await svc.consumeDownload(OFFICER, created.requestId);
    expect(db.state.requests[0].requestStatus).toBe(5);
    await expect(svc.consumeDownload(OFFICER, created.requestId)).rejects.toMatchObject({
      status: 409,
      response: { code: 'DOWNLOAD_APPROVAL_UNAVAILABLE' },
    });
    expect(await svc.findApprovedDownload(OFFICER, 5)).toBeNull();
  });
});

describe('ApprovalsService — escalation', () => {
  const overdue = new Date(Date.now() - 3_600_000);

  it('ยกระดับครั้งเดียว: step เดิม→4 + EscalatedDate, เพิ่ม step ให้ Admin จริง (ไม่ใช่เลข role), เลื่อนวันหมดอายุ, ไม่ยกซ้ำ', async () => {
    const { db, svc, notif } = make();
    const req = db.request({
      requestType: 'EXTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      expiryDate: overdue,
      remark: 'ExternalShareID:1',
    });
    const s1 = db.step(req.requestId, 1, MGR_A.userId);

    const run1 = await svc.escalateExpired(new Date());
    expect(run1).toMatchObject({ checked: 1, escalated: 1, failed: 0 });
    const steps = db.state.steps;
    expect(steps.find((s) => s.stepId === s1.stepId)).toMatchObject({
      stepStatus: 4,
      actionRemark: 'Escalated due to timeout.',
    });
    expect(steps.find((s) => s.stepId === s1.stepId)?.escalatedDate).toBeInstanceOf(Date);
    const added = steps.filter((s) => s.stepId !== s1.stepId);
    expect(added.map((s) => [s.stepOrder, s.approverId, s.stepStatus])).toEqual([
      [2, 20, 1],
      [3, 21, 1],
    ]);
    expect((db.state.requests[0].expiryDate as Date).getTime()).toBeGreaterThan(Date.now());
    expect(notif.sent.map((n) => [n.recipientUserId, n.eventType])).toEqual(
      expect.arrayContaining([
        [20, 'ApprovalEscalation'],
        [21, 'ApprovalEscalation'],
        [OFFICER.userId, 'ApprovalEscalation'],
      ]),
    );

    // รอบถัดไป: ยังไม่ถึงกำหนดใหม่ → ไม่เพิ่ม step ซ้ำ (เดิมเพิ่มทุก tick จน ApprovalStep โตเป็นแสนแถว)
    const run2 = await svc.escalateExpired(new Date());
    expect(run2.checked).toBe(0);
    expect(db.state.steps).toHaveLength(3);
  });

  it('Admin ที่ได้รับช่วงต่ออนุมัติคนแรก → คำขอจบทันที และ step ของ Admin คนอื่นถูกปิด', async () => {
    const { db, svc, registry } = make();
    registry.register(handler('CHANGE_PERMISSION').h);
    const req = db.request({
      requestType: 'CHANGE_PERMISSION',
      requestedBy: OFFICER.userId,
      folderId: 1,
      expiryDate: overdue,
      remark: legacyPerm,
    });
    db.step(req.requestId, 1, MGR_A.userId);
    await svc.escalateExpired(new Date());
    const adminStep = db.state.steps.find((s) => s.approverId === ADMIN.userId)!;
    const r = await svc.approveStep(adminStep.stepId, 'รับช่วง', ADMIN);
    expect(r).toMatchObject({ finalized: true, requestStatus: 2 });
    expect(db.state.steps.find((s) => s.approverId === ADMIN2.userId)?.stepStatus).toBe(4);
  });

  it('ไม่มีผู้รับช่วง (ไม่มี Admin อื่น) → ไม่แตะ step แต่เลื่อนวันหมดอายุ ไม่วนซ้ำ', async () => {
    const { db, svc } = make();
    db.state.users = db.state.users.filter((u) => u.appRole !== AppRole.Admin);
    const req = db.request({
      requestType: 'EXTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      expiryDate: overdue,
      remark: 'ExternalShareID:1',
    });
    db.step(req.requestId, 1, MGR_A.userId);
    expect(await svc.escalateExpired(new Date())).toMatchObject({ escalated: 0, skipped: 1 });
    expect(db.state.steps[0].stepStatus).toBe(1);
    expect((db.state.requests[0].expiryDate as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('คำขอหนึ่งล้ม ไม่ทำให้คำขออื่นหยุด และ rollback เฉพาะคำขอนั้น', async () => {
    const { db, svc } = make();
    const a = db.request({
      requestType: 'EXTERNAL_SHARE',
      requestedBy: OFFICER.userId,
      expiryDate: overdue,
      remark: 'ExternalShareID:1',
    });
    db.step(a.requestId, 1, MGR_A.userId);
    db.failOn.add('insertStep');
    const r = await svc.escalateExpired(new Date());
    expect(r).toMatchObject({ checked: 1, failed: 1, escalated: 0 });
    expect(db.state.steps).toHaveLength(1);
    expect(db.state.steps[0].stepStatus).toBe(1); // rollback แล้ว
  });
});

describe('ApprovalsService — รายการ/สิทธิ์ดู', () => {
  it('รายการรอฉันอนุมัติมี myStepId; Admin เห็น CREATE_HC ทุกคำขอ', async () => {
    const { db, svc } = make();
    const { req, s1 } = twoStepRequest(db);
    const hc = db.request({ requestType: 'CREATE_HC', requestedBy: MGR_A.userId });
    db.step(hc.requestId, 1, ADMIN2.userId);

    const mine = await svc.listPending(MGR_A, {
      page: 1,
      pageSize: 20,
      sortDir: 'asc',
      skip: 0,
    } as never);
    expect(mine.items.map((i) => [i.requestId, i.myStepId])).toEqual([[req.requestId, s1.stepId]]);
    const admin = await svc.listPending(ADMIN, {
      page: 1,
      pageSize: 20,
      sortDir: 'asc',
      skip: 0,
    } as never);
    expect(admin.items.map((i) => i.requestId)).toEqual([hc.requestId]);
    expect(admin.items[0].myStepId).toBeNull(); // ใช้ POST /:id/approve
  });

  it('ดูคำขอ: ผู้ขอ/Manager+/ผู้มี step ดูได้; Officer อื่นไม่ได้', async () => {
    const { db, svc } = make();
    const { req } = twoStepRequest(db);
    await expect(svc.get(req.requestId, OFFICER)).resolves.toMatchObject({
      requestId: req.requestId,
      totalSteps: 2,
    });
    await expect(svc.get(req.requestId, MGR_B)).resolves.toBeDefined();
    const other = fakeUser({ userId: 31, appRole: AppRole.Officer });
    await expect(svc.get(req.requestId, other)).rejects.toMatchObject({ status: 403 });
    await expect(svc.get(404404, MGR_A)).rejects.toMatchObject({ status: 404 });
  });
});
