import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import type { Period } from './period';
import { describe } from './report.service';
import { summariseStock } from './stock-summary';
import { StockSummaryView } from './dto/stock-summary.dto';

/**
 * `GET /reports/stock-summary` — opening, delivered, sold, adjusted and what
 * was left, per product, for a period (2026-10-07). The arithmetic is in
 * `stock-summary.ts`; this is two grouped reads of the ledger and the names.
 *
 * **By `occurredAt`**, like every report — a sale dated last Tuesday counts in
 * last Tuesday — and summed straight from the movements, so it can never
 * disagree with the ledger smoke checks. Quantities only, no cost: open to
 * every role, like the reorder list.
 */
@Injectable()
export class StockSummaryService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async summary(period: Period): Promise<StockSummaryView> {
    const [before, during] = await Promise.all([
      this.prisma.stockMovement.groupBy({
        by: ['productId'],
        where: { occurredAt: { lt: period.from } },
        _sum: { quantity: true },
      }),
      this.prisma.stockMovement.groupBy({
        by: ['productId', 'type', 'reason'],
        where: { occurredAt: { gte: period.from, lt: period.to } },
        _sum: { quantity: true },
      }),
    ]);

    const lines = summariseStock(
      new Map(before.map((row) => [row.productId, row._sum.quantity ?? 0])),
      during.map((row) => ({
        productId: row.productId,
        type: row.type,
        reason: row.reason,
        quantity: row._sum.quantity ?? 0,
      })),
    );
    const byId = new Map(lines.map((line) => [line.productId, line]));

    const products = await this.prisma.product.findMany({
      where: { id: { in: [...byId.keys()] } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        size: true,
        units: {
          orderBy: { factor: 'asc' },
          select: { name: true, factor: true },
        },
      },
    });

    return {
      period: describe(period),
      rows: products.map((product) => {
        const line = byId.get(product.id)!;
        return {
          product: { id: product.id, name: product.name, size: product.size },
          units: product.units,
          opening: line.opening,
          delivered: line.delivered,
          sold: line.sold,
          adjusted: line.adjusted,
          closing: line.closing,
        };
      }),
    };
  }
}
