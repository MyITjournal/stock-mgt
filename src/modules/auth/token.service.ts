import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { OrgRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  organizationId: string;
  orgRole: OrgRole;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface TokenContext {
  userAgent?: string;
  ip?: string;
}

/** Days a refresh token stays valid, parsed from JWT_REFRESH_EXPIRES_IN ("7d"). */
function refreshLifetimeMs(): number {
  const raw = env.JWT_REFRESH_EXPIRES_IN;
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const amount = Number(match[1]);
  const unit = match[2];
  const factor =
    unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : 86_400_000;
  return amount * factor;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Issues an access/refresh pair. `familyId` links every token descended from a
   * single login so that replaying a rotated token can revoke the entire chain.
   */
  async issuePair(
    payload: AccessTokenPayload,
    context: TokenContext = {},
    familyId: string = crypto.randomUUID(),
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: env.JWT_ACCESS_SECRET,
      // Env values are plain strings; jsonwebtoken types this as an `ms`
      // template literal ("15m"), which zod cannot express.
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
    });

    const selector = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(32).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        organizationId: payload.organizationId,
        tokenSelector: selector,
        tokenHash: await argon2.hash(verifier),
        familyId,
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
        expiresAt: new Date(Date.now() + refreshLifetimeMs()),
      },
    });

    return {
      accessToken,
      refreshToken: `${selector}.${verifier}`,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    };
  }

  /**
   * Validates a refresh token and rotates it.
   *
   * Presenting a token that was already rotated or revoked means it leaked, so
   * the whole family is revoked rather than just that one token — otherwise an
   * attacker holding a stolen copy keeps renewing alongside the real user.
   */
  async rotate(
    rawToken: string,
    context: TokenContext = {},
  ): Promise<TokenPair> {
    const [selector, verifier] = rawToken.split('.');
    if (!selector || !verifier) {
      throw new UnauthorizedException('Malformed refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenSelector: selector },
    });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (!(await argon2.verify(stored.tokenHash, verifier))) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt || stored.replacedById) {
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; revoking family ${stored.familyId}`,
      );
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token has already been used');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: stored.userId,
        organizationId: stored.organizationId ?? undefined,
        status: 'active',
      },
      include: { user: true },
    });
    if (!membership) {
      throw new UnauthorizedException('Membership is no longer active');
    }

    const pair = await this.issuePair(
      {
        sub: membership.userId,
        email: membership.user.email,
        organizationId: membership.organizationId,
        orgRole: membership.role,
      },
      context,
      stored.familyId,
    );

    const replacement = await this.prisma.refreshToken.findFirst({
      where: { familyId: stored.familyId },
      orderBy: { createdAt: 'desc' },
    });

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: replacement?.id ?? null },
    });

    return pair;
  }

  /** Revokes every live token in a family. Used on logout and on reuse detection. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes the family the given token belongs to. Tolerates unknown tokens. */
  async revokeByToken(rawToken: string): Promise<void> {
    const [selector] = rawToken.split('.');
    if (!selector) return;

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenSelector: selector },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  /** Revokes every token for a user, across all organizations. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
