import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import type { UserContext } from '../../common/interfaces/user-context';
import {
  AuthTokenResponseDto,
  ConsentDto,
  ExchangeTokenDto,
  LoginDto,
  UserProfileDto,
} from './dto/auth.dto';
import { AuthService } from './services/auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // กัน brute force
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'เข้าสู่ระบบด้วยบัญชี AD (ส่งต่อไป AD Auth API)' })
  @ApiOkResponse({ type: AuthTokenResponseDto })
  login(@Body() dto: LoginDto): Promise<AuthTokenResponseDto> {
    return this.auth.login(dto.username, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'แลก access token ของ AD Auth API เป็น JWT ของ API นี้ (SSO)' })
  @ApiOkResponse({ type: AuthTokenResponseDto })
  exchange(@Body() dto: ExchangeTokenDto): Promise<AuthTokenResponseDto> {
    return this.auth.exchange(dto.accessToken);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'ข้อมูลผู้ใช้ปัจจุบันและสิทธิ์ตามชั้นความลับ' })
  @ApiOkResponse({ type: UserProfileDto })
  me(@CurrentUser() user: UserContext): Promise<UserProfileDto> {
    return this.auth.profile(user.userId);
  }

  @ApiBearerAuth()
  @Post('consent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'บันทึก/เพิกถอนความยินยอม PDPA' })
  @ApiOkResponse({ type: UserProfileDto })
  consent(@CurrentUser() user: UserContext, @Body() dto: ConsentDto): Promise<UserProfileDto> {
    return this.auth.setConsent(user, dto.consentGiven, dto.email);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'บันทึกการออกจากระบบ (JWT เป็น stateless — client ทิ้ง token เอง)' })
  logout(@CurrentUser() user: UserContext): void {
    this.auth.logout(user);
  }
}
