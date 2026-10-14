import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DelegateTaskDto,
  DelegationListQueryDto,
} from '../../../src/modules/wfe/delegation/dto/delegation.dto';
import {
  CancelInstanceDto,
  CompleteStepDto,
  CreateInstanceDto,
  DeleteInstanceQueryDto,
  InstanceListQueryDto,
  MyTasksQueryDto,
  RejectStepDto,
} from '../../../src/modules/wfe/instance/dto/instance.dto';
import { SlaReportQueryDto } from '../../../src/modules/wfe/sla/dto/sla.dto';
import {
  CreateConnectionDto,
  CreateStepDto,
  CreateTemplateDto,
  ImportTemplateDto,
  TemplateListQueryDto,
  UpdateStepDto,
  UpdateTemplateDto,
} from '../../../src/modules/wfe/template/dto/template.dto';

/** จำลอง ValidationPipe ของแอป: whitelist + forbidNonWhitelisted + transform (ไม่แปลงชนิดโดยอัตโนมัติ) */
async function check<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const obj = plainToInstance(cls, plain, { enableImplicitConversion: false });
  const errors = await validate(obj, { whitelist: true, forbidNonWhitelisted: true });
  return { obj, fields: errors.map((e) => e.property).sort() };
}

describe('DTO ของ WFE — validation', () => {
  it('CreateTemplateDto: ตัดช่องว่างชื่อ; ชื่อว่าง/ยาวเกิน/มี field แปลกปลอมถูกปฏิเสธ', async () => {
    const ok = await check(CreateTemplateDto, { name: '  ขออนุมัติ  ', category: 'HR' });
    expect(ok.fields).toEqual([]);
    expect(ok.obj.name).toBe('ขออนุมัติ');
    expect((await check(CreateTemplateDto, { name: '   ' })).fields).toEqual(['name']);
    expect((await check(CreateTemplateDto, { name: 'x'.repeat(201) })).fields).toEqual(['name']);
    expect((await check(CreateTemplateDto, { name: 'x', isActive: true })).fields).toEqual([
      'isActive',
    ]); // กันส่ง IsActive จาก client
    expect((await check(CreateTemplateDto, { name: 'x', approvalStatus: 2 })).fields).toEqual([
      'approvalStatus',
    ]);
  });

  it('UpdateTemplateDto: ทุก field เป็นทางเลือก แต่ยังตรวจชนิด', async () => {
    expect((await check(UpdateTemplateDto, {})).fields).toEqual([]);
    expect((await check(UpdateTemplateDto, { name: '' })).fields).toEqual(['name']);
  });

  it('ImportTemplateDto รับ field จากไฟล์ export (version/isActive/approvalStatus) แต่ไม่ใช้', async () => {
    const r = await check(ImportTemplateDto, {
      name: 'a',
      version: 3,
      isActive: true,
      approvalStatus: 2,
    });
    expect(r.fields).toEqual([]);
  });

  it('CreateStepDto: ชนิด step ต้อง 1–8, SLA อยู่ในช่วง, ความลึกการมอบหมาย 0–3', async () => {
    expect((await check(CreateStepDto, { stepName: 'a', stepType: 2 })).fields).toEqual([]);
    expect((await check(CreateStepDto, { stepName: 'a', stepType: 0 })).fields).toEqual([
      'stepType',
    ]);
    expect((await check(CreateStepDto, { stepName: 'a', stepType: 9 })).fields).toEqual([
      'stepType',
    ]);
    expect(
      (await check(CreateStepDto, { stepName: 'a', stepType: 2, slaHours: 0 })).fields,
    ).toEqual(['slaHours']);
    expect(
      (await check(CreateStepDto, { stepName: 'a', stepType: 2, slaDays: 366 })).fields,
    ).toEqual(['slaDays']);
    expect(
      (await check(CreateStepDto, { stepName: 'a', stepType: 2, maxDelegationDepth: 4 })).fields,
    ).toEqual(['maxDelegationDepth']);
    expect(
      (await check(CreateStepDto, { stepName: 'a', stepType: 2, isDeleted: true })).fields,
    ).toEqual(['isDeleted']);
  });

  it('UpdateStepDto (partial) และ CreateConnectionDto', async () => {
    expect((await check(UpdateStepDto, { slaDays: 2 })).fields).toEqual([]);
    expect((await check(UpdateStepDto, { stepType: 12 })).fields).toEqual(['stepType']);
    expect((await check(CreateConnectionDto, { fromStepId: 1, toStepId: 2 })).fields).toEqual([]);
    expect((await check(CreateConnectionDto, { fromStepId: 0, toStepId: 2 })).fields).toEqual([
      'fromStepId',
    ]);
  });

  it('TemplateListQueryDto: แปลง query string เป็นชนิดที่ถูกต้อง', async () => {
    const r = await check(TemplateListQueryDto, {
      approvalStatus: '2',
      isActive: 'true',
      page: '3',
      pageSize: '50',
    });
    expect(r.fields).toEqual([]);
    expect(r.obj).toMatchObject({ approvalStatus: 2, isActive: true, page: 3, pageSize: 50 });
    expect((await check(TemplateListQueryDto, { approvalStatus: '9' })).fields).toEqual([
      'approvalStatus',
    ]);
    expect((await check(TemplateListQueryDto, { pageSize: '999' })).fields).toEqual(['pageSize']);
  });

  it('CreateInstanceDto ต้องมี workflowDefinitionId ≥ 1', async () => {
    expect(
      (await check(CreateInstanceDto, { workflowDefinitionId: '5', inputParameters: '{}' })).obj
        .workflowDefinitionId,
    ).toBe(5);
    expect((await check(CreateInstanceDto, {})).fields).toEqual(['workflowDefinitionId']);
    expect((await check(CreateInstanceDto, { workflowDefinitionId: 0 })).fields).toEqual([
      'workflowDefinitionId',
    ]);
  });

  it('RejectStepDto ต้องมีเหตุผล · DeleteInstanceQueryDto ต้องมีเหตุผล · CancelInstanceDto/CompleteStepDto ไม่บังคับ', async () => {
    expect((await check(RejectStepDto, { reason: '  ' })).fields).toEqual(['reason']);
    expect((await check(RejectStepDto, { reason: 'ไม่ครบ' })).fields).toEqual([]);
    expect((await check(DeleteInstanceQueryDto, {})).fields).toEqual(['reason']);
    expect((await check(CancelInstanceDto, {})).fields).toEqual([]);
    expect((await check(CompleteStepDto, {})).fields).toEqual([]);
    expect((await check(CompleteStepDto, { outputData: 'x'.repeat(100001) })).fields).toEqual([
      'outputData',
    ]);
  });

  it('InstanceListQueryDto: สถานะ 0–6, วันที่ ISO 8601', async () => {
    const r = await check(InstanceListQueryDto, { status: '5', fromDate: '2026-01-02T00:00:00Z' });
    expect(r.fields).toEqual([]);
    expect(r.obj.status).toBe(5);
    expect(r.obj.fromDate).toBeInstanceOf(Date);
    expect((await check(InstanceListQueryDto, { status: '7' })).fields).toEqual(['status']);
    expect((await check(InstanceListQueryDto, { fromDate: 'ไม่ใช่วันที่' })).fields).toEqual([
      'fromDate',
    ]);
  });

  it('MyTasksQueryDto: onlyOpen=true/false/1/0', async () => {
    expect((await check(MyTasksQueryDto, { onlyOpen: 'true' })).obj.onlyOpen).toBe(true);
    expect((await check(MyTasksQueryDto, { onlyOpen: '0' })).obj.onlyOpen).toBe(false);
    expect((await check(MyTasksQueryDto, { onlyOpen: 'maybe' })).fields).toEqual(['onlyOpen']);
  });

  it('DelegateTaskDto: ผู้รับบังคับ, วันที่เป็น ISO; DelegationListQueryDto: direction ถูกจำกัด', async () => {
    expect(
      (
        await check(DelegateTaskDto, {
          workflowStepInstanceId: 4,
          delegateToUserName: ' DOM\\carol ',
        })
      ).obj.delegateToUserName,
    ).toBe('DOM\\carol');
    expect((await check(DelegateTaskDto, { workflowStepInstanceId: 4 })).fields).toEqual([
      'delegateToUserName',
    ]);
    expect(
      (
        await check(DelegateTaskDto, {
          workflowStepInstanceId: 4,
          delegateToUserName: 'x',
          endDate: 'x',
        })
      ).fields,
    ).toEqual(['endDate']);
    expect(
      (await check(DelegationListQueryDto, { direction: 'to', activeOnly: 'true' })).fields,
    ).toEqual([]);
    expect((await check(DelegationListQueryDto, { direction: 'sideways' })).fields).toEqual([
      'direction',
    ]);
  });

  it('SlaReportQueryDto: weeks 1–52', async () => {
    expect((await check(SlaReportQueryDto, { weeks: '12' })).fields).toEqual([]);
    expect((await check(SlaReportQueryDto, { weeks: '0' })).fields).toEqual(['weeks']);
    expect((await check(SlaReportQueryDto, { weeks: '53' })).fields).toEqual(['weeks']);
  });
});
