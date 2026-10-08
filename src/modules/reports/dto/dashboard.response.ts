import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesGroupRow } from './report.response';
import { DebtorGroup } from '../../payments/dto/receivable.response';
import { GrowthComparisonView } from './growth.dto';

/**
 * What `GET /reports/dashboard` returns.
 *
 * **This is the service's declared return type, not a description of it.**
 * `DashboardService.build()` is annotated with it, so a field that changes shape
 * is a compile error rather than a screen quietly rendering `undefined`. A
 * response class that only *mirrors* what a service happens to return is worse
 * than none: it drifts silently and is believed anyway.
 *
 * It exists because the OpenAPI document described paths and request bodies but
 * no response shapes — NestJS cannot infer a return type — so every client was
 * typing its reads by hand. Declared per endpoint as each slice consumes it
 * (DECISIONS.md §17).
 *
 * `Date` in TypeScript, `string`/`date-time` in Swagger: the first is what the
 * server holds, the second is what goes over the wire once JSON has had it.
 */

class PeriodView {
  @ApiProperty({ example: 'month' })
  name!: string;

  @ApiProperty({ example: 'Africa/Lagos' })
  timezone!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: Date;
}

class PeriodsView {
  @ApiProperty({ type: () => PeriodView })
  today!: PeriodView;

  @ApiProperty({ type: () => PeriodView })
  month!: PeriodView;
}

class SalesSummary {
  @ApiProperty({ description: 'Tax-exclusive revenue today, in kobo.' })
  today!: number;

  @ApiProperty({ description: 'Tax-inclusive turnover today.' })
  todayGross!: number;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  monthGross!: number;

  @ApiProperty()
  lastMonth!: number;

  @ApiProperty({
    description:
      'Change on the same stretch of last month — the same days and time of day, not all of it — in basis points; 2500 is up 25%. Zero when there is nothing to compare with; growth.change.revenue says null.',
  })
  changeBps!: number;
}

class MethodTotal {
  @ApiProperty({ example: 'cash' })
  method!: string;

  @ApiProperty()
  total!: number;
}

class CollectionsSummary {
  @ApiProperty()
  today!: number;

  @ApiProperty()
  month!: number;

  @ApiProperty({ type: () => [MethodTotal] })
  byMethod!: MethodTotal[];

  @ApiProperty({
    description:
      'Sold this month and not yet collected. Deliberately separate from sales: on a credit route the two diverge, and the gap is the cash position.',
  })
  uncollectedThisMonth!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Collected this month as a share of this month’s sales including VAT, in basis points. Null when nothing was sold; may exceed 10000, because collections include payments for older invoices.',
  })
  paidShareBps!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Uncollected as a share of the same figure: exactly 10000 − paidShareBps, so the two never disagree by a rounding. Negative when older invoices were paid this month.',
  })
  uncollectedShareBps!: number | null;
}

class ReceivablesSummary {
  @ApiProperty({
    description: 'Everything still owed to the business, in kobo.',
  })
  total!: number;

  @ApiProperty()
  invoices!: number;

  @ApiProperty()
  oldestDays!: number;

  @ApiProperty({ type: () => [DebtorGroup] })
  topDebtors!: DebtorGroup[];
}

class ProfitSummary {
  @ApiProperty({
    description: 'Tax-exclusive. VAT was never the business’s money.',
  })
  revenue!: number;

  @ApiProperty()
  cogs!: number;

  @ApiProperty()
  grossProfit!: number;

  @ApiProperty()
  expenses!: number;

  @ApiProperty()
  operatingProfit!: number;

  @ApiProperty()
  marginBps!: number;

  @ApiProperty({
    description:
      'Cost of goods sold as a share of revenue, in basis points — exactly 10000 − marginBps. Zero when nothing was sold.',
  })
  cogsShareBps!: number;

  @ApiProperty({
    description:
      'Expenses, salaries included, as a share of revenue, in basis points. Zero when nothing was sold.',
  })
  expensesShareBps!: number;

  @ApiProperty({
    description:
      'Operating profit as a share of revenue, in basis points. Zero when nothing was sold.',
  })
  operatingMarginBps!: number;

  @ApiProperty({
    description:
      'How much of the month’s cost rests on a guess, because goods sold before their delivery was recorded.',
  })
  estimatedCost!: number;

  @ApiProperty()
  estimatedLines!: number;

  @ApiProperty()
  lastMonthOperating!: number;
}

