import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { resolveUnitPrice } from '../catalog/pricing';
import { averageUnitCost, dealOf, unitMargin } from './margins';
import { MarginRow, MarginsView } from './dto/margins.dto';

/**
 * `GET /reports/margins` — today's price beside today's cost, per selling
 * unit (2026-10-07). See `margins.ts` for the arithmetic and why the cost is
 * the average of the stock on hand.
 *
 * Buying-price data, so closed to `sales_rep` like every report that shows
 * cost (§9). Services (`trackStock` off) are left out: they have no cost of
 * goods, so a margin would always read 100%.
 */
@Injectable()
export class MarginService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async margins(
    filter: { tierId?: string; categoryId?: string } = {},
  ): Promise<MarginsView> {
    const [organization, tier] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id: TenantContext.requireOrganizationId() },
        select: { chargesVat: true },
      }),
      this.prisma.priceTier.findFirst({
        where: filter.tierId
          ? { id: filter.tierId, deletedAt: null }
          : { isDefault: true, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (filter.tierId && !tier) {
      throw new NotFoundException('Price list not found');
    }
    const chargesVat = organization?.chargesVat ?? true;

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        trackStock: true,
        ...(filter.categoryId && { categoryId: filter.categoryId }),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        size: true,
        basePrice: true,
        taxRateBps: true,
        category: { select: { id: true, name: true } },
        units: {
          where: { isSellable: true },
          orderBy: { factor: 'asc' },
          select: { id: true, name: true, factor: true },
        },
        prices: { select: { tierId: true, unitId: true, price: true } },
      },
    });
    const ids = products.map((product) => product.id);

    const [balances, deliveries] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { productId: { in: ids }, quantity: { gt: 0 } },
        select: {
          productId: true,
          quantity: true,
          batch: { select: { totalCost: true, quantityReceived: true } },
        },
      }),
      // The newest lot that came in on a delivery, per product. Opening stock
      // and stocktake surpluses are lots too, but not deliveries.
      this.prisma.stockBatch.findMany({
        where: {
          productId: { in: ids },
          quantityReceived: { gt: 0 },
          receiptLine: { isNot: null },
        },
        orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
        distinct: ['productId'],
        select: {
          productId: true,
          receivedAt: true,
          quantityReceived: true,
          quantityPaidFor: true,
          totalCost: true,
        },
      }),
    ]);

    const lotsOf = new Map<string, typeof balances>();
    for (const row of balances) {
      const list = lotsOf.get(row.productId) ?? [];
      list.push(row);
      lotsOf.set(row.productId, list);
    }
    const lastOf = new Map(deliveries.map((lot) => [lot.productId, lot]));

    const rows: MarginRow[] = [];
    for (const product of products) {
      const lots = (lotsOf.get(product.id) ?? []).map((row) => ({
        quantity: row.quantity,
        totalCost: row.batch.totalCost,
        quantityReceived: row.batch.quantityReceived,
      }));
      const onHand = lots.reduce((total, lot) => total + lot.quantity, 0);
      const average = averageUnitCost(lots);
      const last = lastOf.get(product.id);
      // Exact, unrounded: the lot total over everything it brought in (§2).
      const lastUnitCost = last ? last.totalCost / last.quantityReceived : null;
      // With nothing on the shelf, the last delivery is the best cost there
      // is — and the row says that is where it came from.
      const baseCost = average ?? lastUnitCost;
      const costFrom =
        average !== null ? 'on_hand' : last ? 'last_delivery' : null;
      const taxRateBps = chargesVat ? product.taxRateBps : 0;

      for (const unit of product.units) {
        const { price } = resolveUnitPrice(product, unit, tier?.id);
        // Rounded once, for the whole selling unit (§2).
        const cost =
          baseCost === null ? null : Math.round(baseCost * unit.factor);
        const margin =
          price !== null && cost !== null
            ? unitMargin({ price, taxRateBps, unitCost: cost })
            : null;

        rows.push({
          productId: product.id,
          productName: product.name,
          size: product.size,
          category: product.category,
          unitId: unit.id,
          unitName: unit.name,
          factor: unit.factor,
          price,
          cost,
          costFrom,
          onHand,
          margin: margin?.margin ?? null,
          marginBps: margin?.marginBps ?? null,
          lastDelivery:
            last && lastUnitCost !== null
              ? {
                  receivedAt: last.receivedAt,
                  cost: Math.round(lastUnitCost * unit.factor),
                  deal: dealOf(last.quantityReceived, last.quantityPaidFor),
                }
              : null,
        });
      }
    }

    return { tier, chargesVat, rows: rows.sort(byThinnestFirst) };
  }
}

/** Thinnest margin first; then rows with no cost; then rows with no price. */
function byThinnestFirst(a: MarginRow, b: MarginRow): number {
  const rank = (row: MarginRow) =>
    row.marginBps !== null ? 0 : row.price !== null ? 1 : 2;
  return (
    rank(a) - rank(b) ||
    (a.marginBps ?? 0) - (b.marginBps ?? 0) ||
    a.productName.localeCompare(b.productName)
  );
}
