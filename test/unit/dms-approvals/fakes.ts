import type {
  ApprovalListRow,
  ApprovalRequestRow,
  ApprovalStepRow,
} from '../../../src/modules/dms/approvals/approvals/approvals.store';
import type {
  FileLite,
  FolderLite,
  UserLite,
} from '../../../src/modules/dms/approvals/common/lookup.store';
import type {
  AccessLogRow,
  ExternalShareListRow,
  ExternalShareRow,
  InternalShareRow,
  NewAccessLog,
} from '../../../src/modules/dms/approvals/shares/shares.store';
import { AppRole } from '../../../src/common/constants/enums';
import { InMemoryApprovalHandlerRegistry } from '../../../src/modules/dms/approvals/approvals/approval-handler.registry';
import { ApprovalsService } from '../../../src/modules/dms/approvals/approvals/approvals.service';
import { ShareApprovalOutcomes } from '../../../src/modules/dms/approvals/approvals/share-approval-outcomes';
import { PublicShareAccessService } from '../../../src/modules/dms/approvals/shares/public-share-access.service';
import { SharesService } from '../../../src/modules/dms/approvals/shares/shares.service';
import type { DmsFileUncheckedReadPort } from '../../../src/modules/dms/ports/dms-file.port';
import { fakeRequestContext, makeCrudLog } from '../../helpers/stubs';

/**
 * ฐานข้อมูลจำลองในหน่วยความจำ + store ปลอมที่หน้าตาเหมือนของจริง — ใช้ทดสอบ logic ของ service โดยไม่ต้องมี SQL Server
 * (SQL จริงพิสูจน์ด้วยเทสต์นี้ไม่ได้ → ดูรายการ "ต้องทดสอบกับ SQL Server จริง" ใน docs)
 * `FakeTx.run` จำลอง commit/rollback: ถ้า work โยน error จะคืนสถานะ DB กลับเป็นก่อนเริ่ม
 */
export interface DbState {
  requests: ApprovalRequestRow[];
  steps: ApprovalStepRow[];
  users: UserLite[];
  folders: FolderLite[];
  files: FileLite[];
  shares: ExternalShareRow[];
  tokens: { token: string; externalShareId: number; status: string }[];
  filePermissions: InternalShareRow[];
  accessLogs: NewAccessLog[];
  nextId: number;
}

export const emptyState = (): DbState => ({
  requests: [],
  steps: [],
  users: [],
  folders: [],
  files: [],
  shares: [],
  tokens: [],
  filePermissions: [],
  accessLogs: [],
  nextId: 1000,
});

export class FakeDb {
  state: DbState = emptyState();
  /** ทำให้ store โยน error เมื่อเรียกเมธอดชื่อนี้ (จำลองผลข้างเคียงล้ม) */
  failOn = new Set<string>();

  id(): number {
    return this.state.nextId++;
  }
  snapshot(): DbState {
    return structuredClone(this.state);
  }
  restore(s: DbState): void {
    this.state = s;
  }
  maybeFail(name: string): void {
    if (this.failOn.has(name)) throw new Error(`จำลองความล้มเหลวที่ ${name}`);
  }

  user(overrides: Partial<UserLite> & { userId: number }): UserLite {
    const u: UserLite = {
      adUserName: `DOM\\u${overrides.userId}`,
      displayName: `User ${overrides.userId}`,
      appRole: AppRole.Officer,
      isActive: true,
      departmentId: null,
      divisionId: null,
      ...overrides,
    };
    this.state.users.push(u);
    return u;
  }

  folder(overrides: Partial<FolderLite> & { folderId: number }): FolderLite {
    const f: FolderLite = {
      folderName: `Folder ${overrides.folderId}`,
      parentFolderId: null,
      orgUnitId: 1,
      confidentialityLevel: 3,
      isDeleted: false,
      isArchived: false,
      ...overrides,
    };
    this.state.folders.push(f);
    return f;
  }

