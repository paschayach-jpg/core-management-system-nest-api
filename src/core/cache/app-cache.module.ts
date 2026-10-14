import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config';

/** cache ในหน่วยความจำ (ค่าเริ่มต้น) — ถ้าเปิดหลาย instance ให้เปลี่ยน store เป็น Redis ที่นี่จุดเดียว (ดู docs/RECOMMENDATIONS.md) */
@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({ ttl: cfg.get('CACHE_TTL_SEC') * 1000, max: 5000 }),
    }),
  ],
  exports: [CacheModule],
})
export class AppCacheModule {}
