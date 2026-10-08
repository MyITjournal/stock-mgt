import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { callerSeesCost } from '../../common/authz/cost-visibility';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import type { Period } from './period';
import { describe } from './report.service';
import { summariseStock } from './stock-summary';
import { itemKey, itemLabel } from './options';
import { StockSummaryView } from './dto/stock-summary.dto';

/**
 * `GET /reports/stock-summary` — opening, delivered, sold, adjusted and what
 * was left, per product, for a period (2026-10-07). The arithmetic is in
 * `stock-summary.ts`; this is two grouped reads of the ledger and the names.
 *
 * **By `occurredAt`**, like every report — a sale dated last Tuesday counts in
 * last Tuesday — and summed straight from the movements, so it can never
 * disagree with the ledger smoke checks. Quantities are open to every role,
 * like the reorder list; **values** — each movement at its lot's exact cost —
 * are added for a role that may see cost, so opening stock value + purchases
 * − cost of what sold ± adjustments can be checked against the stock value.
 */
@Injectable()
export class StockSummaryService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async summary(period: Period): Promise<StockSummaryView> {
    // Values are buying prices: worked out only for a role that may see cost,
    // and absent — never zero — for anyone else (§9).
    const withValue = callerSeesCost();
    // Per option (§24): moving stock between options is a pair of movements
    // on one lot, so it shows on both rows and the product still adds up.
    const by = withValue
      ? (['productId', 'variantId', 'batchId'] as const)
      : (['productId', 'variantId'] as const);
    const [before, during] = await Promise.all([
      this.prisma.stockMovement.groupBy({
        by: [...by],
        where: { occurredAt: { lt: period.from } },
        _sum: { quantity: true },
      }),
      this.prisma.stockMovement.groupBy({
        by: [...by, 'type', 'reason'],
        where: { occurredAt: { gte: period.from, lt: period.to } },
        _sum: { quantity: true },
      }),
    ]);

    // Each lot's exact cost of one base unit — the ratio valuation uses (§2).
    const rate = new Map<string, number>();
    if (withValue) {
      const batchIds = [
        ...new Set(
          [...before, ...during].map(
            (row) => (row as { batchId: string }).batchId,
          ),
        ),
      ];
      const lots = await this.prisma.stockBatch.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, totalCost: true, quantityReceived: true },
      });
      for (const lot of lots) {
        rate.set(
          lot.id,
          lot.quantityReceived > 0 ? lot.totalCost / lot.quantityReceived : 0,
        );
      }
    }
    const valueOf = (row: object, quantity: number) =>
      withValue
        ? quantity * (rate.get((row as { batchId: string }).batchId) ?? 0)
        : undefined;

    const opening = new Map<string, { quantity: number; value?: number }>();
    // Which product and option each line's key stands for.
    const items = new Map<
      string,
      { productId: string; variantId: string | null }
    >();
    const keyOf = (row: { productId: string; variantId: string | null }) => {
      const key = itemKey(row.productId, row.variantId);
      items.set(key, { productId: row.productId, variantId: row.variantId });
      return key;
    };
    for (const row of before) {
      const quantity = row._sum.quantity ?? 0;
      const key = keyOf(row);
      const sum = opening.get(key) ?? {
        quantity: 0,
        ...(withValue && { value: 0 }),
      };
      sum.quantity += quantity;
      if (withValue) sum.value = (sum.value ?? 0) + valueOf(row, quantity)!;
      opening.set(key, sum);
    }

    const { lines, totalValue, availableValue } = summariseStock(
      opening,
      during.map((row) => {
        const quantity = row._sum.quantity ?? 0;
        return {
          key: keyOf(row),
          type: row.type,
          reason: row.reason,
          quantity,
          ...(withValue && { value: valueOf(row, quantity) }),
        };
      }),
    );
    const productIds = [
      ...new Set(lines.map((line) => items.get(line.key)!.productId)),
    ];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        size: true,
        units: {
          orderBy: { factor: 'asc' },
          select: { name: true, factor: true },
        },
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true },
        },
      },
    });
    const productOf = new Map(products.map((product) => [product.id, product]));
    const rank = new Map(products.map((product, index) => [product.id, index]));

    // By product name, then the "before options" row, then options in the
    // product's own order — so a family reads together.
    const optionRank = (productId: string, variantId: string | null) =>
      variantId === null
        ? -1
        : (productOf
            .get(productId)
            ?.variants.findIndex((variant) => variant.id === variantId) ?? 0);
    const ordered = lines
      .map((line) => ({ line, item: items.get(line.key)! }))
      .filter(({ item }) => productOf.has(item.productId))
      .sort(
        (a, b) =>
          rank.get(a.item.productId)! - rank.get(b.item.productId)! ||
          optionRank(a.item.productId, a.item.variantId) -
            optionRank(b.item.productId, b.item.variantId),
      );

    return {
      period: describe(period),
      rows: ordered.map(({ line, item }) => {
        const product = productOf.get(item.productId)!;
        const variant =
          product.variants.find((option) => option.id === item.variantId) ??
          null;
        return {
          key: line.key,
          label: itemLabel(product, variant),
          product: { id: product.id, name: product.name, size: product.size },
          variant,
          units: product.units,
          opening: line.opening,
          delivered: line.delivered,
          sold: line.sold,
          adjusted: line.adjusted,
          closing: line.closing,
          ...(line.value && { value: line.value }),
        };
      }),
      ...(totalValue && { totalValue, availableValue }),
    };
  }
}
