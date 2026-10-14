import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import {
  computeNextRunningNumber,
  type RunningNumberRow,
  type RunningType,
} from './running-number.util';

/** ความยาวสูงสุดของเลขที่ที่ออก — `t_project.c_project_no` / `t_project_task.c_task_code` เป็น varchar(20) */
export const RUNNING_MAX_LENGTH = 20;

/**
 * ออกเลขที่รันของ RGP จากตาราง `dbo.RunningNumber` ซึ่งอยู่คนละฐานกับ `RGP.*` (ฐาน BUI_RG = DataSource 'project')
 *
 * วิธีใช้: ผู้เรียกเปิด transaction บนฐาน 'project' แล้วส่ง `manager` เข้ามา
 *   `tx.run(({ manager }) => runningNumbers.next(manager, 'PRJ'), { target: 'project' })`
 * แถวถูกล็อกด้วย `WITH (UPDLOCK, ROWLOCK)` จนจบ transaction ผู้เรียก → ผู้ใช้สองคนที่ออกเลขพร้อมกันได้เลขไม่ซ้ำกัน
 * (ผู้เรียกควรถือ transaction นี้ค้างไว้จนงานที่ใช้เลขนั้น commit เพื่อไม่ให้เกิดช่องว่างเมื่องานล้ม)
 */
@Injectable()
export class RunningNumberService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'RunningNumber';

  constructor(crudLog: CrudLogService) {
    super(crudLog);
  }

  /**
   * ออกเลขถัดไป — ล้มพร้อมข้อความชัดเจนถ้าไม่มีแถว `running_type` นี้ (ระบบเดิมสร้างแถว TK ให้เองเงียบๆ
   * แต่การสร้างแถวตั้งค่าเองโดยเดา product/format เสี่ยงกว่า จึงให้ผู้ดูแลตั้งค่าเอง)
   */
  next(manager: EntityManager, type: RunningType, now: Date = new Date()): Promise<string> {
    return this.logged(
      { action: 'EXECUTE', operation: 'GENERATE_RUNNING_NUMBER', recordId: type },
      async () => {
        // ล็อกแถวเดียว (ระบบเดิม UPDATE ทุกแถวที่ running_type ตรงกัน — ที่นี่อัปเดตตาม id ของแถวที่อ่าน)
        const rows: RunningNumberRow[] = await manager.query(
          `SELECT TOP 1 id, current_number AS currentNumber, prefix, format,
                  digit_number AS digitNumber, Year_UW AS yearUw
           FROM dbo.RunningNumber WITH (UPDLOCK, ROWLOCK)
           WHERE running_type = @0
           ORDER BY id`,
          [type],
        );
        const row = rows?.[0];
        if (!row) {
          throw new BusinessException(
            `ไม่พบการตั้งค่า RunningNumber สำหรับ running_type = '${type}' ในฐานข้อมูลโครงการ (BUI_RG) — ` +
              'กรุณาให้ผู้ดูแลระบบเพิ่มแถวตั้งค่า (prefix, format, digit_number) ก่อน',
            'RUNNING_NUMBER_NOT_CONFIGURED',
          );
        }

        const result = computeNextRunningNumber(row, now, type);
        if (result.formatted.length > RUNNING_MAX_LENGTH) {
          throw new BusinessException(
            `เลขที่ที่ออก '${result.formatted}' ยาวเกิน ${RUNNING_MAX_LENGTH} ตัวอักษร — ตรวจ format/digit_number ของ RunningNumber`,
            'RUNNING_NUMBER_TOO_LONG',
          );
        }

        await manager.query(
          'UPDATE dbo.RunningNumber SET current_number = @0, Year_UW = @1 WHERE id = @2',
          [result.next, result.year, row.id],
        );
        return result.formatted;
      },
      (formatted) => ({ after: { number: formatted } }),
    );
  }
}
