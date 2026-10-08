import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { summariseSessions } from './sessions';
import { SessionsSummaryView } from './dto/sessions.response';

/**
 * Who is signed in to this shop, read from the sign-in records (2026-10-08).
 *
 * Through the raw client, like `StaffService`: refresh tokens belong to a
 * person, not a shop, so the table is not tenant-scoped — every query pins the
 * organization by hand. **No addresses leave here**: the records hold an IP,
 * which means nothing to an owner and is personal data.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(): Promise<SessionsSummaryView> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    // One live token per chain: rotation revokes the old one as it issues
    // the next, so what is unrevoked and unexpired is each chain's newest.
    const [live, lastSeen] = await Promise.all([
      this.prisma.refreshToken.findMany({
        where: { organizationId, revokedAt: null, expiresAt: { gt: now } },
        select: {
          userId: true,
          familyId: true,
          userAgent: true,
          createdAt: true,
        },
      }),
      this.prisma.refreshToken.groupBy({
        by: ['userId'],
        where: { organizationId },
        _max: { createdAt: true },
      }),
    ]);

    // When each chain began — the sign-in itself.
    const starts = await this.prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: { familyId: { in: live.map((row) => row.familyId) } },
      _min: { createdAt: true },
    });
    const startOf = new Map(
      starts.map((row) => [row.familyId, row._min.createdAt]),
    );

    return summariseSessions(
      live.map((row) => ({
        userId: row.userId,
        userAgent: row.userAgent,
        signedInAt: startOf.get(row.familyId) ?? row.createdAt,
        lastActiveAt: row.createdAt,
      })),
      new Map(
        lastSeen
          .filter((row) => row._max.createdAt)
          .map((row) => [row.userId, row._max.createdAt!]),
      ),
      now,
    );
  }
}
