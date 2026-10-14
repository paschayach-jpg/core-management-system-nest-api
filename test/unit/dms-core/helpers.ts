import { AppRole } from '../../../src/common/constants/enums';
import type { UserContext } from '../../../src/common/interfaces/user-context';
import type { FileRow } from '../../../src/modules/dms/core/files/file.types';
import type { FolderRow } from '../../../src/modules/dms/core/folders/folder.types';
import { FolderAccess } from '../../../src/modules/dms/core/access/folder-access';
import { fakeUser } from '../../helpers/stubs';

/** ผู้ใช้ตามบทบาท (Authority ว่าง = ไม่มีสิทธิ์ตามชั้นความลับ เว้นแต่ระบุ) */
export const userOf = (role: AppRole, over: Partial<UserContext> = {}): UserContext =>
  fakeUser({ userId: 100 + role, appRole: role, orgUnitId: 1, ...over });

export const officer = (over: Partial<UserContext> = {}) => userOf(AppRole.Officer, over);
export const srOfficer = (over: Partial<UserContext> = {}) => userOf(AppRole.SrOfficer, over);
export const manager = (over: Partial<UserContext> = {}) => userOf(AppRole.Manager, over);
export const admin = (over: Partial<UserContext> = {}) => userOf(AppRole.Admin, over);

/** Authority ที่เปิดทุกสิทธิ์ของทุกชั้น (ให้ผู้ใช้ non-privileged ผ่านชั้น Authority) */
export const fullAuthority = (): UserContext['authority'] =>
  Object.fromEntries(
    [1, 2, 3, 4].map((level) => [
      level,
      {
        configId: level,
        configLabel: 'test',
        confidentialityLevel: level,
        levelCode: null,
        canView: true,
        canAdd: true,
        canEdit: true,
        canApprove: true,
        canDownload: true,
      },
    ]),
  );

export const folderRow = (over: Partial<FolderRow> = {}): FolderRow => ({
  folderId: 1,
  folderName: 'F',
  parentFolderId: null,
  orgUnitId: 1,
  templateId: null,
  confidentialityLevel: 4,
  folderDepth: 1,
  folderSizeBytes: '0',
  fileCount: 0,
  isArchived: false,
  archivedBy: null,
  archivedDate: null,
  isDeleted: false,
  deletedBy: null,
  deletedDate: null,
  recycleBinExpiry: null,
  inheritPermission: true,
  createdBy: 1,
  createdDate: new Date('2026-01-01'),
  updatedBy: null,
  updatedDate: null,
  createdByName: null,
  ...over,
});

export const fileRow = (over: Partial<FileRow> = {}): FileRow => ({
  fileId: 1,
  folderId: 10,
  originalFileName: 'a.pdf',
  storedFileName: 'a_1_x.pdf',
  fileExtension: '.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: '5',
  physicalPath: '1/10/a_1_x.pdf',
  checksum: 'abc',
  virusScanStatus: 0,
  virusScanDate: null,
  fileStatus: 1,
  uploadedBy: 1,
  uploadedByName: 'U',
  uploadedDate: new Date('2026-01-01'),
  archivedBy: null,
  archivedDate: null,
  deletedBy: null,
  deletedDate: null,
  version: 1,
  ...over,
});

/** transaction ปลอม: รัน callback ทันที (ผู้ทดสอบตรวจ rollback เองถ้าจำเป็น) */
export function fakeTx() {
  const scope = { manager: {}, sp: {}, queryRunner: {} };
  const calls = { runs: 0 };
  return {
    scope,
    calls,
    run: async <T>(work: (s: typeof scope) => Promise<T>): Promise<T> => {
      calls.runs++;
      return work(scope);
    },
  };
}

/** ตัวประเมินสิทธิ์ปลอมที่กำหนดผลได้ — ค่าเริ่มต้น: ผ่านทุกสิทธิ์ */
export function fakeEvaluator(
  rule: (userId: number, folderId: number, perm: string) => boolean = () => true,
) {
  return {
    check: async (u: UserContext, folderId: number, perm: string) => rule(u.userId, folderId, perm),
    checkMany: async (u: UserContext, ids: number[], perm: string) =>
      new Map(ids.map((id) => [id, rule(u.userId, id, perm)])),
    // เหมือน PermissionEvaluator.canAdd: Manager+ ใช้ ACL Write · อื่นๆ ใช้ Authority.CanAdd หรือ ACL Write
    canAdd: async (u: UserContext, folderId: number, level: number) =>
      u.appRole >= AppRole.Manager
        ? rule(u.userId, folderId, 'Write')
        : (u.authority?.[level]?.canAdd ?? false) || rule(u.userId, folderId, 'Write'),
  };
}

export const fakeAccess = (rule?: Parameters<typeof fakeEvaluator>[0]) =>
  new FolderAccess(fakeEvaluator(rule) as never);

