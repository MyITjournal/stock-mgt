import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { env } from '../../../config/env';
import { AccessTokenPayload } from '../token.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: { cookies?: Record<string, string> }) =>
          req.cookies?.access_token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: env.JWT_ACCESS_SECRET,
    });
  }

  /**
   * Re-checks the membership on every request rather than trusting the token
   * alone, so revoking someone's access takes effect immediately instead of
   * waiting for their access token to expire.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: payload.sub,
        organizationId: payload.organizationId,
        status: 'active',
      },
      include: { user: true },
    });

    if (!membership || membership.user.deletedAt) {
      throw new UnauthorizedException('Membership is no longer active');
    }

    return {
      sub: membership.userId,
      email: membership.user.email,
      role: membership.user.role,
      organizationId: membership.organizationId,
      orgRole: membership.role,
    };
  }
}
