import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BusinessException,
  PermissionDeniedException,
} from '../../../../common/exceptions/business.exception';
import { CrudLogService } from '../../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../../core/crud-log/crud-logged.service';
import { RequestContextService } from '../../../../core/cls/request-context.service';
import { NotificationsService } from '../../../shared/notifications/notifications.service';
import {
  DMS_FILE_UNCHECKED_PORT,
  DmsFileReadHandle,
  DmsFileUncheckedReadPort,
} from '../../ports/dms-file.port';
import { EVENT } from '../common/approval-messages';
import { isFileActive, LookupStore } from '../common/lookup.store';
import { isGuid, verifySharePassword } from '../common/share-crypto';
import {
  AccessDenyReason,
  evaluateShareAccess,
  PUBLIC_SHARE_DENIED_MESSAGE,
} from '../common/share-rules';
import type { PublicShareAccessDto, PublicShareInfoDto } from './dto/shares.dto';
import { ExternalShareRow, SharesStore } from './shares.store';

const deny = (): PermissionDeniedException =>
  new PermissionDeniedException(PUBLIC_SHARE_DENIED_MESSAGE, 'SHARE_ACCESS_DENIED');

/**
 * การเข้าถึงลิงก์แชร์ภายนอกด้วย token โดยไม่ต้อง login (ShareAccessService.ValidateAndGrantAccess)
 *
 * หน้าจอเดิมที่เรียกใช้ (AccessShareForm) เป็น dead code แต่ลิงก์ที่ API ออกให้ต้องใช้งานได้จริง
 * (บันทึกเป็นคำถามเปิดใน docs ให้ทีมยืนยัน) — จึงออกแบบแบบปลอดภัยไว้ก่อน:
 *  - ปฏิเสธทุกกรณีด้วยข้อความเดียวกัน (token ผิด/หมดอายุ/รหัสผ่านผิด/ครบจำนวน ฯลฯ ไม่บอกว่าผิดตรงไหน)
 *    เหตุผลจริงบันทึกลง storage.ShareAccessLog เท่านั้น (token ที่ไม่มีในระบบบันทึกไม่ได้ — FK ไป ExternalShare)
 *  - รหัสผ่านรับทาง body (ไม่ใส่ใน URL) และตรวจด้วย PBKDF2 แบบเดียวกับที่ระบบเดิมสร้าง hash
 *  - นับจำนวนดาวน์โหลดแบบ atomic ในคำสั่ง UPDATE เดียว (ไม่เกินเพดานแม้โหลดพร้อมกัน)
 *  - ไฟล์เปิดผ่าน DMS_FILE_UNCHECKED_PORT หลังตรวจ token แล้วเท่านั้น (ไม่มี port → 503 DMS_UNAVAILABLE)
 */
@Injectable()
export class PublicShareAccessService extends CrudLoggedService {
  protected readonly logModule = 'DMS' as const;
  protected readonly logEntity = 'ExternalShare';
  private readonly logger = new Logger(PublicShareAccessService.name);

  constructor(
    crudLog: CrudLogService,
    private readonly store: SharesStore,
    private readonly lookup: LookupStore,
    private readonly notifications: NotificationsService,
    private readonly ctx: RequestContextService,
    @Optional()
    @Inject(DMS_FILE_UNCHECKED_PORT)
    private readonly filePort?: DmsFileUncheckedReadPort,
  ) {
    super(crudLog);
  }

  /** ดูข้อมูลลิงก์ (ชื่อ ขนาด รายการไฟล์ของโฟลเดอร์) — ไม่นับเป็นการดาวน์โหลด */
  open(token: string, dto: PublicShareAccessDto): Promise<PublicShareInfoDto> {
    return this.logged({ action: 'READ', operation: 'PUBLIC_SHARE_OPEN' }, async () => {
      const share = await this.authorize(token, dto.password, 'View');
      const info = await this.describe(share);
      await this.writeLog(share, 'View', true, null, info.sizeBytes);
      return info;
    });
  }

