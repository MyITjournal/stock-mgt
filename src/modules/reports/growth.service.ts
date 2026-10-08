import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import {
  monthKey,
  monthPeriod,
  resolvePeriod,
  sameSpanLastMonth,
  type Period,
} from './period';
import { ReportService } from './report.service';
import {
  averageSale,
  compareGrowth,
  countFirstPurchases,
  type GrowthFigures,
} from './growth';
import {
  GrowthComparisonView,
  GrowthMonthView,
  GrowthReportView,
} from './dto/growth.dto';

/**
 * Is the business growing (2026-10-08) — the Home panel and Reports → Growth.
 *
 * Every money figure comes from the reports that already exist: revenue,
 * gross and operating profit from `ReportService.profit`, collected from
 * `collections` — so growth can never disagree with the profit report for the
 * same month. What is new is counting sales and buyers, and **comparing a
 * month so far with the same stretch of the month before** (`period.ts`).
 */
@Injectable()
export class GrowthService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly reports: ReportService,
  ) {}

  /** This month so far, beside the same days and hours of last month. */
  async thisMonth(timezone: string, now: Date): Promise<GrowthComparisonView> {
    const current = resolvePeriod('month', timezone, now);
    const previous = sameSpanLastMonth(timezone, now);
    const firsts = await this.firstPurchases();
    const [currentFigures, previousFigures] = await Promise.all([
      this.figures(current, firsts),
      this.figures(previous, firsts),
    ]);
    return {
      currentFrom: current.from,
      currentTo: now,
      previousFrom: previous.from,
      previousTo: previous.to,
      current: currentFigures,
      previous: previousFigures,
      change: compareGrowth(currentFigures, previousFigures),
    };
  }

  /**
   * Month by month, oldest first, ending with this one. Each full month is
   * compared with the whole month before it; **this month, being partial, with
   * the same stretch of last month** — the comparison Home makes.
   */
  async months(count: number): Promise<GrowthReportView> {
    const timezone = await this.reports.timezone();
    const now = new Date();
    const firsts = await this.firstPurchases();

    // One month more than shown, so the oldest row has something before it.
    const periods = Array.from({ length: count + 1 }, (_, index) =>
      monthPeriod(timezone, now, index - count),
    );
    const [all, sameSpan] = await Promise.all([
      Promise.all(periods.map((period) => this.figures(period, firsts))),
      this.figures(sameSpanLastMonth(timezone, now), firsts),
    ]);

    const months: GrowthMonthView[] = periods.slice(1).map((period, index) => {
      const partial = index === count - 1;
      const figures = all[index + 1];
      return {
        month: monthKey(timezone, period.from),
        from: period.from,
        to: partial ? now : period.to,
        partial,
        figures,
        change: compareGrowth(figures, partial ? sameSpan : all[index]),
      };
    });

    return { months };
  }

  /** Every figure for one window. */
  async figures(
    period: Period,
    firsts: ReadonlyMap<string, Date>,
  ): Promise<GrowthFigures> {
    const window = { gte: period.from, lt: period.to };
    const [profit, collected, sales, buyers] = await Promise.all([
      this.reports.profit(period),
      this.reports.collections(period).then((view) => view.total),
      this.prisma.sale.count({ where: { occurredAt: window } }),
      this.prisma.sale.groupBy({
        by: ['customerId'],
        where: { occurredAt: window, customerId: { not: null } },
      }),
    ]);

    return {
      revenue: profit.revenue,
      grossProfit: profit.grossProfit,
      marginBps: profit.marginBps,
      operatingProfit: profit.operatingProfit,
      collected,
      sales,
      averageSale: averageSale(profit.revenue, sales),
      customers: buyers.length,
      newCustomers: countFirstPurchases(
        firsts.values(),
        period.from,
        period.to,
      ),
    };
  }

  /**
   * When each named customer first bought — once per request, so twelve
   * months cost one grouped read rather than twelve. A merged duplicate's
   * sales moved to the customer kept, so its history counts there.
   */
  async firstPurchases(): Promise<Map<string, Date>> {
    const rows = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: { customerId: { not: null } },
      _min: { occurredAt: true },
    });
    const firsts = new Map<string, Date>();
    for (const row of rows) {
      if (row.customerId && row._min.occurredAt) {
        firsts.set(row.customerId, row._min.occurredAt);
      }
    }
    return firsts;
  }
}
