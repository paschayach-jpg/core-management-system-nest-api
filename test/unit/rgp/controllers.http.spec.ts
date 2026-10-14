import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { diskStorage } from 'multer';
import request from 'supertest';
import { AppRole } from '../../../src/common/constants/enums';
import { MinRoleGuard } from '../../../src/common/guards/min-role.guard';
import type { UserContext } from '../../../src/common/interfaces/user-context';
import { ProjectAttachmentsController } from '../../../src/modules/rgp/attachments/project-attachments.controller';
import { ProjectAttachmentsService } from '../../../src/modules/rgp/attachments/project-attachments.service';
import { ProjectAuditController } from '../../../src/modules/rgp/audit/project-audit.controller';
import { ProjectAuditService } from '../../../src/modules/rgp/audit/project-audit.service';
import { ProjectDocumentsController } from '../../../src/modules/rgp/documents/project-documents.controller';
import { ProjectDocumentsService } from '../../../src/modules/rgp/documents/project-documents.service';
import { RgpLookupsController } from '../../../src/modules/rgp/lookups/rgp-lookups.controller';
import { RgpLookupsService } from '../../../src/modules/rgp/lookups/rgp-lookups.service';
import { MemberRolesService } from '../../../src/modules/rgp/members/member-roles.service';
import {
  MemberRolesController,
  ProjectMembersController,
} from '../../../src/modules/rgp/members/project-members.controller';
import { ProjectMembersService } from '../../../src/modules/rgp/members/project-members.service';
import { ProjectProgressController } from '../../../src/modules/rgp/progress/project-progress.controller';
import { ProjectProgressService } from '../../../src/modules/rgp/progress/project-progress.service';
import { ProjectsController } from '../../../src/modules/rgp/projects/projects.controller';
import { ProjectsService } from '../../../src/modules/rgp/projects/projects.service';
import { ProjectStatesController } from '../../../src/modules/rgp/states/project-states.controller';
import { ProjectStatesService } from '../../../src/modules/rgp/states/project-states.service';
import { StateMembersService } from '../../../src/modules/rgp/states/state-members.service';
import { StateNotifyService } from '../../../src/modules/rgp/states/state-notify.service';
import { ProjectTasksController } from '../../../src/modules/rgp/tasks/project-tasks.controller';
import { ProjectTasksService } from '../../../src/modules/rgp/tasks/project-tasks.service';
import {
  ProjectTemplatesController,
  TemplateDocsController,
  TemplateStatesController,
} from '../../../src/modules/rgp/templates/project-templates.controller';
import { ProjectTemplatesService } from '../../../src/modules/rgp/templates/project-templates.service';
import { fakeUser } from '../../helpers/stubs';

/**
 * ทดสอบชั้น HTTP ของ RGP (route, ValidationPipe, @MinRole, อัปโหลด/ดาวน์โหลด) โดยใช้ service ปลอม —
 * ตรวจว่า controller เรียก service ด้วยอาร์กิวเมนต์ที่ถูกต้อง (ผู้ใช้จาก token ไม่ใช่จาก body) โดยไม่ต้องมี DB
 */

type Mock = jest.Mock;
const mocks = {
  projects: {} as Record<string, Mock>,
  states: {} as Record<string, Mock>,
  stateMembers: {} as Record<string, Mock>,
  notify: {} as Record<string, Mock>,
  progress: {} as Record<string, Mock>,
  tasks: {} as Record<string, Mock>,
  documents: {} as Record<string, Mock>,
  members: {} as Record<string, Mock>,
  roles: {} as Record<string, Mock>,
  attachments: {} as Record<string, Mock>,
  templates: {} as Record<string, Mock>,
  lookups: {} as Record<string, Mock>,
  audit: {} as Record<string, Mock>,
};

const fns = (names: string[]): Record<string, Mock> =>
  Object.fromEntries(names.map((n) => [n, jest.fn(async () => ({ ok: true }))]));

