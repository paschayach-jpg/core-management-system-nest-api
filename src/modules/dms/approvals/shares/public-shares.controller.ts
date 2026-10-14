import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../../../common/decorators/auth.decorators';
import { attachmentDisposition } from '../common/content-disposition';
import { PublicShareAccessDto, PublicShareInfoDto, PublicTokenParamDto } from './dto/shares.dto';
import { PublicShareAccessService } from './public-share-access.service';

/**
 * Endpoint สาธารณะสำหรับผู้ใช้ภายนอกที่ถือลิงก์แชร์ (ไม่ต้อง login) — เหตุผลที่ต้องเป็น @Public():
 * ผู้รับลิงก์ไม่มีบัญชีในระบบ ความปลอดภัยมาจาก token 128 บิต + รหัสผ่านที่เป็นทางเลือก + เพดานจำนวนครั้ง
 * จำกัดความถี่เข้มงวด (10 ครั้ง/นาที/IP) และตอบข้อความเดียวกันทุกกรณีที่เข้าไม่ได้
 *
 * ใช้ POST ทั้งคู่เพื่อไม่ให้รหัสผ่านอยู่ใน URL/access log
 */
@ApiTags('DMS')
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('dms/public/shares')
export class PublicSharesController {
  constructor(private readonly service: PublicShareAccessService) {}

  // security: [{}] = ไม่ต้องส่ง Bearer token (OpenAPI: ว่างหมายถึงเข้าได้โดยไม่ระบุตัวตน)
  @Post(':token/open')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ผู้ใช้ภายนอก: ดูข้อมูลลิงก์แชร์ด้วย token (ไม่ต้อง login; ไม่นับเป็นการดาวน์โหลด)',
    security: [{}],
  })
  @ApiOkResponse({ type: PublicShareInfoDto })
  open(
    @Param() p: PublicTokenParamDto,
    @Body() dto: PublicShareAccessDto,
  ): Promise<PublicShareInfoDto> {
    return this.service.open(p.token, dto);
  }

  @Post(':token/download')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ผู้ใช้ภายนอก: ดาวน์โหลดไฟล์ผ่านลิงก์แชร์ (ไม่ต้อง login; นับจำนวนครั้ง; ลิงก์โฟลเดอร์ระบุ fileId)',
    security: [{}],
  })
  async download(
    @Param() p: PublicTokenParamDto,
    @Body() dto: PublicShareAccessDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const handle = await this.service.download(p.token, dto);
    res.set({
      'Content-Type': handle.mimeType || 'application/octet-stream',
      'Content-Disposition': attachmentDisposition(handle.fileName),
      'Content-Length': String(handle.size),
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(handle.stream);
  }
}
