import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import { ILike } from 'typeorm';
import { CrudLoggedService } from '../../core/crud-log/crud-logged.service';
import type { CrudLogService } from '../../core/crud-log/crud-log.service';
import type { Paginated, PaginationQueryDto } from '../dto/pagination.dto';
import { paginated } from '../dto/pagination.dto';
import {
  ConflictBusinessException,
  ResourceNotFoundException,
} from '../exceptions/business.exception';

export interface EntityCrudOptions<E> {
  /** ชื่อที่ใช้ในข้อความ error และ log */
  entityName: string;
  /** property (camelCase) ของ primary key */
  idProperty: keyof E & string;
  /** property ที่ ?q= ค้นแบบ contains */
  searchProperties?: (keyof E & string)[];
  /** property ที่อนุญาตให้ ?sortBy= */
  sortable?: (keyof E & string)[];
  defaultSort?: { property: keyof E & string; dir?: 'asc' | 'desc' };
  /** property ที่ห้ามแก้ผ่าน update (เช่น id, createdBy, createdDate) */
  immutable?: (keyof E & string)[];
}

/**
 * CRUD มาตรฐานบน TypeORM Repository พร้อม CRUD-log (ก่อน/หลังแก้ไขถูกเก็บให้) — ใช้กับตาราง master/lookup ที่ไม่มีกฎธุรกิจพิเศษ
 * ตารางที่มีกฎซับซ้อนให้เขียน service เอง (extend CrudLoggedService) แล้วเรียก Stored Procedure
 */
export abstract class EntityCrudService<E extends ObjectLiteral> extends CrudLoggedService {
  constructor(
    crudLog: CrudLogService,
    protected readonly repo: Repository<E>,
    protected readonly opts: EntityCrudOptions<E>,
  ) {
    super(crudLog);
  }

  async list(query: PaginationQueryDto, where: FindOptionsWhere<E> = {}): Promise<Paginated<E>> {
    const search = query.q?.trim();
    const props = this.opts.searchProperties ?? [];
    // OR ระหว่างคอลัมน์ค้นหา, AND กับเงื่อนไข where เดิม
    const wheres: FindOptionsWhere<E>[] =
      search && props.length > 0
        ? props.map((p) => ({ ...where, [p]: ILike(`%${search}%`) }) as FindOptionsWhere<E>)
        : [where];

    const sortProp =
      query.sortBy && this.opts.sortable?.includes(query.sortBy as keyof E & string)
        ? (query.sortBy as keyof E & string)
        : (this.opts.defaultSort?.property ?? this.opts.idProperty);
    const dir = query.sortBy ? query.sortDir : (this.opts.defaultSort?.dir ?? 'asc');

    const [items, total] = await this.repo.findAndCount({
      where: wheres,
      order: { [sortProp]: dir === 'desc' ? 'DESC' : 'ASC' } as never,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return paginated(items, total, query);
  }

  async get(id: number | string): Promise<E> {
    const found = await this.repo.findOneBy({ [this.opts.idProperty]: id } as FindOptionsWhere<E>);
    if (!found) throw new ResourceNotFoundException(this.opts.entityName, id);
    return found;
  }

  create(input: DeepPartial<E>): Promise<E> {
    return this.logged(
      { action: 'CREATE', entity: this.opts.entityName },
      async () => {
        const saved = await this.repo.save(this.repo.create(input));
        return saved as E;
      },
      (r) => ({ recordId: r[this.opts.idProperty] as string | number, after: r }),
    );
  }

  update(id: number | string, patch: DeepPartial<E>): Promise<E> {
    return this.logged(
      {
        action: 'UPDATE',
        entity: this.opts.entityName,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        const current = await this.get(id);
        const safe: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
        for (const p of [this.opts.idProperty, ...(this.opts.immutable ?? [])]) delete safe[p];
        Object.assign(current, safe);
        return (await this.repo.save(current)) as E;
      },
      (r) => ({ after: r }),
    );
  }

  /** ลบจริง — ตารางที่ต้อง soft delete ให้ override */
  remove(id: number | string): Promise<void> {
    return this.logged(
      {
        action: 'DELETE',
        entity: this.opts.entityName,
        recordId: id,
        captureBefore: () => this.get(id),
      },
      async () => {
        const current = await this.get(id);
        try {
          await this.repo.remove(current);
        } catch (err) {
          // FK ชน = ถูกอ้างอิงอยู่ → 409 แทน 500
          if ((err as { driverError?: { number?: number } }).driverError?.number === 547) {
            throw new ConflictBusinessException(
              `ลบ ${this.opts.entityName} ไม่ได้ เพราะถูกใช้งานอยู่`,
              'IN_USE',
            );
          }
          throw err;
        }
      },
    );
  }
}
