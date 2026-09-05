import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { Minor } from '../../common/money/money';
import { LIVE_ALLOCATIONS, saleBalance } from '../payments/balance';
import {
  Period,
  PeriodName,
  customPeriod,
  dayKey,
  eachDayKey,
  resolvePeriod,
} from './period';
import { Profit, computeProfit, marginBps } from './profit';
import { ValuedLot, valueOf } from './valuation';

/** Africa/Lagos, unless the organization says otherwise. */
const FALLBACK_TIMEZONE = 'Africa/Lagos';

/** How many rows a "top N" list returns when the caller does not say. */
const TOP_N = 10;

export type SalesGrouping =
  | 'day'
  | 'product'
  | 'category'
  | 'customer'
  | 'location'
  | 'rep'
  | 'tier';

export interface PeriodQuery {
  period?: PeriodName;
  from?: Date;
  to?: Date;
}

/**
 * Profit for a window, plus how much of its cost is estimated rather than
 * invoiced. The annotation travels with the figures so a caller cannot show
 * the margin while quietly dropping the caveat.
 */
export type PeriodProfit = Profit & {
  estimatedCost: Minor;
  estimatedLines: number;
};

export interface SalesGroup {
  key: string;
  label: string;
  /** Tax-inclusive turnover, before returns. */
  grossSales: Minor;
  /** Tax-exclusive, net of returns. */
  revenue: Minor;
  returned: Minor;
  cogs: Minor;
  grossProfit: Minor;
  marginBps: number;
  /** Base units sold, net of what came back. */
  units: number;
  invoices: number;
}

/**
 * Every report the dashboard and the reports screen are built from.
 *
 * **Computed on read, deliberately.** Nothing here is materialised or cached:
 * these are aggregations over rows that are already correct, and the row counts
 * a distributor reaches do not justify a second source of truth that can drift
 * from the first. The day a query is genuinely slow is the day to revisit it —
 * see DECISIONS.md §15, which says exactly this and says to wait for evidence.
 *
 * Two rules run through all of it:
 *
 * - **Periods are resolved in the organization's timezone**, never UTC, via
 *   [`period.ts`](./period.ts). Nothing in this file does date arithmetic.
 * - **Money follows §2.** Revenue is tax-exclusive (`profit.ts`), and stock is
 *   valued from exact lot totals (`valuation.ts`) rather than the rounded
 *   `Product.costPrice` snapshot.
 */
