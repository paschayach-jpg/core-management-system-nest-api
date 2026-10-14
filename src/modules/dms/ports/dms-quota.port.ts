/**
 * สัญญาการบังคับโควตา — DmsApprovalsModule (quota) เป็นผู้ implement, DmsCoreModule เรียกก่อนสร้างโฟลเดอร์/อัปโหลด
 * ใช้ @Optional() ฝั่งผู้เรียก: ถ้าไม่มี provider (เช่นในเทสต์) ให้ข้ามการตรวจ
 */
export const DMS_QUOTA_PORT = Symbol('DMS_QUOTA_PORT');

export interface DmsQuotaPort {
  /** โยน BusinessException('QUOTA_FULL') เมื่อพื้นที่ของหน่วยงานเต็ม (พฤติกรรมเดิมของ FolderQuotaService.EnforceQuota) */
  enforceQuota(orgUnitId: number): Promise<void>;
  /** ตรวจทั้งชุดไฟล์ก่อนอัปโหลด — ทั้งชุดล้มถ้าเกินโควตา (ValidateBatchAgainstOrgQuota) */
  validateBatch(orgUnitId: number, fileSizesBytes: number[]): Promise<void>;
  /** ส่งแจ้งเตือนเมื่อใช้พื้นที่เกินเกณฑ์ Warning/Critical (ไม่โยน error) */
  sendAlertIfNeeded(orgUnitId: number): Promise<void>;
}
