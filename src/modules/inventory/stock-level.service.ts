import { StockAdjustmentReason } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { callerSeesCost } from '../../common/authz/cost-visibility';
import {
  ExpiringBatchRow,
  ForcedMovementView,
  RebuildBalancesView,
  StockLevelRow,
} from './dto/stock.response';
import { COUNT_UNITS } from './dto/count-unit.response';

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
   * Stock on hand, one row per product, option and location, with the batches
   * that make it up when asked for. Each option is a row of its own: on the
   * shelf an option is an item (owner, 2026-10-08; DECISIONS.md §24).
   */
  async findLevels(filter: LevelFilter = {}): Promise<StockLevelRow[]> {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        ...(filter.productId && { productId: filter.productId }),
        ...(filter.locationId && { locationId: filter.locationId }),
        ...(filter.includeEmpty ? {} : { quantity: { not: 0 } }),
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            units: COUNT_UNITS,
            // Only whether it has options, for the leftover rows below.
            variants: { select: { id: true }, take: 1 },
          },
        },
        variant: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        batch: {
          select: {
            id: true,
            lotCode: true,
            expiryDate: true,
            receivedAt: true,
            quantityReceived: true,
            totalCost: true,
            receiptLine: { select: { id: true } },
            movements: {
              where: { reason: StockAdjustmentReason.opening_balance },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      // A product's options together and in its own order, before location.
      orderBy: [
        { productId: 'asc' },
        { variant: { sortOrder: 'asc' } },
        { locationId: 'asc' },
      ],
    });

    // Asked once for the whole page rather than per batch: the role cannot
    // change halfway through a request.
    const seesCost = callerSeesCost();

    const grouped = new Map<
      string,
      {
        product: { id: string; name: string; sku: string };
        variant: { id: string; name: string } | null;
        location: { id: string; name: string };
        units: { name: string; factor: number }[];
        quantity: number;
        batches: {
          batchId: string;
          quantity: number;
          lotCode: string | null;
          expiryDate: Date | null;
          /**
           * Exact, from the invoice. The ratio is the derived figure.
           *
           * Absent entirely for a role that may not see cost — this is a buying
           * price, and `includeBatches=true` was handing it to any member.
           */
          unitCost?: number | null;
          isOpening: boolean;
        }[];
      }
    >();

    for (const balance of balances) {
      // The empty "no option" balance a product leaves behind when its stock
      // moves into its first option (`moveIntoVariant`). Shown, it would be a
      // card at zero naming no option, whose Adjust and Move can only refuse.
      if (
        balance.variantId === null &&
        balance.quantity === 0 &&
        balance.product.variants.length > 0
      ) {
        continue;
      }

      const key = `${balance.productId}:${balance.variantId ?? '-'}:${balance.locationId}`;
      const row = grouped.get(key) ?? {
        product: {
          id: balance.product.id,
          name: balance.product.name,
          sku: balance.product.sku,
        },
        variant: balance.variant,
        location: balance.location,
        units: balance.product.units,
        quantity: 0,
        batches: [],
      };

      row.quantity += balance.quantity;
      row.batches.push({
        batchId: balance.batchId,
        quantity: balance.quantity,
        lotCode: balance.batch.lotCode,
        expiryDate: balance.batch.expiryDate,
        // Opening stock: entered with a cost, never on a delivery.
        isOpening:
          !balance.batch.receiptLine && balance.batch.movements.length > 0,
        ...(seesCost && {
          unitCost:
            balance.batch.quantityReceived > 0
              ? balance.batch.totalCost / balance.batch.quantityReceived
              : null,
        }),
      });

      grouped.set(key, row);
    }

    return [...grouped.values()].map((row) => ({
      product: row.product,
      variant: row.variant,
      location: row.location,
      units: row.units,
      quantity: row.quantity,
      ...(filter.includeBatches ? { batches: row.batches } : {}),
    }));
  }

  /**
   * Batches with stock left that expire on or before a date — the list someone
   * walks the shelves with. Ordered soonest first, which is the order FEFO
   * would sell them in anyway.
   */
  async findExpiring(
    before: Date,
    locationId?: string,
  ): Promise<ExpiringBatchRow[]> {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        ...(locationId && { locationId }),
        batch: { expiryDate: { not: null, lte: before } },
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true, units: COUNT_UNITS },
        },
        variant: { select: { id: true, name: true } },
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

    const seesCost = callerSeesCost();

    return balances
      .map((balance) => ({
        product: {
          id: balance.product.id,
          name: balance.product.name,
          sku: balance.product.sku,
        },
        units: balance.product.units,
        variant: balance.variant,
        location: balance.location,
        batchId: balance.batchId,
        lotCode: balance.batch.lotCode,
        expiryDate: balance.batch.expiryDate,
        quantity: balance.quantity,
        /**
         * What walks out of the door if this is not sold in time — a cost, so
         * it is withheld from a role that may not see cost. The list itself
         * stays open: a storekeeper walking the shelves needs to know which
         * lots to push, and that is not a cost question.
         */
        ...(seesCost && {
          valueAtRisk:
            balance.batch.quantityReceived > 0
              ? Math.round(
                  (balance.batch.totalCost / balance.batch.quantityReceived) *
                    balance.quantity,
                )
              : 0,
        }),
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
  findForced(since?: Date): Promise<ForcedMovementView[]> {
    return this.prisma.stockMovement.findMany({
      where: { isForced: true, ...(since && { occurredAt: { gte: since } }) },
      orderBy: { occurredAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        variant: { select: { id: true, name: true } },
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
  async rebuild(): Promise<RebuildBalancesView> {
    const organizationId = TenantContext.requireOrganizationId();

    // The option is part of the grain: one lot can hold two options' stock
    // after `moveIntoVariant`, and those are two balances, not one.
    const summed = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'variantId', 'locationId', 'batchId'],
      _sum: { quantity: true },
    });
    const keyOf = (row: {
      productId: string;
      variantId: string | null;
      locationId: string;
      batchId: string;
    }) =>
      `${row.productId}:${row.variantId ?? '-'}:${row.locationId}:${row.batchId}`;
    const truth = new Map(
      summed.map((row) => [
        keyOf(row),
        { ...row, quantity: row._sum.quantity ?? 0 },
      ]),
    );

    const cached = await this.prisma.stockBalance.findMany();
    const drifted: {
      productId: string;
      variantId: string | null;
      locationId: string;
      batchId: string;
      was: number;
      now: number;
    }[] = [];

    for (const balance of cached) {
      const key = keyOf(balance);
      const expected = truth.get(key)?.quantity ?? 0;
      if (expected !== balance.quantity) {
        drifted.push({
          productId: balance.productId,
          variantId: balance.variantId,
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
        variantId: row.variantId,
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
            variantId: row.variantId,
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
