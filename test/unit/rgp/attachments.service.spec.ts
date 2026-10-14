import { Readable } from 'node:stream';
import { AppRole } from '../../../src/common/constants/enums';
import { PermissionDeniedException } from '../../../src/common/exceptions/business.exception';
import { ProjectAttachment } from '../../../src/modules/rgp/entities/project-attachment.entity';
import { Project } from '../../../src/modules/rgp/entities/project.entity';
import { fakeUser } from '../../helpers/stubs';
import { makeHarness, seedProject, type Harness } from './helpers/harness';
import { MemoryManager } from './helpers/memory-db';

const officer = fakeUser({ adUserName: 'somchai', appRole: AppRole.Officer });

function makeDms() {
  let nextFileId = 100;
  return {
    upload: jest.fn(async (_u: unknown, folderId: number, files: { originalName: string }[]) =>
      files.map((f) => ({
        fileId: nextFileId++,
        folderId,
        originalFileName: f.originalName,
        storedFileName: f.originalName,
        fileSizeBytes: '10',
        version: 1,
      })),
    ),
    listFolder: jest.fn(),
    remove: jest.fn(async (_user: unknown, _fileId: number) => undefined),
    openRead: jest.fn(async (_u: unknown, fileId: number) => ({
      stream: Readable.from(['x']),
      fileName: `file-${fileId}.pdf`,
      size: 1,
      mimeType: 'application/pdf',
    })),
  };
}

/** จำลองผลของ SQL อ่านไฟล์แนบ (join FileDocument/Folder) จากแถวใน storage.t_project_attachment */
function emulateList(h: Harness) {
  h.main.onQuery = (sql, params, db) => {
    if (!sql.includes('FROM storage.t_project_attachment a')) return [];
    return db
      .rows<ProjectAttachment>(ProjectAttachment)
      .filter((a) => a.projectId === params[0])
      .map((a) => ({
        attachId: a.attachId,
        projectId: a.projectId,
        fileId: a.fileId,
        fileName: `file-${a.fileId}.pdf`,
        fileExt: '.pdf',
        fileSizeBytes: 12345678901, // bigint จาก driver
        uploadedBy: 7,
        uploadedDate: new Date(),
        confidentialityLevel: 4,
        folderName: 'PC',
        createUser: a.createUser,
        createDate: a.createDate,
      }));
  };
}

const links = (h: Harness) => h.main.rows<ProjectAttachment>(ProjectAttachment);

function setup(
  withDms = true,
  sysConfig?: { getNumber: (k: string, f: number) => Promise<number> },
) {
  const dms = withDms ? makeDms() : undefined;
  const h = makeHarness({ user: officer, dms, sysConfig });
  emulateList(h);
  const seeded = seedProject(h);
  return { h, dms, ...seeded };
}

describe('ProjectAttachmentsService — ยังไม่มี DMS_FILE_PORT', () => {
  it('upload / link / download ตอบ 503 DMS_UNAVAILABLE ที่จุดใช้งาน', async () => {
    const { h, project } = setup(false);
    const unavailable = { status: 503, response: { code: 'DMS_UNAVAILABLE' } };
    await expect(
      h.attachments.upload(
        project.projectId,
        [{ originalName: 'a.pdf', buffer: Buffer.from('x') }],
        undefined,
        officer,
      ),
    ).rejects.toMatchObject(unavailable);
    await expect(h.attachments.link(project.projectId, [1], officer)).rejects.toMatchObject(
      unavailable,
    );
    await expect(h.attachments.download(project.projectId, 1, officer)).rejects.toMatchObject(
      unavailable,
    );
  });

  it('list และ unlink ยังใช้ได้ (ไม่ต้องใช้ port)', async () => {
    const { h, project } = setup(false);
    h.main.seed(ProjectAttachment, [{ projectId: project.projectId, fileId: 5, createUser: 'u' }]);
    expect(await h.attachments.list(project.projectId)).toHaveLength(1);
    await h.attachments.unlink(project.projectId, 5);
    expect(links(h)).toHaveLength(0);
  });
});

