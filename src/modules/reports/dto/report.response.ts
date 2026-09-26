import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

/**
 * What the report endpoints return.
 *
 * **These are the services' declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * Four rules from §6 run through every figure below, and a client that ignores
 * them will draw a chart that disagrees with the shop:
 *
 * - **Revenue is tax-exclusive.** Prices are stored VAT-inclusive, so counting
 *   the gross overstates every margin by 7.5%. A dashboard reading lower than
 *   expected is this working.
 * - **Periods resolve in `Organization.timezone`**, never UTC — otherwise
 *   "today" rolls over at 1am Lagos time. Callers send a period *name* and read
 *   the resolved window back; nothing client-side does date arithmetic.
 * - **A return counts in the period it happened**, not the month of the sale it
 *   reverses.
 * - **Stock is valued from lot totals, rounded once** — never
 *   `Product.costPrice`, which §2 forbids as an input. Group totals each round
 *   their own fractions, so they may not add to the grand total to the kobo.
 *
 * Cost-bearing fields are **absent rather than zero** for a role that may not
 * see them (§9). A zero reads as "free goods" to anything that sums it.
 */

/** The window a response echoes back, so a chart can label its own axis. */
export class PeriodView {
  @ApiProperty({
    enum: [
      'today',
      'yesterday',
      'month',
      'last-month',
      'last-7-days',
      'last-30-days',
      'year',
      'custom',
    ],
    description: 'What was asked for, echoed back.',
  })
  name!: string;

  @ApiProperty({
    example: 'Africa/Lagos',
    description: 'The zone the boundaries were resolved in.',
  })
  timezone!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Inclusive.' })
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time', description: 'Exclusive.' })
  to!: Date;
}

/**
 * Revenue, cost and expenses for a window.
 *
 * **Management figures, not accounting**: no accruals, no depreciation, no
 * overhead allocation (§1).
 */
export class ProfitReportView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({
    description:
      'Tax-exclusive and net of returns. This is the headline number, and it is deliberately smaller than what went through the till.',
  })
  revenue!: number;

  @ApiProperty({ description: 'Tax-inclusive turnover, before returns.' })
  grossSales!: number;

  @ApiProperty({
    description: 'VAT inside the gross, which was never the business’s money.',
  })
  tax!: number;

  @ApiProperty({
    description: 'Refunded in this period, whenever it was sold.',
  })
  returned!: number;

  @ApiProperty({
    description: 'Cost of goods sold, from the lots the picks took.',
  })
  cogs!: number;

  @ApiProperty({ description: '`revenue − cogs`.' })
  grossProfit!: number;

  @ApiProperty({ description: 'Expenses recorded in the window.' })
  expenses!: number;

  @ApiProperty({ description: '`grossProfit − expenses`.' })
  operatingProfit!: number;

  @ApiProperty({
    description: 'Gross margin in basis points. 250 is 2.5%.',
  })
  marginBps!: number;

  @ApiProperty({
    description:
      'How much of `cogs` rests on a guess — goods sold before the delivery they came from was recorded, costed from the last real lot (§2). The annotation travels with the figures so a caller cannot show the margin while dropping the caveat.',
  })
  estimatedCost!: number;

  @ApiProperty({ description: 'How many sale lines that covers.' })
  estimatedLines!: number;
}

/** One row of a sales slice, whichever dimension it is grouped by. */
export class SalesGroupRow {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Tax-inclusive turnover, before returns.' })
  grossSales!: number;

  @ApiProperty({ description: 'Tax-exclusive, net of returns.' })
  revenue!: number;

  @ApiProperty()
  returned!: number;

  @ApiPropertyOptional({
    description:
      '**Absent** for a role that may not see cost. This row and its two neighbours are the margin one line at a time, which is why they go with the header totals rather than separately.',
  })
  cogs?: number;

  @ApiPropertyOptional()
  grossProfit?: number;

  @ApiPropertyOptional()
  marginBps?: number;