  file(overrides: Partial<FileLite> & { fileId: number; folderId: number }): FileLite {
    const f: FileLite = {
      originalFileName: `file-${overrides.fileId}.pdf`,
      fileSizeBytes: 1234,
      fileStatus: 1,
      uploadedBy: 0,
      deletedDate: null,
      ...overrides,
    };
    this.state.files.push(f);
    return f;
  }

  request(
    overrides: Partial<ApprovalRequestRow> & { requestType: string; requestedBy: number },
  ): ApprovalRequestRow {
    const r: ApprovalRequestRow = {
      requestId: this.id(),
      folderId: null,
      fileId: null,
      permissionId: null,
      requestedDate: new Date('2026-10-01T09:00:00'),
      requestStatus: 1,
      subject: 'คำขอทดสอบ',
      remark: null,
      expiryDate: new Date('2099-01-01T00:00:00'),
      resolvedBy: null,
      resolvedDate: null,
      resolveRemark: null,
      ...overrides,
    };
    this.state.requests.push(r);
    return r;
  }

  step(
    requestId: number,
    stepOrder: number,
    approverId: number,
    overrides: Partial<ApprovalStepRow> = {},
  ): ApprovalStepRow {
    const s: ApprovalStepRow = {
      stepId: this.id(),
      requestId,
      stepOrder,
      approverId,
      stepStatus: 1,
      actionDate: null,
      actionRemark: null,
      delegatedTo: null,
      notifiedDate: null,
      escalatedDate: null,
      ...overrides,
    };
    this.state.steps.push(s);
    return s;
  }

  share(overrides: Partial<ExternalShareRow> & { sharerUserId: number }): ExternalShareRow {
    const s: ExternalShareRow = {
      externalShareId: this.id(),
      shareToken: '11111111-2222-3333-4444-555555555555',
      fileId: null,
      folderId: null,
      approverUserId: null,
      passwordHash: null,
      expiryDate: new Date('2099-01-01T00:00:00'),
      downloadLimit: null,
      currentDownloadCount: 0,
      status: 'Active',
      createdDate: new Date('2026-10-01T09:00:00'),
      approvedDate: null,
      disabledDate: null,
      disabledReason: null,
      revokedBy: null,
      revokedDate: null,
      revocationReason: null,
      sharePurpose: null,
      notifyOnAccess: true,
      ...overrides,
    };
    this.state.shares.push(s);
    this.state.tokens.push({
      token: s.shareToken,
      externalShareId: s.externalShareId,
      status: s.status,
    });
    return s;
  }
}

/** scope จำลองที่มีรูปเดียวกับ TransactionScope จริง (queryRunner + manager + sp) */
export interface FakeScope {
  queryRunner: { isTransactionActive: boolean };
  manager: object;
  sp: { queryRunner: { isTransactionActive: boolean } };
}

/**
 * แทน TransactionRunner: ล้มเหลวกลางทาง → rollback
 * เก็บ scope ที่เปิดไว้ใน `scopes` (ตัวล่าสุด = ตัวที่กำลังใช้) และบอกได้ว่า transaction ยังเปิดอยู่ไหม (`isOpen`)
 * เพื่อให้เทสต์พิสูจน์ได้ว่า handler ของ Core ถูกเรียกพร้อม scope ของ transaction ที่เปิดอยู่จริง
 */
export function fakeTx(db: FakeDb) {
  const scopes: FakeScope[] = [];
  return {
    scopes,
    isOpen: () => scopes.at(-1)?.queryRunner.isTransactionActive === true,
    run: async <T>(work: (scope: FakeScope) => Promise<T>): Promise<T> => {
      const snap = db.snapshot();
      const queryRunner = { isTransactionActive: true };
      const scope: FakeScope = { queryRunner, manager: {}, sp: { queryRunner } };
      scopes.push(scope);
      try {
        const result = await work(scope);
        queryRunner.isTransactionActive = false; // commit
        return result;
      } catch (err) {
        db.restore(snap);
        queryRunner.isTransactionActive = false; // rollback
        throw err;
      }
    },
  };
}

