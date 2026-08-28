import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StaleUsersCleanupService {
  private readonly logger = new Logger(StaleUsersCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanStaleUnverifiedUsers(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.user.deleteMany({
        where: {
          isVerified: false,
          OR: [
            {
              otpExpiresAt: null,
              createdAt: { lt: cutoff },
            },
            {
              otpExpiresAt: { lt: cutoff },
            },
          ],
        },
      });

      if (result.count > 0) {
        this.logger.log(`Cleaned up ${result.count} stale unverified user(s)`);
      }
    } catch (err) {
      this.logger.error(
        'cleanStaleUnverifiedUsers failed',
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
