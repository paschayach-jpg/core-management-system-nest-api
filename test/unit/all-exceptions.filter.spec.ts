import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import {
  BusinessException,
  ResourceNotFoundException,
} from '../../src/common/exceptions/business.exception';
import { AllExceptionsFilter, ErrorBody } from '../../src/common/filters/all-exceptions.filter';
import { SpExecutionError } from '../../src/database/sp/sp-execution.error';

function run(ex: unknown): { status: number; body: ErrorBody } {
  jest.spyOn(ClsServiceManager, 'getClsService').mockReturnValue({ getId: () => 'rid-1' } as never);
  let status = 0;
  let body: ErrorBody | undefined;
  const res = {
    headersSent: false,
    status(s: number) {
      status = s;
      return this;
    },
    json(b: ErrorBody) {
      body = b;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'POST', originalUrl: '/api/v1/x' }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(ex, host);
  return { status, body: body as ErrorBody };
}

describe('AllExceptionsFilter', () => {
  it('BusinessException → 422 พร้อม code/details และ requestId', () => {
    const { status, body } = run(
      new BusinessException('ลึกเกิน 10 ระดับ', 'FOLDER_DEPTH_EXCEEDED', { depth: 11 }),
    );
    expect(status).toBe(422);
    expect(body).toMatchObject({
      code: 'FOLDER_DEPTH_EXCEEDED',
      message: 'ลึกเกิน 10 ระดับ',
      details: { depth: 11 },
      requestId: 'rid-1',
      path: '/api/v1/x',
    });
  });

  it('ResourceNotFoundException → 404', () => {
    expect(run(new ResourceNotFoundException('Folder', 5)).status).toBe(404);
  });

  it('ValidationPipe (BadRequest ที่ message เป็น array) → VALIDATION_FAILED + details', () => {
    const { status, body } = run(
      new BadRequestException(['name should not be empty', 'id must be an integer']),
    );
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual(['name should not be empty', 'id must be an integer']);
  });

  it('HttpException ทั่วไปรักษา status เดิม', () => {
    expect(run(new ForbiddenException('no')).status).toBe(403);
    expect(run(new ConflictException('dup')).body.code).toBe('CONFLICT');
  });

  it('RAISERROR จาก SP → 422 พร้อมข้อความของ SP', () => {
    const { status, body } = run(
      new SpExecutionError('EMS.sp_InsertOrgUnit', 'รหัสหน่วยงาน X มีอยู่ในระบบแล้ว', 50000),
    );
    expect(status).toBe(422);
    expect(body).toMatchObject({
      code: 'DB_BUSINESS_RULE',
      message: 'รหัสหน่วยงาน X มีอยู่ในระบบแล้ว',
    });
  });

  it.each([
    [2627, 409, 'DUPLICATE'],
    [547, 409, 'REFERENCE_CONFLICT'],
    [1205, 503, 'DB_DEADLOCK'],
    [-2, 504, 'DB_TIMEOUT'],
    [8134, 500, 'DB_ERROR'],
  ])('SQL error %i → HTTP %i %s', (num, http, code) => {
    const { status, body } = run(new SpExecutionError('x', 'raw sql message with internals', num));
    expect(status).toBe(http);
    expect(body.code).toBe(code);
    if (http === 500) expect(body.message).not.toContain('internals'); // ไม่รั่วรายละเอียดภายใน
  });

  it('QueryFailedError ของ TypeORM ถูกแปลงด้วยเลข error ของ driver', () => {
    const qf = new QueryFailedError(
      'INSERT ...',
      [],
      Object.assign(new Error('Violation of UNIQUE KEY'), { number: 2627 }),
    );
    expect(run(qf).status).toBe(409);
  });

  it('EntityNotFoundError → 404', () => {
    expect(run(new EntityNotFoundError('Folder', {})).status).toBe(404);
  });

  it('error ที่ไม่รู้จัก → 500 ข้อความทั่วไป', () => {
    const { status, body } = run(new Error('secret stack detail'));
    expect(status).toBe(500);
    expect(body.message).toBe('เกิดข้อผิดพลาดภายในระบบ');
  });
});
