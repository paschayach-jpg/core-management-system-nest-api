import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../../common/decorators/auth.decorators';
import { ApiPaginatedResponse } from '../../../common/dto/paginated-response';
import { Paginated } from '../../../common/dto/pagination.dto';
import type { UserContext } from '../../../common/interfaces/user-context';
import { KMS_ROLE } from '../kms.constants';
import { ArticleMoveService } from './article-move.service';
import {
  MoveCandidateDto,
  MoveCandidatesQueryDto,
  MovePreviewDto,
  MovePreviewRequestDto,
  MoveRequestDto,
  MoveResultDto,
} from './dto/move.dto';

/** ย้ายบทความข้ามหมวด — path อยู่ใต้ /kms/article-moves เพื่อไม่ชนกับ /kms/articles/:id */
@ApiTags('KMS')
@ApiBearerAuth()
@Controller('kms/article-moves')
export class ArticleMoveController {
  constructor(private readonly service: ArticleMoveService) {}

  @Get('candidates')
  @MinRole(KMS_ROLE.move)
  @ApiOperation({
    summary: 'บทความในหมวดต้นทาง (รวมหมวดย่อย) ที่เลือกย้ายได้ — แบ่งหน้า · Manager ขึ้นไป',
  })
  @ApiPaginatedResponse(MoveCandidateDto)
  candidates(@Query() q: MoveCandidatesQueryDto): Promise<Paginated<MoveCandidateDto>> {
    return this.service.candidates(q);
  }

  @Post('preview')
  @MinRole(KMS_ROLE.move)
  @ApiOperation({
    summary: 'ตรวจก่อนย้าย: จำนวนที่จะย้าย + คำเตือน (ยังไม่เขียน DB) — Manager ขึ้นไป',
  })
  @ApiOkResponse({ type: MovePreviewDto })
  preview(@Body() dto: MovePreviewRequestDto): Promise<MovePreviewDto> {
    return this.service.preview(dto.articleIds, dto.toCategoryId);
  }

  @Post()
  @MinRole(KMS_ROLE.move)
  @ApiOperation({
    summary:
      'ย้ายบทความไปหมวดอื่น (เปลี่ยนเฉพาะ CategoryID ไม่สร้าง version) — Manager ขึ้นไป · มีคำเตือนต้องส่ง confirmWarnings=true ไม่งั้น 409',
  })
  @ApiOkResponse({ type: MoveResultDto })
  move(@Body() dto: MoveRequestDto, @CurrentUser() user: UserContext): Promise<MoveResultDto> {
    return this.service.move(dto, user);
  }
}
