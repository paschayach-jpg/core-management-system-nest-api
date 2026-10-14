import { Injectable } from '@nestjs/common';
import type { UserContext } from '../../../../common/interfaces/user-context';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { Sp } from '../../../../database/sp/sp-catalog.generated';
import { SpExecutor } from '../../../../database/sp/sp-executor.service';
import { FolderAccess } from '../access/folder-access';
import { toFolderDto } from '../folders/dto/folder.dto';
import { FolderRepository } from '../folders/folder.repository';
import { FoldersService } from '../folders/folders.service';
import type { QuickAccessItemDto } from './dto/quick-access.dto';

/**
 * ทางลัดโฟลเดอร์ของผู้ใช้ (storage.QuickAccessFolder) — พอร์ตจาก QuickAccessService
 * ใช้เฉพาะ SP (ตารางนี้ไม่มี DDL ใน export): sp_GetQuickAccessByUser / sp_AddQuickAccess / sp_RemoveQuickAccess
 * ทุก endpoint ทำงานกับของ "ฉัน" เท่านั้น (ไม่รับ userId จาก client)
 */
@Injectable()
export class QuickAccessService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'QuickAccessFolder';

  constructor(
    crudLog: CrudLogService,
    private readonly sp: SpExecutor,
    private readonly folderRepo: FolderRepository,
    private readonly folders: FoldersService,
    private readonly access: FolderAccess,
  ) {
    super(crudLog);
  }

  /** ทางลัดของฉัน (ใหม่สุดก่อน) — ซ่อนโฟลเดอร์ที่ฉันไม่มีสิทธิ์เห็นแล้ว; ที่ถูกลบ/เก็บถาวรยังแสดงพร้อมธง */
  async list(user: UserContext): Promise<QuickAccessItemDto[]> {
    const rows = await this.sp
      .call(Sp.storage.getQuickAccessByUser)
      .rows<Record<string, unknown>>({ UserID: user.userId });
    if (rows.length === 0) return [];
    const folders = await this.folderRepo.getByIds(rows.map((r) => Number(r.FolderID)));
    const byId = new Map(folders.map((f) => [f.folderId, f]));
    const visible = await this.access.viewableIds(user, folders);
    const items: QuickAccessItemDto[] = [];
    for (const r of rows) {
      const f = byId.get(Number(r.FolderID));
      if (!f || !visible.has(f.folderId)) continue;
      items.push({
        quickAccessId: Number(r.QuickAccessID),
        folderId: f.folderId,
        addedDate: r.AddedDate as Date,
        folder: toFolderDto(f),
      });
    }
    return items;
  }

  /** เพิ่มทางลัด (ซ้ำถือว่าสำเร็จ — SP ข้ามให้) · ต้องเห็นโฟลเดอร์ได้ และโฟลเดอร์ต้องไม่ถูกลบ */
  add(user: UserContext, folderId: number): Promise<void> {
    return this.logged(
      { action: 'CREATE', operation: 'ADD_QUICK_ACCESS', recordId: folderId },
      async () => {
        const f = await this.folders.require(folderId);
        if (f.isDeleted) {
          throw new BusinessException(
            'ไม่สามารถเพิ่มทางลัดไปยัง Folder ที่ถูกลบ',
            'FOLDER_DELETED',
          );
        }
        await this.access.assertView(user, f);
        await this.sp
          .call(Sp.storage.addQuickAccess)
          .exec({ UserID: user.userId, FolderID: folderId });
      },
    );
  }

  remove(user: UserContext, folderId: number): Promise<void> {
    return this.logged(
      { action: 'DELETE', operation: 'REMOVE_QUICK_ACCESS', recordId: folderId },
      () =>
        this.sp
          .call(Sp.storage.removeQuickAccess)
          .exec({ UserID: user.userId, FolderID: folderId }),
    );
  }
}
