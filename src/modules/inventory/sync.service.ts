import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import {
  SYNC_LAG_MS,
  decodeCursor,
  encodeCursor,
  keysetWhere,
} from '../../common/pagination/keyset-cursor';

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
          ...keysetWhere(cursor, query.since),
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
