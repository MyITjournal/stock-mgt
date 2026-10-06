import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/** How long after waking the first sweep waits — out of a cold start's way. */
const AFTER_WAKING_MS = 30_000;

/** At most this many session chains are removed in one statement. */
const FAMILY_BATCH = 500;

/**
 * Clearing out rows that have stopped meaning anything.
 *
 * ## Why not only at midnight
 *
 * This used to be a job at midnight. **On Render's free plan the server is
 * asleep at midnight** — it sleeps after fifteen minutes with no requests —
 * so a nightly job on a shop's quiet server never ran at all, and the rows it
 * was meant to clear piled up in a 500 MB database. Now it runs shortly after
 * every wake-up and every hour while awake. Each sweep is a couple of deletes
 * by indexed date, cheap enough to run often.
 *
 * ## What it clears
 *
 * - **Stored write replies** (`IdempotencyKey`) older than their 48 hours. Kept
 *   so a retried sale is not recorded twice; past their window nothing retries.
 *   They are about a third of the space a sale takes.
 * - **Sign-in sessions** (`RefreshToken`) — but only a **whole chain** once
 *   every token in it has expired. A token that was replaced is kept while its
 *   chain is alive, because presenting it again is how a stolen session is
 *   caught: it signs the whole chain out (`TokenService.rotate`). Deleting it
 *   early would quietly lose that. Once the newest token in the chain has
 *   expired, there is nothing left to protect.
 */
@Injectable()
export class HousekeepingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HousekeepingService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    // Not awaited: waking up must not wait on housekeeping.
    setTimeout(() => void this.sweep(), AFTER_WAKING_MS).unref();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    await this.sweep();
  }

  /** One pass. Never throws; never runs twice at once. */
  async sweep(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const replies = await this.prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: now } },
      });
      const sessions = await this.purgeDeadSessionChains(now);
      if (replies.count > 0 || sessions > 0) {
        this.logger.log(
          `Cleared ${replies.count} stored write repl${replies.count === 1 ? 'y' : 'ies'} and ${sessions} expired sign-in session${sessions === 1 ? '' : 's'}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Housekeeping failed',
        error instanceof Error ? error.stack : error,
      );
    } finally {
      this.running = false;
    }
  }

  /** Every session chain whose newest token has expired, removed whole. */
  private async purgeDeadSessionChains(now: Date): Promise<number> {
    let removed = 0;
    for (;;) {
      const dead = await this.prisma.refreshToken.groupBy({
        by: ['familyId'],
        _max: { expiresAt: true },
        having: { expiresAt: { _max: { lt: now } } },
        orderBy: { familyId: 'asc' },
        take: FAMILY_BATCH,
      });
      if (dead.length === 0) return removed;
      const result = await this.prisma.refreshToken.deleteMany({
        where: { familyId: { in: dead.map((row) => row.familyId) } },
      });
      removed += result.count;
      if (dead.length < FAMILY_BATCH) return removed;
    }
  }
}
