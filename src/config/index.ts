// หมายเหตุ: ไม่ export app-config.module ที่นี่ เพราะ ConfigModule.forRoot() ตรวจ env ทันทีที่ import (เทสต์จะล้ม)
// → app.module.ts import './config/app-config.module' ตรงๆ
export * from './app-config.service';
export * from './env.schema';
