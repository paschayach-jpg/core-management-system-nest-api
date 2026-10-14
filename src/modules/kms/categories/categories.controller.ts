import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import { KMS_ROLE } from '../kms.constants';
import { CategoriesService } from './categories.service';
import {
  CategoryListQueryDto,
  CategorySummaryDto,
  CategoryTitleDto,
  CategoryTitlesQueryDto,
  CreateCategoryDto,
  KbCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/categories')
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary:
      'หมวดหมู่ความรู้ทั้งหมดเรียงตามต้นไม้ (ลึกกี่ชั้นก็ได้) พร้อม depth และ path — กรอง activeOnly / parentId / rootsOnly ได้',
  })
  @ApiOkResponse({ type: [KbCategoryDto] })
  list(@Query() q: CategoryListQueryDto): Promise<KbCategoryDto[]> {
    return this.service.list(q);
  }

  @Get('summary')
  @ApiOperation({ summary: 'จำนวนบทความต่อหมวด (หมวดเอง + รวมหมวดย่อย) สำหรับวาด KB tree' })
  @ApiOkResponse({ type: [CategorySummaryDto] })
  summary(): Promise<CategorySummaryDto[]> {
    return this.service.summary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดหมวด' })
  @ApiOkResponse({ type: KbCategoryDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<KbCategoryDto> {
    return this.service.get(id);
  }

  @Get(':id/titles')
  @ApiOperation({
    summary: 'Title ที่ไม่ซ้ำในหมวด (ใบของ KB tree) พร้อมจำนวนบทความ — แบ่งหน้า, ค้นด้วย q',
  })
  @ApiPaginatedResponse(CategoryTitleDto)
  titles(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: CategoryTitlesQueryDto,
  ): Promise<Paginated<CategoryTitleDto>> {
    return this.service.titles(id, q);
  }

  @Post()
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({
    summary:
      'สร้างหมวด — Manager ขึ้นไป · รหัสหมวดห้ามซ้ำ · รหัสประเภทเอกสาร (1-9) ห้ามซ้ำและห้ามอยู่ใต้ LW · CategoryID ออกเลขตามชนิดคอลัมน์จริง (IDENTITY หรือ MAX+1)',
  })
  @ApiOkResponse({ type: KbCategoryDto })
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: UserContext): Promise<KbCategoryDto> {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({
    summary:
      'แก้หมวด (ย้ายหมวดแม่ได้ แต่ห้ามเป็นตัวเอง/หมวดย่อยของตัวเอง) — Manager ขึ้นไป · Display Profile ไม่แก้ที่นี่',
  })
  @ApiOkResponse({ type: KbCategoryDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: UserContext,
  ): Promise<KbCategoryDto> {
    return this.service.update(id, dto, user);
  }

  @Post(':id/deactivate')
  @MinRole(KMS_ROLE.masterWrite)
  @ApiOperation({ summary: 'ปิดใช้งานหมวด (IsActive = 0, ไม่ลบแถว) — Manager ขึ้นไป' })
  @ApiOkResponse({ type: KbCategoryDto })
  deactivate(@Param('id', ParseIntPipe) id: number): Promise<KbCategoryDto> {
    return this.service.deactivate(id);
  }
}