/** FolderRepository ในหน่วยความจำ (เฉพาะเมธอดที่ service ใช้) */
export class FakeFolderRepo {
  rows: FolderRow[];
  nextId = 1000;
  calls: { name: string; args: unknown[] }[] = [];
  filesInSubtree = 0;
  admins: number[] = [];
  orgUsable = true;
  expiredRoots: number[] = [];

  constructor(rows: FolderRow[] = []) {
    this.rows = rows;
  }
  private rec(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }
  called(name: string) {
    return this.calls.filter((c) => c.name === name);
  }

  getById = async (id: number) => this.rows.find((r) => r.folderId === id) ?? null;
  getByIds = async (ids: number[]) => this.rows.filter((r) => ids.includes(r.folderId));
  getChildren = async (parentId: number) =>
    this.rows.filter((r) => r.parentFolderId === parentId && !r.isDeleted);
  getRootsByOrgUnit = async (org: number) =>
    this.rows.filter((r) => r.parentFolderId === null && r.orgUnitId === org && !r.isDeleted);
  getByOrgUnit = async (org: number) => this.rows.filter((r) => r.orgUnitId === org && !r.isDeleted);
  getAllActive = async () => this.rows.filter((r) => !r.isDeleted);
  getSiblings = async (parentId: number | null, org: number) =>
    this.rows.filter((r) => r.parentFolderId === parentId && r.orgUnitId === org && !r.isDeleted);
  getSubtree = async (id: number) => {
    const out: FolderRow[] = [];
    const walk = (fid: number) => {
      const f = this.rows.find((r) => r.folderId === fid);
      if (f) out.push(f);
      this.rows.filter((r) => r.parentFolderId === fid).forEach((c) => walk(c.folderId));
    };
    walk(id);
    return out;
  };
  getSubtreeIds = async (id: number) => (await this.getSubtree(id)).map((f) => f.folderId);
  getPath = async (id: number) => {
    const path: { folderId: number; folderName: string }[] = [];
    let cur = this.rows.find((r) => r.folderId === id);
    while (cur) {
      path.unshift({ folderId: cur.folderId, folderName: cur.folderName });
      cur = this.rows.find((r) => r.folderId === cur?.parentFolderId);
    }
    return path;
  };
  getRootAncestor = async (id: number) => {
    let cur = this.rows.find((r) => r.folderId === id);
    while (cur && cur.parentFolderId !== null) {
      cur = this.rows.find((r) => r.folderId === cur?.parentFolderId);
    }
    return cur ?? null;
  };
  countActiveFilesInSubtree = async () => this.filesInSubtree;
  directStats = async () => ({ fileCount: 0, sizeBytes: '0' });
  subtreeStats = async (id: number) => ({
    folderCount: (await this.getSubtree(id)).length,
    fileCount: this.filesInSubtree,
    sizeBytes: '0',
  });
  orgUnitIsUsable = async () => this.orgUsable;
  activeUserIdsByRole = async () => this.admins;
  findExpiredDeletedRoots = async () => this.expiredRoots;
  listDeleted = async (q: unknown) => {
    this.rec('listDeleted', q);
    return { items: this.rows.filter((r) => r.isDeleted), total: this.rows.filter((r) => r.isDeleted).length };
  };

  insert = async (f: Record<string, unknown>) => {
    this.rec('insert', f);
    const id = this.nextId++;
    this.rows.push(
      folderRow({
        folderId: id,
        folderName: f.folderName as string,
        parentFolderId: (f.parentFolderId as number | null) ?? null,
        orgUnitId: f.orgUnitId as number,
        confidentialityLevel: f.confidentialityLevel as number,
        folderDepth: f.folderDepth as number,
        inheritPermission: f.inheritPermission as boolean,
        createdBy: f.createdBy as number,
      }),
    );
    return id;
  };
  rename = async (folder: FolderRow, name: string, by: number) => {
    this.rec('rename', folder.folderId, name, by);
    folder.folderName = name;
  };
  reparent = async (args: Record<string, unknown>) => {
    this.rec('reparent', args);
    const s = this.rows.find((r) => r.folderId === args.sourceId);
    if (s) s.parentFolderId = args.newParentId as number;
  };
  changeConfidentiality = async (args: Record<string, unknown>) => {
    this.rec('changeConfidentiality', args);
    const s = this.rows.find((r) => r.folderId === args.folderId);
    if (s) {
      s.parentFolderId = args.newRootId as number;
      s.confidentialityLevel = args.newLevel as number;
    }
  };
  softDeleteTree = async (id: number, by: number) => {
    this.rec('softDeleteTree', id, by);
    for (const f of await this.getSubtree(id)) {
      f.isDeleted = true;
      f.deletedBy = by;
      f.deletedDate = new Date();
    }
  };
  restoreTree = async (id: number) => {
    this.rec('restoreTree', id);
    for (const f of await this.getSubtree(id)) f.isDeleted = false;
  };
  refreshCounters = async (ids: number[]) => this.rec('refreshCounters', ids);
}

