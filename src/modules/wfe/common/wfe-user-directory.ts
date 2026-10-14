import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { camelizeKeys } from '../../../common/utils/camelize';

export interface DirectoryUser {
  userId: number;
  adUserName: string;
  displayName: string;
  isActive: boolean;
  appRole: number;
}

const CHUNK = 500;

/**
 * ค้นผู้ใช้ตามชื่อผู้ใช้ AD (EMS.UserAccount) แบบอ่านอย่างเดียว
 * — step instance / delegation เก็บผู้รับผิดชอบเป็นสตริง ADUserName แต่ NotificationsService ต้องการ UserID
 * และการมอบหมายงานต้องตรวจว่าผู้รับมีบัญชีที่ใช้งานอยู่ (ดู docs/modules/wfe.md ข้อเสนอให้ UsersService มีเมธอดนี้)
 */
@Injectable()
export class WfeUserDirectory {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findByAdUserName(name: string, m?: EntityManager): Promise<DirectoryUser | null> {
    const map = await this.findMany([name], m);
    return map.get(name.trim().toLowerCase()) ?? null;
  }

  /** คืน Map ที่ key = ชื่อผู้ใช้ตัวพิมพ์เล็ก */
  async findMany(names: readonly string[], m?: EntityManager): Promise<Map<string, DirectoryUser>> {
    const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const out = new Map<string, DirectoryUser>();
    const runner = m ?? this.ds.manager;
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const part = wanted.slice(i, i + CHUNK);
      const marks = part.map((_, idx) => `@${idx}`).join(',');
      const rows = (await runner.query(
        `SELECT UserID, ADUserName, DisplayName, IsActive, AppRole
           FROM EMS.UserAccount WHERE ADUserName IN (${marks})`,
        part,
      )) as Record<string, unknown>[];
      for (const r of rows) {
        const u = camelizeKeys<DirectoryUser>(r);
        out.set(String(u.adUserName).trim().toLowerCase(), {
          userId: Number(u.userId),
          adUserName: String(u.adUserName),
          displayName: String(u.displayName ?? u.adUserName),
          isActive: Boolean(u.isActive),
          appRole: Number(u.appRole),
        });
      }
    }
    return out;
  }
}
