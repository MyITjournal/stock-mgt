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
  BusinessType,
} from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService, EMAIL_ALREADY_EXISTS } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { defaultPriceTierRows } from '../catalog/price-tier.service';
import { defaultPackagingTypeRows } from '../catalog/packaging-type.service';
import { defaultLocationRow } from '../inventory/location.service';
import { defaultExpenseCategoryRows } from '../expenses/expense-category.service';
import { assertMailAvailable, assertSelfServeSignup } from './self-serve';
import { TokenContext, TokenPair, TokenService } from './token.service';
import {
  HOURS_INCLUDE,
  WorkingHoursService,
} from '../staff/working-hours.service';
import { env } from '../../config/env';
import { RegisterDto } from './dto/register.dto';
import {
  DEFAULT_CURRENCY,
  startingTimezone,
  type SupportedCurrency,
} from '../../common/money/currencies';
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
    private readonly hours: WorkingHoursService,
  ) {}

  /**
   * Creates the user, their business and their `owner` membership atomically.
   *
   * The rows are written in one transaction rather than through
   * `UsersService.createEmailUser`, because a user created without an
   * organization would be unable to log in and unable to register again.
   * The duplicate-email semantics of that method are preserved below.
   */
  async register(dto: RegisterDto) {
    assertSelfServeSignup();
    assertMailAvailable();

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

      await this.seedOrganizationDefaults(
        tx,
        organization.id,
        organization.businessType,
      );

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

  /**
   * Creates a business and its owner, already verified, with no code sent.
   *
   * ## Why this is not `register` with a flag
   *
   * It has no HTTP route and never will. `register` is a public endpoint whose
   * entire job is to prove somebody controls the address they claimed;
   * threading a "skip that" parameter through it would put the bypass one
   * missing check away from being reachable by the people it exists to verify.
   * A separate method with no controller cannot be called over the network at
   * all — the only caller is the CLI, which already has the database.
   *
   * ## Why it deliberately shares `seedOrganizationDefaults`
   *
   * A business set up this way must be indistinguishable from one that
   * registered itself, or the accounts we create by hand are subtly different
   * from the ones we test — missing a price tier, a location, an expense
   * category — and the difference only shows up in front of a customer. That
   * has happened once already: Google sign-up created an organization and
   * stopped, leaving businesses with nowhere to put a price.
   *
   * Takes an email **or** a username, matching staff: an owner in this market
   * may have neither an address nor any use for one.
   */
  async createVerifiedOwner(input: {
    organizationName: string;
    firstName: string;
    lastName: string;
    password: string;
    email?: string;
    username?: string;
    /** Omitted by the paths that never ask — they get `mixed`, today's behaviour. */
    businessType?: BusinessType;
    /** Omitted, naira — every shop before currencies existed. */
    currency?: SupportedCurrency;
    /** The owner's own zone; omitted, the currency's home zone. */
    timezone?: string;
  }) {
    if (!input.email && !input.username) {
      throw new BadRequestException(
        'Give the owner an email or a username — they need something to sign in with.',
      );
    }

    const email = input.email?.toLowerCase() ?? null;
    const slug = slugify(input.organizationName);
    /**
     * An owner's username is **plain**, where a staff username is qualified by
     * the shop's slug (`amina@adebayo-stores-f84554`).
     *
     * The qualification exists because an owner names their own staff and two
     * shops will both have an `amina`; nobody types those usernames by choice,
     * they are handed over. An owner picks their own at sign-up and has to type
     * it from memory every morning, so it is globally unique instead — and they
     * are told at sign-up if the one they wanted is taken, which is the ordinary
     * bargain everywhere else on the internet.
     */
    const username = input.username?.toLowerCase().trim() || null;

    const clash = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(username ? [{ username }] : []),
        ],
      },
      select: { email: true, username: true },
    });
    if (clash) {
      throw new ConflictException(
        clash.email === email
          ? `${email} already has an account.`
          : `The username ${username} is taken.`,
      );
    }

    const passwordHash = await argon2.hash(input.password);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          username,
          password: passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          authProvider: AuthProvider.email,
          role: UserRole.user,
          // Verified on creation, because the verification this skips is
          // "does this person control that address" — and the answer is that
          // we set the account up for them ourselves.
          isVerified: true,
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug,
          ...(input.businessType && { businessType: input.businessType }),
          currency: input.currency ?? DEFAULT_CURRENCY,
          timezone: startingTimezone(
            input.currency ?? DEFAULT_CURRENCY,
            input.timezone,
          ),
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

      await this.seedOrganizationDefaults(
        tx,
        organization.id,
        organization.businessType,
      );

      return {
        userId: user.id,
        email: user.email,
        username: user.username,
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
      };
    });
  }

  /**
   * Creating your own shop, with a username and a password and nothing else.
   *
   * ## Why this is a second entry point rather than a flag on `register`
   *
   * `register` exists to prove somebody controls an address they claimed: it
   * mints a code, sends it, and withholds the account until it comes back.
   * Every line of it is about that proof. Threading "skip the proof" through it
   * would put the bypass one missing check away from the people it exists to
   * verify — and the two paths have genuinely different prerequisites, since
   * this one needs no mail provider at all.
   *
   * ## It shares the whole of `createVerifiedOwner`
   *
   * So a shop somebody makes for themselves is indistinguishable from one made
   * with the CLI, down to the default price tier and the starter locations.
   * That sharing has been paid for once already: Google sign-up used to create
   * an organization and stop, leaving businesses with nowhere to put a price.
   *
   * ## Signed in immediately, and the hours do not stop them
   *
   * Tokens are issued in the same call, because a sign-up that ends at a login
   * screen is a sign-up half the people abandon. A brand-new shop defaults to
   * 08:00–19:00, so somebody signing up at ten at night would be refused — but
   * `WorkingHoursService` exempts owners, and the only member of a new shop is
   * its owner.
   */
  async signUp(
    input: {
      organizationName: string;
      firstName: string;
      lastName: string;
      username: string;
      password: string;
      email?: string;
      businessType?: BusinessType;
      currency?: SupportedCurrency;
      timezone?: string;
    },
    context: TokenContext = {},
  ): Promise<TokenPair> {
    assertSelfServeSignup();

    const created = await this.createVerifiedOwner(input);
    this.logger.log(
      `New shop "${created.organizationName}" (${created.organizationSlug}) signed up`,
    );
    return this.issueForUser(created.userId, context);
  }

  /**
   * Sets somebody's password without their old one, and signs them out.
   *
   * The recovery path for an instance with self-serve signup off, where
   * `forgot-password` is closed. No HTTP route, for the same reason as
   * {@link createVerifiedOwner}: over the network this would be account
   * takeover with extra steps. The CLI is the only caller, and reaching the CLI
   * already means holding the database.
   */
  async setPasswordByIdentifier(
    identifier: { email: string } | { username: string },
    newPassword: string,
  ) {
    const credentials = await this.users.findCredentials(identifier);
    if (!credentials) {
      throw new BadRequestException('No account matches that identifier.');
    }

    await this.users.updatePassword(credentials.id, newPassword);
    await this.tokens.revokeAllForUser(credentials.id);

    return { userId: credentials.id };
  }

  /**
   * What a new business needs before the app is usable: the price lists for
   * its kind of trading (one of them the default) for prices to hang off, the packaging vocabulary, somewhere for stock to
   * sit, and something to file spending under.
   *
   * Both registration paths call it. Google sign-up used to create the
   * organization and stop there, so those businesses had no tier at all and
   * nowhere to put a price. Any future per-org default belongs here, not
   * inline in one of the two paths.
   *
   * Typed on the delegates it touches so it accepts either the client or a
   * transaction handle.
   */
  private async seedOrganizationDefaults(
    db: Pick<
      PrismaService,
      'priceTier' | 'packagingType' | 'location' | 'expenseCategory'
    >,
    organizationId: string,
    businessType: BusinessType,
  ) {
    await db.priceTier.createMany({
      data: defaultPriceTierRows(organizationId, businessType),
    });
    await db.packagingType.createMany({
      data: defaultPackagingTypeRows(organizationId),
    });
    // Stock has to land somewhere, and a business with one shop should never
    // have to think about locations at all.
    await db.location.create({ data: defaultLocationRow(organizationId) });
    await db.expenseCategory.createMany({
      data: defaultExpenseCategoryRows(organizationId),
    });
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
    assertMailAvailable();

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
    // Exactly one identifier. Stated here rather than in the DTO because "send
    // one of these two" reads better as a message than as a validator.
    if (!dto.email === !dto.username) {
      throw new BadRequestException(
        'Sign in with either an email or a username, not both and not neither.',
      );
    }

    const identifier = dto.email
      ? { email: dto.email.toLowerCase() }
      : { username: dto.username!.toLowerCase() };

    // The one read that asks for the password hash, and it asks explicitly.
    const user = await this.signInCandidate(identifier, dto.password);

    if (!user.isVerified) {
      throw new ForbiddenException({
        error: 'PENDING_VERIFICATION',
        message: 'Verify your email before signing in.',
      });
    }

    if (context.ip) await this.users.updateLastLoginIp(user.id, context.ip);
    return this.issueForUser(user.id, context);
  }

  /**
   * Who is signing in, password checked.
   *
   * A staff username is stored qualified by the shop — `davidyo@adebayo-
   * stores-a1b2c3` — so two shops may each have a David. Nobody types that:
   * an owner added a member of staff who then could not sign in as "Davidyo"
   * (2026-10-07). So a plain name that is not itself a username (owners'
   * are plain) is tried against **every staff member of that name**, and the
   * password decides which: exactly one fits, they are in; the same name and
   * password at two shops is told to use the full name. Nothing here reveals
   * whether a name exists — every failure is the same `Invalid credentials`,
   * and the login rate limit still counts each attempt.
   */
  private async signInCandidate(
    identifier: { email: string } | { username: string },
    password: string,
  ) {
    const exact = await this.users.findCredentials(identifier);
    const candidates =
      exact || !('username' in identifier) || identifier.username.includes('@')
        ? exact
          ? [exact]
          : []
        : await this.users.findStaffCredentialsByName(identifier.username);

    const fits: (typeof candidates)[number][] = [];
    for (const candidate of candidates) {
      if (
        candidate.password &&
        (await argon2.verify(candidate.password, password))
      ) {
        fits.push(candidate);
      }
    }
    if (fits.length > 1) {
      throw new UnauthorizedException(
        'More than one shop has a member of staff by that name. Sign in with your full username — the one with @ and your shop’s name.',
      );
    }
    if (fits.length === 0) {
      // Deliberately the same message either way, so this cannot be used to
      // find out which usernames or addresses exist.
      throw new UnauthorizedException('Invalid credentials');
    }
    return fits[0];
  }

  refresh(rawToken: string, context: TokenContext = {}): Promise<TokenPair> {
    return this.tokens.rotate(rawToken, context);
  }

  async logout(rawToken: string | undefined): Promise<{ message: string }> {
    if (rawToken) await this.tokens.revokeByToken(rawToken);
    return { message: 'Signed out.' };
  }

  /**
   * Re-issues tokens against a different organization the user belongs to.
   *
   * The third path that mints a session, and therefore the third that has to
   * ask about opening hours — the other two being `issueForUser` and
   * `TokenService.rotate`. Without it, somebody who works for two businesses
   * could sign into the one that is open and switch into the one that is
   * closed, which is the whole rule undone by a single request.
   */
  async switchOrganization(
    userId: string,
    organizationId: string,
    context: TokenContext = {},
  ): Promise<TokenPair> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId, status: MembershipStatus.active },
      include: { user: true, ...HOURS_INCLUDE },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of that organization');
    }

    this.hours.assertWithinHours(membership);

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
    assertMailAvailable();

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
   * Changing your own password, knowing the current one.
   *
   * ## Why this exists
   *
   * It was missing, and its absence only became load-bearing when self-serve
   * signup could be turned off. With signup on, somebody who wanted a different
   * password could go the long way round through `forgot-password`. With it
   * off, that route is closed — so without this, a password handed to an owner
   * at setup would be the password they were stuck with forever, and the only
   * way to change it would be to ask us to run a script.
   *
   * It is worth having regardless. A shared or overheard password is an
   * ordinary thing in a shop, and the fix for it should not be a support
   * request.
   *
   * ## Why the current password is required
   *
   * An access token is fifteen minutes of authority; a password is permanent.
   * An unattended till, a borrowed phone, a session left open on a shared
   * machine — all of those hand someone a token, and none of them should be
   * enough to take the account away from its owner. Knowing the current
   * password is what separates "using this session" from "becoming this user".
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const credentials = await this.users.findCredentials({ id: userId });
    if (!credentials?.password) {
      // A Google-only account has no password to check against, so there is
      // nothing here to change and no safe way to set one from a session alone.
      throw new BadRequestException(
        'This account signs in with Google and has no password to change.',
      );
    }

    if (!(await argon2.verify(credentials.password, currentPassword))) {
      throw new UnauthorizedException('That is not your current password.');
    }

    await this.users.updatePassword(userId, newPassword);

    // Same rule as every other password change in this codebase: a new password
    // must stop the sessions the old one opened, or a refresh token issued
    // before it goes on renewing for up to seven days. That is the whole point
    // when the reason for changing it is that somebody else knows it.
    await this.tokens.revokeAllForUser(userId);

    return {
      message:
        'Password changed. Everyone signed in as you has been signed out.',
    };
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

    // Google sign-in is a *signup* path for anybody it has not seen before, and
    // one that never mints a code — so it would sail straight past a check that
    // only guarded the emailed routes. Somebody who already has an account and
    // a business signs in as normal; the refusal lands only where a new one
    // would be created.
    if (!user) {
      assertSelfServeSignup();
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
      // Same rule, second door: an existing user with no active membership is
      // about to have a business created for them, which is the other half of
      // signing up.
      assertSelfServeSignup();

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
      await this.seedOrganizationDefaults(
        this.prisma,
        organization.id,
        organization.businessType,
      );
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
      include: { user: true, ...HOURS_INCLUDE },
      orderBy: { createdAt: 'asc' },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException('You do not belong to any organization');
    }

    const active =
      memberships.find((m) => m.role === OrgRole.owner) ?? memberships[0];

    // Outside opening hours, no session is issued at all. Checked here rather
    // than on every request: a cashier halfway through recording a sale at one
    // minute to seven must not be cut off mid-transaction, and a rule that
    // interrupts work is a rule people find ways around.
    this.hours.assertWithinHours(active);

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
    // Refused outright in production, rather than merely discouraged there.
    //
    // This exists so `npm run smoke` can run unattended against a deployed test
    // instance with no mailbox to read. It is also a master key into every
    // account in the system, and "test instance" has a way of quietly becoming
    // production — a copied env file, a debug session nobody undid. §15 has
    // recorded that risk as a note since Slice 6; a note is not a control.
    if (env.NODE_ENV === 'production') {
      if (env.OTP_OVERRIDE) {
        this.logger.error(
          'OTP_OVERRIDE is set on a production instance and is being ignored. Remove it: it is a master key into every account.',
        );
      }
    } else if (env.OTP_OVERRIDE && code === env.OTP_OVERRIDE) {
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
