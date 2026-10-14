import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppRole } from '../../../common/constants/enums';
import { MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import { Paginated, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { HrDepartment } from '../entities/hr-department.entity';
import { HrDivision } from '../entities/hr-division.entity';
import { HrPositionLevel } from '../entities/hr-position-level.entity';
import { HrPositionMapping } from '../entities/hr-position-mapping.entity';
import { HrPosition } from '../entities/hr-position.entity';
import {
  CreateDepartmentDto,
  CreateDivisionDto,
  CreatePositionDto,
  CreatePositionLevelDto,
  CreatePositionMappingDto,
  PositionMappingViewDto,
  UpdateDepartmentDto,
  UpdateDivisionDto,
  UpdatePositionDto,
  UpdatePositionLevelDto,
  UpdatePositionMappingDto,
} from './dto/hr-masters.dto';
import {
  HrDepartmentsService,
  HrDivisionsService,
  HrPositionLevelsService,
  HrPositionMappingsService,
  HrPositionsService,
} from './hr-masters.services';

// ข้อมูลหลักองค์กร (HR master): อ่านได้ทุกคนที่ login · เขียน/ลบ = Admin

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('hr/divisions')
export class HrDivisionsController {
  constructor(private readonly service: HrDivisionsService) {}

  @Get()
  @ApiOperation({ summary: 'ฝ่าย (ค้นด้วย q, แบ่งหน้า)' })
  @ApiPaginatedResponse(HrDivision)
  list(@Query() q: PaginationQueryDto): Promise<Paginated<HrDivision>> {
    return this.service.list(q);
  }
  @Get(':id')
  @ApiOperation({ summary: 'ดูรายละเอียดฝ่าย' })
  get(@Param('id', ParseIntPipe) id: number): Promise<HrDivision> {
    return this.service.get(id);
  }
  @Post()
  @ApiOperation({ summary: 'สร้างฝ่าย — Admin' })
  @MinRole(AppRole.Admin)
  create(@Body() dto: CreateDivisionDto): Promise<HrDivision> {
    return this.service.create(dto);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขฝ่าย — Admin' })
  @MinRole(AppRole.Admin)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDivisionDto,
  ): Promise<HrDivision> {
    return this.service.update(id, dto);
  }
  @Delete(':id')
  @ApiOperation({ summary: 'ลบฝ่าย — Admin' })
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }
}

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('hr/departments')
export class HrDepartmentsController {
  constructor(private readonly service: HrDepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'แผนก (ค้นด้วย q, แบ่งหน้า)' })
  @ApiPaginatedResponse(HrDepartment)
  list(@Query() q: PaginationQueryDto): Promise<Paginated<HrDepartment>> {
    return this.service.list(q);
  }
  @Get(':id')
  @ApiOperation({ summary: 'ดูรายละเอียดแผนก' })
  get(@Param('id', ParseIntPipe) id: number): Promise<HrDepartment> {
    return this.service.get(id);
  }
  @Post()
  @ApiOperation({ summary: 'สร้างแผนก — Admin' })
  @MinRole(AppRole.Admin)
  create(@Body() dto: CreateDepartmentDto): Promise<HrDepartment> {
    return this.service.create(dto);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขแผนก — Admin' })
  @MinRole(AppRole.Admin)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
  ): Promise<HrDepartment> {
    return this.service.update(id, dto);
  }
  @Delete(':id')
  @ApiOperation({ summary: 'ลบแผนก — Admin' })
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }
}

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('hr/positions')
export class HrPositionsController {
  constructor(private readonly service: HrPositionsService) {}

  @Get()
  @ApiOperation({ summary: 'ตำแหน่งงาน (EMS.m_Role)' })
  @ApiPaginatedResponse(HrPosition)
  list(@Query() q: PaginationQueryDto): Promise<Paginated<HrPosition>> {
    return this.service.list(q);
  }
  @Get(':id')
  @ApiOperation({ summary: 'ดูรายละเอียดตำแหน่งงาน' })
  get(@Param('id', ParseIntPipe) id: number): Promise<HrPosition> {
    return this.service.get(id);
  }
  @Post()
  @ApiOperation({ summary: 'สร้างตำแหน่งงาน — Admin' })
  @MinRole(AppRole.Admin)
  create(@Body() dto: CreatePositionDto): Promise<HrPosition> {
    return this.service.create(dto);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขตำแหน่งงาน — Admin' })
  @MinRole(AppRole.Admin)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePositionDto,
  ): Promise<HrPosition> {
    return this.service.update(id, dto);
  }
  @Delete(':id')
  @ApiOperation({ summary: 'ลบตำแหน่งงาน — Admin' })
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }
}

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('hr/position-levels')
export class HrPositionLevelsController {
  constructor(private readonly service: HrPositionLevelsService) {}

  @Get()
  @ApiOperation({ summary: 'ระดับตำแหน่ง (EMS.m_Position)' })
  @ApiPaginatedResponse(HrPositionLevel)
  list(@Query() q: PaginationQueryDto): Promise<Paginated<HrPositionLevel>> {
    return this.service.list(q);
  }
  @Get(':levelCode')
  @ApiOperation({ summary: 'ดูรายละเอียดระดับตำแหน่ง' })
  get(@Param('levelCode') levelCode: string): Promise<HrPositionLevel> {
    return this.service.get(levelCode);
  }
  @Post()
  @ApiOperation({ summary: 'สร้างระดับตำแหน่ง — Admin' })
  @MinRole(AppRole.Admin)
  create(@Body() dto: CreatePositionLevelDto): Promise<HrPositionLevel> {
    return this.service.create(dto);
  }
  @Patch(':levelCode')
  @ApiOperation({ summary: 'แก้ไขระดับตำแหน่ง — Admin' })
  @MinRole(AppRole.Admin)
  update(
    @Param('levelCode') levelCode: string,
    @Body() dto: UpdatePositionLevelDto,
  ): Promise<HrPositionLevel> {
    return this.service.update(levelCode, dto);
  }
  @Delete(':levelCode')
  @ApiOperation({ summary: 'ลบระดับตำแหน่ง — Admin' })
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('levelCode') levelCode: string): Promise<void> {
    return this.service.remove(levelCode);
  }
}

@ApiTags('Shared')
@ApiBearerAuth()
@Controller('hr/position-mappings')
export class HrPositionMappingsController {
  constructor(private readonly service: HrPositionMappingsService) {}

  @Get()
  @ApiOperation({ summary: 'การผูกตำแหน่งกับฝ่าย/แผนก (พร้อมชื่อ) — กรองด้วย departmentId ได้' })
  @ApiQuery({ name: 'departmentId', required: false, type: Number })
  list(@Query('departmentId') departmentId?: string): Promise<PositionMappingViewDto[]> {
    return this.service.listWithNames(departmentId ? Number(departmentId) : undefined);
  }
  @Post()
  @ApiOperation({ summary: 'สร้างการผูกตำแหน่งกับฝ่าย/แผนก — Admin' })
  @MinRole(AppRole.Admin)
  create(@Body() dto: CreatePositionMappingDto): Promise<HrPositionMapping> {
    return this.service.create(dto);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขการผูกตำแหน่งกับฝ่าย/แผนก — Admin' })
  @MinRole(AppRole.Admin)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePositionMappingDto,
  ): Promise<HrPositionMapping> {
    return this.service.update(id, dto);
  }
  @Delete(':id')
  @ApiOperation({ summary: 'ลบการผูกตำแหน่งกับฝ่าย/แผนก — Admin' })
  @MinRole(AppRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }
}
