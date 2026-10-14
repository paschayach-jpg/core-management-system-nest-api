import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../../config';
import { PermissionsModule } from '../dms/permissions/permissions.module';
import { DmsModule } from '../dms/dms.module';
import { SharedModule } from '../shared/shared.module';
import { ArticleAttachmentsService } from './articles/article-attachments.service';
import { ArticleLinksService } from './articles/article-links.service';
import { ArticleRelationsController } from './articles/article-relations.controller';
import { ArticlesController } from './articles/articles.controller';
import { ArticlesService } from './articles/articles.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import {
  CategoryDisplayController,
  DisplayProfilesController,
} from './display-profiles/display-profiles.controller';
import { DisplayProfilesService } from './display-profiles/display-profiles.service';
import {
  KbArticle,
  KbArticleAttachment,
  KbArticleDisplayProfile,
  KbArticleDisplayProfileColumn,
  KbArticleLink,
  KbCategory,
  KbImportTemplate,
  KbImportTemplateColumn,
  KbVersion,
} from './entities';
import { ImportJobRegistry } from './import/import-job.registry';
import { kmsMulterOptions } from './import/import-upload';
import { ImportsController } from './import/imports.controller';
import { ImportsService } from './import/imports.service';
import { SqlKbImportStore } from './import/kb-import-sql.store';
import { KbImportStore } from './import/kb-import.store';
import { ImportTemplatesController } from './import-templates/import-templates.controller';
import { ImportTemplatesService } from './import-templates/import-templates.service';
import { ArticleMoveController } from './moves/article-move.controller';
import { ArticleMoveService } from './moves/article-move.service';

/**
 * KMS = Knowledge Management System (prefix /kms/...)
 *  หมวด (ต้นไม้ไม่จำกัดความลึก) · บทความ (วงจร Draft→Review→Published→Archived, version, link สองทาง, ไฟล์แนบ) · ย้ายบทความ ·
 *  Display Profile · Import Template · Excel Import (งานเบื้องหลัง) · Dashboard
 *
 * ไฟล์แนบเข้า DMS ผ่านพอร์ต DMS_FILE_PORT เท่านั้น (inject แบบ @Optional — ถ้า DMS ยังไม่มี provider จุดใช้งานตอบ 503 DMS_UNAVAILABLE)
 * ตั้งค่า multer (เขียนลงดิสก์, ขนาดตาม STORAGE_MAX_UPLOAD_MB) ที่นี่ที่เดียวสำหรับทุก endpoint อัปโหลดของ KMS
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KbCategory,
      KbArticle,
      KbVersion,
      KbArticleLink,
      KbArticleAttachment,
      KbArticleDisplayProfile,
      KbArticleDisplayProfileColumn,
      KbImportTemplate,
      KbImportTemplateColumn,
    ]),
    SharedModule,
    PermissionsModule,
    DmsModule,
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => kmsMulterOptions(cfg.get('STORAGE_MAX_UPLOAD_MB')),
    }),
  ],
  controllers: [
    CategoriesController,
    ArticlesController,
    ArticleRelationsController,
    ArticleMoveController,
    DisplayProfilesController,
    CategoryDisplayController,
    ImportTemplatesController,
    ImportsController,
    DashboardController,
  ],
  providers: [
    CategoriesService,
    ArticlesService,
    ArticleLinksService,
    ArticleAttachmentsService,
    ArticleMoveService,
    DisplayProfilesService,
    ImportTemplatesService,
    ImportsService,
    DashboardService,
    ImportJobRegistry,
    { provide: KbImportStore, useClass: SqlKbImportStore },
  ],
  // RGP/โมดูลอื่นที่ต้องอ่านหมวดกฎหมาย (เดิม KmsRepository.GetLawTypes/GetCategoriesByParent) ใช้ผ่าน CategoriesService
  exports: [CategoriesService, ArticlesService],
})
export class KmsModule {}
