import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import type { DbTarget, SpOptions } from './sp/sp-executor.service';

export interface TransactionScope {
  queryRunner: QueryRunner;
  manager: EntityManager;
  /** ใส่เป็น options ของ SpExecutor เพื่อให้ SP รันใน transaction นี้ */
  sp: SpOptions;
}

export type IsolationLevel =
  'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

/**
 * รันงานเป็น transaction เดียว (เทียบได้กับ TransactionScope / SqlTransaction ใน .NET)
 *
 * ```ts
 * await this.tx.run(async ({ manager, sp }) => {
 *   await manager.insert(Folder, {...});
 *   await this.sp.exec(Sp.EMS.insertNotification, {...}, sp);
 * });
 * ```
 * commit เมื่อ callback สำเร็จ, rollback เมื่อ throw
 */
@Injectable()
export class TransactionRunner {
  constructor(
    @InjectDataSource() private readonly mainDs: DataSource,
    @InjectDataSource('project') private readonly projectDs: DataSource,
  ) {}

  async run<T>(
    work: (scope: TransactionScope) => Promise<T>,
    options: { target?: DbTarget; isolation?: IsolationLevel } = {},
  ): Promise<T> {
    const ds = options.target === 'project' ? this.projectDs : this.mainDs;
    const queryRunner = ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction(options.isolation);
    try {
      const result = await work({
        queryRunner,
        manager: queryRunner.manager,
        sp: { queryRunner, target: options.target },
      });
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // ไม่ให้ error ของ rollback บัง error ต้นเหตุ
        }
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
