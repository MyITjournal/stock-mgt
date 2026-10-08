import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { resolveUnitPrice } from '../catalog/pricing';
import {
  averageUnitCost,
  dealOf,
  projectSale,
  projectionTotals,
  unitMargin,
} from './margins';
import { MarginRow, MarginsView } from './dto/margins.dto';
import { itemKey } from './options';

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
        prices: {
          select: { tierId: true, unitId: true, variantId: true, price: true },
        },
        // Retired options are left out: they can no longer be sold.
        variants: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true },
        },
      },
    });
    const ids = products.map((product) => product.id);

    const [balances, deliveries, optionDeliveries] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { productId: { in: ids }, quantity: { gt: 0 } },
        select: {
          productId: true,
          variantId: true,
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
      // The newest delivery of each option. The figures are the lot's, which
      // take any correction, as above.
      this.prisma.goodsReceiptLine.findMany({
        where: {
          productId: { in: ids },
          variantId: { not: null },
          batch: { quantityReceived: { gt: 0 } },
        },
        orderBy: [{ batch: { receivedAt: 'desc' } }, { createdAt: 'desc' }],
        distinct: ['productId', 'variantId'],
        select: {
          productId: true,
          variantId: true,
          batch: {
            select: {
              receivedAt: true,
              quantityReceived: true,
              quantityPaidFor: true,
              totalCost: true,
            },
          },
        },
      }),
    ]);

    // Keyed by product and option (`itemKey`): each option's own lots.
    const lotsOf = new Map<string, typeof balances>();
    for (const row of balances) {
      const key = itemKey(row.productId, row.variantId);
      const list = lotsOf.get(key) ?? [];
      list.push(row);
      lotsOf.set(key, list);
    }
    const lastOf = new Map<string, (typeof deliveries)[number]>(
      deliveries.map((lot) => [lot.productId, lot]),
    );
    for (const line of optionDeliveries) {
      lastOf.set(itemKey(line.productId, line.variantId), {
        productId: line.productId,
        ...line.batch,
      });
    }

    const rows: MarginRow[] = [];
    // The stock on hand sold at today's carton price: exact parts, summed
    // and rounded once at the end.
    const projected: { revenue: number; cost: number }[] = [];
    let unpriced = 0;
    // A row per option (owner, 2026-10-08): an option can have its own price,
    // and its own cost — the lots it holds.
    const items = products.flatMap((product) => {
      const options: ({ id: string; name: string } | null)[] =
        product.variants.length > 0 ? product.variants : [null];
      return options.map((variant) => ({ product, variant }));
    });
    for (const { product, variant } of items) {
      const key = itemKey(product.id, variant?.id);
      const lots = (lotsOf.get(key) ?? []).map((row) => ({
        quantity: row.quantity,
        totalCost: row.batch.totalCost,
        quantityReceived: row.batch.quantityReceived,
      }));
      const onHand = lots.reduce((total, lot) => total + lot.quantity, 0);
      const average = averageUnitCost(lots);
      // An option never delivered as itself — its stock came from before it
      // had options — takes the product's last delivery.
      const last = lastOf.get(key) ?? lastOf.get(product.id);
      // Exact, unrounded: the lot total over everything it brought in (§2).
      const lastUnitCost = last ? last.totalCost / last.quantityReceived : null;
      // With nothing on the shelf, the last delivery is the best cost there
      // is — and the row says that is where it came from.
      const baseCost = average ?? lastUnitCost;
      const costFrom =
        average !== null ? 'on_hand' : last ? 'last_delivery' : null;
      const taxRateBps = chargesVat ? product.taxRateBps : 0;

      // One row per product, in the **biggest unit the till sells** (owner,
      // 2026-10-07): a 1/2 pack, a pack and a carton of the same lotion are the
      // same margin at three sizes, and three rows of it made the report three
      // times as long to read. The carton is how a wholesaler thinks of it.
      const biggest = product.units.at(-1);
      for (const unit of biggest ? [biggest] : []) {
        const { price } = resolveUnitPrice(
          product,
          unit,
          tier?.id,
          variant?.id,
        );
        // Rounded once, for the whole selling unit (§2).
        const cost =
          baseCost === null ? null : Math.round(baseCost * unit.factor);
        const margin =
          price !== null && cost !== null
            ? unitMargin({ price, taxRateBps, unitCost: cost })
            : null;
        const part =
          margin && onHand > 0 && baseCost !== null
            ? projectSale({
                onHand,
                unitFactor: unit.factor,
                netPrice: margin.netPrice,
                baseCost,
              })
            : null;
        if (part) projected.push(part);
        // On the shelf with no price: left out of the projection, and
        // counted so the screen can say so rather than look complete.
        if (onHand > 0 && price === null) unpriced += 1;

        rows.push({
          productId: product.id,
          productName: product.name,
          variant,
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
          projectedProfit: part ? Math.round(part.revenue - part.cost) : null,
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

    return {
      tier,
      chargesVat,
      rows: rows.sort(byThinnestFirst),
      projection: { ...projectionTotals(projected), unpriced },
    };
  }
}

/** Thinnest margin first; then rows with no cost; then rows with no price. */
function byThinnestFirst(a: MarginRow, b: MarginRow): number {
  const rank = (row: MarginRow) =>
    row.marginBps !== null ? 0 : row.price !== null ? 1 : 2;
  return (
    rank(a) - rank(b) ||
    (a.marginBps ?? 0) - (b.marginBps ?? 0) ||
    a.productName.localeCompare(b.productName) ||
    (a.variant?.name ?? '').localeCompare(b.variant?.name ?? '')
  );
}