  @ApiProperty({ description: 'Base units sold, net of what came back.' })
  units!: number;

  @ApiProperty()
  invoices!: number;
}

/**
 * The header figures for a sales slice.
 *
 * **Redacted with the rows, never separately.** 7.2 shipped a leak of exactly
 * this shape on `GET /sales`: the lines were redacted one by one and the header
 * total — the same numbers summed — was passed straight out beside what they
 * sold for, which is the whole margin.
 */
export class SalesTotals {
  @ApiProperty()
  grossSales!: number;

  @ApiProperty()
  revenue!: number;

  @ApiProperty()
  returned!: number;

  @ApiPropertyOptional({
    description: '**Absent** for a role that may not see cost.',
  })
  cogs?: number;

  @ApiPropertyOptional()
  grossProfit?: number;

  @ApiPropertyOptional()
  marginBps?: number;

  @ApiProperty()
  invoices!: number;
}

/**
 * Sales sliced by day, product, category, customer, location, rep or tier.
 *
 * **Open to a rep on purpose** — what sold, and to whom, is the one slice they
 * need — with the margin columns removed from rows and totals alike.
 */
export class SalesReportView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({
    enum: ['day', 'product', 'category', 'customer', 'location', 'rep', 'tier'],
  })
  groupBy!: string;

  @ApiProperty({ type: () => [SalesGroupRow] })
  rows!: SalesGroupRow[];

  @ApiProperty({ type: () => SalesTotals })
  totals!: SalesTotals;
}

/** One row of a purchases breakdown. */
export class PurchaseGroupRow {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({
    description:
      'Invoice totals, in kobo. Never `costPrice × quantity` — that is a rounded average and would drift from the invoices by a few kobo a line, which is the drift that makes a vendor dispute unwinnable.',
  })
  value!: number;

  @ApiProperty({ description: 'Base units that arrived.' })
  quantityReceived!: number;

  @ApiProperty({
    description: 'Base units the invoice charged for. The gap is free goods.',
  })
  quantityPaidFor!: number;

  @ApiProperty()
  lines!: number;
}

/** The buying-side counterpart of the sales slice. */
export class PurchasesReportView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({
    description: 'What the window’s deliveries cost, at invoice totals.',
  })
  total!: number;

  @ApiProperty({ description: 'How many separate deliveries arrived.' })
  deliveries!: number;

  @ApiProperty({ description: 'How many vendors supplied anything.' })
  suppliers!: number;

  @ApiProperty({ description: 'Base units received.' })
  unitsReceived!: number;

  @ApiProperty({
    description: 'Of those, how many were not charged for — the free goods.',
  })
  unitsFree!: number;

  @ApiProperty({ type: () => [PurchaseGroupRow] })
  bySupplier!: PurchaseGroupRow[];

  @ApiProperty({ type: () => [PurchaseGroupRow] })
  byCategory!: PurchaseGroupRow[];

  @ApiProperty({ type: () => [PurchaseGroupRow] })
  topProducts!: PurchaseGroupRow[];
}

class CollectionsByMethod {
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty()
  total!: number;
}

class CollectionsByLocation {
  @ApiProperty({
    description:
      '`unassigned` for money that belonged to no counter — a transfer landing in the bank. A real category rather than a gap, so it gets its own row instead of being dropped.',
  })
  locationId!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  count!: number;
}

class CollectionsByAccount {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Null for cash, which lands in no account.',
  })
  bankAccountId!: string | null;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  count!: number;
}

/**
 * Money actually received in the window.
 *
 * **Deliberately not the same number as sales.** On a credit route the two
 * diverge, and the gap is the cash position. Voided payments are excluded:
 * a void says the money never moved.
 *
 * `byLocation` is the end-of-shift cash-up — what each counter or van took,
 * which is the question `Payment.locationId` exists to answer (§11) — and
 * `byBankAccount` is the reconciliation view, one row to lay beside each
 * statement.
 */
