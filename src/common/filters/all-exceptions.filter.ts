import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsServiceManager } from 'nestjs-cls';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { SpExecutionError } from '../../database/sp/sp-execution.error';
import { BusinessException } from '../exceptions/business.exception';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  /** รายละเอียดเพิ่มเติม เช่น รายการ field ที่ validate ไม่ผ่าน */
  details?: unknown;
  requestId?: string;
  path: string;
  timestamp: string;
}

interface Mapped {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** เลข error ของ SQL Server ที่พบบ่อย */
const SQL_UNIQUE = [2601, 2627];
const SQL_FK = 547;
const SQL_DEADLOCK = 1205;
const SQL_TIMEOUT = -2;

/**
 * แปลงทุก exception เป็นรูปแบบ error เดียวกัน (เหมือน middleware จัดการ exception กลางใน ASP.NET)
 *  - 4xx: บอกเหตุผลให้ client
 *  - 5xx: log stack เต็มฝั่ง server, ตอบข้อความทั่วไป (ไม่รั่วรายละเอียดภายใน)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    const mapped = this.map(exception);
    const requestId = ClsServiceManager.getClsService().getId() as string | undefined;

    if (mapped.status >= 500) {
      const err = exception as Error;
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${mapped.status} ${mapped.code}: ${err?.message ?? String(exception)}`,
        err?.stack,
      );
    } else if (mapped.status !== 404 && mapped.status !== 401) {
      this.logger.warn(
        `${req.method} ${req.originalUrl} → ${mapped.status} ${mapped.code}: ${mapped.message}`,
      );
    }

    const body: ErrorBody = {
      statusCode: mapped.status,
      code: mapped.code,
      message: mapped.message,
      details: mapped.details,
      requestId,
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    };
    if (res.headersSent) return;
    res.status(mapped.status).json(body);
  }

  private map(ex: unknown): Mapped {
    if (ex instanceof BusinessException) {
      const r = ex.getResponse() as { message: string; code: string; details?: unknown };
      return { status: ex.getStatus(), code: r.code, message: r.message, details: r.details };
    }

    if (ex instanceof HttpException) {
      const status = ex.getStatus();
      const r = ex.getResponse();
      if (typeof r === 'string') return { status, code: httpCode(status), message: r };
      const obj = r as { message?: string | string[]; error?: string; code?: string };
      if (Array.isArray(obj.message)) {
        // ValidationPipe: message เป็นรายการข้อความของแต่ละ field
        return {
          status,
          code: 'VALIDATION_FAILED',
          message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
          details: obj.message,
        };
      }
      return {
        status,
        code: obj.code ?? httpCode(status),
        message: obj.message ?? obj.error ?? ex.message,
      };
    }

    if (ex instanceof SpExecutionError)
      return this.mapSql(ex.sqlNumber, ex.message, ex.isUserRaised);

    if (ex instanceof QueryFailedError) {
      const driver = ex.driverError as { number?: number; message?: string } | undefined;
      return this.mapSql(
        driver?.number,
        driver?.message ?? ex.message,
        (driver?.number ?? 0) >= 50000,
      );
    }

    if (ex instanceof EntityNotFoundError) {
      return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'ไม่พบข้อมูลที่ต้องการ' };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'เกิดข้อผิดพลาดภายในระบบ',
    };
  }

  private mapSql(num: number | undefined, message: string, userRaised: boolean): Mapped {
    if (userRaised) {
      // RAISERROR/THROW ใน SP ที่ตั้งใจส่งข้อความถึงผู้ใช้ (เช่น 'รหัสหน่วยงาน X มีอยู่ในระบบแล้ว')
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: 'DB_BUSINESS_RULE', message };
    }
    if (num !== undefined && SQL_UNIQUE.includes(num)) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'DUPLICATE',
        message: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว',
      };
    }
    if (num === SQL_FK) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'REFERENCE_CONFLICT',
        message: 'ข้อมูลถูกอ้างอิงอยู่ หรืออ้างอิงข้อมูลที่ไม่มีอยู่',
      };
    }
    if (num === SQL_DEADLOCK) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'DB_DEADLOCK',
        message: 'ระบบไม่ว่างชั่วคราว กรุณาลองใหม่',
      };
    }
    if (num === SQL_TIMEOUT) {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        code: 'DB_TIMEOUT',
        message: 'ฐานข้อมูลตอบสนองช้าเกินกำหนด',
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'DB_ERROR',
      message: 'เกิดข้อผิดพลาดของฐานข้อมูล',
    };
  }
}

function httpCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return `HTTP_${status}`;
  }
}
