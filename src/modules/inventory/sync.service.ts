import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import {
  SYNC_LAG_MS,
  decodeCursor,
  encodeCursor,
  keysetWhereCreated,
  keysetWhereCreatedDesc,
} from '../../common/pagination/keyset-cursor';
import { MovementPageView } from './dto/stock.response';

/** How many movements one page returns when the caller does not say. */
const DEFAULT_PAGE = 200;
const MAX_PAGE = 1000;

export interface MovementQuery {
  productId?: string;
  locationId?: string;
  /**
   * The lower bound on `createdAt`.
   *
   * Syncing (`order: 'asc'`): a starting position, ignored when `cursor` is
   * given, because a cursor is more precise than a timestamp.
   *
   * Browsing (`order: 'desc'`): an ordinary filter, applied alongside the
   * cursor — walking backwards, the starting position is the newest row.
   */
  since?: Date;
  /** An upper bound on `createdAt`. Only meaningful when browsing. */
  until?: Date;
  cursor?: string;
  limit?: number;
  /**
   * `asc` is the sync order and the default, so every existing client is
   * untouched.
   */
  order?: 'asc' | 'desc';
}

/**
 * The ledger, for two readers.
 *
 * **Syncing.** The mobile app pulls what changed since it last spoke to the
 * server. Movements are append-only, so "what changed" is just "what was
 * added" — no tombstones, no diffing, and pages that can be replayed safely
 * because ids are client-stable and a row seen twice is deduped rather than
 * double-counted. It walks forward on (`createdAt`, `id`).
 *
 * **Browsing.** Somebody opening the stock movements screen wants the newest
 * row at the top and pages *back* through yesterday. Reversing on the client
 * cannot do that: it reverses one page, not the sequence.
 *
 * The two differ in one more way worth knowing, and it is the same lesson the
 * sales and payments feeds each learned separately: **the one-second lag is a
 * sync safeguard, so browsing skips it.** It exists to stop a forward-walking
 * cursor advancing past a row that was still committing — unrecoverable,
 * because the cursor never goes back. Reading newest-first has the opposite
 * exposure: new rows arrive at the top, above wherever the reader has paged to,
 * so a late commit is never stepped over. Leaving the lag on made a
 * just-recorded row missing from the list that refetched, which reads as a lost
 * movement rather than as caution.
 */
@Injectable()
export class SyncService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async movements(query: MovementQuery): Promise<MovementPageView> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    const browsing = query.order === 'desc';

    const rows = await this.prisma.stockMovement.findMany({
      where: {
        ...(query.productId && { productId: query.productId }),
        ...(query.locationId && { locationId: query.locationId }),
        AND: [
          ...(browsing ? [] : [{ createdAt: { lte: syncedThrough } }]),
          ...(browsing
            ? [
                ...(query.since ? [{ createdAt: { gte: query.since } }] : []),
                ...(query.until ? [{ createdAt: { lte: query.until } }] : []),
                ...keysetWhereCreatedDesc(cursor),
              ]
            : keysetWhereCreated(cursor, query.since)),
        ],
      },
      orderBy: browsing
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'asc' }, { id: 'asc' }],
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
          ? encodeCursor({ at: last.createdAt, id: last.id })
          : null,
      syncedThrough,
      hasMore: rows.length === limit,
    };
  }
}
