import { Module } from '@nestjs/common';
import { PermissionEvaluator } from './permission-evaluator';

/** ตัวประเมินสิทธิ์โฟลเดอร์ — import เข้า module ที่ต้องตรวจสิทธิ์ (DMS, KMS, RGP) */
@Module({ providers: [PermissionEvaluator], exports: [PermissionEvaluator] })
export class PermissionsModule {}