class NamedRef {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

class ExpiringBatchRow {
  @ApiProperty()
  batchId!: string;

  @ApiProperty({ nullable: true, type: String })
  lotCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: Date | null;

  @ApiProperty({ type: () => NamedRef })
  product!: NamedRef;

  @ApiProperty({ type: () => NamedRef })
  location!: NamedRef;

  @ApiProperty()
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'What walks out of the door if this is not sold in time. Always present here, because this endpoint is closed to roles that may not see cost.',
  })
  value?: number;

  @ApiProperty({ nullable: true, type: Number })
  daysToExpiry!: number | null;
}

class StockAlertRow {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty({ nullable: true, type: Number })
  reorderPoint!: number | null;

  @ApiProperty({ description: 'Summed across locations, in base units.' })
  quantity!: number;
}

class AttentionSummary {
  @ApiProperty({ type: () => [ExpiringBatchRow] })
  expiringSoon!: ExpiringBatchRow[];

  @ApiProperty()
  expiringCount!: number;

  @ApiPropertyOptional()
  valueAtRisk?: number;

  @ApiProperty({
    description: 'Already past their date and still on the shelf.',
  })
  expired!: number;

  @ApiProperty({ type: () => [StockAlertRow] })
  outOfStock!: StockAlertRow[];

  @ApiProperty()
  outOfStockCount!: number;

  @ApiProperty({ type: () => [StockAlertRow] })
  lowStock!: StockAlertRow[];

  @ApiProperty()
  lowStockCount!: number;

  @ApiProperty({ type: () => [StockAlertRow] })
  negativeStock!: StockAlertRow[];

  @ApiProperty()
  productsWithoutReorderPoint!: number;

  @ApiProperty({
    description: 'Movements an owner or manager pushed through a shortfall.',
  })
  forcedMovements!: number;
}

class DeadStockProduct {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  sku?: string;
}

class DeadStockRow {
  @ApiProperty({ type: () => DeadStockProduct })
  product!: DeadStockProduct;

  @ApiProperty()
  quantity!: number;
}

class MoversSummary {
  @ApiProperty({ type: () => [SalesGroupRow] })
  topByRevenue!: SalesGroupRow[];

  @ApiProperty({ type: () => [SalesGroupRow] })
  topByUnits!: SalesGroupRow[];

  @ApiProperty({ type: () => [DeadStockRow] })
  deadStock!: DeadStockRow[];

  @ApiProperty()
  deadStockCount!: number;
}

class VendorRef {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;
}

class OwedVendorRow {
  @ApiProperty({ type: () => VendorRef })
  supplier!: VendorRef;

  @ApiProperty()
  balance!: number;

  @ApiProperty()
  bills!: number;

  @ApiProperty()
  oldestDays!: number;
}

class PayablesSummary {
  @ApiProperty({
    description: 'Everything still owed to every vendor, in kobo.',
  })
  total!: number;

  @ApiProperty()
  bills!: number;

  @ApiProperty()
  suppliers!: number;

  @ApiProperty()
  oldestDays!: number;

  @ApiProperty({
    description:
      'Past the date the business said it would pay, counting only bills that were given one.',
  })
  overdue!: number;

  @ApiProperty({
    description:
      'Paid to vendors this month, voided payments left out — beside what is still owed, as collections sit beside receivables.',
  })
  paidThisMonth!: number;

  @ApiProperty({ type: () => [OwedVendorRow] })
  topVendors!: OwedVendorRow[];
}

class PurchaseGroupRow {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Invoice totals, in kobo.' })
  value!: number;

  @ApiProperty()
  quantityReceived!: number;

  @ApiProperty({
    description: 'The gap against quantityReceived is free goods.',
  })
  quantityPaidFor!: number;

  @ApiProperty()
  lines!: number;
}

class PurchasesSummary {
  @ApiProperty()
  month!: number;

  @ApiProperty()
  deliveries!: number;

  @ApiProperty()
  suppliers!: number;

  @ApiProperty()
  unitsReceived!: number;

  @ApiProperty({ description: 'Units that arrived without being charged for.' })
  unitsFree!: number;

  @ApiProperty({ type: () => [PurchaseGroupRow] })
  topVendors!: PurchaseGroupRow[];

  @ApiProperty({ type: () => [PurchaseGroupRow] })
  topCategories!: PurchaseGroupRow[];
}