@Injectable()
export class ReportService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  /**
   * The organization's timezone, which every period boundary depends on.
   *
   * `Organization` is the tenant rather than a tenant-owned table, so it is not
   * in `TENANT_SCOPED_MODELS` and is read by id here.
   */
  async timezone(): Promise<string> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: TenantContext.requireOrganizationId() },
      select: { timezone: true },
    });
    return organization?.timezone || FALLBACK_TIMEZONE;
  }

  /** Turns whatever the caller asked for into a concrete window. */
  async resolve(query: PeriodQuery = {}): Promise<Period> {
    const timezone = await this.timezone();

    if (query.from || query.to) {
      if (!query.from || !query.to) {
        throw new BadRequestException(
          'A custom range needs both `from` and `to`. Use `period` for a named window instead.',
        );
      }
      if (query.from > query.to) {
        throw new BadRequestException('`from` is after `to`.');
      }
      return customPeriod(timezone, query.from, query.to);
    }

    return resolvePeriod(query.period ?? 'month', timezone, new Date());
  }

  // -- Profit ---------------------------------------------------------------

  /**
   * Revenue, cost and expenses for a window.
   *
   * Sales and returns are both filtered on their **own** `occurredAt`, which is
   * what makes a return land in the period it happened rather than reopening
   * the month of the sale it reverses (`profit.ts`).
   */
  async profit(period: Period): Promise<PeriodProfit> {
    const window = { gte: period.from, lt: period.to };

    const [sales, returns, expenses] = await Promise.all([
      this.prisma.sale.findMany({
        where: { occurredAt: window },
        select: { total: true, taxTotal: true, costTotal: true },
      }),
      this.prisma.saleReturn.findMany({
        where: { occurredAt: window },
        select: {
          refundAmount: true,
          costAmount: true,
          saleLine: { select: { taxRateBps: true } },
        },
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, occurredAt: window },
        select: { amount: true },
      }),
    ]);

    const profit = computeProfit({
      sales,
      returns: returns.map((row) => ({
        refundAmount: row.refundAmount,
        costAmount: row.costAmount,
        taxRateBps: row.saleLine.taxRateBps,
      })),
      expenses,
    });

    return { ...profit, ...(await this.estimatedCost(period)) };
  }

  /**
   * How much of the period's cost of goods rests on a guess.
   *
   * A line is flagged when goods were sold before the delivery they came from
   * was recorded, so the rate had to be taken from the product's last real lot.
   * The margin is still the best available answer — but an owner reading a thin
   * margin deserves to know which part of it is estimated, rather than having
   * the guess blend invisibly into the facts.
   */
  private async estimatedCost(period: Period) {
    const lines = await this.prisma.saleLine.findMany({
      where: {
        costIsEstimated: true,
        sale: { occurredAt: { gte: period.from, lt: period.to } },
      },
      select: { costOfGoodsSold: true },
    });

    return {
      estimatedCost: lines.reduce((sum, line) => sum + line.costOfGoodsSold, 0),
      estimatedLines: lines.length,
    };
  }

  // -- Sales ----------------------------------------------------------------

  /**
   * Sales sliced by whichever dimension was asked for.
   *
   * Grouping by product or category has to work at **line** level; everything
   * else works at sale level. They are separate paths because a sale spanning
   * three products belongs to three product groups and exactly one customer.
   */
  async sales(period: Period, groupBy: SalesGrouping = 'day') {
    const groups =
      groupBy === 'product' || groupBy === 'category'
        ? await this.salesByLine(period, groupBy)
        : await this.salesBySale(period, groupBy);

    const rows = [...groups.values()].map(finishGroup);
    const totals = await this.profit(period);

    return {
      period: describe(period),
      groupBy,
      rows: sortRows(rows, groupBy),
      totals: {
        grossSales: totals.grossSales,
        revenue: totals.revenue,
        returned: totals.returned,
        cogs: totals.cogs,
        grossProfit: totals.grossProfit,
        marginBps: totals.marginBps,
        invoices: rows.reduce((sum, row) => sum + row.invoices, 0),
      },
    };
  }

  /** Sale-level grouping: by day, customer, location, rep or tier. */
  private async salesBySale(period: Period, groupBy: SalesGrouping) {
    const window = { gte: period.from, lt: period.to };

    const sales = await this.prisma.sale.findMany({
      where: { occurredAt: window },
      select: {
        id: true,
        occurredAt: true,
        total: true,
        taxTotal: true,
        costTotal: true,
        customer: { select: { id: true, firstName: true, lastName: true } },
        location: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
        tier: { select: { id: true, name: true } },
        lines: { select: { baseQuantity: true } },
      },
    });

    const groups = new Map<string, Draft>();

    for (const sale of sales) {
      const { key, label } = saleKey(sale, groupBy, period.timezone);
      const group = draftFor(groups, key, label);

      group.grossSales += sale.total;
      group.tax += sale.taxTotal;
      group.cogs += sale.costTotal;
      group.units += sale.lines.reduce(
        (sum, line) => sum + line.baseQuantity,
        0,
      );
      group.invoices += 1;
    }

    // Returns are attributed to the day they happened, but to the *sale's*
    // customer, location, rep or tier — the goods went back to whoever bought
    // them, whatever today's date is.
    const returns = await this.prisma.saleReturn.findMany({
      where: { occurredAt: window },
      select: {
        occurredAt: true,
        refundAmount: true,
        costAmount: true,
        quantity: true,
        saleLine: { select: { taxRateBps: true, unitFactor: true } },
        sale: {
          select: {
            id: true,
            occurredAt: true,
            customer: { select: { id: true, firstName: true, lastName: true } },
            location: { select: { id: true, name: true } },
            recordedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
            tier: { select: { id: true, name: true } },
          },
        },
      },
    });

    for (const row of returns) {
      const { key, label } =
        groupBy === 'day'
          ? {
              key: dayKey(period.timezone, row.occurredAt),
              label: dayKey(period.timezone, row.occurredAt),
            }
          : saleKey(row.sale, groupBy, period.timezone);

      const group = draftFor(groups, key, label);
      applyReturn(group, row);
    }

    return groups;
  }

  /** Line-level grouping: by product or category. */
  private async salesByLine(period: Period, groupBy: 'product' | 'category') {
    const window = { gte: period.from, lt: period.to };

    const lines = await this.prisma.saleLine.findMany({
      where: { sale: { occurredAt: window } },
      select: {
        saleId: true,
        lineTotal: true,
        taxAmount: true,
        costOfGoodsSold: true,
        baseQuantity: true,
        product: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
    });

    const groups = new Map<string, Draft>();
    const invoicesSeen = new Map<string, Set<string>>();

    for (const line of lines) {
      const { key, label } = lineKey(line.product, groupBy);
      const group = draftFor(groups, key, label);

      group.grossSales += line.lineTotal;
      group.tax += line.taxAmount;
      group.cogs += line.costOfGoodsSold;
      group.units += line.baseQuantity;

      // A three-line invoice is one invoice in each of its product groups, not
      // three, so count distinct sales rather than lines.
      const seen = invoicesSeen.get(key) ?? new Set<string>();
      seen.add(line.saleId);
      invoicesSeen.set(key, seen);
    }

    for (const [key, seen] of invoicesSeen) {
      const group = groups.get(key);
      if (group) group.invoices = seen.size;
    }

    const returns = await this.prisma.saleReturn.findMany({
      where: { occurredAt: window },
      select: {
        refundAmount: true,
        costAmount: true,
        quantity: true,
        saleLine: {
          select: {
            taxRateBps: true,
            unitFactor: true,
            product: {
              select: {
                id: true,
                name: true,
                category: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    for (const row of returns) {
      const { key, label } = lineKey(row.saleLine.product, groupBy);
      applyReturn(draftFor(groups, key, label), row);
    }

    return groups;
  }

  /** The daily series a trend chart draws, with empty days filled in. */
  async dailySales(period: Period) {
    const byDay = await this.salesBySale(period, 'day');

    return eachDayKey(period).map((key) => {
      const group = byDay.get(key);
      return {
        date: key,
        grossSales: group ? group.grossSales : 0,
        revenue: group ? group.grossSales - group.tax - group.returnedExTax : 0,
        invoices: group ? group.invoices : 0,
      };
    });
  }

  /**
   * Money actually received in the window — collections, not sales.
   *
   * `byLocation` is the end-of-shift cash-up: what each counter or van took,
   * which is the question `Payment.locationId` exists to answer. Payments with
   * no location are a real category rather than a gap — a transfer landing in
   * the bank belongs to no till — so they get their own row instead of being
   * dropped or forced onto one.
   */
  async collections(period: Period) {
    const payments = await this.prisma.payment.findMany({
      where: {
        voidedAt: null,
        occurredAt: { gte: period.from, lt: period.to },
      },
      select: {
        amount: true,
        method: true,
        location: { select: { id: true, name: true } },
      },
    });

    const byMethod = new Map<string, Minor>();
    const byLocation = new Map<
      string,
      { label: string; total: Minor; count: number }
    >();

    for (const payment of payments) {
      byMethod.set(
        payment.method,
        (byMethod.get(payment.method) ?? 0) + payment.amount,
      );

      const key = payment.location?.id ?? 'unassigned';
      const row = byLocation.get(key) ?? {
        label: payment.location?.name ?? 'Not at a counter',
        total: 0,
        count: 0,
      };
      row.total += payment.amount;
      row.count += 1;
      byLocation.set(key, row);
    }

    return {
      total: payments.reduce((sum, payment) => sum + payment.amount, 0),
      count: payments.length,
      byMethod: [...byMethod.entries()].map(([method, total]) => ({
        method,
        total,
      })),
      byLocation: [...byLocation.entries()]
        .map(([locationId, row]) => ({ locationId, ...row }))
        .sort((a, b) => b.total - a.total),
    };
  }

  // -- Stock ----------------------------------------------------------------

  /**
   * What the stock on hand cost, from the exact lot totals §2 requires.
   *
   * The grand total is valued over every lot at once rather than by summing the
   * groups, because each group rounds its own fractions — see `valuation.ts`.
   */
  async stockValuation(filter: { locationId?: string; categoryId?: string }) {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { not: 0 },
        ...(filter.locationId && { locationId: filter.locationId }),
        ...(filter.categoryId && {
          product: { categoryId: filter.categoryId },
        }),
      },
      select: {
        quantity: true,
        batch: { select: { totalCost: true, quantityReceived: true } },
        location: { select: { id: true, name: true } },
        product: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
    });

    const lots = balances.map((row) => ({
      quantity: row.quantity,
      totalCost: row.batch.totalCost,
      quantityReceived: row.batch.quantityReceived,
      row,
    }));

    return {
      total: valueOf(lots),
      units: lots.reduce((sum, lot) => sum + lot.quantity, 0),
      byLocation: rollUp(
        lots,
        (lot) => lot.row.location.id,
        (lot) => lot.row.location.name,
      ),
      byCategory: rollUp(
        lots,
        (lot) => lot.row.product.category?.id ?? 'uncategorised',
        (lot) => lot.row.product.category?.name ?? 'Uncategorised',
      ),
      byProduct: rollUp(
        lots,
        (lot) => lot.row.product.id,
        (lot) => lot.row.product.name,
      ).slice(0, 50),
    };
  }

  /**
   * Batches expiring inside a window, and what walking away from them costs.
   *
   * Ordered by expiry, which is the order FEFO will pick them in — so the list
   * reads as "sell these first" rather than as a filing cabinet.
   */
  async expiry(withinDays = 30) {
    const horizon = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        quantity: { gt: 0 },
        batch: { expiryDate: { not: null, lte: horizon } },
      },
      select: {
        quantity: true,
        batch: {
          select: {
            id: true,
            lotCode: true,
            expiryDate: true,
            totalCost: true,
            quantityReceived: true,
          },
        },
        product: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: { batch: { expiryDate: 'asc' } },
    });

    const now = Date.now();
    const batches = balances.map((row) => ({
      batchId: row.batch.id,
      lotCode: row.batch.lotCode,
      expiryDate: row.batch.expiryDate,
      product: row.product,
      location: row.location,
      quantity: row.quantity,
      value: valueOf([
        {
          quantity: row.quantity,
          totalCost: row.batch.totalCost,
          quantityReceived: row.batch.quantityReceived,
        },
      ]),
      daysToExpiry: row.batch.expiryDate
        ? Math.floor((row.batch.expiryDate.getTime() - now) / 86_400_000)
        : null,
    }));

    return {
      withinDays,
      batches,
      valueAtRisk: batches.reduce((sum, batch) => sum + batch.value, 0),
      /** Already past their date and still on the shelf. */
      expired: batches.filter(
        (batch) => batch.daysToExpiry !== null && batch.daysToExpiry < 0,
      ).length,
    };
  }

  /**
   * Stock that needs attention: out, low, or negative.
   *
   * Quantities are summed **across locations**, because `reorderPoint` is a
   * per-product level (§12) — a van being empty is not a reason to reorder if
   * the store is full.
   */
  async stockAlerts() {
    const [products, balances] = await Promise.all([
      this.prisma.product.findMany({
        where: { deletedAt: null, isActive: true, trackStock: true },
        select: { id: true, name: true, sku: true, reorderPoint: true },
      }),
      this.prisma.stockBalance.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
      }),
    ]);

    const onHand = new Map(
      balances.map((row) => [row.productId, row._sum.quantity ?? 0]),
    );

    const withStock = products.map((product) => ({
      ...product,
      quantity: onHand.get(product.id) ?? 0,
    }));

    return {
      outOfStock: withStock.filter((product) => product.quantity === 0),
      // A level of 0 means "tell me when it runs out", which the line above
      // already covers, so low stock is strictly above empty.
      lowStock: withStock.filter(
        (product) =>
          product.reorderPoint !== null &&
          product.quantity > 0 &&
          product.quantity <= product.reorderPoint,
      ),
      negative: withStock.filter((product) => product.quantity < 0),
      /** How many products have no level set, so nobody mistakes the list for complete. */
      withoutReorderPoint: withStock.filter(
        (product) => product.reorderPoint === null,
      ).length,
    };
  }

  /**
   * Movements that someone had to decide about: adjustments, damage, and the
   * forced overrides of §5. The discipline report.
   */
  async stockAudit(period: Period) {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: period.from, lt: period.to },
        OR: [{ isForced: true }, { type: { in: ['adjustment', 'damage'] } }],
      },
      select: {
        id: true,
        type: true,
        quantity: true,
        reason: true,
        isForced: true,
        forcedReason: true,
        createdAt: true,
        product: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byReason = new Map<string, { count: number; quantity: number }>();
    for (const movement of movements) {
      const key = movement.reason ?? movement.type;
      const row = byReason.get(key) ?? { count: 0, quantity: 0 };
      row.count += 1;
      row.quantity += movement.quantity;
      byReason.set(key, row);
    }

    return {
      period: describe(period),
      movements,
      forced: movements.filter((movement) => movement.isForced).length,
      /** Net base units written off or corrected. Negative means stock left. */
      netQuantity: movements.reduce((sum, row) => sum + row.quantity, 0),
      byReason: [...byReason.entries()].map(([reason, row]) => ({
        reason,
        ...row,
      })),
    };
  }

  // -- Products and customers ----------------------------------------------

  /** Best and worst sellers, and what is not moving at all. */
  async products(period: Period, options: { staleDays?: number } = {}) {
    const staleDays = options.staleDays ?? 30;
    const byProduct = [...(await this.salesByLine(period, 'product')).values()]
      .map(finishGroup)
      .sort((a, b) => b.revenue - a.revenue);

    const staleBefore = new Date(Date.now() - staleDays * 86_400_000);

    // Anything held that has not sold in the window: cash sitting on a shelf.
    const [held, recentlySold] = await Promise.all([
      this.prisma.stockBalance.groupBy({
        by: ['productId'],
        where: { quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
      this.prisma.saleLine.findMany({
        where: { sale: { occurredAt: { gte: staleBefore } } },
        select: { productId: true },
        distinct: ['productId'],
      }),
    ]);

    const sold = new Set(recentlySold.map((line) => line.productId));
    const stagnant = held.filter((row) => !sold.has(row.productId));

    const names = await this.prisma.product.findMany({
      where: { id: { in: stagnant.map((row) => row.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const nameOf = new Map(names.map((product) => [product.id, product]));

    return {
      period: describe(period),
      topByRevenue: byProduct.slice(0, TOP_N),
      topByUnits: [...byProduct]
        .sort((a, b) => b.units - a.units)
        .slice(0, TOP_N),
      // Worth reading next to the list above: the two disagree, and the
      // disagreement is where the thin-margin volume lines are.
      byMargin: [...byProduct]
        .filter((row) => row.revenue > 0)
        .sort((a, b) => a.marginBps - b.marginBps)
        .slice(0, TOP_N),
      deadStock: stagnant.map((row) => ({
        product: nameOf.get(row.productId) ?? { id: row.productId },
        quantity: row._sum.quantity ?? 0,
      })),
      staleDays,
    };
  }

  /** Who buys, how much, how recently, and what they still owe. */
  async customers(period: Period) {
    const window = { gte: period.from, lt: period.to };

    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        sales: {
          select: {
            total: true,
            taxTotal: true,
            costTotal: true,
            occurredAt: true,
            allocations: LIVE_ALLOCATIONS,
            returns: { select: { refundAmount: true } },
          },
        },
      },
    });

    const rows = customers.map((customer) => {
      const inPeriod = customer.sales.filter(
        (sale) => sale.occurredAt >= window.gte && sale.occurredAt < window.lt,
      );
      const spendExTax = inPeriod.reduce(
        (sum, sale) => sum + sale.total - sale.taxTotal,
        0,
      );
      const cost = inPeriod.reduce((sum, sale) => sum + sale.costTotal, 0);
      const lastPurchase = customer.sales
        .map((sale) => sale.occurredAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
        },
        invoices: inPeriod.length,
        spend: spendExTax,
        grossProfit: spendExTax - cost,
        marginBps: marginBps(spendExTax - cost, spendExTax),
        /** Every invoice ever, not just this window. */
        lifetimeSpend: customer.sales.reduce(
          (sum, sale) => sum + sale.total - sale.taxTotal,
          0,
        ),
        balance: customer.sales.reduce(
          (sum, sale) => sum + saleBalance(sale).balance,
          0,
        ),
        lastPurchase: lastPurchase ?? null,
      };
    });

    return {
      period: describe(period),
      customers: rows.sort((a, b) => b.spend - a.spend),
      /** Bought before, but not in this window — the ones to ring. */
      lapsed: rows
        .filter((row) => row.invoices === 0 && row.lastPurchase !== null)
        .sort(
          (a, b) =>
            (b.lastPurchase?.getTime() ?? 0) - (a.lastPurchase?.getTime() ?? 0),
        ),
    };
  }
}

// -- Grouping plumbing ------------------------------------------------------

/** A group mid-accumulation, before the derived figures are worked out. */
interface Draft {
  key: string;
  label: string;
  grossSales: Minor;
  tax: Minor;
  cogs: Minor;
  returned: Minor;
  returnedExTax: Minor;
  returnedCost: Minor;
  units: number;
  invoices: number;
}

function draftFor(groups: Map<string, Draft>, key: string, label: string) {
  const existing = groups.get(key);
  if (existing) return existing;

  const created: Draft = {
    key,
    label,
    grossSales: 0,
    tax: 0,
    cogs: 0,
    returned: 0,
    returnedExTax: 0,
    returnedCost: 0,
    units: 0,
    invoices: 0,
  };
  groups.set(key, created);
  return created;
}

function applyReturn(
  group: Draft,
  row: {
    refundAmount: Minor;
    costAmount: Minor;
    quantity: number;
    saleLine: { taxRateBps: number; unitFactor: number };
  },
) {
  // Tax on a refund is derived at the rate the line was sold under, exactly as
  // the sale derived it — never stored twice (§2).
  const net = Math.round(
    (row.refundAmount * 10_000) / (10_000 + row.saleLine.taxRateBps),
  );

  group.returned += row.refundAmount;
  group.returnedExTax += row.refundAmount - net;
  group.returnedCost += row.costAmount;
  group.units -= row.quantity * row.saleLine.unitFactor;
}

function finishGroup(draft: Draft): SalesGroup {
  // `returnedExTax` accumulates the *tax* on refunds; the ex-tax refund value
  // is the refund less that tax.
  const refundExTax = draft.returned - draft.returnedExTax;
  const revenue = draft.grossSales - draft.tax - refundExTax;
  const cogs = draft.cogs - draft.returnedCost;

  return {
    key: draft.key,
    label: draft.label,
    grossSales: draft.grossSales,
    revenue,
    returned: draft.returned,
    cogs,
    grossProfit: revenue - cogs,
    marginBps: marginBps(revenue - cogs, revenue),
    units: draft.units,
    invoices: draft.invoices,
  };
}

function sortRows(rows: SalesGroup[], groupBy: SalesGrouping) {
  // A day series reads in date order; everything else reads biggest first.
  return groupBy === 'day'
    ? rows.sort((a, b) => a.key.localeCompare(b.key))
    : rows.sort((a, b) => b.revenue - a.revenue);
}

interface SaleForKey {
  occurredAt: Date;
  customer: { id: string; firstName: string; lastName: string | null } | null;
  location: { id: string; name: string } | null;
  recordedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  tier: { id: string; name: string } | null;
}

function saleKey(sale: SaleForKey, groupBy: SalesGrouping, timezone: string) {
  switch (groupBy) {
    case 'customer':
      return sale.customer
        ? {
            key: sale.customer.id,
            label: fullName(sale.customer.firstName, sale.customer.lastName),
          }
        : { key: 'walk-in', label: 'Walk-in' };

    case 'location':
      return sale.location
        ? { key: sale.location.id, label: sale.location.name }
        : { key: 'none', label: 'No location' };

    case 'rep':
      return sale.recordedBy
        ? {
            key: sale.recordedBy.id,
            label: fullName(
              sale.recordedBy.firstName,
              sale.recordedBy.lastName,
            ),
          }
        : { key: 'unknown', label: 'Unknown' };

    case 'tier':
      return sale.tier
        ? { key: sale.tier.id, label: sale.tier.name }
        : { key: 'none', label: 'No tier' };

    default: {
      const key = dayKey(timezone, sale.occurredAt);
      return { key, label: key };
    }
  }
}

function lineKey(
  product: {
    id: string;
    name: string;
    category: { id: string; name: string } | null;
  },
  groupBy: 'product' | 'category',
) {
  if (groupBy === 'category') {
    return product.category
      ? { key: product.category.id, label: product.category.name }
      : { key: 'uncategorised', label: 'Uncategorised' };
  }
  return { key: product.id, label: product.name };
}

function rollUp<T extends ValuedLot>(
  lots: readonly T[],
  keyOf: (lot: T) => string,
  labelOf: (lot: T) => string,
) {
  const grouped = new Map<string, { label: string; lots: T[] }>();

  for (const lot of lots) {
    const key = keyOf(lot);
    const bucket = grouped.get(key) ?? { label: labelOf(lot), lots: [] };
    bucket.lots.push(lot);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      value: valueOf(bucket.lots),
      units: bucket.lots.reduce((sum, lot) => sum + lot.quantity, 0),
    }))
    .sort((a, b) => b.value - a.value);
}

function fullName(first: string | null, last: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim() || 'Unnamed';
}

/** The window a response echoes back, so a chart can label its own axis. */
export function describe(period: Period) {
  return {
    name: period.name,
    timezone: period.timezone,
    from: period.from,
    to: period.to,
  };
}
