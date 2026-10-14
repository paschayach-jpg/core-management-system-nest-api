import { Readable } from 'node:stream';
import { PUBLIC_SHARE_DENIED_MESSAGE } from '../../../src/modules/dms/approvals/common/share-rules';
import { hashSharePassword } from '../../../src/modules/dms/approvals/common/share-crypto';
import type { DmsFileUncheckedReadPort } from '../../../src/modules/dms/ports/dms-file.port';
import { buildHarness } from './fakes';

const TOKEN = '11111111-2222-3333-4444-555555555555';

function filePort(opts: { fail?: boolean } = {}) {
  const opened: number[] = [];
  const destroyed: number[] = [];
  const port: DmsFileUncheckedReadPort = {
    openReadUnchecked: async (fileId) => {
      if (opts.fail) throw new Error('ไฟล์กายภาพหาย');
      opened.push(fileId);
      const stream = Readable.from([Buffer.from('hello')]);
      stream.on('close', () => destroyed.push(fileId));
      return { stream, fileName: `file-${fileId}.pdf`, size: 5, mimeType: 'application/pdf' };
    },
  };
  return { port, opened, destroyed };
}

function make(portOpts: Parameters<typeof filePort>[0] = {}, withPort = true) {
  const fp = filePort(portOpts);
  const h = buildHarness({ filePort: withPort ? fp.port : undefined });
  h.db.user({ userId: 30 });
  h.db.folder({ folderId: 1 });
  h.db.folder({ folderId: 2 });
  h.db.file({ fileId: 5, folderId: 1 });
  h.db.file({ fileId: 6, folderId: 2 });
  h.db.file({ fileId: 7, folderId: 1, fileStatus: 3 }); // ถูกลบ
  return { ...h, fp };
}

/** ข้อความ/รหัสที่ผู้ใช้ภายนอกเห็นเมื่อถูกปฏิเสธ */
async function denial(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as { status: number; response: { message: string; code: string } };
    return { status: err.status, message: err.response.message, code: err.response.code };
  }
  return null;
}

