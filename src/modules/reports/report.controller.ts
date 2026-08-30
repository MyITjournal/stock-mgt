import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { ReportService } from './report.service';
import {
  ExpiryQueryDto,
  PeriodQueryDto,
  ProductReportQueryDto,
  SalesReportQueryDto,
  ValuationQueryDto,
} from './dto/report-query.dto';

/**
 * Who may see what the goods cost.
 *
 * Margin, cost of goods sold and stock valuation are restricted to the people
 * who set prices. A `sales_rep` carrying buying prices around a market is a
 * commercial problem, not a permissions technicality — and it is the kind of
 * leak that cannot be undone once it has happened.
 *
 * Reps keep the reports that do not expose cost: what sold, and to whom.
 */
const SEES_COST = [OrgRole.owner, OrgRole.manager, OrgRole.accountant];

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
  async profit(@Query() query: PeriodQueryDto) {
    const period = await this.reports.resolve(toPeriodQuery(query));
    return { period: period, ...(await this.reports.profit(period)) };
  }

  @Get('collections')
  @ApiOperation({
    summary: 'Money actually received in the period',
    description:
      'Deliberately not the same number as sales. Voided payments are excluded.',
  })
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
  stockValuation(@Query() query: ValuationQueryDto) {
    return this.reports.stockValuation(query);
  }

  @Get('expiry')
  @ApiOperation({
    summary: 'Batches running out of time, soonest first',
    description:
      'In the order FEFO will pick them, so the list reads as "sell these first".',
  })
  expiry(@Query() query: ExpiryQueryDto) {
    return this.reports.expiry(query.withinDays ?? 30);
  }

  @Get('stock-alerts')
  @ApiOperation({
    summary: 'Out of stock, below reorder point, or negative',
    description:
      'Quantities are summed across locations, because a reorder point is a per-product level: an empty van is not a reason to reorder when the store is full.',
  })
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