export class CollectionsView {
  @ApiProperty()
  total!: number;

  @ApiProperty({ description: 'How many payments make it up.' })
  count!: number;

  @ApiProperty({ type: () => [CollectionsByMethod] })
  byMethod!: CollectionsByMethod[];

  @ApiProperty({ type: () => [CollectionsByLocation] })
  byLocation!: CollectionsByLocation[];

  @ApiProperty({ type: () => [CollectionsByAccount] })
  byBankAccount!: CollectionsByAccount[];
}

/** One roll-up of stock value, by location, category or product. */
export class ValuationGroupRow {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Rounded once, over this group’s lots.' })
  value!: number;

  @ApiProperty({ description: 'Base units held.' })
  units!: number;
}

/**
 * What the stock on hand cost.
 *
 * The grand total is valued over every lot at once rather than by summing the
 * groups, because each group rounds its own fractions — so the parts may not
 * add to the whole to the kobo, and that is correct rather than a bug.
 */
export class StockValuationView {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  units!: number;

  @ApiProperty({ type: () => [ValuationGroupRow] })
  byLocation!: ValuationGroupRow[];

  @ApiProperty({ type: () => [ValuationGroupRow] })
  byCategory!: ValuationGroupRow[];

  @ApiProperty({
    type: () => [ValuationGroupRow],
    description: 'The fifty most valuable.',
  })
  byProduct!: ValuationGroupRow[];
}

class ReportProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

class ReportLocationRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

/** A lot running out of time. */
export class ExpiringLotRow {
  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({ type: String, nullable: true })
  lotCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: Date | null;

  @ApiProperty({ type: () => ReportProductRef })
  product!: ReportProductRef;

  @ApiProperty({ type: () => ReportLocationRef })
  location!: ReportLocationRef;

  @ApiProperty()
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'What walking away from this lot costs. **Absent** for a role that may not see cost — the list itself stays open, because knowing which lots to push is a shelf question rather than a cost one.',
  })
  value?: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Negative once the date has passed.',
  })
  daysToExpiry!: number | null;
}

/** Ordered soonest first, which is the order FEFO will pick them in. */
export class ExpiryReportView {
  @ApiProperty()
  withinDays!: number;

  @ApiProperty({ type: () => [ExpiringLotRow] })
  batches!: ExpiringLotRow[];

  @ApiPropertyOptional({
    description:
      'The whole list’s value. **Absent** for a role that may not see cost.',
  })
  valueAtRisk?: number;

  @ApiProperty({
    description: 'Already past their date and still on the shelf.',
  })
  expired!: number;
}

/** A product needing attention. */
export class StockAlertRow {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null when nobody has set a level for this product.',
  })
  reorderPoint!: number | null;

  @ApiProperty({ description: 'Summed across every location.' })
  quantity!: number;
}

/**
 * Stock that needs attention.
 *
 * Quantities are summed **across locations**, because a reorder point is a
 * per-product level: an empty van is not a reason to reorder when the store is
 * full.
 */
export class StockAlertsView {
  @ApiProperty({ type: () => [StockAlertRow] })
  outOfStock!: StockAlertRow[];

  @ApiProperty({
    type: () => [StockAlertRow],
    description:
      'Strictly above empty: a level of 0 means "tell me when it runs out", which `outOfStock` already covers.',
  })
  lowStock!: StockAlertRow[];

  @ApiProperty({
    type: () => [StockAlertRow],
    description:
      'Stock that went out before it was entered as received. A forced movement leaves this trail.',
  })
  negative!: StockAlertRow[];

  @ApiProperty({
    description:
      'How many products have no level set, so nobody mistakes the list for complete.',
  })
  withoutReorderPoint!: number;
}

class AuditUserRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