function resetMocks(): void {
  Object.assign(
    mocks.projects,
    fns([
      'list',
      'getDetail',
      'create',
      'update',
      'updateLegalDict',
      'remove',
      'close',
      'recalculateStatus',
      'checkProjectNo',
      'referenceCandidates',
    ]),
  );
  Object.assign(
    mocks.states,
    fns(['listByProject', 'create', 'reorder', 'estimatedDays', 'get', 'update', 'remove']),
  );
  Object.assign(mocks.stateMembers, fns(['listByState', 'add', 'remove']));
  Object.assign(mocks.notify, fns(['notify']));
  Object.assign(mocks.progress, fns(['overview', 'history', 'update']));
  Object.assign(
    mocks.tasks,
    fns([
      'listByProject',
      'listByState',
      'create',
      'get',
      'update',
      'updateStatus',
      'remove',
      'statusLog',
      'listComments',
      'addComment',
      'deleteComment',
    ]),
  );
  Object.assign(
    mocks.documents,
    fns(['listByProject', 'listByState', 'create', 'get', 'update', 'updateStatus', 'remove']),
  );
  Object.assign(mocks.members, fns(['listByProject', 'add', 'remove']));
  Object.assign(mocks.roles, fns(['list', 'create', 'update', 'remove']));
  Object.assign(mocks.attachments, fns(['list', 'upload', 'link', 'download', 'unlink']));
  Object.assign(
    mocks.templates,
    fns([
      'list',
      'create',
      'get',
      'blueprint',
      'listStates',
      'update',
      'remove',
      'copyStatesFrom',
      'createState',
      'updateState',
      'removeState',
      'listDocsByState',
      'createDoc',
      'updateDoc',
      'removeDoc',
    ]),
  );
  Object.assign(
    mocks.lookups,
    fns([
      'employeeList',
      'subCommitteeList',
      'divisionList',
      'departmentList',
      'masterDocuments',
      'masterDocumentTypes',
    ]),
  );
  Object.assign(mocks.audit, fns(['query']));
}

let app: INestApplication;
let currentUser: UserContext;
// โฟลเดอร์ชั่วคราวของเทสต์นี้เอง — ห้ามนับไฟล์ใน os.tmpdir() ตรงๆ เพราะ suite อื่นที่รันขนานเขียนไฟล์ชั่วคราวที่นั่นด้วย (ทำให้เทสต์ไม่นิ่ง)
const uploadDir = mkdtempSync(join(tmpdir(), 'rgp-upload-test-'));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      MulterModule.register({
        storage: diskStorage({ destination: uploadDir }),
        limits: { fileSize: 1024 * 1024 },
      }),
    ],
    controllers: [
      ProjectsController,
      ProjectStatesController,
      ProjectProgressController,
      ProjectTasksController,
      ProjectDocumentsController,
      ProjectMembersController,
      MemberRolesController,
      ProjectAttachmentsController,
      ProjectTemplatesController,
      TemplateStatesController,
      TemplateDocsController,
      RgpLookupsController,
      ProjectAuditController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: MinRoleGuard },
      { provide: ProjectsService, useValue: mocks.projects },
      { provide: ProjectStatesService, useValue: mocks.states },
      { provide: StateMembersService, useValue: mocks.stateMembers },
      { provide: StateNotifyService, useValue: mocks.notify },
      { provide: ProjectProgressService, useValue: mocks.progress },
      { provide: ProjectTasksService, useValue: mocks.tasks },
      { provide: ProjectDocumentsService, useValue: mocks.documents },
      { provide: ProjectMembersService, useValue: mocks.members },
      { provide: MemberRolesService, useValue: mocks.roles },
      { provide: ProjectAttachmentsService, useValue: mocks.attachments },
      { provide: ProjectTemplatesService, useValue: mocks.templates },
      { provide: RgpLookupsService, useValue: mocks.lookups },
      { provide: ProjectAuditService, useValue: mocks.audit },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // ผู้ใช้ปัจจุบัน (แทน JwtAuthGuard)
  app.use((req: { user?: UserContext }, _res: unknown, next: () => void) => {
    req.user = currentUser;
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app?.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetMocks();
  currentUser = fakeUser({ userId: 5, adUserName: 'somchai', appRole: AppRole.Officer });
});

