import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

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