const byOrder = (a: ApprovalStepRow, b: ApprovalStepRow) => a.stepOrder - b.stepOrder;

export function fakeLookup(db: FakeDb) {
  return {
    getUser: async (id: number) => db.state.users.find((u) => u.userId === id) ?? null,
    getActiveUsersByRole: async (role: number) =>
      db.state.users.filter((u) => u.appRole === role && u.isActive),
    getUsersByIds: async (ids: number[]) => db.state.users.filter((u) => ids.includes(u.userId)),
    getFolder: async (id: number) => db.state.folders.find((f) => f.folderId === id) ?? null,
    getFile: async (id: number) => db.state.files.find((f) => f.fileId === id) ?? null,
    listActiveFilesInFolder: async (folderId: number) =>
      db.state.files.filter(
        (f) => f.folderId === folderId && f.fileStatus !== 3 && f.deletedDate === null,
      ),
    principalExists: async (type: number, id: number) =>
      type === 1
        ? db.state.users.some((u) => u.userId === id && u.isActive)
        : type === 2
          ? id >= 1 && id <= 4
          : true,
    getOrgUnit: async () => null,
  };
}

export function fakeApprovalsStore(db: FakeDb) {
  const listRow = (r: ApprovalRequestRow, userId: number): ApprovalListRow => ({
    ...r,
    requesterName: db.state.users.find((u) => u.userId === r.requestedBy)?.displayName ?? null,
    folderName: db.state.folders.find((f) => f.folderId === r.folderId)?.folderName ?? null,
    fileName: db.state.files.find((f) => f.fileId === r.fileId)?.originalFileName ?? null,
    myStepId:
      db.state.steps
        .filter(
          (s) =>
            s.requestId === r.requestId &&
            [1, 4].includes(s.stepStatus) &&
            (s.approverId === userId || s.delegatedTo === userId),
        )
        .sort(byOrder)[0]?.stepId ?? null,
  });
  const page = <T>(items: T[], p: { skip: number; take: number }) => ({
    items: items.slice(p.skip, p.skip + p.take),
    total: items.length,
  });
  return {
    getRequest: async (id: number) => db.state.requests.find((r) => r.requestId === id) ?? null,
    getStep: async (id: number) => db.state.steps.find((s) => s.stepId === id) ?? null,
    getSteps: async (requestId: number) =>
      db.state.steps.filter((s) => s.requestId === requestId).sort(byOrder),
    isAssignedApprover: async (requestId: number, userId: number) =>
      db.state.steps.some(
        (s) => s.requestId === requestId && (s.approverId === userId || s.delegatedTo === userId),
      ),
    pageSteps: async (
      requestId: number,
      p: { skip: number; take: number },
      dir: 'ASC' | 'DESC',
    ) => {
      const all = db.state.steps.filter((s) => s.requestId === requestId).sort(byOrder);
      return page(dir === 'DESC' ? all.reverse() : all, p);
    },
    pagePendingFor: async (userId: number, role: number, p: { skip: number; take: number }) => {
      const mine = db.state.requests.filter(
        (r) =>
          r.requestStatus === 1 &&
          (db.state.steps.some(
            (s) =>
              s.requestId === r.requestId &&
              [1, 4].includes(s.stepStatus) &&
              (s.approverId === userId || s.delegatedTo === userId),
          ) ||
            (role >= 4 && r.requestType === 'CREATE_HC')),
      );
      return page(
        mine.map((r) => listRow(r, userId)),
        p,
      );
    },
    pageRequestedBy: async (
      userId: number,
      status: number | null,
      p: { skip: number; take: number },
    ) =>
      page(
        db.state.requests
          .filter(
            (r) => r.requestedBy === userId && (status === null || r.requestStatus === status),
          )
          .map((r) => listRow(r, userId)),
        p,
      ),
    pageByFolder: async (folderId: number, p: { skip: number; take: number }) =>
      page(
        db.state.requests.filter((r) => r.folderId === folderId).map((r) => listRow(r, 0)),
        p,
      ),
    getListRow: async (id: number, userId: number) => {
      const r = db.state.requests.find((x) => x.requestId === id);
      return r ? listRow(r, userId) : null;
    },
    findApprovedDownload: async (userId: number, fileId: number) =>
      db.state.requests
        .filter(
          (r) =>
            r.requestType === 'DOWNLOAD_FILE' &&
            r.fileId === fileId &&
            r.requestedBy === userId &&
            r.requestStatus === 2,
        )
        .sort((a, b) => b.requestedDate.getTime() - a.requestedDate.getTime())[0] ?? null,
    getExpiredPending: async (limit: number) =>
      db.state.requests
        .filter((r) => r.requestStatus === 1 && r.expiryDate && r.expiryDate.getTime() < Date.now())
        .slice(0, limit),
    insertRequest: async (
      _t: unknown,
      r: Partial<ApprovalRequestRow> & { requestType: string; requestedBy: number },
    ) => {
      db.maybeFail('insertRequest');
      return db.request({ ...r, requestedDate: new Date() }).requestId;
    },
    insertStep: async (_t: unknown, requestId: number, stepOrder: number, approverId: number) => {
      db.maybeFail('insertStep');
      if (db.state.steps.some((s) => s.requestId === requestId && s.stepOrder === stepOrder)) {
        throw new Error('UQ_wf_ApprovalStep_Order'); // unique (RequestID, StepOrder)
      }
      return db.step(requestId, stepOrder, approverId).stepId;
    },
    updateStepStatus: async (
      _t: unknown,
      stepId: number,
      status: number,
      remark: string | null,
    ) => {
      db.maybeFail('updateStepStatus');
      const s = db.state.steps.find((x) => x.stepId === stepId);
      if (s) Object.assign(s, { stepStatus: status, actionRemark: remark, actionDate: new Date() });
    },
    markStepEscalated: async (_t: unknown, stepId: number) => {
      const s = db.state.steps.find((x) => x.stepId === stepId);
      if (s) s.escalatedDate = new Date();
    },
    updateRequestStatus: async (
      _t: unknown,
      id: number,
      status: number,
      by: number,
      remark: string | null,
    ) => {
      db.maybeFail('updateRequestStatus');
      const r = db.state.requests.find((x) => x.requestId === id);
      if (r)
        Object.assign(r, {
          requestStatus: status,
          resolvedBy: by,
          resolveRemark: remark,
          resolvedDate: new Date(),
        });
    },
    extendExpiry: async (_t: unknown, id: number, d: Date) => {
      const r = db.state.requests.find((x) => x.requestId === id);
      if (r) r.expiryDate = d;
    },
    consumeDownload: async (_t: unknown, id: number, userId: number) => {
      const r = db.state.requests.find(
        (x) =>
          x.requestId === id &&
          x.requestedBy === userId &&
          x.requestType === 'DOWNLOAD_FILE' &&
          x.requestStatus === 2,
      );
      if (!r) return false;
      r.requestStatus = 5;
      return true;
    },
    findPendingRequestForExternalShare: async (_t: unknown, shareId: number) =>
      db.state.requests.find(
        (r) =>
          r.requestStatus === 1 &&
          ['EXTERNAL_SHARE', 'CHANGE_PERMISSION'].includes(r.requestType) &&
          ((r.remark ?? '') === `ExternalShareID:${shareId}` ||
            new RegExp(`"externalShareId":${shareId}[,}]`).test(r.remark ?? '')),
      ) ?? null,
  };
}