const http = () => request(app.getHttpServer());

describe('route และพารามิเตอร์', () => {
  it('GET /rgp/projects/check-no ไม่ถูก :projectId กลืน', async () => {
    const res = await http().get('/rgp/projects/check-no?projectNo=PRJ-1').expect(200);
    expect(mocks.projects.checkProjectNo).toHaveBeenCalledWith('PRJ-1');
    expect(mocks.projects.getDetail).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /rgp/projects/reference-candidates?excludeProjectId=3', async () => {
    await http().get('/rgp/projects/reference-candidates?excludeProjectId=3').expect(200);
    expect(mocks.projects.referenceCandidates).toHaveBeenCalledWith(3);
  });

  it(':projectId ที่ไม่ใช่ตัวเลข → 400 และไม่เรียก service', async () => {
    await http().get('/rgp/projects/abc').expect(400);
    await http().get('/rgp/states/1.5/members').expect(400);
    expect(mocks.projects.getDetail).not.toHaveBeenCalled();
  });

  it('check-no ต้องมี projectNo', async () => {
    await http().get('/rgp/projects/check-no').expect(400);
  });

  it('PUT /rgp/projects/:id/states/order ไม่ชนกับ PATCH /rgp/states/:id', async () => {
    await http()
      .put('/rgp/projects/9/states/order')
      .send({ items: [{ stateId: 1, seqNo: 2 }] })
      .expect(200);
    expect(mocks.states.reorder).toHaveBeenCalledWith(
      9,
      { items: [{ stateId: 1, seqNo: 2 }] },
      currentUser,
    );
  });
});

describe('ค้นหาโครงการ — query string', () => {
  it('แปลงตัวเลขและส่งต่อให้ service', async () => {
    await http()
      .get(
        '/rgp/projects?page=2&pageSize=5&status=Open&templateId=3&createdFrom=2026-01-01&projectNo=%20PRJ%20',
      )
      .expect(200);
    const q = mocks.projects.list.mock.calls[0][0];
    expect(q).toMatchObject({
      page: 2,
      pageSize: 5,
      status: 'Open',
      templateId: 3,
      createdFrom: '2026-01-01',
      projectNo: 'PRJ', // trim
    });
  });

  it.each([
    ['status ที่ไม่รู้จัก', 'status=Bogus'],
    ['pageSize เกิน 200', 'pageSize=500'],
    ['วันที่ไม่ถูกต้อง', 'createdFrom=2026-02-30'],
    ['รูปแบบวันที่ผิด', 'createdTo=01/02/2026'],
    ['templateId ไม่ใช่ตัวเลข', 'templateId=abc'],
    ['field แปลกปลอม', 'isAdmin=true'],
  ])('%s → 400', async (_n, qs) => {
    await http().get(`/rgp/projects?${qs}`).expect(400);
    expect(mocks.projects.list).not.toHaveBeenCalled();
  });
});