describe('ProjectAttachmentsService.upload', () => {
  const file = (name: string) => ({
    originalName: name,
    buffer: Buffer.from(name),
    mimeType: 'application/pdf',
  });

  it('อัปโหลดผ่าน port (ไม่เขียนทับชื่อซ้ำ) ไปโฟลเดอร์ 437 ตามค่าเริ่มต้น แล้วผูกกับโครงการ', async () => {
    const { h, dms, project } = setup();
    const result = await h.attachments.upload(
      project.projectId,
      [file('a.pdf'), file('b.pdf')],
      undefined,
      officer,
    );

    expect(dms!.upload).toHaveBeenCalledWith(officer, 437, [file('a.pdf'), file('b.pdf')], {
      overwriteExisting: false,
    });
    expect(links(h).map((l) => [l.projectId, l.fileId, l.createUser])).toEqual([
      [project.projectId, 100, 'somchai'],
      [project.projectId, 101, 'somchai'],
    ]);
    expect(result.map((r) => [r.fileId, r.fileSizeBytes])).toEqual([
      [100, '12345678901'], // bigint ส่งเป็นสตริง
      [101, '12345678901'],
    ]);
  });

  it('ใช้โฟลเดอร์จาก config (ExternalUpload.FolderId.Level4) และ folderId ที่ระบุมาก่อน', async () => {
    const sysConfig = {
      getNumber: jest.fn(async (key: string, fallback: number) =>
        key === 'ExternalUpload.FolderId.Level4' ? 555 : fallback,
      ),
    };
    const { h, dms, project } = setup(true, sysConfig);
    await h.attachments.upload(project.projectId, [file('a.pdf')], undefined, officer);
    expect(dms!.upload.mock.calls[0][1]).toBe(555);
    expect(sysConfig.getNumber).toHaveBeenCalledWith('ExternalUpload.FolderId.Level4', 437);

    await h.attachments.upload(project.projectId, [file('b.pdf')], 12, officer);
    expect(dms!.upload.mock.calls[1][1]).toBe(12);
  });

  it('ไม่มีไฟล์ → 422 · โครงการไม่พบ → 404 โดยไม่เรียก DMS', async () => {
    const { h, dms, project } = setup();
    await expect(
      h.attachments.upload(project.projectId, [], undefined, officer),
    ).rejects.toMatchObject({
      response: { code: 'NO_FILE_UPLOADED' },
    });
    await expect(
      h.attachments.upload(999, [file('a.pdf')], undefined, officer),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    expect(dms!.upload).not.toHaveBeenCalled();
  });

  it('DMS ปฏิเสธ (สิทธิ์/quota) → error ส่งต่อ ไม่ผูกอะไร', async () => {
    const { h, dms, project } = setup();
    dms!.upload.mockRejectedValueOnce(new PermissionDeniedException('ไม่มีสิทธิ์เขียนโฟลเดอร์นี้'));
    await expect(
      h.attachments.upload(project.projectId, [file('a.pdf')], 9, officer),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
    expect(links(h)).toHaveLength(0);
  });

  it('ผูกกับโครงการไม่สำเร็จ → ลบไฟล์ที่เพิ่งอัปโหลดออกจาก DMS (ไม่ให้เหลือไฟล์กำพร้า) แล้วโยน error เดิม', async () => {
    const { h, dms, project } = setup();
    const insert = jest
      .spyOn(MemoryManager.prototype, 'insert')
      .mockRejectedValue(new Error('ผูกไม่ได้'));
    try {
      await expect(
        h.attachments.upload(project.projectId, [file('a.pdf'), file('b.pdf')], undefined, officer),
      ).rejects.toThrow('ผูกไม่ได้');
    } finally {
      insert.mockRestore();
    }
    expect(dms!.remove.mock.calls.map((c) => c[1])).toEqual([100, 101]);
    expect(links(h)).toHaveLength(0);
  });
});

describe('ProjectAttachmentsService.link / download / unlink', () => {
  it('ผูกไฟล์ที่มีอยู่: ตรวจสิทธิ์อ่านผ่าน DMS ทุกไฟล์ · ไฟล์ที่ผูกอยู่แล้วถูกข้าม · id ซ้ำในคำขอนับครั้งเดียว', async () => {
    const { h, dms, project } = setup();
    h.main.seed(ProjectAttachment, [{ projectId: project.projectId, fileId: 5, createUser: 'u' }]);

    const r = await h.attachments.link(project.projectId, [5, 6, 6, 7], officer);

    expect(r).toEqual({ linked: [6, 7], alreadyLinked: [5] });
    expect(dms!.openRead.mock.calls.map((c) => c[1])).toEqual([5, 6, 7]);
    expect(links(h).map((l) => l.fileId)).toEqual([5, 6, 7]);
  });

  it('ไม่มีสิทธิ์อ่านไฟล์ใดไฟล์หนึ่ง (DMS โยน 403) → ไม่ผูกเลยสักไฟล์', async () => {
    const { h, dms, project } = setup();
    dms!.openRead.mockImplementation(async (_u: unknown, fileId: number) => {
      if (fileId === 7) throw new PermissionDeniedException('ไม่มีสิทธิ์อ่านไฟล์');
      return { stream: Readable.from(['x']), fileName: 'f', size: 1, mimeType: 'x' };
    });
    await expect(h.attachments.link(project.projectId, [6, 7], officer)).rejects.toBeInstanceOf(
      PermissionDeniedException,
    );
    expect(links(h)).toHaveLength(0);
  });

  it('ดาวน์โหลด: ต้องเป็นไฟล์ที่ผูกกับโครงการนี้ มิฉะนั้น 404 (ไม่ใช้ id ไฟล์ของ DMS ลอยๆ)', async () => {
    const { h, dms, project } = setup();
    h.main.seed(ProjectAttachment, [{ projectId: project.projectId, fileId: 5, createUser: 'u' }]);

    const handle = await h.attachments.download(project.projectId, 5, officer);
    expect(handle.fileName).toBe('file-5.pdf');
    expect(dms!.openRead).toHaveBeenCalledWith(officer, 5);

    await expect(h.attachments.download(project.projectId, 6, officer)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
    const other = seedProject(h, { projectNo: 'OTHER' });
    await expect(h.attachments.download(other.project.projectId, 5, officer)).rejects.toMatchObject(
      {
        response: { code: 'NOT_FOUND' },
      },
    );
  });

  it('ยกเลิกการแนบ: ลบเฉพาะการผูก ไม่เรียก DMS ลบไฟล์ · ไม่พบ → 404', async () => {
    const { h, dms, project } = setup();
    h.main.seed(ProjectAttachment, [{ projectId: project.projectId, fileId: 5, createUser: 'u' }]);
    await h.attachments.unlink(project.projectId, 5);
    expect(links(h)).toHaveLength(0);
    expect(dms!.remove).not.toHaveBeenCalled();
    await expect(h.attachments.unlink(project.projectId, 5)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('list: โครงการที่ถูกลบ → 404', async () => {
    const { h, project } = setup();
    h.main.rows<Project>(Project)[0].active = 'N';
    await expect(h.attachments.list(project.projectId)).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('CRUD-log: upload/link = CREATE, unlink = DELETE, download = READ (เก็บเฉพาะเมื่อเปิดระดับ all)', async () => {
    const { h, project } = setup();
    await h.attachments.link(project.projectId, [6], officer);
    await h.attachments.unlink(project.projectId, 6);
    await h.crud.drain();
    expect(h.sink.events.map((e) => [e.entity, e.action, e.operation, e.success])).toEqual([
      ['ProjectAttachment', 'CREATE', 'LINK_PROJECT_ATTACHMENT', true],
      ['ProjectAttachment', 'DELETE', 'REMOVE_PROJECT_ATTACHMENT', true],
    ]);
  });
});