/** A movement somebody had to make a decision about. */
export class StockAuditRow {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['adjustment', 'damage'],
    enumName: 'AuditMovementType',
  })
  type!: string;

  @ApiProperty({ description: 'Signed, in base units.' })
  quantity!: number;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty()
  isForced!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Never null on a forced movement: supplying it is the override.',
  })
  forcedReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => ReportProductRef })
  product!: ReportProductRef;

  @ApiProperty({ type: () => ReportLocationRef })
  location!: ReportLocationRef;

  @ApiProperty({ type: () => AuditUserRef, nullable: true })
  recordedBy!: AuditUserRef | null;
}

class AuditReasonTotal {
  @ApiProperty({
    description:
      'The adjustment reason, or the movement type when it has none.',
  })
  reason!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty({ description: 'Net base units under this reason.' })
  quantity!: number;
}

/** The discipline report: every decision, with the reason attached. */
export class StockAuditView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({ type: () => [StockAuditRow] })
  movements!: StockAuditRow[];

  @ApiProperty({ description: 'How many were pushed through a shortfall.' })
  forced!: number;

  @ApiProperty({
    description:
      'Net base units written off or corrected. Negative means stock left.',
  })
  netQuantity!: number;

  @ApiProperty({ type: () => [AuditReasonTotal] })
  byReason!: AuditReasonTotal[];
}

/**
 * A product held but not sold lately.
 *
 * `name` and `sku` are optional because the row is keyed off a stock balance:
 * a product deleted since it was last counted still holds stock and still
 * belongs on this list, with only its id to show for it.
 */
class DeadStockProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  sku?: string;
}

class DeadStockRow {
  @ApiProperty({ type: () => DeadStockProductRef })
  product!: DeadStockProductRef;

  @ApiProperty({ description: 'Base units sitting on a shelf.' })
  quantity!: number;
}

/**
 * Best sellers, thinnest margins, and what is not moving.
 *
 * `topByRevenue` and `topByUnits` are both returned **because they disagree**,
 * and the disagreement is where the high-volume low-margin lines are.
 */
export class ProductReportView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({ type: () => [SalesGroupRow] })
  topByRevenue!: SalesGroupRow[];

  @ApiProperty({ type: () => [SalesGroupRow] })
  topByUnits!: SalesGroupRow[];

  @ApiProperty({
    type: () => [SalesGroupRow],
    description: 'Thinnest margin first, among products that sold anything.',
  })
  byMargin!: SalesGroupRow[];

  @ApiProperty({
    type: () => [DeadStockRow],
    description:
      'Held, but nothing sold within `staleDays`. Cash sitting on a shelf.',
  })
  deadStock!: DeadStockRow[];

  @ApiProperty({ description: 'The window "not moving" was measured over.' })
  staleDays!: number;
}

class ReportCustomerRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Chasing a lapsed customer is a phone call.',
  })
  phone!: string | null;
}

export class CustomerReportRow {
  @ApiProperty({ type: () => ReportCustomerRef })
  customer!: ReportCustomerRef;

  @ApiProperty({ description: 'Invoices in this window.' })
  invoices!: number;

  @ApiProperty({ description: 'Tax-exclusive spend in this window.' })
  spend!: number;

  @ApiProperty()
  grossProfit!: number;

  @ApiProperty()
  marginBps!: number;

  @ApiProperty({ description: 'Every invoice ever, not just this window.' })
  lifetimeSpend!: number;

  @ApiProperty({
    description:
      'What they still owe, over their whole history. Voided payments do not count toward it.',
  })
  balance!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Null for a customer who has never bought anything.',
  })
  lastPurchase!: Date | null;
}

/** Who buys, how much, how recently, and what they still owe. */
export class CustomerReportView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({
    type: () => [CustomerReportRow],
    description: 'Biggest spender in the window first.',
  })
  customers!: CustomerReportRow[];

  @ApiProperty({
    type: () => [CustomerReportRow],
    description:
      'Bought before, but not in this window — the ones to ring. Most recent purchase first.',
  })
  lapsed!: CustomerReportRow[];
}
