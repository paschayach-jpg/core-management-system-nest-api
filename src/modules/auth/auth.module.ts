import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MinRoleGuard } from '../../common/guards/min-role.guard';
import { AppConfigService } from '../../config';
import { UserAccount } from '../shared/entities/user-account.entity';
import { AuthController } from './auth.controller';
import { AdAuthClient } from './clients/ad-auth.client';
import { AuthService } from './services/auth.service';
import { UserContextService } from './services/user-context.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    HttpModule,
    PassportModule,
    TypeOrmModule.forFeature([UserAccount]),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        secret: cfg.get('JWT_SECRET'),
        signOptions: {
          expiresIn: cfg.get('JWT_EXPIRES_IN') as never,
          issuer: cfg.get('JWT_ISSUER'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserContextService,
    AdAuthClient,
    JwtStrategy,
    // guard ทั้งแอป: ทุก endpoint ต้อง login (ยกเว้น @Public) แล้วค่อยตรวจ @MinRole
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MinRoleGuard },
  ],
  exports: [UserContextService],
})
export class AuthModule {}