  /** ดาวน์โหลดไฟล์ผ่านลิงก์ — นับจำนวนครั้ง บันทึก log และแจ้งเจ้าของ (ถ้าตั้ง NotifyOnAccess) */
  download(token: string, dto: PublicShareAccessDto): Promise<DmsFileReadHandle> {
    return this.logged(
      { action: 'EXECUTE', operation: 'PUBLIC_SHARE_DOWNLOAD' },
      async () => {
        const share = await this.authorize(token, dto.password, 'Download');
        const fileId = await this.resolveFileId(share, dto.fileId);
        if (fileId === null) {
          await this.writeLog(share, 'Download', false, 'TargetUnavailable', null);
          throw deny();
        }
        if (!this.filePort) {
          throw new BusinessException(
            'บริการไฟล์ยังไม่พร้อมใช้งาน',
            'DMS_UNAVAILABLE',
            undefined,
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        // เปิดไฟล์ก่อนนับสิทธิ์: ถ้าเปิดไม่ได้จะไม่เสียจำนวนครั้ง
        let handle: DmsFileReadHandle;
        try {
          handle = await this.filePort.openReadUnchecked(fileId);
        } catch {
          await this.writeLog(share, 'Download', false, 'TargetUnavailable', null);
          throw deny();
        }
        const slot = await this.store.consumeDownloadSlot(share.externalShareId);
        if (!slot) {
          handle.stream.destroy(); // ถูกแย่งสิทธิ์ครั้งสุดท้ายไปแล้ว
          await this.writeLog(share, 'Download', false, 'LimitReached', null);
          throw deny();
        }
        await this.writeLog(share, 'Download', true, null, handle.size);

        const target = share.fileId ? 'ไฟล์' : 'ไฟล์ในโฟลเดอร์';
        if (share.notifyOnAccess) {
          await this.notifications.send({
            recipientUserId: share.sharerUserId,
            eventType: EVENT.shareAccessed,
            relatedEntityId: share.externalShareId,
            messageText: `${target}ที่คุณแชร์ '${handle.fileName}' ถูกดาวน์โหลดผ่านลิงก์เมื่อ ${new Date().toLocaleString('th-TH')}`,
          });
        }
        if (slot.becameDisabled) {
          await this.notifications.send({
            recipientUserId: share.sharerUserId,
            eventType: EVENT.shareDisabled,
            relatedEntityId: share.externalShareId,
            messageText: `ลิงก์แชร์ของคุณถูกปิดอัตโนมัติ เพราะดาวน์โหลดครบ ${share.downloadLimit} ครั้งแล้ว`,
          });
        }
        return handle;
      },
      (h) => ({ meta: { fileName: h.fileName, size: h.size } }),
    );
  }

  // ── ภายใน ─────────────────────────────────────────────────

  /** ตรวจ token → สถานะ → หมดอายุ → รหัสผ่าน → เพดานดาวน์โหลด; ไม่ผ่าน = บันทึก log (ถ้ามี share) แล้วโยนข้อความทั่วไป */
  private async authorize(
    token: string,
    password: string | undefined,
    accessType: 'View' | 'Download',
  ): Promise<ExternalShareRow> {
    if (!isGuid(token)) throw deny();
    const share = await this.store.getExternalByToken(token.toLowerCase());
    if (!share) throw deny(); // ไม่มี share ให้ผูก log (FK) — CRUD-log ของ logged() บันทึกความล้มเหลวให้แล้ว

    const hasPassword = !!share.passwordHash;
    const passwordOk = hasPassword ? await verifySharePassword(password, share.passwordHash) : true;
    const reason: AccessDenyReason | null = evaluateShareAccess({
      status: share.status,
      expiryDate: share.expiryDate,
      hasPassword,
      passwordOk,
      downloadLimit: share.downloadLimit,
      currentDownloadCount: share.currentDownloadCount,
    });
    if (reason) {
      if (reason === 'Expired' && share.status === 'Active') {
        await this.store.markExpired(share.externalShareId); // เปลี่ยนสถานะตามจริงเมื่อมีคนมาเจอ
      }
      await this.writeLog(share, accessType, false, reason, null);
      throw deny();
    }
    return share;
  }

  /** ไฟล์ที่จะส่ง: ลิงก์ไฟล์ = ไฟล์นั้น · ลิงก์โฟลเดอร์ = ไฟล์ใน "โฟลเดอร์นั้นโดยตรง" ตาม fileId ที่ขอ (ไม่ลงโฟลเดอร์ย่อย) */
  private async resolveFileId(share: ExternalShareRow, requested?: number): Promise<number | null> {
    if (share.fileId) {
      const file = await this.lookup.getFile(share.fileId);
      return file && isFileActive(file) ? file.fileId : null;
    }
    if (!share.folderId || !requested) return null;
    const file = await this.lookup.getFile(requested);
    return file && isFileActive(file) && file.folderId === share.folderId ? file.fileId : null;
  }

  private async describe(share: ExternalShareRow): Promise<PublicShareInfoDto> {
    const remaining =
      share.downloadLimit === null
        ? -1
        : Math.max(0, share.downloadLimit - share.currentDownloadCount);
    if (share.fileId) {
      const file = await this.lookup.getFile(share.fileId);
      if (!file || !isFileActive(file)) {
        await this.writeLog(share, 'View', false, 'TargetUnavailable', null);
        throw deny();
      }
      return {
        kind: 'file',
        name: file.originalFileName,
        sizeBytes: file.fileSizeBytes,
        files: [
          { fileId: file.fileId, fileName: file.originalFileName, sizeBytes: file.fileSizeBytes },
        ],
        expiryDate: share.expiryDate,
        remainingDownloads: remaining,
      };
    }
    const folder = share.folderId ? await this.lookup.getFolder(share.folderId) : null;
    if (!folder || folder.isDeleted) {
      await this.writeLog(share, 'View', false, 'TargetUnavailable', null);
      throw deny();
    }
    const files = await this.lookup.listActiveFilesInFolder(folder.folderId);
    return {
      kind: 'folder',
      name: folder.folderName,
      sizeBytes: null,
      files: files.map((f) => ({
        fileId: f.fileId,
        fileName: f.originalFileName,
        sizeBytes: f.fileSizeBytes,
      })),
      expiryDate: share.expiryDate,
      remainingDownloads: remaining,
    };
  }

  private async writeLog(
    share: ExternalShareRow,
    accessType: 'View' | 'Download',
    ok: boolean,
    failureReason: string | null,
    size: number | null,
  ): Promise<void> {
    try {
      await this.store.insertAccessLog({
        shareToken: share.shareToken,
        externalShareId: share.externalShareId,
        recipientIdentifier: 'Anonymous',
        accessType,
        isSuccessful: ok,
        failureReason,
        fileSizeBytes: size,
        ipAddress: this.ctx.ip ?? null,
        userAgent: this.ctx.userAgent ?? null,
      });
    } catch (err) {
      // log ที่ล้มเหลวต้องไม่เปิดเผยข้อผิดพลาดภายในให้ผู้ใช้ภายนอก — แต่การดาวน์โหลดที่สำเร็จต้องมี log เสมอ จึงปล่อยให้ล้มทั้งคำขอ
      this.logger.error(
        `เขียน ShareAccessLog ของแชร์ ${share.externalShareId} ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (ok && accessType === 'Download') throw err;
    }
  }
}
