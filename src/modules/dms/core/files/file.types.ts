import { camelizeKeys } from '../../../../common/utils/camelize';

/** แถว storage.FileDocument ภายในระบบ */
export interface FileRow {
  fileId: number;
  fileGuid?: string;
  folderId: number;
  originalFileName: string;
  storedFileName: string;
  fileExtension: string;
  mimeType: string;
  /** bigint → string */
  fileSizeBytes: string;
  /** ค่าที่บันทึกใน DB (อาจเป็น path แบบ Windows) — ใช้ภายในเท่านั้น ไม่ส่งออก API */
  physicalPath: string;
  checksum: string;
  virusScanStatus: number;
  virusScanDate: Date | null;
  /** 1=Active, 2=Archived, 3=Deleted(soft) */
  fileStatus: number;
  uploadedBy: number;
  uploadedByName?: string | null;
  uploadedDate: Date | null;
  archivedBy: number | null;
  archivedDate: Date | null;
  deletedBy: number | null;
  deletedDate: Date | null;
  version: number;
  /** เติมเมื่อ join กับโฟลเดอร์ */
  folderName?: string | null;
  orgUnitId?: number | null;
}

const nullableInt = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const nullableDate = (v: unknown): Date | null => (v ? (v as Date) : null);

export function mapFileRow(raw: Record<string, unknown>): FileRow {
  const c = camelizeKeys<Record<string, unknown>>(raw);
  return {
    fileId: Number(c.fileId),
    fileGuid: c.fileGuid as string | undefined,
    folderId: Number(c.folderId),
    originalFileName: String(c.originalFileName ?? ''),
    storedFileName: String(c.storedFileName ?? ''),
    fileExtension: String(c.fileExtension ?? ''),
    mimeType: String(c.mimeType ?? 'application/octet-stream'),
    fileSizeBytes: String(c.fileSizeBytes ?? '0'),
    physicalPath: String(c.physicalPath ?? ''),
    checksum: String(c.checksum ?? ''),
    virusScanStatus: Number(c.virusScanStatus ?? 0),
    virusScanDate: nullableDate(c.virusScanDate),
    fileStatus: Number(c.fileStatus ?? 1),
    uploadedBy: Number(c.uploadedBy ?? 0),
    uploadedByName: (c.uploadedByName as string | null | undefined) ?? null,
    uploadedDate: nullableDate(c.uploadedDate),
    archivedBy: nullableInt(c.archivedBy),
    archivedDate: nullableDate(c.archivedDate),
    deletedBy: nullableInt(c.deletedBy),
    deletedDate: nullableDate(c.deletedDate),
    version: Number(c.version ?? 1),
    folderName: (c.folderName as string | null | undefined) ?? null,
    orgUnitId: nullableInt(c.orgUnitId),
  };
}

export const FILE_STATUS_ACTIVE = 1;
export const FILE_STATUS_ARCHIVED = 2;
export const FILE_STATUS_DELETED = 3;

export interface NewFile {
  folderId: number;
  originalFileName: string;
  storedFileName: string;
  fileExtension: string;
  mimeType: string;
  fileSizeBytes: number;
  physicalPath: string;
  checksum: string;
  uploadedBy: number;
  version: number;
}
