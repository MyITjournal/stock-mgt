import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { UsersModule } from '../users/users.module';
import { StaffModule } from '../staff/staff.module';
import { env } from '../../config/env';

@Module({
  imports: [
    UsersModule,
    // For WorkingHoursService: a session is refused outside opening hours, and
    // both issuing and renewing one go through here.
    StaffModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: {
        expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy, GoogleStrategy],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
