import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';

/**
 * How far behind the server clock a page is allowed to reach.
 *
 * A row committed at 12:00:00.400 can become visible *after* one committed at
 * 12:00:00.600 — the timestamp is taken when the statement runs, the row
 * appears when the transaction commits. A cursor that advances to the newest
 * visible row therefore steps over anything still in flight, and because the
 * cursor only ever moves forward, that row is missed forever.
 *
 * Holding the window a second short of now means an in-flight transaction has
 * committed by the time its slice of time becomes eligible.
 */
const SYNC_LAG_MS = 1000;

/** How many movements one page returns when the caller does not say. */
const DEFAULT_PAGE = 200;
const MAX_PAGE = 1000;

export interface MovementQuery {
  productId?: string;
  locationId?: string;
  /** Everything recorded after this point. Ignored when `cursor` is given. */
  since?: Date;
  cursor?: string;
  limit?: number;
}

interface Cursor {
  createdAt: Date;
  id: string;
}

/**
 * Delta sync for the ledger.
 *
 * The mobile app pulls what changed since it last spoke to the server. Movements
 * are append-only, so "what changed" is just "what was added" — no tombstones,
 * no diffing, and pages that can be replayed safely because ids are
 * client-stable and a row seen twice is deduped rather than double-counted.
 */
@Injectable()
export class SyncService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async movements(query: MovementQuery) {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    const rows = await this.prisma.stockMovement.findMany({
      where: {
        ...(query.productId && { productId: query.productId }),
        ...(query.locationId && { locationId: query.locationId }),
        AND: [
          { createdAt: { lte: syncedThrough } },
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    {
                      createdAt: cursor.createdAt,
                      id: { gt: cursor.id },
                    },
                  ],
                },
              ]
            : query.since
              ? [{ createdAt: { gt: query.since } }]
              : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: {
        batch: { select: { lotCode: true, expiryDate: true } },
      },
    });

    const last = rows.at(-1);

    return {
      movements: rows,
      /**
       * Pass back verbatim on the next call. Null when the page came up short,
       * which means the client is caught up to `syncedThrough`.
       */
      nextCursor:
        rows.length === limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      syncedThrough,
      hasMore: rows.length === limit,
    };
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString(
    'base64url',
  );
}

function decodeCursor(raw: string): Cursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const createdAt = new Date(decoded.slice(0, separator));

  if (separator === -1 || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException(
      'Malformed sync cursor. Pass back the nextCursor from the previous page, or omit it to start over.',
    );
  }

  return { createdAt, id: decoded.slice(separator + 1) };
}
