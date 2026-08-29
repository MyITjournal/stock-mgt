import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../tenancy/tenant-context';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** How long a replayable answer is kept. Long enough for a rep to reconnect. */
const RETENTION_HOURS = 48;

/**
 * Makes retried writes safe.
 *
 * A field rep on a bad connection will resend a request that already
 * succeeded — the response never made it back, so the client cannot tell. When
 * the caller supplies an `Idempotency-Key`, the first outcome is stored and any
 * repeat returns it verbatim instead of creating a second sale.
 *
 * Applied per-route rather than globally, so only writes that genuinely need it
 * pay for the extra lookup.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.header(IDEMPOTENCY_HEADER);

    // No key means the caller accepts at-least-once behaviour.
    if (!key) return next.handle();

    const organizationId = TenantContext.organizationId();
    if (!organizationId) return next.handle();

    // The route pattern ("/products") rather than the concrete path, so a key
    // is scoped to the operation and not to one particular resource id.
    const route = (request as Request & { route?: { path?: string } }).route;
    const endpoint = `${request.method} ${route?.path ?? request.path}`;
    const requestHash = hashBody(request.body);

    const existing = await this.prisma.idempotencyKey.findFirst({
      where: { organizationId, key },
    });

    if (existing) {
      if (
        existing.endpoint !== endpoint ||
        existing.requestHash !== requestHash
      ) {
        // Same key, different request. Replaying the old answer would be a lie,
        // so tell the client its key handling is wrong.
        throw new ConflictException(
          'This Idempotency-Key was already used for a different request. Use a fresh key per distinct operation.',
        );
      }

      this.logger.log(`Replaying stored response for key ${key}`);
      const response = context.switchToHttp().getResponse<Response>();
      response.status(existing.statusCode);
      response.setHeader('Idempotent-Replay', 'true');
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      tap((body) => {
        void this.remember({
          organizationId,
          key,
          endpoint,
          requestHash,
          statusCode: context.switchToHttp().getResponse<Response>().statusCode,
          body,
        });
      }),
    );
  }

  private async remember(entry: {
    organizationId: string;
    key: string;
    endpoint: string;
    requestHash: string;
    statusCode: number;
    body: unknown;
  }): Promise<void> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          organizationId: entry.organizationId,
          key: entry.key,
          endpoint: entry.endpoint,
          requestHash: entry.requestHash,
          statusCode: entry.statusCode,
          responseBody: entry.body as object,
          expiresAt: new Date(Date.now() + RETENTION_HOURS * 3600_000),
        },
      });
    } catch (error) {
      // Two concurrent retries can race to insert the same key. The work itself
      // already succeeded, so losing the race must not fail the request.
      this.logger.warn(
        `Could not store idempotency key ${entry.key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Stable hash of the request body, insensitive to key order. */
export function hashBody(body: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(sortKeys(body)))
    .digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