/** One vendor target's progress this month, for a doughnut. */
class TargetGlance {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dangote Distribution' })
  supplier!: string;

  @ApiProperty({ example: 'Lotion' })
  category!: string;

  @ApiProperty({ example: 112 })
  targetCartons!: number;

  @ApiProperty({ example: 86.5, description: 'Paid for, to one decimal.' })
  achievedCartons!: number;

  @ApiProperty({ example: 25.5 })
  remainingCartons!: number;

  @ApiProperty({
    example: 7723,
    description: 'Basis points of the target; above 10000 is over-performance.',
  })
  achievedBps!: number;
}

/** One vendor's money target this month, for a doughnut. */
class MoneyTargetGlance {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Unilever' })
  supplier!: string;

  @ApiProperty({
    description: 'The target, in kobo — before VAT when addsVat.',
  })
  amount!: number;

  @ApiProperty()
  addsVat!: boolean;

  @ApiProperty({ description: 'What counts so far, in kobo.' })
  counted!: number;

  @ApiProperty({ description: 'In kobo; never negative.' })
  remaining!: number;

  @ApiProperty({ description: 'Basis points of the target.' })
  achievedBps!: number;
}

class PurchasingSummary {
  @ApiProperty({ type: () => PayablesSummary })
  payables!: PayablesSummary;

  @ApiProperty({ type: () => PurchasesSummary })
  purchases!: PurchasesSummary;

  @ApiProperty({
    type: () => [TargetGlance],
    description:
      'Every vendor target for this month, in cartons. Empty when there are none.',
  })
  targets!: TargetGlance[];

  @ApiProperty({
    type: () => [MoneyTargetGlance],
    description:
      'Every vendor money target for this month. Empty when there are none.',
  })
  moneyTargets!: MoneyTargetGlance[];
}

class TrendDay {
  @ApiProperty({ example: '2026-09-19' })
  date!: string;

  @ApiProperty()
  grossSales!: number;

  @ApiProperty()
  revenue!: number;

  @ApiProperty()
  invoices!: number;
}

class TrendSummary {
  @ApiProperty({ type: () => [TrendDay] })
  days!: TrendDay[];
}

/** Who is signed in now (2026-10-08): used in the last thirty minutes. */
class SignedInSummary {
  @ApiProperty()
  people!: number;

  @ApiProperty()
  devices!: number;
}

/** What stock the shop handled this month, at cost (2026-10-07). */
class StockHandledSummary {
  @ApiProperty({
    description:
      'Stock at the start of the month, and opening stock entered in it, at cost.',
  })
  opening!: number;

  @ApiProperty({ description: 'Delivered this month, at invoice value.' })
  delivered!: number;

  @ApiProperty({
    description:
      'Goods available for sale: opening + delivered, summed exactly and rounded once.',
  })
  available!: number;
}

export class DashboardView {
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: Date;

  @ApiProperty({ example: 'Africa/Lagos' })
  timezone!: string;

  @ApiProperty({ type: () => PeriodsView })
  periods!: PeriodsView;

  @ApiProperty({ type: () => SalesSummary })
  sales!: SalesSummary;

  @ApiProperty({ type: () => CollectionsSummary })
  collections!: CollectionsSummary;

  @ApiProperty({ type: () => ReceivablesSummary })
  receivables!: ReceivablesSummary;

  @ApiProperty({ type: () => ProfitSummary })
  profit!: ProfitSummary;

  @ApiProperty({ type: () => AttentionSummary })
  attention!: AttentionSummary;

  @ApiProperty({ type: () => MoversSummary })
  movers!: MoversSummary;

  @ApiProperty({ type: () => PurchasingSummary })
  purchasing!: PurchasingSummary;

  @ApiProperty({ type: () => TrendSummary })
  trend!: TrendSummary;

  @ApiProperty({
    type: () => GrowthComparisonView,
    description:
      'This month so far beside the same stretch of last month, figure by figure.',
  })
  growth!: GrowthComparisonView;

  @ApiProperty({
    type: () => SignedInSummary,
    description:
      'People and devices active in the last thirty minutes — the same count Settings → Staff shows.',
  })
  signedIn!: SignedInSummary;

  @ApiPropertyOptional({
    type: () => StockHandledSummary,
    description:
      'The month’s goods available for sale, at cost. Absent for a role that may not see cost — which this endpoint already refuses.',
  })
  stock?: StockHandledSummary;
}
