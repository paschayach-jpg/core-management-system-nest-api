import { camelizeKeys } from '../../../../common/utils/camelize';

/** แถว storage.Folder ภายในระบบ (ไม่มี PhysicalPath — ไม่ส่งออก API) */
export interface FolderRow {
  folderId: number;
  folderGuid?: string;
  folderName: string;
  parentFolderId: number | null;
  orgUnitId: number;
  templateId: number | null;
  confidentialityLevel: number;
  folderDepth: number;
  /** bigint → string */
  folderSizeBytes: string;
  /** นับสดจาก FileDocument (ไม่ใช้ค่าในคอลัมน์) */
  fileCount: number;
  isArchived: boolean;
  archivedBy: number | null;
  archivedDate: Date | null;
  isDeleted: boolean;
  deletedBy: number | null;
  deletedDate: Date | null;
  recycleBinExpiry: Date | null;
  inheritPermission: boolean;
  createdBy: number;
  createdDate: Date | null;
  updatedBy: number | null;
  updatedDate: Date | null;
  createdByName?: string | null;
}

const nullableInt = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const nullableDate = (v: unknown): Date | null => (v ? (v as Date) : null);

/** แถวดิบจาก SP/SQL (ชื่อคอลัมน์ PascalCase) → FolderRow */
export function mapFolderRow(raw: Record<string, unknown>): FolderRow {
  const c = camelizeKeys<Record<string, unknown>>(raw);
  return {
    folderId: Number(c.folderId),
    folderGuid: c.folderGuid as string | undefined,
    folderName: String(c.folderName ?? ''),
    parentFolderId: nullableInt(c.parentFolderId),
    orgUnitId: Number(c.orgUnitId),
    templateId: nullableInt(c.templateId),
    confidentialityLevel: Number(c.confidentialityLevel),
    folderDepth: Number(c.folderDepth ?? 0),
    folderSizeBytes: String(c.folderSizeBytes ?? '0'),
    fileCount: Number(c.fileCount ?? 0),
    isArchived: Boolean(c.isArchived),
    archivedBy: nullableInt(c.archivedBy),
    archivedDate: nullableDate(c.archivedDate),
    isDeleted: Boolean(c.isDeleted),
    deletedBy: nullableInt(c.deletedBy),
    deletedDate: nullableDate(c.deletedDate),
    recycleBinExpiry: nullableDate(c.recycleBinExpiry),
    inheritPermission: Boolean(c.inheritPermission),
    createdBy: Number(c.createdBy ?? 0),
    createdDate: nullableDate(c.createdDate),
    updatedBy: nullableInt(c.updatedBy),
    updatedDate: nullableDate(c.updatedDate),
    createdByName: (c.createdByName as string | null | undefined) ?? null,
  };
}

/** ข้อมูลโฟลเดอร์ใหม่ที่จะ INSERT */
export interface NewFolder {
  folderName: string;
  parentFolderId: number | null;
  orgUnitId: number;
  templateId?: number | null;
  confidentialityLevel: number;
  folderDepth: number;
  inheritPermission: boolean;
  createdBy: number;
}

/** จุดบนเส้นทางจาก Root ถึงโฟลเดอร์ */
export interface FolderPathItem {
  folderId: number;
  folderName: string;
}
