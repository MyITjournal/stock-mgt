import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Idempotency keys are only useful while a client might still retry. Without a
 * sweep the table grows with every write forever.
 */
@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeExpiredKeys(): Promise<void> {
    try {
      const result = await this.prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

      if (result.count > 0) {
        this.logger.log(`Purged ${result.count} expired idempotency key(s)`);
      }
    } catch (error) {
      this.logger.error(
        'purgeExpiredKeys failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