export function fakeSharesStore(db: FakeDb) {
  const toList = (s: ExternalShareRow): ExternalShareListRow => ({
    ...s,
    sharerName: db.state.users.find((u) => u.userId === s.sharerUserId)?.displayName ?? null,
    fileName: db.state.files.find((f) => f.fileId === s.fileId)?.originalFileName ?? null,
    folderName: db.state.folders.find((f) => f.folderId === s.folderId)?.folderName ?? null,
  });
  const setTokens = (id: number, status: string) =>
    db.state.tokens.filter((t) => t.externalShareId === id).forEach((t) => (t.status = status));
  return {
    getExternal: async (id: number) =>
      db.state.shares.find((s) => s.externalShareId === id) ?? null,
    getExternalByToken: async (token: string) =>
      db.state.shares.find((s) => s.shareToken === token) ?? null,
    getExternalListRow: async (id: number) => {
      const s = db.state.shares.find((x) => x.externalShareId === id);
      return s ? toList(s) : null;
    },
    pageExternal: async (
      f: { sharerUserId?: number; status?: string },
      p: { skip: number; take: number },
    ) => {
      const all = db.state.shares.filter(
        (s) =>
          (f.sharerUserId === undefined || s.sharerUserId === f.sharerUserId) &&
          (!f.status || s.status === f.status),
      );
      return { items: all.slice(p.skip, p.skip + p.take).map(toList), total: all.length };
    },
    insertExternal: async (
      _t: unknown,
      s: {
        token: string;
        fileId: number | null;
        folderId: number | null;
        sharerUserId: number;
        passwordHash: string | null;
        expiryDate: Date | null;
        downloadLimit: number | null;
        sharePurpose: string | null;
        notifyOnAccess: boolean;
      },
    ) => {
      db.maybeFail('insertExternal');
      return db.share({
        shareToken: s.token,
        fileId: s.fileId,
        folderId: s.folderId,
        sharerUserId: s.sharerUserId,
        passwordHash: s.passwordHash,
        expiryDate: s.expiryDate,
        downloadLimit: s.downloadLimit,
        sharePurpose: s.sharePurpose,
        notifyOnAccess: s.notifyOnAccess,
        status: 'Pending',
      }).externalShareId;
    },
    insertToken: async () => undefined,
    activate: async (_t: unknown, id: number, approverId: number) => {
      const s = db.state.shares.find((x) => x.externalShareId === id && x.status === 'Pending');
      if (!s) return false;
      Object.assign(s, { status: 'Active', approvedDate: new Date(), approverUserId: approverId });
      setTokens(id, 'Active');
      return true;
    },
    revoke: async (
      _t: unknown,
      id: number,
      userId: number,
      reason: string | null,
      from: string[],
    ) => {
      const s = db.state.shares.find((x) => x.externalShareId === id && from.includes(x.status));
      if (!s) return false;
      Object.assign(s, {
        status: 'Revoked',
        revokedBy: userId,
        revokedDate: new Date(),
        revocationReason: reason,
      });
      setTokens(id, 'Revoked');
      return true;
    },
    toggle: async (_t: unknown, id: number) => {
      const s = db.state.shares.find(
        (x) => x.externalShareId === id && ['Active', 'Disabled'].includes(x.status),
      );
      if (!s) return null;
      s.status = s.status === 'Active' ? 'Disabled' : 'Active';
      setTokens(id, s.status);
      return s.status as 'Active' | 'Disabled';
    },
    markExpired: async (id: number) => {
      const s = db.state.shares.find((x) => x.externalShareId === id);
      if (s && s.status === 'Active') s.status = 'Expired';
    },
    consumeDownloadSlot: async (id: number) => {
      const s = db.state.shares.find((x) => x.externalShareId === id);
      if (!s || s.status !== 'Active') return null;
      if (s.downloadLimit !== null && s.currentDownloadCount >= s.downloadLimit) return null;
      s.currentDownloadCount++;
      const becameDisabled = s.downloadLimit !== null && s.currentDownloadCount >= s.downloadLimit;
      if (becameDisabled) s.status = 'Disabled';
      return { count: s.currentDownloadCount, becameDisabled };
    },
    insertAccessLog: async (l: NewAccessLog) => {
      db.maybeFail('insertAccessLog');
      db.state.accessLogs.push(l);
    },
    pageAccessLog: async (id: number, p: { skip: number; take: number }) => {
      const all = db.state.accessLogs.filter((l) => l.externalShareId === id);
      const items: AccessLogRow[] = all.slice(p.skip, p.skip + p.take).map((l, i) => ({
        accessLogId: String(i + 1),
        shareToken: l.shareToken,
        externalShareId: l.externalShareId,
        recipientIdentifier: l.recipientIdentifier,
        accessType: l.accessType,
        isSuccessful: l.isSuccessful,
        failureReason: l.failureReason,
        fileSizeBytes: l.fileSizeBytes === null ? null : String(l.fileSizeBytes),
        accessTimestamp: new Date(),
        ipAddress: l.ipAddress,
        userAgent: l.userAgent,
      }));
      return { items, total: all.length };
    },
    insertFilePermission: async (
      _t: unknown,
      p: {
        fileId: number;
        principalType: number;
        principalId: number;
        canRead: boolean;
        canWrite: boolean;
        canDelete: boolean;
        expiryDate: Date | null;
        grantedBy: number;
      },
    ) => {
      db.maybeFail('insertFilePermission');
      const row: InternalShareRow = {
        filePermissionId: db.id(),
        isDeny: false,
        grantedDate: new Date(),
        revokedBy: null,
        revokedDate: null,
        revokeReason: null,
        fileName: null,
        grantedByName: null,
        ...p,
      };
      db.state.filePermissions.push(row);
      return row.filePermissionId;
    },
    getFilePermission: async (id: number) =>
      db.state.filePermissions.find((p) => p.filePermissionId === id) ?? null,
    activeFilePermissions: async (fileId: number) =>
      db.state.filePermissions.filter((p) => p.fileId === fileId && !p.revokedDate),
    revokeFilePermission: async (_t: unknown, id: number, userId: number, reason: string) => {
      const p = db.state.filePermissions.find((x) => x.filePermissionId === id);
      if (p) Object.assign(p, { revokedBy: userId, revokedDate: new Date(), revokeReason: reason });
    },
    pageInternal: async (grantedBy: number | null, p: { skip: number; take: number }) => {
      const all = db.state.filePermissions.filter(
        (x) => !x.revokedDate && (grantedBy === null || x.grantedBy === grantedBy),
      );
      return { items: all.slice(p.skip, p.skip + p.take), total: all.length };
    },
  };
}

