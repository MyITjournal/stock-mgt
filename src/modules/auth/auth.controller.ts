import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenPair } from './token.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleProfile } from './strategies/google.strategy';
import { env } from '../../config/env';
import { RegisterDto } from './dto/register.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SwitchOrganizationDto } from './dto/switch-organization.dto';
import {
  ChangePasswordDto,
  ChangePasswordResponse,
} from './dto/change-password.dto';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Tokens go out in the JSON body *and* as httpOnly cookies: the body serves
   * Swagger, the Telegram bot and any mobile client; the cookies serve the web
   * dashboard, which should never hold a token in JavaScript-readable storage.
   */
  private respondWithTokens(res: Response, pair: TokenPair): TokenPair {
    const secure = env.NODE_ENV === 'production';
    const domain = env.COOKIE_DOMAIN || undefined;

    res.cookie(ACCESS_COOKIE, pair.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      domain,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie(REFRESH_COOKIE, pair.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      domain,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return pair;
  }

  private static context(req: Request) {
    return {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    };
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an account and its organization' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /**
   * Creating a shop with a username and a password, no email required.
   *
   * Separate from `register` on purpose — that one proves somebody controls an
   * address, and every line of it is about that proof. This one needs no mail
   * provider, which is what lets it work on an instance that has none.
   *
   * Three a minute rather than login's five: a person creates a shop once, and
   * the endpoint writes an organization plus a dozen seeded rows, so it is the
   * cheapest thing here to abuse and the least likely to be repeated honestly.
   */
  @Public()
  @Post('sign-up')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a shop and its owner, with no email' })
  async signUp(
    @Body() dto: SignUpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.auth.signUp(dto, AuthController.context(req));
    return this.respondWithTokens(res, pair);
  }

  @Public()
  @Post('verify-otp')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm the emailed code and sign in' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.auth.verifyOtp(
      dto.email,
      dto.code,
      AuthController.context(req),
    );
    return this.respondWithTokens(res, pair);
  }

  @Public()
  @Post('resend-otp')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a fresh verification code' })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.auth.resendOtp(dto.email);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.auth.login(dto, AuthController.context(req));
    return this.respondWithTokens(res, pair);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  // Higher than login: a legitimate client renews every fifteen minutes, and
  // several devices in one shop share an address until they are signed in.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate a refresh token for a new pair' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;

    const pair = await this.auth.refresh(
      token ?? '',
      AuthController.context(req),
    );
    return this.respondWithTokens(res, pair);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke the refresh token family and clear cookies',
  })
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const result = await this.auth.logout(
      cookies?.[REFRESH_COOKIE] ?? dto.refreshToken,
    );

    res.clearCookie(ACCESS_COOKIE);
    res.clearCookie(REFRESH_COOKIE);
    return result;
  }

  @ApiBearerAuth('JWT')
  @Get('me')
  @ApiOperation({ summary: 'The current user and active organization' })
  me(@CurrentUser() user: unknown) {
    return user;
  }

  @ApiBearerAuth('JWT')
  @Post('switch-organization')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-issue tokens against another organization' })
  async switchOrganization(
    @CurrentUser('sub') userId: string,
    @Body() dto: SwitchOrganizationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.auth.switchOrganization(
      userId,
      dto.organizationId,
      AuthController.context(req),
    );
    return this.respondWithTokens(res, pair);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Email a password reset link' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  /**
   * Changing your own password, which until now was only possible by going
   * round through a reset email. That route is closed entirely on an instance
   * where self-serve signup is off, so this is the only way an owner can
   * change the password they were given at setup.
   */
  @ApiBearerAuth('JWT')
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  // Tighter than login's five: this one is authenticated, so the limiter keys
  // on the person rather than the address, and nobody changes their password
  // three times a minute. It is here because the endpoint verifies an argon2
  // hash, which is deliberately expensive to compute.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Change your own password, knowing the current one',
  })
  @ApiOkResponse({ type: ChangePasswordResponse })
  changePassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  // The token is a 32-hex selector plus a 64-hex verifier, so guessing it is
  // not the threat. The limit is here because every other unauthenticated write
  // has one, and an endpoint that hashes an argon2 verifier on each call is one
  // somebody can make expensive.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Start the Google sign-in flow' })
  googleAuth(): void {
    // The guard redirects to Google; nothing to do here.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google redirects back here' })
  async googleCallback(
    @Req() req: Request & { user?: GoogleProfile },
    @Res({ passthrough: true }) res: Response,
  ) {
    const pair = await this.auth.googleLogin(
      req.user as GoogleProfile,
      AuthController.context(req),
    );
    this.respondWithTokens(res, pair);

    if (env.FRONTEND_URL) {
      res.redirect(`${env.FRONTEND_URL}/auth/callback`);
      return undefined;
    }
    return pair;
  }
}
