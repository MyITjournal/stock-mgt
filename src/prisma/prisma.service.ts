import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

/**
 * How long one write may take, for every transaction (2026-10-07).
 *
 * Prisma's default is **5 seconds**, and it was being hit in production. Every
 * statement inside a transaction is a round trip from Render (Frankfurt) to
 * the Supabase pooler (Ireland), and a delivery makes about six per line —
 * batch, receipt line, movement, balance, cost — so a long invoice ran past
 * 5 s and was rolled back as a 500. It failed identically on every retry, and
 * the owner could not save one invoice at all. A till sale with many lines
 * walks FEFO per line and is the same shape.
 *
 * Thirty seconds is generous on purpose: the cost of a slow save is waiting,
 * and the cost of a cancelled one is a person typing the invoice again. The
 * three screens that already set a longer limit (import, opening stock,
 * delivery correction) keep their own. `maxWait` is how long to wait for a
 * free connection from the pool before starting.
 */
const TRANSACTION_LIMITS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * The pool is sized here, not in the connection string.
   *
   * `?connection_limit=` is a **Prisma Rust query-engine** parameter, and this
   * client does not use that engine — it goes through the `pg` driver adapter,
   * whose pool is `node-postgres` and which takes its size from `max` in the
   * pool config. Putting `connection_limit` on the URL is silently ignored:
   * `pg` does not recognise it, so the pool quietly stays at its default of
   * ten per process. That matters on a hosted Postgres with a connection cap,
   * where the symptom is not a clear error but intermittent
   * `too many connections` under ordinary load.
   */
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.DATABASE_POOL_MAX,
      }),
      transactionOptions: TRANSACTION_LIMITS,
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Cheap round-trip used by the health endpoint. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error as Error);
      return false;
    }
  }
}