describe('PublicShareAccessService — เข้าถึงลิงก์ด้วย token', () => {
  it('สำเร็จ: คืน stream, นับ 1 ครั้ง, บันทึก ShareAccessLog (IP/UA), แจ้งเจ้าของเมื่อ NotifyOnAccess', async () => {
    const { db, publicAccess, notif, fp, crud, sink } = make();
    db.share({ sharerUserId: 30, fileId: 5, shareToken: TOKEN });
    const handle = await publicAccess.download(TOKEN, {});
    expect(handle).toMatchObject({ fileName: 'file-5.pdf', size: 5 });
    expect(fp.opened).toEqual([5]);
    expect(db.state.shares[0].currentDownloadCount).toBe(1);
    expect(db.state.accessLogs).toEqual([
      expect.objectContaining({
        accessType: 'Download',
        isSuccessful: true,
        failureReason: null,
        fileSizeBytes: 5,
        recipientIdentifier: 'Anonymous',
        ipAddress: '10.0.0.5',
        userAgent: 'jest',
        externalShareId: db.state.shares[0].externalShareId,
      }),
    ]);
    expect(notif.sent[0]).toMatchObject({ recipientUserId: 30, eventType: 'ShareAccessed' });
    expect(notif.sent[0].messageText).not.toContain(TOKEN);
    await crud.drain();
    expect(sink.events[0]).toMatchObject({
      operation: 'PUBLIC_SHARE_DOWNLOAD',
      action: 'EXECUTE',
      success: true,
    });
  });

  it('ปฏิเสธทุกกรณีด้วยข้อความ/รหัสเดียวกัน (403) ไม่บอกว่าผิดตรงไหน — แต่เหตุผลจริงอยู่ใน ShareAccessLog', async () => {
    const { db, publicAccess } = make();
    const pwd = await hashSharePassword('right-pass');
    const mk = (token: string, extra: Parameters<typeof db.share>[0]) =>
      db.share({ shareToken: token, fileId: 5, ...extra });
    mk('aaaaaaaa-0000-0000-0000-000000000001', { sharerUserId: 30, status: 'Pending' });
    mk('aaaaaaaa-0000-0000-0000-000000000002', { sharerUserId: 30, status: 'Revoked' });
    mk('aaaaaaaa-0000-0000-0000-000000000003', { sharerUserId: 30, status: 'Disabled' });
    mk('aaaaaaaa-0000-0000-0000-000000000004', {
      sharerUserId: 30,
      status: 'Active',
      expiryDate: new Date(Date.now() - 1000),
    });
    mk('aaaaaaaa-0000-0000-0000-000000000005', {
      sharerUserId: 30,
      status: 'Active',
      passwordHash: pwd,
    });
    mk('aaaaaaaa-0000-0000-0000-000000000006', {
      sharerUserId: 30,
      status: 'Active',
      downloadLimit: 2,
      currentDownloadCount: 2,
    });

    const results = [
      await denial(publicAccess.download('aaaaaaaa-0000-0000-0000-000000000001', {})),
      await denial(publicAccess.download('aaaaaaaa-0000-0000-0000-000000000002', {})),
      await denial(publicAccess.download('aaaaaaaa-0000-0000-0000-000000000003', {})),
      await denial(publicAccess.download('aaaaaaaa-0000-0000-0000-000000000004', {})),
      await denial(
        publicAccess.download('aaaaaaaa-0000-0000-0000-000000000005', { password: 'wrong' }),
      ),
      await denial(publicAccess.download('aaaaaaaa-0000-0000-0000-000000000005', {})),
      await denial(publicAccess.download('aaaaaaaa-0000-0000-0000-000000000006', {})),
      await denial(publicAccess.download('ffffffff-0000-0000-0000-00000000ffff', {})), // token ไม่มีในระบบ
      await denial(publicAccess.download('ไม่ใช่-guid', {})), // รูปแบบผิด
    ];
    for (const r of results)
      expect(r).toEqual({
        status: 403,
        message: PUBLIC_SHARE_DENIED_MESSAGE,
        code: 'SHARE_ACCESS_DENIED',
      });

    expect(db.state.accessLogs.map((l) => l.failureReason)).toEqual([
      'Pending',
      'Revoked',
      'Disabled',
      'Expired',
      'WrongPassword',
      'WrongPassword',
      'LimitReached',
    ]); // token ที่ไม่มี/ผิดรูปแบบไม่มีแถวให้ผูก log (FK ไป ExternalShare)
    expect(db.state.accessLogs.every((l) => l.isSuccessful === false)).toBe(true);
    // ลิงก์ Active ที่เลยกำหนดถูกเปลี่ยนสถานะเป็น Expired จริง
    expect(db.state.shares.find((s) => s.shareToken.endsWith('0004'))?.status).toBe('Expired');
  });

  it('รหัสผ่านถูก → ผ่าน (hash รูปแบบเดียวกับระบบเดิม)', async () => {
    const { db, publicAccess } = make();
    db.share({
      sharerUserId: 30,
      fileId: 5,
      shareToken: TOKEN,
      passwordHash: await hashSharePassword('รหัสลับ'),
    });
    await expect(publicAccess.download(TOKEN, { password: 'รหัสลับ' })).resolves.toBeDefined();
  });

  it('จำกัดจำนวนครั้ง: ครั้งสุดท้ายปิดลิงก์เป็น Disabled + แจ้งเจ้าของ, ครั้งถัดไปถูกปฏิเสธ', async () => {
    const { db, publicAccess, notif } = make();
    db.share({
      sharerUserId: 30,
      fileId: 5,
      shareToken: TOKEN,
      downloadLimit: 2,
      notifyOnAccess: false,
    });
    await publicAccess.download(TOKEN, {});
    expect(db.state.shares[0].status).toBe('Active');
    await publicAccess.download(TOKEN, {});
    expect(db.state.shares[0]).toMatchObject({ status: 'Disabled', currentDownloadCount: 2 });
    expect(notif.sent.map((n) => n.eventType)).toEqual(['ShareDisabled']);
    expect((await denial(publicAccess.download(TOKEN, {})))?.code).toBe('SHARE_ACCESS_DENIED');
    expect(db.state.shares[0].currentDownloadCount).toBe(2); // ไม่นับเกินเพดาน
  });

  it('โหลดพร้อมกันครั้งสุดท้าย: คนที่แพ้การแย่งสิทธิ์ถูกปฏิเสธและ stream ถูกปิด (ไม่รั่ว)', async () => {
    const { db, publicAccess, sharesStore, fp } = make();
    db.share({ sharerUserId: 30, fileId: 5, shareToken: TOKEN, downloadLimit: 1 });
    // อีกคำขอหนึ่งเพิ่งใช้สิทธิ์สุดท้ายไประหว่างที่เรากำลังเปิดไฟล์
    sharesStore.consumeDownloadSlot = async () => null;
    expect((await denial(publicAccess.download(TOKEN, {})))?.code).toBe('SHARE_ACCESS_DENIED');
    await new Promise((r) => setImmediate(r));
    expect(fp.destroyed).toEqual([5]);
    expect(db.state.accessLogs.at(-1)).toMatchObject({
      isSuccessful: false,
      failureReason: 'LimitReached',
    });
  });

  it('ไม่มี DMS_FILE_UNCHECKED_PORT → 503 DMS_UNAVAILABLE และไม่เสียจำนวนครั้ง', async () => {
    const { db, publicAccess } = make({}, false);
    db.share({ sharerUserId: 30, fileId: 5, shareToken: TOKEN, downloadLimit: 1 });
    expect(await denial(publicAccess.download(TOKEN, {}))).toMatchObject({
      status: 503,
      code: 'DMS_UNAVAILABLE',
    });
    expect(db.state.shares[0].currentDownloadCount).toBe(0);
  });

  it('เปิดไฟล์ไม่ได้ → ปฏิเสธทั่วไป และไม่เสียจำนวนครั้ง', async () => {
    const { db, publicAccess } = make({ fail: true });
    db.share({ sharerUserId: 30, fileId: 5, shareToken: TOKEN, downloadLimit: 1 });
    expect((await denial(publicAccess.download(TOKEN, {})))?.code).toBe('SHARE_ACCESS_DENIED');
    expect(db.state.shares[0].currentDownloadCount).toBe(0);
    expect(db.state.accessLogs[0].failureReason).toBe('TargetUnavailable');
  });

  it('ไฟล์ที่ถูกลบแล้วโหลดผ่านลิงก์ไม่ได้', async () => {
    const { db, publicAccess } = make();
    db.share({ sharerUserId: 30, fileId: 7, shareToken: TOKEN });
    expect((await denial(publicAccess.download(TOKEN, {})))?.code).toBe('SHARE_ACCESS_DENIED');
  });

  it('ลิงก์โฟลเดอร์: ต้องระบุ fileId ที่อยู่ในโฟลเดอร์นั้นโดยตรงเท่านั้น', async () => {
    const { db, publicAccess, fp } = make();
    db.share({ sharerUserId: 30, folderId: 1, shareToken: TOKEN, notifyOnAccess: false });
    expect((await denial(publicAccess.download(TOKEN, {})))?.code).toBe('SHARE_ACCESS_DENIED'); // ไม่ระบุไฟล์
    expect((await denial(publicAccess.download(TOKEN, { fileId: 6 })))?.code).toBe(
      'SHARE_ACCESS_DENIED',
    ); // อยู่โฟลเดอร์อื่น
    expect((await denial(publicAccess.download(TOKEN, { fileId: 7 })))?.code).toBe(
      'SHARE_ACCESS_DENIED',
    ); // ถูกลบ
    await expect(publicAccess.download(TOKEN, { fileId: 5 })).resolves.toMatchObject({
      fileName: 'file-5.pdf',
    });
    expect(fp.opened).toEqual([5]);
  });

  it('open: คืนข้อมูลลิงก์โดยไม่นับเป็นการดาวน์โหลด และบันทึก View', async () => {
    const { db, publicAccess } = make();
    db.share({
      sharerUserId: 30,
      fileId: 5,
      shareToken: TOKEN,
      downloadLimit: 3,
      currentDownloadCount: 1,
    });
    const info = await publicAccess.open(TOKEN, {});
    expect(info).toMatchObject({ kind: 'file', name: 'file-5.pdf', remainingDownloads: 2 });
    expect(db.state.shares[0].currentDownloadCount).toBe(1);
    expect(db.state.accessLogs[0]).toMatchObject({ accessType: 'View', isSuccessful: true });

    db.share({ sharerUserId: 30, folderId: 1, shareToken: 'bbbbbbbb-0000-0000-0000-000000000001' });
    const folder = await publicAccess.open('bbbbbbbb-0000-0000-0000-000000000001', {});
    expect(folder).toMatchObject({ kind: 'folder', remainingDownloads: -1 });
    expect(folder.files.map((f) => f.fileId)).toEqual([5]); // ไม่รวมไฟล์ที่ถูกลบ
    expect((await denial(publicAccess.open(TOKEN.replace('1111', '9999'), {})))?.code).toBe(
      'SHARE_ACCESS_DENIED',
    );
  });
});
