import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { SEES_COST } from '../../common/authz/cost-visibility';
import { DashboardService } from './dashboard.service';
import { DashboardView } from './dto/dashboard.response';
import {
  CollectionsView,
  CustomerReportView,
  ExpiryReportView,
  ProductReportView,
  ProfitReportView,
  PurchasesReportView,
  SalesReportView,
  StockAlertsView,
  StockAuditView,
  StockValuationView,
} from './dto/report.response';
import { ReportService } from './report.service';
import {
  ExpiryQueryDto,
  PeriodQueryDto,
  ProductReportQueryDto,
  SalesReportQueryDto,
  ValuationQueryDto,
} from './dto/report-query.dto';

@ApiTags('reports')
@ApiBearerAuth('JWT')
@Controller('reports')
export class ReportController {
  constructor(
    private readonly reports: ReportService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('dashboard')
  @Roles(...SEES_COST)
  @ApiOkResponse({ type: DashboardView })
  @ApiOperation({
    summary: 'Everything the home screen needs, in one call',
    description:
      'Answers the morning questions in order: what did I sell, did I actually get paid, what do people owe me, am I making money, what is about to go wrong, and what is moving. Sales and collections are reported separately on purpose — on a credit route they diverge, and the gap is the cash position.',
  })
  dashboardView() {
    return this.dashboard.build();
  }

  @Get('sales')
  @ApiOperation({
    summary:
      'Sales sliced by day, product, category, customer, location, rep or tier',
    description:
      'Revenue is tax-exclusive and net of returns; a return counts in the period it happened, not the period of the sale it reverses.',
  })
  @ApiOkResponse({ type: SalesReportView })
  async sales(@Query() query: SalesReportQueryDto) {
    const period = await this.reports.resolve(toPeriodQuery(query));
    return this.reports.sales(period, query.groupBy ?? 'day');
  }

  @Get('profit')
  @Roles(...SEES_COST)
  @ApiOperation({
    summary: 'Revenue, cost of goods, expenses and what is left',
    description:
      'Management figures, not accounting: no accruals, no depreciation, no overhead allocation. Revenue excludes VAT, which was never the business’s money.',
  })
  @ApiOkResponse({ type: ProfitReportView })
  async profit(@Query() query: PeriodQueryDto): Promise<ProfitReportView> {
    // Composed here rather than in the service, so the annotation on this
    // method is what the shape is checked against (§17) — a response class
    // that only mirrors what a handler happens to return drifts silently.
    const period = await this.reports.resolve(toPeriodQuery(query));
    return { period, ...(await this.reports.profit(period)) };
  }

  @Get('purchases')
  @Roles(...SEES_COST)
  @ApiOperation({
    summary: 'What I bought in the period, and from whom',
    description:
      'The buying-side counterpart of `/reports/sales`, summed from goods receipts. Value is the exact invoice total per line, never `costPrice × quantity`. Quantities are reported as both received and paid for — the gap between them is free goods, which is also why a vendor target counts the second figure and not the first.',
  })
  @ApiOkResponse({ type: PurchasesReportView })
  async purchases(@Query() query: PeriodQueryDto) {
    const period = await this.reports.resolve(toPeriodQuery(query));
    return this.reports.purchases(period);
  }

  @Get('collections')
  @Roles(...SEES_COST)
  @ApiOperation({
    summary: 'Money actually received in the period',
    description:
      'Deliberately not the same number as sales. Voided payments are excluded. Owner, manager and accountant: this is the end-of-shift cash-up, broken down per till and per bank account, and it is what a shortfall would show up in.',
  })
  @ApiOkResponse({ type: CollectionsView })
  async collections(@Query() query: PeriodQueryDto) {
    const period = await this.reports.resolve(toPeriodQuery(query));
    return this.reports.collections(period);
  }

  @Get('stock-valuation')
  @Roles(...SEES_COST)
  @ApiOperation({
    summary: 'What the stock on hand cost',
    description:
      'Valued from exact lot totals, rounded once at the end — never from the rounded `Product.costPrice` snapshot, which DECISIONS.md §2 forbids as an input. Group totals each round their own fractions, so they may not add to the grand total to the kobo.',
  })
  @ApiOkResponse({ type: StockValuationView })
  stockValuation(@Query() query: ValuationQueryDto) {
    return this.reports.stockValuation(query);
  }

  @Get('expiry')
  @ApiOperation({
    summary: 'Batches running out of time, soonest first',
    description:
      'In the order FEFO will pick them, so the list reads as "sell these first".',
  })
  @ApiOkResponse({ type: ExpiryReportView })
  expiry(@Query() query: ExpiryQueryDto) {
    return this.reports.expiry(query.withinDays ?? 30);
  }

  @Get('stock-alerts')
  @ApiOperation({
    summary: 'Out of stock, below reorder point, or negative',
    description:
      'Quantities are summed across locations, because a reorder point is a per-product level: an empty van is not a reason to reorder when the store is full.',
  })
  @ApiOkResponse({ type: StockAlertsView })
  stockAlerts() {
    return this.reports.stockAlerts();
  }

  @Get('products')
  @Roles(...SEES_COST)
  @ApiOperation({
    summary: 'Best sellers, thinnest margins, and what is not moving',
    description:
      'Top by revenue and top by units are both returned because they disagree, and the disagreement is where the high-volume low-margin lines are.',
  })
  @ApiOkResponse({ type: ProductReportView })
  async products(@Query() query: ProductReportQueryDto) {
    const period = await this.reports.resolve(toPeriodQuery(query));
    return this.reports.products(period, { staleDays: query.staleDays });
  }

  @Get('customers')
  @Roles(...SEES_COST)
  @ApiOperation({
    summary: 'Who buys, how much, how recently, and what they still owe',
    description:
      'Includes a lapsed list: customers who have bought before but not in this window.',
  })
  @ApiOkResponse({ type: CustomerReportView })
  async customers(@Query() query: PeriodQueryDto) {
    const period = await this.reports.resolve(toPeriodQuery(query));
    return this.reports.customers(period);
  }

  @Get('stock-audit')
  @Roles(...SEES_COST)
  @ApiOperation({
    summary: 'Adjustments, damage and forced overrides',
    description:
      'The discipline report: every movement somebody had to make a decision about, with the reason attached.',
  })
  @ApiOkResponse({ type: StockAuditView })
  async stockAudit(@Query() query: PeriodQueryDto) {
    const period = await this.reports.resolve(toPeriodQuery(query));
    return this.reports.stockAudit(period);
  }
}

/** Query strings arrive as text; periods are resolved from real dates. */
function toPeriodQuery(query: PeriodQueryDto) {
  return {
    period: query.period,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
}
