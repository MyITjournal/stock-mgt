import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesGroupRow } from './report.response';

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
      'Change on last month in basis points; 2500 is up 25%. Zero when last month sold nothing, because no percentage exists.',
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
}

class DebtorCustomer {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty({ nullable: true, type: String })
  lastName!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Chasing a debt is a phone call, so the list carries the number.',
  })
  phone!: string | null;
}

class DebtorRow {
  @ApiProperty({
    type: () => DebtorCustomer,
    nullable: true,
    description: 'Null for walk-in sales, which carry no customer row.',
  })
  customer!: DebtorCustomer | null;

  @ApiProperty()
  balance!: number;

  @ApiProperty()
  invoices!: number;

  @ApiProperty()
  oldestDays!: number;
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

  @ApiProperty({ type: () => [DebtorRow] })
  topDebtors!: DebtorRow[];
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

class PurchasingSummary {
  @ApiProperty({ type: () => PayablesSummary })
  payables!: PayablesSummary;

  @ApiProperty({ type: () => PurchasesSummary })
  purchases!: PurchasesSummary;
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
}
