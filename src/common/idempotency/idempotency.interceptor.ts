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
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../tenancy/tenant-context';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** How long a replayable answer is kept. Long enough for a rep to reconnect. */
const RETENTION_HOURS = 48;

/**
 * How long a claimed-but-unfinished request is believed to still be running.
 *
 * A process that dies between claiming a key and storing its answer would
 * otherwise leave that key unusable until the nightly sweep, so a claim older
 * than this is taken over. It must stay comfortably above the slowest real
 * request: set it too low and a slow goods receipt gets executed twice, which
 * is the exact thing this interceptor exists to prevent.
 */
const STALE_CLAIM_MS = 120_000;

/**
 * Makes retried writes safe.
 *
 * A field rep on a bad connection will resend a request that already
 * succeeded — the response never made it back, so the client cannot tell. When
 * the caller supplies an `Idempotency-Key`, the first outcome is stored and any
 * repeat returns it verbatim instead of creating a second sale.
 *
 * The key is claimed **before** the handler runs rather than recorded after it.
 * Recording afterwards left a window in which two requests that overlapped —
 * a client timing out at ten seconds while the server was still working — both
 * looked like the first one and both did the work. Writing the row first makes
 * the unique constraint on (organizationId, key) the arbiter: exactly one
 * caller wins the insert, and the losers are told to wait rather than
 * executing.
 *
 * Applied per-route rather than globally, so only writes that genuinely need it
 * pay for the extra lookup. See `Idempotent` in ./idempotent.decorator.
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

    // The concrete URL, not the route pattern. A retry by definition goes back
    // to the same address, so nothing legitimate is lost by being specific —
    // while the pattern made every id-scoped command look like every other.
    const endpoint = `${request.method} ${request.originalUrl}`;
    const requestHash = hashBody(request.body);

    const claim = await this.claim({
      organizationId,
      key,
      endpoint,
      requestHash,
    });

    if (claim.kind === 'replay') {
      this.logger.log(`Replaying stored response for key ${key}`);
      const response = context.switchToHttp().getResponse<Response>();
      response.status(claim.statusCode);
      response.setHeader('Idempotent-Replay', 'true');
      return of(claim.body);
    }

    if (claim.kind === 'mismatch') {
      // Same key, different request. Replaying the old answer would be a lie,
      // so tell the client its key handling is wrong.
      throw new ConflictException(
        'This Idempotency-Key was already used for a different request. Use a fresh key per distinct operation.',
      );
    }

    if (claim.kind === 'in-flight') {
      // The first attempt is still running. Answering now would mean either
      // doing the work twice or inventing a response, so say so and let the
      // client come back.
      throw new ConflictException(
        'A request with this Idempotency-Key is still in progress. Retry in a moment.',
      );
    }

    const claimId = claim.id;

    return next.handle().pipe(
      mergeMap((body) =>
        from(
          this.complete(
            claimId,
            context.switchToHttp().getResponse<Response>().statusCode,
            body,
          ),
        ).pipe(mergeMap(() => of(body))),
      ),
      catchError((error: unknown) =>
        // The work failed, so nothing is replayable. Release the claim or the
        // client could never retry this key — a 409 for insufficient stock is
        // exactly the case where retrying after fixing the problem is right.
        from(this.release(claimId)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  /**
   * Take ownership of the key, or report what the existing row means for this
   * caller. The insert races deliberately: whoever the unique constraint lets
   * through owns the work.
   */
  private async claim(
    entry: {
      organizationId: string;
      key: string;
      endpoint: string;
      requestHash: string;
    },
    attempt = 1,
  ): Promise<
    | { kind: 'claimed'; id: string }
    | { kind: 'replay'; statusCode: number; body: unknown }
    | { kind: 'mismatch' }
    | { kind: 'in-flight' }
  > {
    try {
      const created = await this.prisma.idempotencyKey.create({
        data: {
          organizationId: entry.organizationId,
          key: entry.key,
          endpoint: entry.endpoint,
          requestHash: entry.requestHash,
          expiresAt: new Date(Date.now() + RETENTION_HOURS * 3600_000),
        },
      });
      return { kind: 'claimed', id: created.id };
    } catch (error) {
      // Only a unique violation means somebody else holds this key. Anything
      // else is the database being unwell, and swallowing it here would turn a
      // broken connection into a silently unprotected write.
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await this.prisma.idempotencyKey.findFirst({
      where: { organizationId: entry.organizationId, key: entry.key },
    });

    // Gone between the failed insert and this read: the holder failed and
    // released it. Try once more, then stop — a key that keeps vanishing is a
    // loop, not a race worth chasing.
    if (!existing) {
      if (attempt >= 2) return { kind: 'in-flight' };
      return this.claim(entry, attempt + 1);
    }

    if (
      existing.endpoint !== entry.endpoint ||
      existing.requestHash !== entry.requestHash
    ) {
      return { kind: 'mismatch' };
    }

    if (existing.statusCode !== null) {
      return {
        kind: 'replay',
        statusCode: existing.statusCode,
        body: existing.responseBody,
      };
    }

    if (Date.now() - existing.createdAt.getTime() < STALE_CLAIM_MS) {
      return { kind: 'in-flight' };
    }

    // The holder is long gone. Take the claim over, but only if nobody else
    // has touched it since this read — otherwise fall back to waiting.
    const takeover = await this.prisma.idempotencyKey.updateMany({
      where: {
        id: existing.id,
        statusCode: null,
        createdAt: existing.createdAt,
      },
      data: { createdAt: new Date() },
    });

    if (takeover.count === 0) return { kind: 'in-flight' };

    this.logger.warn(
      `Took over a stale idempotency claim for key ${entry.key}; the request holding it never finished.`,
    );
    return { kind: 'claimed', id: existing.id };
  }

  /** Store the answer, turning the claim into something replayable. */
  private async complete(
    id: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    try {
      await this.prisma.idempotencyKey.update({
        where: { id },
        data: { statusCode, responseBody: body as object },
      });
    } catch (error) {
      // The work itself succeeded and the caller is owed its response, so a
      // failure to record it must not turn into a failed request. The cost is
      // that this one key stays in flight until the stale takeover.
      this.logger.warn(
        `Could not store idempotency response for ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Give the key back after a failed request, so the caller can retry it. */
  private async release(id: string): Promise<void> {
    try {
      await this.prisma.idempotencyKey.delete({ where: { id } });
    } catch (error) {
      this.logger.warn(
        `Could not release idempotency claim ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Prisma's "unique constraint failed" — the signal that another request got
 * there first. Matched structurally rather than with `instanceof` so this does
 * not depend on which copy of the Prisma runtime threw it.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Stable hash of the request body, insensitive to key order.
 *
 * `body ?? null` is load-bearing. A command route carries no body at all, so
 * nothing sets a JSON content type and Express leaves `req.body` undefined —
 * and `JSON.stringify(undefined)` is the *value* undefined, not a string, which
 * makes the hash throw. Every keyed request to `POST /stocktakes/:id/post`
 * answered 500 because of it.
 */
export function hashBody(body: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(sortKeys(body ?? null)))
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
