import { Injectable } from '@nestjs/common';
import { ReceivableService } from '../payments/receivable.service';
import { PayableService } from '../payables/payable.service';
import { resolvePeriod } from './period';
import { marginBps, shareBps } from './profit';
import { ReportService, describe } from './report.service';
import { PurchaseTargetService } from './purchase-target.service';
import { StockSummaryService } from './stock-summary.service';
import { SessionsService } from '../staff/sessions.service';
import { GrowthService } from './growth.service';
import { DashboardView } from './dto/dashboard.response';

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
    private readonly targets: PurchaseTargetService,
    private readonly stockSummary: StockSummaryService,
    private readonly sessions: SessionsService,
    private readonly growthService: GrowthService,
  ) {}

  async build(): Promise<DashboardView> {
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
      monthStock,
      signedIn,
      monthTargets,
      paidToVendors,
      growth,
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
      this.stockSummary.summary(month),
      this.sessions.summary(),
      // No period: the target report defaults to this month in the shop's
      // timezone, which is the month every other figure here is.
      this.targets.report(),
      this.payables.paidBetween(month),
      // This month so far beside the same stretch of last month (2026-10-08).
      this.growthService.thisMonth(timezone, now),
    ]);

    const paidShareBps = shareBps(
      monthCollections.total,
      monthProfit.grossSales,
    );

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
        // Against the same days of last month, not all of it (2026-10-08):
        // eight days of October set against thirty of September read as a
        // collapse every month until its last week. 0 when there is nothing
        // to compare with, as before; `growth.change.revenue` says null.
        changeBps: growth.change.revenue ?? 0,
      },

      // 2. Did I actually get paid? Not the same question.
      collections: {
        today: todayCollections.total,
        month: monthCollections.total,
        byMethod: monthCollections.byMethod,
        /** Sold on credit this month and not yet collected. */
        uncollectedThisMonth: monthProfit.grossSales - monthCollections.total,
        // Both against what was sold *with* VAT (2026-10-07, owner) — the
        // figure the two of them add up to, so the shares make 100% together.
        // Against revenue they would not, by exactly the VAT.
        // The second is the rest of the first, so rounding can never make
        // them 99.9% or 100.1% between them.
        paidShareBps,
        uncollectedShareBps:
          paidShareBps === null ? null : 10_000 - paidShareBps,
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
        // The rest of the margin, so the two always make 100% of revenue.
        cogsShareBps:
          monthProfit.revenue === 0 ? 0 : 10_000 - monthProfit.marginBps,
        expensesShareBps: marginBps(monthProfit.expenses, monthProfit.revenue),
        operatingMarginBps: marginBps(
          monthProfit.operatingProfit,
          monthProfit.revenue,
        ),
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
          /** Paid to vendors this month — the other half of what is owed. */
          paidThisMonth: paidToVendors,
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
        /**
         * This month's vendor targets, in cartons — every one, not a glance:
         * a distributor has a handful and watches all of them. Shown as one
         * doughnut each. Empty for a shop with none, which is most retail.
         */
        targets: monthTargets.targets.map((target) => ({
          id: target.id,
          supplier: target.supplier.name,
          category: target.category.name,
          targetCartons: target.progress.targetCartons,
          achievedCartons: target.progress.achievedCartons,
          remainingCartons: target.progress.remainingCartons,
          achievedBps: target.progress.achievedBps,
        })),
        /** This month's money targets, one doughnut each beside the cartons. */
        moneyTargets: monthTargets.moneyTargets.map((target) => ({
          id: target.id,
          supplier: target.supplier.name,
          amount: target.amount,
          addsVat: target.addsVat,
          counted: target.counted,
          remaining: target.remaining,
          achievedBps: target.achievedBps,
        })),
      },

      trend: { days: daily },

      // 11. Am I growing? Every figure against the same stretch of last month.
      growth,

      // 10. Who is working right now? The same count as Settings → Staff.
      signedIn: {
        people: signedIn.activePeople,
        devices: signedIn.activeDevices,
      },

      // 9. What stock did I handle this month? Opening + delivered, at cost —
      // from the same ledger walk as Reports → Stock, so the two agree.
      ...(monthStock.totalValue && {
        stock: {
          opening: monthStock.totalValue.opening,
          delivered: monthStock.totalValue.delivered,
          available: monthStock.availableValue!,
        },
      }),
    };
  }
}
