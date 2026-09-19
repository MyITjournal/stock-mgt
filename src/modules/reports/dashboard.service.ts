import { Injectable } from '@nestjs/common';
import { ReceivableService } from '../payments/receivable.service';
import { PayableService } from '../payables/payable.service';
import { resolvePeriod } from './period';
import { ReportService, describe } from './report.service';

/** How many rows each attention list shows before it stops being a glance. */
const GLANCE = 5;

/**
 * The one call the home screen makes.
 *
 * Deliberately a single endpoint rather than nine. A rep opening the app on a
 * phone over a Nigerian mobile connection pays a round trip for each request,
 * and a dashboard that fires nine of them feels broken long before it is slow.
 *
 * The shape follows the questions an owner actually asks in the morning, in
 * that order: what did I sell, did I actually get paid, what do people owe me,
 * am I making money, what is about to go wrong, and what is moving.
 *
 * **Sales and collections are separate numbers and that is the point.** On a
 * credit route they diverge constantly, and conflating them is how a business
 * reads a good month while running out of cash. Everything else on here is
 * ordinary arithmetic; this pair is the insight.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly reports: ReportService,
    private readonly receivables: ReceivableService,
    private readonly payables: PayableService,
  ) {}

  async build() {
    const timezone = await this.reports.timezone();
    const now = new Date();

    const today = resolvePeriod('today', timezone, now);
    const month = resolvePeriod('month', timezone, now);
    const lastMonth = resolvePeriod('last-month', timezone, now);
    const trend = resolvePeriod('last-30-days', timezone, now);

    const [
      todayProfit,
      monthProfit,
      lastMonthProfit,
      todayCollections,
      monthCollections,
      owed,
      alerts,
      expiring,
      movers,
      daily,
      audit,
      owedToVendors,
      monthPurchases,
    ] = await Promise.all([
      this.reports.profit(today),
      this.reports.profit(month),
      this.reports.profit(lastMonth),
      this.reports.collections(today),
      this.reports.collections(month),
      this.receivables.outstanding(),
      this.reports.stockAlerts(),
      this.reports.expiry(30),
      this.reports.products(month),
      this.reports.dailySales(trend),
      this.reports.stockAudit(month),
      this.payables.outstanding(),
      this.reports.purchases(month),
    ]);

    return {
      generatedAt: now,
      timezone,
      periods: { today: describe(today), month: describe(month) },

      // 1. What did I sell?
      sales: {
        today: todayProfit.revenue,
        todayGross: todayProfit.grossSales,
        month: monthProfit.revenue,
        monthGross: monthProfit.grossSales,
        lastMonth: lastMonthProfit.revenue,
        changeBps: changeBps(lastMonthProfit.revenue, monthProfit.revenue),
      },

      // 2. Did I actually get paid? Not the same question.
      collections: {
        today: todayCollections.total,
        month: monthCollections.total,
        byMethod: monthCollections.byMethod,
        /** Sold on credit this month and not yet collected. */
        uncollectedThisMonth: monthProfit.grossSales - monthCollections.total,
      },

      // 3. What do people owe me?
      receivables: {
        total: owed.totalOutstanding,
        invoices: owed.invoices.length,
        oldestDays: owed.byCustomer[0]?.oldestDays ?? 0,
        topDebtors: owed.byCustomer.slice(0, GLANCE),
      },

      // 4. Am I making money?
      profit: {
        revenue: monthProfit.revenue,
        cogs: monthProfit.cogs,
        grossProfit: monthProfit.grossProfit,
        expenses: monthProfit.expenses,
        operatingProfit: monthProfit.operatingProfit,
        marginBps: monthProfit.marginBps,
        // How much of the month rests on a cost we had to guess.
        estimatedCost: monthProfit.estimatedCost,
        estimatedLines: monthProfit.estimatedLines,
        lastMonthOperating: lastMonthProfit.operatingProfit,
      },

      // 5. What is about to go wrong?
      attention: {
        expiringSoon: expiring.batches.slice(0, GLANCE),
        expiringCount: expiring.batches.length,
        valueAtRisk: expiring.valueAtRisk,
        expired: expiring.expired,
        outOfStock: alerts.outOfStock.slice(0, GLANCE),
        outOfStockCount: alerts.outOfStock.length,
        lowStock: alerts.lowStock.slice(0, GLANCE),
        lowStockCount: alerts.lowStock.length,
        negativeStock: alerts.negative,
        productsWithoutReorderPoint: alerts.withoutReorderPoint,
        forcedMovements: audit.forced,
      },

      // 6. What is moving, and what is not?
      movers: {
        topByRevenue: movers.topByRevenue.slice(0, GLANCE),
        topByUnits: movers.topByUnits.slice(0, GLANCE),
        deadStock: movers.deadStock.slice(0, GLANCE),
        deadStockCount: movers.deadStock.length,
      },

      /**
       * 7. What did I buy, and what do I still owe for it?
       *
       * The buying half of the morning, and the half a retail shop asks about
       * first — a distributor watches its vendor targets, a shop watches what it
       * owes. `payables.total` is the headline: one figure, and the web
       * dashboard drills into `topVendors` or the full `GET /payables` list.
       *
       * Safe to put here because this endpoint is already owner, manager and
       * accountant only. The note in DECISIONS.md §12 keeping targets off the
       * dashboard — "targetValue is a buying price and reps see the dashboard"
       * — described a risk that had already been closed by the role on the
       * route; reps cannot reach this at all.
       */
      purchasing: {
        payables: {
          total: owedToVendors.total,
          bills: owedToVendors.bills.length,
          suppliers: owedToVendors.suppliers,
          oldestDays: owedToVendors.oldestDays ?? 0,
          /** Past the date the business said it would pay, where it said one. */
          overdue: owedToVendors.overdue,
          topVendors: owedToVendors.bySupplier.slice(0, GLANCE),
        },
        purchases: {
          month: monthPurchases.total,
          deliveries: monthPurchases.deliveries,
          suppliers: monthPurchases.suppliers,
          unitsReceived: monthPurchases.unitsReceived,
          /** Units that arrived without being charged for. */
          unitsFree: monthPurchases.unitsFree,
          topVendors: monthPurchases.bySupplier.slice(0, GLANCE),
          topCategories: monthPurchases.byCategory.slice(0, GLANCE),
        },
      },

      trend: { days: daily },
    };
  }
}

/**
 * Change from one period to the next, in basis points (2500 = up 25%).
 *
 * No previous revenue means no percentage exists — returning 0 rather than
 * Infinity, on the same reasoning as `marginBps`.
 */
function changeBps(previous: number, current: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000);
}