/** ตัวรวม CRUD-log ในหน่วยความจำ: events ล่าสุดหลัง drain */
export async function logEvents(crud: { service: { drain(): Promise<void> }; sink: { events: unknown[] } }) {
  await crud.service.drain();
  return crud.sink.events as {
    module: string;
    entity: string;
    action: string;
    operation?: string;
    recordId?: string | number;
    success: boolean;
    errorCode?: string;
    meta?: Record<string, unknown>;
    after?: unknown;
  }[];
}

/** ดึง code จาก BusinessException ที่ถูกโยน */
export async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { getResponse(): { code: string } }).getResponse().code;
  }
  return undefined;
}

export async function errorStatus(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { getStatus(): number }).getStatus();
  }
  return undefined;
}

/** FileRepository ในหน่วยความจำ (เฉพาะเมธอดที่ service ใช้) */
export class FakeFileRepo {
  rows: FileRow[];
  nextId = 500;
  calls: { name: string; args: unknown[] }[] = [];
  /** ให้ insert ล้มเพื่อทดสอบ compensation */
  failInsert: Error | null = null;

  constructor(rows: FileRow[] = []) {
    this.rows = rows;
  }
  private rec(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }
  called(name: string) {
    return this.calls.filter((c) => c.name === name);
  }
  /** ลำดับการเรียกเมธอดที่เขียนข้อมูล */
  get order() {
    return this.calls.map((c) => c.name);
  }

  getById = async (id: number) => this.rows.find((r) => r.fileId === id) ?? null;
  listByFolder = async (folderId: number) => {
    const items = this.rows.filter((r) => r.folderId === folderId && r.fileStatus !== 3);
    return { items, total: items.length };
  };
  listActiveByFolder = async (folderId: number) =>
    this.rows.filter((r) => r.folderId === folderId && r.fileStatus === 1);
  findActiveByName = async (folderId: number, name: string) =>
    this.rows
      .filter(
        (r) =>
          r.folderId === folderId &&
          r.fileStatus !== 3 &&
          r.originalFileName.toLowerCase() === name.toLowerCase(),
      )
      .sort((a, b) => b.version - a.version)[0] ?? null;
  activeNamesStartingWith = async (folderId: number, prefix: string) =>
    this.rows
      .filter(
        (r) =>
          r.folderId === folderId &&
          r.fileStatus !== 3 &&
          r.originalFileName.toLowerCase().startsWith(prefix.toLowerCase()),
      )
      .map((r) => r.originalFileName);
  namesExist = async (folderId: number, names: string[]) =>
    names.filter((n) => this.rows.some((r) => r.folderId === folderId && r.fileStatus !== 3 && r.originalFileName === n));
  versionsOf = async (folderId: number, name: string) =>
    this.rows.filter((r) => r.folderId === folderId && r.originalFileName === name);

  insert = async (d: Record<string, unknown>) => {
    this.rec('insert', d);
    if (this.failInsert) throw this.failInsert;
    const id = this.nextId++;
    this.rows.push(
      fileRow({
        fileId: id,
        folderId: d.folderId as number,
        originalFileName: d.originalFileName as string,
        storedFileName: d.storedFileName as string,
        fileExtension: d.fileExtension as string,
        mimeType: d.mimeType as string,
        fileSizeBytes: String(d.fileSizeBytes),
        physicalPath: d.physicalPath as string,
        checksum: d.checksum as string,
        uploadedBy: d.uploadedBy as number,
        version: d.version as number,
      }),
    );
    return id;
  };
  softDelete = async (id: number, by: number) => {
    this.rec('softDelete', id, by);
    const r = this.rows.find((x) => x.fileId === id);
    if (r) {
      r.fileStatus = 3;
      r.deletedBy = by;
      r.deletedDate = new Date();
    }
  };
  rename = async (id: number, name: string) => {
    this.rec('rename', id, name);
    const r = this.rows.find((x) => x.fileId === id);
    if (r) r.originalFileName = name;
  };
  relocate = async (id: number, to: Record<string, unknown>) => {
    this.rec('relocate', id, to);
    if (this.failInsert) throw this.failInsert;
    const r = this.rows.find((x) => x.fileId === id);
    if (r) {
      r.folderId = to.folderId as number;
      r.physicalPath = to.physicalPath as string;
      r.storedFileName = to.storedFileName as string;
      r.originalFileName = to.originalFileName as string;
    }
  };
  restore = async (id: number, newName: string | null) => {
    this.rec('restore', id, newName);
    const r = this.rows.find((x) => x.fileId === id);
    if (r) {
      r.fileStatus = 1;
      r.deletedDate = null;
      if (newName) r.originalFileName = newName;
    }
  };
}