/** ผู้รับแจ้งเตือนที่ส่งไปจริง (หลัง commit) */
export function fakeNotifications() {
  const sent: { recipientUserId: number; eventType: string; messageText: string }[] = [];
  return {
    sent,
    send: async (n: { recipientUserId: number; eventType: string; messageText: string }) =>
      void sent.push(n),
    sendMany: async (ns: { recipientUserId: number; eventType: string; messageText: string }[]) =>
      void sent.push(...ns),
  };
}

export const allowAllPerm = () => ({
  check: async () => true,
  assert: async () => undefined,
});

// ── ชุดประกอบ service จริงบน store ปลอม ─────────────────────

export function buildHarness(opts: { perm?: unknown; filePort?: DmsFileUncheckedReadPort } = {}) {
  const db = new FakeDb();
  const { service: crud, sink } = makeCrudLog();
  const registry = new InMemoryApprovalHandlerRegistry();
  const notif = fakeNotifications();
  const lookup = fakeLookup(db);
  const sharesStore = fakeSharesStore(db);
  const tx = fakeTx(db);
  const perm = opts.perm ?? allowAllPerm();
  const outcomes = new ShareApprovalOutcomes(sharesStore as never, lookup as never);
  const approvals = new ApprovalsService(
    crud,
    fakeApprovalsStore(db) as never,
    lookup as never,
    tx as never,
    notif as never,
    registry,
    outcomes,
    perm as never,
  );
  const shares = new SharesService(
    crud,
    sharesStore as never,
    lookup as never,
    approvals,
    outcomes,
    tx as never,
    notif as never,
    perm as never,
  );
  const publicAccess = new PublicShareAccessService(
    crud,
    sharesStore as never,
    lookup as never,
    notif as never,
    fakeRequestContext() as never,
    opts.filePort,
  );
  return { db, crud, sink, registry, notif, approvals, shares, publicAccess, sharesStore, lookup };
}
