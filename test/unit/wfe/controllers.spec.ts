import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AppRole } from '../../../src/common/constants/enums';
import { MIN_ROLE_KEY } from '../../../src/common/decorators/auth.decorators';
import { MinRoleGuard } from '../../../src/common/guards/min-role.guard';
import { WorkflowDelegationsController } from '../../../src/modules/wfe/delegation/delegation.controller';
import {
  WorkflowInstancesController,
  WorkflowStepInstancesController,
  WorkflowTasksController,
} from '../../../src/modules/wfe/instance/instance.controller';
import { WorkflowSlaController } from '../../../src/modules/wfe/sla/sla.controller';
import { WorkflowTemplatesController } from '../../../src/modules/wfe/template/template.controller';
import { fakeUser } from '../../helpers/stubs';

/** คีย์ metadata ของ @ApiOperation (DECORATORS.API_OPERATION ใน @nestjs/swagger — import ลึกไม่ได้เพราะ package จำกัด exports) */
const SWAGGER_API_OPERATION = 'swagger/apiOperation';

type Ctor = { prototype: Record<string, unknown> } & (new (...a: never[]) => object);
const CONTROLLERS: Ctor[] = [
  WorkflowTemplatesController,
  WorkflowInstancesController,
  WorkflowTasksController,
  WorkflowStepInstancesController,
  WorkflowDelegationsController,
  WorkflowSlaController,
] as never;

const O = AppRole.Officer;
const M = AppRole.Manager;
const A = AppRole.Admin;

/**
 * ตารางสิทธิ์ขั้นต่ำของทุก endpoint (ตัวเลขคือ @MinRole; O = ทุกคนที่ login แล้วไปตรวจสิทธิ์ทรัพยากรใน service)
 * เปลี่ยนตารางนี้ต้องแก้เอกสาร docs/modules/wfe.md ด้วย
 */
const MATRIX: Record<string, Record<string, AppRole>> = {
  WorkflowTemplatesController: {
    list: O,
    get: O,
    versions: O,
    validate: O,
    steps: O,
    connections: O,
    export: M,
    import: M,
    create: M,
    update: M,
    remove: M,
    copy: M,
    submit: M,
    deactivate: M,
    sync: M,
    createStep: M,
    updateStep: M,
    deleteStep: M,
    createConnection: M,
    updateConnection: M,
    deleteConnection: M,
    approve: A,
    reject: A,
    publish: A,
    deprecate: A,
  },
  WorkflowInstancesController: {
    list: O,
    create: O,
    get: O,
    history: O,
    suspend: O,
    resume: O,
    cancel: O,
    remove: M,
  },
  WorkflowTasksController: { mine: O },
  WorkflowStepInstancesController: { get: O, start: O, complete: O, reject: O },
  WorkflowDelegationsController: {
    mine: O,
    history: O,
    get: O,
    delegate: O,
    returnTask: O,
    deactivate: O,
  },
  WorkflowSlaController: { compliance: M, taskDistribution: M, overdue: M, refresh: A },
};

function ctx(Cls: Ctor, handler: string, user: unknown): ExecutionContext {
  return {
    getHandler: () => Cls.prototype[handler],
    getClass: () => Cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('สิทธิ์ของ endpoint WFE (@MinRole)', () => {
  const guard = new MinRoleGuard(new Reflector());

  for (const Cls of CONTROLLERS) {
    const name = Cls.name;
    describe(name, () => {
      const expected = MATRIX[name];

      it('ตารางสิทธิ์ครอบคลุมทุก handler ของ controller (ไม่มี endpoint ที่ลืมกำหนดสิทธิ์)', () => {
        const handlers = Object.getOwnPropertyNames(Cls.prototype).filter(
          (m) =>
            m !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, Cls.prototype[m] as object),
        );
        expect(handlers.sort()).toEqual(Object.keys(expected).sort());
      });

      for (const [handler, required] of Object.entries(expected)) {
        it(`${handler}: ต้องการ role ≥ ${AppRole[required]}`, () => {
          const meta = Reflect.getMetadata(MIN_ROLE_KEY, Cls.prototype[handler] as object) as
            AppRole | undefined;
          expect(meta ?? O).toBe(required);

          // ต่ำกว่า → 403 · เท่ากับ/สูงกว่า → ผ่าน
          for (const role of [AppRole.Officer, AppRole.SrOfficer, AppRole.Manager, AppRole.Admin]) {
            const call = () => guard.canActivate(ctx(Cls, handler, fakeUser({ appRole: role })));
            if (role < required) expect(call).toThrow(ForbiddenException);
            else expect(call()).toBe(true);
          }
        });
      }
    });
  }
});

describe('Swagger / route ของ controller WFE', () => {
  it('ทุก handler มี @ApiOperation(summary ภาษาไทย) และ route ขึ้นต้น wfe/', () => {
    for (const Cls of CONTROLLERS) {
      expect(Reflect.getMetadata(PATH_METADATA, Cls) as string).toMatch(/^wfe\//);
      for (const handler of Object.keys(MATRIX[Cls.name])) {
        const op = Reflect.getMetadata(SWAGGER_API_OPERATION, Cls.prototype[handler] as object) as
          { summary?: string } | undefined;
        expect(op?.summary).toMatch(/[฀-๿]/); // มีอักษรไทย
        expect(
          Reflect.getMetadata(METHOD_METADATA, Cls.prototype[handler] as object),
        ).toBeDefined();
      }
    }
  });

  it('ไม่มี endpoint ที่เป็น @Public (ทุกอันต้อง login)', () => {
    for (const Cls of CONTROLLERS)
      for (const handler of Object.keys(MATRIX[Cls.name]))
        expect(Reflect.getMetadata('isPublic', Cls.prototype[handler] as object)).toBeUndefined();
  });

  it('การกระทำที่เปลี่ยนสถานะใช้ POST, อ่านใช้ GET, ลบใช้ DELETE', () => {
    const verb = (Cls: Ctor, h: string) =>
      Reflect.getMetadata(METHOD_METADATA, Cls.prototype[h] as object) as RequestMethod;
    expect(verb(WorkflowTemplatesController as never, 'approve')).toBe(RequestMethod.POST);
    expect(verb(WorkflowTemplatesController as never, 'validate')).toBe(RequestMethod.GET);
    expect(verb(WorkflowTemplatesController as never, 'remove')).toBe(RequestMethod.DELETE);
    expect(verb(WorkflowInstancesController as never, 'remove')).toBe(RequestMethod.DELETE);
    expect(verb(WorkflowTasksController as never, 'mine')).toBe(RequestMethod.GET);
  });
});
