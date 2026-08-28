import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthProvider,
  MembershipStatus,
  OrgRole,
  UserRole,
} from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService, EMAIL_ALREADY_EXISTS } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { TokenContext, TokenPair, TokenService } from './token.service';
import { env } from '../../config/env';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

/** Six digits, uniformly distributed. */
function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${crypto.randomBytes(3).toString('hex')}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
  ) {}

  /**
   * Creates the user, their business and their `owner` membership atomically.
   *
   * The three rows are written in one transaction rather than through
   * `UsersService.createEmailUser`, because a user created without an
   * organization would be unable to log in and unable to register again.
   * The duplicate-email semantics of that method are preserved below.
   */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.users.findByEmail(email);

    if (existing) {
      throw new ConflictException(
        existing.isVerified
          ? {
              error: EMAIL_ALREADY_EXISTS,
              message: 'An account with this email already exists.',
            }
          : {
              error: 'PENDING_VERIFICATION',
              message:
                'This email is registered and awaiting verification. Request a new code.',
            },
      );
    }

    const code = generateOtp();
    const [passwordHash, otpHash] = await Promise.all([
      argon2.hash(dto.password),
      argon2.hash(code),
    ]);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          authProvider: AuthProvider.email,
          role: UserRole.user,
          isVerified: false,
          otpHash,
          otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          slug: slugify(dto.organizationName),
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrgRole.owner,
          status: MembershipStatus.active,
        },
      });

      return { user, organization };
    });

    await this.mail.sendVerificationOtp(email, code);

    return {
      message: 'Account created. Check your email for a verification code.',
      userId: result.user.id,
      organizationId: result.organization.id,
      organizationSlug: result.organization.slug,
    };
  }

  async verifyOtp(email: string, code: string, context: TokenContext = {}) {
    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) throw new UnauthorizedException('Invalid code');
    if (user.isVerified)
      throw new BadRequestException('Email already verified');

    if (!(await this.otpMatches(user.id, code))) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.users.clearOtp(user.id);
    return this.issueForUser(user.id, context);
  }

  async resendOtp(email: string) {
    const user = await this.users.findByEmail(email.toLowerCase());

    // Always report success — otherwise this endpoint enumerates accounts.
    if (!user || user.isVerified) {
      return { message: 'If that account exists, a new code has been sent.' };
    }

    const code = generateOtp();
    await this.users.storeOtpHash(
      user.id,
      await argon2.hash(code),
      new Date(Date.now() + OTP_TTL_MS),
    );
    await this.mail.sendVerificationOtp(user.email, code);

    return { message: 'If that account exists, a new code has been sent.' };
  }

  async login(dto: LoginDto, context: TokenContext = {}): Promise<TokenPair> {
    const user = await this.users.findByEmail(dto.email.toLowerCase());
    if (!user?.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!(await argon2.verify(user.password, dto.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isVerified) {
      throw new ForbiddenException({
        error: 'PENDING_VERIFICATION',
        message: 'Verify your email before signing in.',
      });
    }

    if (context.ip) await this.users.updateLastLoginIp(user.id, context.ip);
    return this.issueForUser(user.id, context);
  }

  refresh(rawToken: string, context: TokenContext = {}): Promise<TokenPair> {
    return this.tokens.rotate(rawToken, context);
  }

  async logout(rawToken: string | undefined): Promise<{ message: string }> {
    if (rawToken) await this.tokens.revokeByToken(rawToken);
    return { message: 'Signed out.' };
  }

  /** Re-issues tokens against a different organization the user belongs to. */
  async switchOrganization(
    userId: string,
    organizationId: string,
    context: TokenContext = {},
  ): Promise<TokenPair> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId, status: MembershipStatus.active },
      include: { user: true },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of that organization');
    }

    return this.tokens.issuePair(
      {
        sub: membership.userId,
        email: membership.user.email,
        organizationId: membership.organizationId,
        orgRole: membership.role,
      },
      context,
    );
  }

  async forgotPassword(email: string) {
    const user = await this.users.findByEmail(email.toLowerCase());
    const response = {
      message: 'If that account exists, a reset link has been sent.',
    };
    if (!user) return response;

    await this.users.invalidateAllByUserId(user.id);

    const selector = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('hex');
    await this.users.setPasswordResetToken(
      user.id,
      selector,
      await argon2.hash(verifier),
      new Date(Date.now() + RESET_TTL_MS),
    );

    const base = env.FRONTEND_URL ?? env.APP_URL ?? '';
    await this.mail.sendPasswordReset(
      user.email,
      `${base}/reset-password?token=${selector}.${verifier}`,
    );

    return response;
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const [selector, verifier] = rawToken.split('.');
    if (!selector || !verifier) {
      throw new BadRequestException('Malformed reset token');
    }

    const found = await this.users.findByValidResetToken(selector);
    if (!found)
      throw new UnauthorizedException('Invalid or expired reset token');

    if (!(await argon2.verify(found.resetPassword.tokenHash, verifier))) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    await this.users.updatePassword(found.user.id, newPassword);
    await this.users.markPasswordResetAsUsed(found.resetPassword.id);

    // A password change invalidates every existing session.
    await this.tokens.revokeAllForUser(found.user.id);

    return { message: 'Password updated. Sign in with your new password.' };
  }

  /**
   * Google sign-in. A first-time Google user gets an organization named after
   * them, matching what email registration does.
   */
  async googleLogin(
    profile: { email: string; firstName: string; lastName: string },
    context: TokenContext = {},
  ): Promise<TokenPair> {
    const email = profile.email.toLowerCase();
    let user = await this.users.findByEmail(email);

    if (!user) {
      user = await this.users.createGoogleUser({
        email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        isVerified: true,
        onboardingComplete: false,
      });
    } else if (user.authProvider !== AuthProvider.google) {
      await this.users.linkGoogleAccount(user.id);
    }

    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id, status: MembershipStatus.active },
    });

    if (!membership) {
      const name = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(' ');
      const organization = await this.prisma.organization.create({
        data: {
          name: `${name || email}'s business`,
          slug: slugify(name || email),
        },
      });
      await this.prisma.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrgRole.owner,
          status: MembershipStatus.active,
        },
      });
    }

    if (context.ip) await this.users.updateLastLoginIp(user.id, context.ip);
    this.users.logOAuthLogin(user.id, context.ip ?? 'unknown', 'google');

    return this.issueForUser(user.id, context);
  }

  /** Picks the organization to sign into: owner memberships win, then oldest. */
  private async issueForUser(
    userId: string,
    context: TokenContext,
  ): Promise<TokenPair> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: MembershipStatus.active },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException('You do not belong to any organization');
    }

    const active =
      memberships.find((m) => m.role === OrgRole.owner) ?? memberships[0];

    return this.tokens.issuePair(
      {
        sub: active.userId,
        email: active.user.email,
        organizationId: active.organizationId,
        orgRole: active.role,
      },
      context,
    );
  }

  private async otpMatches(userId: string, code: string): Promise<boolean> {
    if (env.OTP_OVERRIDE && code === env.OTP_OVERRIDE) {
      this.logger.warn(`OTP override used for user ${userId}`);
      return true;
    }

    const record = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { otpHash: true, otpExpiresAt: true },
    });

    if (!record?.otpHash || !record.otpExpiresAt) return false;
    if (record.otpExpiresAt < new Date()) return false;

    return argon2.verify(record.otpHash, code);
  }
}