describe('สร้างโครงการ — ValidationPipe', () => {
  const valid = {
    name: 'โครงการ',
    templateId: 1,
    startDate: '2026-03-01',
    dueDate: '2026-04-01',
    states: [{ name: 'ขั้น 1', estimatedDays: 5, required: true }],
    documents: [{ stateIndex: 0, name: 'เอกสาร' }],
    members: [{ memberType: 'Employee', adUserName: 'somchai', role: 'ผู้ประสานงาน' }],
  };

  it('payload ถูกต้อง → 201 และ service ได้ DTO + ผู้ใช้จาก token', async () => {
    await http().post('/rgp/projects').send(valid).expect(201);
    expect(mocks.projects.create).toHaveBeenCalledTimes(1);
    const [dto, user] = mocks.projects.create.mock.calls[0];
    expect(dto).toMatchObject(valid);
    expect(dto.states[0].constructor.name).toBe('CreateProjectStateDto'); // nested transform ทำงาน
    expect(user).toBe(currentUser);
  });

  it.each([
    ['ไม่มีชื่อ', { ...valid, name: undefined }],
    ['ชื่อว่าง', { ...valid, name: '   ' }],
    ['ชื่อยาวเกิน 300', { ...valid, name: 'ก'.repeat(301) }],
    ['เลขที่โครงการยาวเกิน 20', { ...valid, projectNo: 'P'.repeat(21) }],
    ['วันที่ไม่มีอยู่จริง', { ...valid, startDate: '2026-02-30' }],
    ['ขั้นตอนไม่มีชื่อ', { ...valid, states: [{ name: '' }] }],
    ['วันคาดการณ์ติดลบ', { ...valid, states: [{ name: 'a', estimatedDays: -1 }] }],
    ['stateIndex ติดลบ', { ...valid, documents: [{ stateIndex: -1, name: 'x' }] }],
    ['ประเภทบุคคลไม่รู้จัก', { ...valid, members: [{ memberType: 'Alien', role: 'r' }] }],
    ['บุคคลไม่มีบทบาท', { ...valid, members: [{ memberType: 'Division', orgId: 1 }] }],
    ['มี field ที่ไม่อยู่ใน DTO (mass-assignment: status)', { ...valid, status: 'Completed' }],
    ['พยายามส่ง createUser', { ...valid, createUser: 'admin' }],
    ['ขั้นตอนเกิน 100', { ...valid, states: Array.from({ length: 101 }, () => ({ name: 'x' })) }],
  ])('%s → 400 และไม่เรียก service', async (_n, body) => {
    await http().post('/rgp/projects').send(body).expect(400);
    expect(mocks.projects.create).not.toHaveBeenCalled();
  });
});

describe('แก้ไขโครงการ / พจนานุกรม', () => {
  it('PATCH ส่ง null ล้มค่าได้ และ field ที่ไม่รู้จัก → 400', async () => {
    await http().patch('/rgp/projects/4').send({ dueDate: null, description: null }).expect(200);
    expect(mocks.projects.update).toHaveBeenCalledWith(
      4,
      { dueDate: null, description: null },
      currentUser,
    );
    await http().patch('/rgp/projects/4').send({ projectNo: 'X' }).expect(400);
    await http().patch('/rgp/projects/4').send({ name: '' }).expect(400);
  });

  it('PUT legal-dict: ต้องมี key json (string หรือ null)', async () => {
    await http().put('/rgp/projects/4/legal-dict').send({}).expect(400);
    await http().put('/rgp/projects/4/legal-dict').send({ json: 5 }).expect(400);
    await http().put('/rgp/projects/4/legal-dict').send({ json: null }).expect(204);
    await http().put('/rgp/projects/4/legal-dict').send({ json: '{"a":1}' }).expect(204);
    expect(mocks.projects.updateLegalDict).toHaveBeenCalledTimes(2);
  });

  it('DELETE ส่งผู้ใช้จาก token (ไม่รับจาก client)', async () => {
    await http().delete('/rgp/projects/4').expect(204);
    expect(mocks.projects.remove).toHaveBeenCalledWith(4, currentUser);
  });
});

