import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';

export interface LevelFilter {
  productId?: string;
  locationId?: string;
  includeBatches?: boolean;
  /** Include products whose balance has fallen to zero. */
  includeEmpty?: boolean;
}

/**
 * Reading the ledger back: what is on hand, what is about to go off, and what
 * was pushed through a shortfall.
 *
 * Balances come from the `StockBalance` cache rather than a sum over movements
 * — that is what the cache is for — and `rebuild()` proves the two agree.
 */
@Injectable()
export class StockLevelService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  /**
   * Stock on hand, one row per product and location, with the batches that make
   * it up when asked for.
   */
  async findLevels(filter: LevelFilter = {}) {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        ...(filter.productId && { productId: filter.productId }),
        ...(filter.locationId && { locationId: filter.locationId }),
        ...(filter.includeEmpty ? {} : { quantity: { not: 0 } }),
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        location: { select: { id: true, name: true } },
        batch: {
          select: {
            id: true,
            lotCode: true,
            expiryDate: true,
            receivedAt: true,
            quantityReceived: true,
            totalCost: true,
          },
        },
      },
      orderBy: [{ productId: 'asc' }, { locationId: 'asc' }],
    });

    const grouped = new Map<
      string,
      {
        product: { id: string; name: string; sku: string };
        location: { id: string; name: string };
        quantity: number;
        batches: {
          batchId: string;
          quantity: number;
          lotCode: string | null;
          expiryDate: Date | null;
          /** Exact, from the invoice. The ratio is the derived figure. */
          unitCost: number | null;
        }[];
      }
    >();

    for (const balance of balances) {
      const key = `${balance.productId}:${balance.locationId}`;
      const row = grouped.get(key) ?? {
        product: balance.product,
        location: balance.location,
        quantity: 0,
        batches: [],
      };

      row.quantity += balance.quantity;
      row.batches.push({
        batchId: balance.batchId,
        quantity: balance.quantity,
        lotCode: balance.batch.lotCode,
        expiryDate: balance.batch.expiryDate,
        unitCost:
          balance.batch.quantityReceived > 0
            ? balance.batch.totalCost / balance.batch.quantityReceived
            : null,
      });

      grouped.set(key, row);
    }

    return [...grouped.values()].map((row) => ({
      product: row.product,
      location: row.location,
      quantity: row.quantity,
      ...(filter.includeBatches ? { batches: row.batches } : {}),
    }));
  }

  /**
   * Batches with stock left that expire on or before a date — the list someone
   * walks the shelves with. Ordered soonest first, which is the order FEFO
   * would sell them in anyway.
   */
  async findExpiring(before: Date, locationId?: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        ...(locationId && { locationId }),
        batch: { expiryDate: { not: null, lte: before } },
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        location: { select: { id: true, name: true } },
        batch: {
          select: {
            id: true,
            lotCode: true,
            expiryDate: true,
            quantityReceived: true,
            totalCost: true,
          },
        },
      },
    });

    return balances
      .map((balance) => ({
        product: balance.product,
        location: balance.location,
        batchId: balance.batchId,
        lotCode: balance.batch.lotCode,
        expiryDate: balance.batch.expiryDate,
        quantity: balance.quantity,
        /** What walks out of the door if this is not sold in time. */
        valueAtRisk:
          balance.batch.quantityReceived > 0
            ? Math.round(
                (balance.batch.totalCost / balance.batch.quantityReceived) *
                  balance.quantity,
              )
            : 0,
      }))
      .sort(
        (a, b) =>
          (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0),
      );
  }

  /**
   * Movements an owner or manager pushed through a shortfall.
   *
   * This is the point of allowing the override at all: "we sold stock we had
   * not entered yet" becomes a list with names against it, rather than a stock
   * count that quietly stops adding up.
   */
  findForced(since?: Date) {
    return this.prisma.stockMovement.findMany({
      where: { isForced: true, ...(since && { occurredAt: { gte: since } }) },
      orderBy: { occurredAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        location: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Rebuilds every cached balance from the ledger.
   *
   * The cache is an optimisation, and an optimisation that cannot be
   * reconstructed is a liability. Returns what changed, so running it and
   * getting an empty list is the proof that the cache and the ledger agree.
   */
  async rebuild() {
    const organizationId = TenantContext.requireOrganizationId();

    const summed = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'locationId', 'batchId'],
      _sum: { quantity: true },
    });
    const truth = new Map(
      summed.map((row) => [
        `${row.productId}:${row.locationId}:${row.batchId}`,
        { ...row, quantity: row._sum.quantity ?? 0 },
      ]),
    );

    const cached = await this.prisma.stockBalance.findMany();
    const drifted: {
      productId: string;
      locationId: string;
      batchId: string;
      was: number;
      now: number;
    }[] = [];

    for (const balance of cached) {
      const key = `${balance.productId}:${balance.locationId}:${balance.batchId}`;
      const expected = truth.get(key)?.quantity ?? 0;
      if (expected !== balance.quantity) {
        drifted.push({
          productId: balance.productId,
          locationId: balance.locationId,
          batchId: balance.batchId,
          was: balance.quantity,
          now: expected,
        });
      }
      truth.delete(key);
    }

    // Whatever the ledger knows about and the cache does not.
    for (const [, row] of truth) {
      drifted.push({
        productId: row.productId,
        locationId: row.locationId,
        batchId: row.batchId,
        was: 0,
        now: row.quantity,
      });
    }

    if (drifted.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.stockBalance.deleteMany({});
        await tx.stockBalance.createMany({
          data: summed.map((row) => ({
            organizationId,
            productId: row.productId,
            locationId: row.locationId,
            batchId: row.batchId,
            quantity: row._sum.quantity ?? 0,
          })),
        });
      });
    }

    return { corrected: drifted.length, drifted };
  }
}