describe('@MinRole — บังคับสิทธิ์ที่ API', () => {
  const managerOnly: [string, string, string][] = [
    ['POST', '/rgp/projects/1/close', 'close'],
    ['POST', '/rgp/templates', 'create'],
    ['PATCH', '/rgp/templates/1', 'update'],
    ['DELETE', '/rgp/templates/1', 'remove'],
    ['POST', '/rgp/templates/1/copy-states', 'copyStatesFrom'],
    ['POST', '/rgp/templates/1/states', 'createState'],
    ['PATCH', '/rgp/template-states/1', 'updateState'],
    ['DELETE', '/rgp/template-states/1', 'removeState'],
    ['POST', '/rgp/template-states/1/docs', 'createDoc'],
    ['PATCH', '/rgp/template-docs/1', 'updateDoc'],
    ['DELETE', '/rgp/template-docs/1', 'removeDoc'],
    ['POST', '/rgp/member-roles', 'create'],
    ['PATCH', '/rgp/member-roles/1', 'update'],
    ['DELETE', '/rgp/member-roles/1', 'remove'],
    ['GET', '/rgp/audit', 'query'],
    ['GET', '/rgp/projects/1/audit', 'query'],
  ];
  const bodies: Record<string, object> = {
    '/rgp/templates': { code: 'A', name: 'ก' },
    '/rgp/templates/1/copy-states': { sourceTemplateId: 2 },
    '/rgp/templates/1/states': { name: 'ก' },
    '/rgp/template-states/1/docs': { masterDocId: 1 },
    '/rgp/member-roles': { name: 'ก' },
  };

  it.each(managerOnly)('Officer เรียก %s %s → 403 และไม่เรียก service', async (method, path) => {
    currentUser = fakeUser({ appRole: AppRole.Officer });
    const res = await http()
      [method.toLowerCase() as 'get'](path)
      .send(bodies[path] ?? {});
    expect(res.status).toBe(403);
    for (const group of Object.values(mocks)) {
      for (const fn of Object.values(group)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it.each(managerOnly)('Manager เรียก %s %s → ผ่านถึง service', async (method, path, fn) => {
    currentUser = fakeUser({ appRole: AppRole.Manager });
    const res = await http()
      [method.toLowerCase() as 'get'](path)
      .send(bodies[path] ?? {});
    expect(res.status).toBeLessThan(300);
    const called = Object.values(mocks).some((group) => group[fn]?.mock.calls.length > 0);
    expect(called).toBe(true);
  });

  it('การทำงานของโครงการทั่วไป Officer ทำได้ (ระบบเดิมไม่จำกัดสิทธิ์)', async () => {
    currentUser = fakeUser({ appRole: AppRole.Officer });
    await http().get('/rgp/templates').expect(200);
    await http().get('/rgp/member-roles').expect(200);
    await http().post('/rgp/states/1/progress').send({ pctComplete: 50 }).expect(200);
    await http().post('/rgp/states/1/tasks').send({ title: 'งาน' }).expect(201);
    await http().post('/rgp/projects/1/recalculate-status').expect(200);
  });
});

describe('ความคืบหน้า / Task / เอกสาร / สมาชิก — DTO', () => {
  it('progress: 0–100 จำนวนเต็มเท่านั้น', async () => {
    for (const bad of [-1, 101, 50.5, '50x', null]) {
      await http().post('/rgp/states/1/progress').send({ pctComplete: bad }).expect(400);
    }
    await http()
      .post('/rgp/states/1/progress')
      .send({ pctComplete: 100, remark: ' ok ' })
      .expect(200);
    expect(mocks.progress.update).toHaveBeenCalledWith(
      1,
      { pctComplete: 100, remark: 'ok' },
      currentUser,
    );
  });

  it('task status: ต้องเป็นสถานะที่รู้จัก · % 0–100', async () => {
    await http().patch('/rgp/tasks/3/status').send({ status: 'Finished' }).expect(400);
    await http()
      .patch('/rgp/tasks/3/status')
      .send({ status: 'Done', pctComplete: 101 })
      .expect(400);
    await http().patch('/rgp/tasks/3/status').send({ pctComplete: 10 }).expect(400);
    for (const status of ['Todo', 'InProgress', 'InReview', 'Done', 'OnHold', 'Cancelled']) {
      await http().patch('/rgp/tasks/3/status').send({ status }).expect(200);
    }
    expect(mocks.tasks.updateStatus).toHaveBeenCalledTimes(6);
    expect(mocks.tasks.updateStatus.mock.calls[0]).toEqual([3, { status: 'Todo' }, currentUser]);
  });

  it('task create: priority 1–4, วันที่ถูกต้อง, ห้ามส่ง status/projectId', async () => {
    await http().post('/rgp/states/2/tasks').send({ title: 'x', priority: 5 }).expect(400);
    await http()
      .post('/rgp/states/2/tasks')
      .send({ title: 'x', dueDate: '2026-13-01' })
      .expect(400);
    await http().post('/rgp/states/2/tasks').send({ title: 'x', status: 'Done' }).expect(400);
    await http().post('/rgp/states/2/tasks').send({ title: 'x', projectId: 9 }).expect(400);
    await http()
      .post('/rgp/states/2/tasks')
      .send({ title: 'x', priority: 4, parentTaskId: 7 })
      .expect(201);
  });

  it('task list: includeDeleted แปลงเป็น boolean', async () => {
    await http().get('/rgp/states/2/tasks?includeDeleted=true').expect(200);
    expect(mocks.tasks.listByState).toHaveBeenCalledWith(2, true);
    await http().get('/rgp/states/2/tasks').expect(200);
    expect(mocks.tasks.listByState).toHaveBeenLastCalledWith(2, false);
    await http().get('/rgp/states/2/tasks?includeDeleted=maybe').expect(400);
  });

  it('เอกสาร: สถานะต้องเป็น Pending/Received/Verified/Rejected', async () => {
    await http().patch('/rgp/documents/5/status').send({ status: 'Done' }).expect(400);
    await http().patch('/rgp/documents/5/status').send({ status: 'Verified' }).expect(200);
    await http().post('/rgp/states/1/documents').send({ name: '' }).expect(400);
  });

  it('เพิ่มสมาชิก state ต้องส่ง projectMemberId · ลบ/แจ้งเตือนเรียก service ด้วยผู้ใช้จาก token', async () => {
    await http().post('/rgp/states/1/members').send({}).expect(400);
    await http().post('/rgp/states/1/members').send({ projectMemberId: 7 }).expect(201);
    expect(mocks.stateMembers.add).toHaveBeenCalledWith(1, 7, currentUser);
    await http().post('/rgp/state-members/7/notify').expect(200);
    expect(mocks.notify.notify).toHaveBeenCalledWith(7, currentUser);
    await http().delete('/rgp/state-members/7').expect(204);
  });

  it('ลบขั้นตอน: cascade เป็น query boolean', async () => {
    await http().delete('/rgp/states/4?cascade=true').expect(204);
    expect(mocks.states.remove).toHaveBeenCalledWith(4, currentUser, true);
    await http().delete('/rgp/states/4').expect(204);
    expect(mocks.states.remove).toHaveBeenLastCalledWith(4, currentUser, false);
  });

  it('reorder ต้องมี items อย่างน้อย 1 รายการ และ seqNo ≥ 1', async () => {
    await http().put('/rgp/projects/1/states/order').send({ items: [] }).expect(400);
    await http()
      .put('/rgp/projects/1/states/order')
      .send({ items: [{ stateId: 1, seqNo: 0 }] })
      .expect(400);
  });

  it('เพิ่มบุคคล: ส่ง memberType/role ครบ', async () => {
    await http()
      .post('/rgp/projects/1/members')
      .send({ memberType: 'Division', orgId: 2, role: 'ประธาน' })
      .expect(201);
    expect(mocks.members.add.mock.calls[0][1]).toMatchObject({
      memberType: 'Division',
      orgId: 2,
      role: 'ประธาน',
    });
    await http()
      .post('/rgp/projects/1/members')
      .send({ memberType: 'Division', orgId: 0, role: 'x' })
      .expect(400);
  });

  it('template: roles activeOnly และ copy-states คืนจำนวนที่คัดลอก', async () => {
    mocks.templates.copyStatesFrom.mockResolvedValueOnce(4);
    currentUser = fakeUser({ appRole: AppRole.Manager });
    const res = await http()
      .post('/rgp/templates/1/copy-states')
      .send({ sourceTemplateId: 2 })
      .expect(200);
    expect(res.body).toEqual({ copiedStates: 4 });
    expect(mocks.templates.copyStatesFrom).toHaveBeenCalledWith(1, 2, currentUser);

    await http().get('/rgp/member-roles?activeOnly=true').expect(200);
    expect(mocks.roles.list).toHaveBeenCalledWith(true);
  });
});

describe('ไฟล์แนบ — อัปโหลด/ดาวน์โหลด', () => {
  const tmpCount = () => readdirSync(uploadDir).length;

  it('อัปโหลด multipart: อ่านเป็น buffer ส่งให้ service ด้วย folderId และลบไฟล์ชั่วคราว', async () => {
    mocks.attachments.upload.mockResolvedValueOnce([{ fileId: 100 }]);
    const before = tmpCount();

    const res = await http()
      .post('/rgp/projects/8/attachments/upload?folderId=12')
      .attach('files', Buffer.from('hello'), 'ทดสอบ.txt')
      .expect(201);

    expect(res.body).toEqual([{ fileId: 100 }]);
    const [projectId, inputs, folderId, user] = mocks.attachments.upload.mock.calls[0];
    expect(projectId).toBe(8);
    expect(folderId).toBe(12);
    expect(user).toBe(currentUser);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].buffer.toString()).toBe('hello');
    expect(inputs[0].originalName).toBe('ทดสอบ.txt'); // ชื่อไทยไม่เพี้ยน
    expect(tmpCount()).toBeLessThanOrEqual(before);
  });

  it('ไม่แนบไฟล์ → service ได้รายการว่าง (service ปฏิเสธเอง) · ไฟล์ใหญ่เกินกำหนด → 413 และไม่ทิ้งไฟล์ค้าง', async () => {
    await http().post('/rgp/projects/8/attachments/upload').expect(201);
    expect(mocks.attachments.upload.mock.calls[0][1]).toEqual([]);

    const before = tmpCount();
    await http()
      .post('/rgp/projects/8/attachments/upload')
      .attach('files', Buffer.alloc(1024 * 1024 + 10), 'big.bin')
      .expect(413);
    expect(tmpCount()).toBeLessThanOrEqual(before);
  });

  it('validate query ไม่ผ่านหลัง multer เขียนไฟล์แล้ว → 400 และไฟล์ชั่วคราวไม่ค้าง', async () => {
    const before = tmpCount();
    await http()
      .post('/rgp/projects/8/attachments/upload?folderId=abc')
      .attach('files', Buffer.from('hello'), 'a.txt')
      .expect(400);
    // finalize ของ interceptor ลบแบบ async เล็กน้อยหลังตอบ
    await new Promise((r) => setTimeout(r, 50));
    expect(tmpCount()).toBeLessThanOrEqual(before);
    expect(mocks.attachments.upload).not.toHaveBeenCalled();
  });

  it('ผูกไฟล์เดิม: fileIds ต้องเป็นจำนวนเต็มบวก 1–50 ตัว', async () => {
    await http().post('/rgp/projects/8/attachments').send({ fileIds: [] }).expect(400);
    await http()
      .post('/rgp/projects/8/attachments')
      .send({ fileIds: [0] })
      .expect(400);
    await http()
      .post('/rgp/projects/8/attachments')
      .send({ fileIds: Array.from({ length: 51 }, (_, i) => i + 1) })
      .expect(400);
    await http()
      .post('/rgp/projects/8/attachments')
      .send({ fileIds: [3, 4] })
      .expect(200);
    expect(mocks.attachments.link).toHaveBeenCalledWith(8, [3, 4], currentUser);
  });

  it('ดาวน์โหลด: สตรีมไฟล์พร้อม header (ชื่อไทยเข้ารหัส UTF-8)', async () => {
    mocks.attachments.download.mockResolvedValueOnce({
      stream: Readable.from([Buffer.from('PDFDATA')]),
      fileName: 'รายงาน 1.pdf',
      size: 7,
      mimeType: 'application/pdf',
    });
    const res = await http().get('/rgp/projects/8/attachments/55/download').expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-length']).toBe('7');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('รายงาน 1.pdf')}`,
    );
    expect(res.body.toString()).toBe('PDFDATA');
    expect(mocks.attachments.download).toHaveBeenCalledWith(8, 55, currentUser);
    expect(existsSync(uploadDir)).toBe(true);
  });
});
