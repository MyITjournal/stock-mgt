import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, SalePrintKind } from '@prisma/client';

/**
 * What a sale looks like on the way out: `POST /sales`, `GET /sales` and
 * `GET /sales/:id` all return this shape, because `create` ends in
 * `return this.findOne(saleId)`.
 *
 * **This is the service's declared return type, not a description of it.**
 * A field that changes shape is a compile error rather than a till quietly
 * rendering `undefined` (DECISIONS.md §17).
 *
 * Two things about it are easy to get wrong and expensive to get wrong:
 *
 * **Cost fields are optional, not nullable.** `redactCost` *removes* the key
 * for a role that may not see buying prices (§9), so `costTotal` is
 * `number | undefined` and the key is simply absent for a rep. A client that
 * types it as nullable and renders `sale.costTotal ?? 0` prints "free goods";
 * one that types it as required prints `NaN`. Both are wrong in a way nobody
 * notices until a rep is looking at a screen.
 *
 * **Every money figure here is a snapshot**, frozen at the time of sale —
 * prices move, tax rates change, a carton gets redefined, and none of it may
 * rewrite what a customer paid last week. Nothing downstream recomputes them,
 * and the till renders these rather than its own running total.
 */

class SaleCustomerView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ngozi' })
  firstName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Okafor' })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+2348030000000' })
  phone!: string | null;
}

class NamedRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Main shop' })
  name!: string;
}

class RecordedByView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

class SoldProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Peak Milk Powder 400g' })
  name!: string;

  @ApiProperty({ example: 'PEAK-400G' })
  sku!: string;

  @ApiProperty({ type: String, nullable: true, example: '400g' })
  size!: string | null;
}

class SoldOptionRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Gold' })
  name!: string;
}

class SoldUnitRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'carton' })
  name!: string;

  @ApiProperty({ example: 24 })
  factor!: number;
}

export class SaleLineView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  saleId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The option sold — null on a product without options.',
  })
  variantId!: string | null;

  @ApiProperty({ format: 'uuid' })
  unitId!: string;

  @ApiProperty({
    example: 2,
    description: 'As typed, counted in `unitId` — two cartons, not 48 pieces.',
  })
  quantity!: number;

  @ApiProperty({
    example: 24,
    description:
      'What `unitId` meant at the time, copied so redefining a carton later cannot change what this sale took off the shelf.',
  })
  unitFactor!: number;

  @ApiProperty({ example: 48, description: '`quantity × unitFactor`.' })
  baseQuantity!: number;

  @ApiProperty({
    example: 1200000,
    description: 'Tax-inclusive price of one `unitId`, in kobo.',
  })
  unitPrice!: number;

  @ApiProperty({ example: 2400000, description: '`unitPrice × quantity`.' })
  lineTotal!: number;

  @ApiProperty({ example: 750, description: 'The VAT rate at the time.' })
  taxRateBps!: number;

  @ApiProperty({
    example: 167442,
    description: 'The VAT inside `lineTotal`, derived by subtraction (§2).',
  })
  taxAmount!: number;

  @ApiPropertyOptional({
    description:
      'What these goods cost, from the batches FEFO actually picked. **Absent, not null,** for a role that may not see cost (§9).',
  })
  costOfGoodsSold?: number;

  @ApiPropertyOptional({
    description:
      'True when the cost above came from an estimated rate rather than an invoice — goods sold before their delivery was recorded (§2). Absent alongside the cost it qualifies.',
  })
  costIsEstimated?: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => SoldProductRef })
  product!: SoldProductRef;

  @ApiProperty({ type: () => SoldOptionRef, nullable: true })
  variant!: SoldOptionRef | null;

  @ApiProperty({ type: () => SoldUnitRef })
  unit!: SoldUnitRef;
}

export class SaleReturnView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  saleId!: string;

  @ApiProperty({ format: 'uuid' })
  saleLineId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Groups the lines handed back in one visit.',
  })
  returnGroupId!: string;

  @ApiProperty({ description: 'In base units, always positive.' })
  quantity!: number;

  @ApiProperty({ description: 'What the customer got back, in kobo.' })
  refundAmount!: number;

  @ApiPropertyOptional({
    description:
      'The share of the line cost that came back with the goods. Absent for a role that may not see cost (§9).',
  })
  costAmount?: number;

  @ApiProperty({
    description:
      'False when the goods came back broken: the refund still happens, but nothing returns to sellable stock.',
  })
  restocked!: boolean;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

class AllocatedPaymentRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({ type: String, nullable: true, example: 'FT26083012345' })
  reference!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;
}

export class SaleAllocationView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  saleId!: string;

  @ApiProperty({
    description: 'Signed, following the payment it belongs to (§5).',
  })
  amount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => AllocatedPaymentRef })
  payment!: AllocatedPaymentRef;
}

class CorrectedCustomerRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ngozi' })
  firstName!: string;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

/** One line whose price was corrected, before and after, in kobo. */
class SaleCorrectionLineView {
  @ApiProperty({ format: 'uuid' })
  saleLineId!: string;

  @ApiProperty()
  unitPriceBefore!: number;

  @ApiProperty()
  unitPriceAfter!: number;

  @ApiProperty()
  lineTotalBefore!: number;

  @ApiProperty()
  lineTotalAfter!: number;
}

/**
 * A correction made to this sale (2026-10-08): why, who, when, and what it
 * said before. Customer before and after are the same when only prices moved;
 * null is a walk-in.
 */
export class SaleCorrectionView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => RecordedByView, nullable: true })
  recordedBy!: RecordedByView | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  customerIdBefore!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  customerIdAfter!: string | null;

  @ApiProperty({ type: () => CorrectedCustomerRef, nullable: true })
  customerBefore!: CorrectedCustomerRef | null;

  @ApiProperty({ type: () => CorrectedCustomerRef, nullable: true })
  customerAfter!: CorrectedCustomerRef | null;

  @ApiProperty({ description: 'Kobo.' })
  totalBefore!: number;

  @ApiProperty()
  totalAfter!: number;

  @ApiProperty({
    description:
      'Settled by payments before and after, in kobo. They differ when a lower total brought the payment down with it.',
  })
  paidBefore!: number;

  @ApiProperty()
  paidAfter!: number;

  @ApiProperty({ type: () => [SaleCorrectionLineView] })
  lines!: SaleCorrectionLineView[];
}

/** One line of a correction preview. */
class SaleCorrectionPreviewLine {
  @ApiProperty({ format: 'uuid' })
  lineId!: string;

  @ApiProperty()
  lineTotalBefore!: number;

  @ApiProperty()
  lineTotalAfter!: number;
}

/**
 * What a correction to a sale would do, worked out by doing it and rolling
 * back — so the dialog shows the server's figures and meets every refusal the
 * save would.
 */
export class SaleCorrectionPreviewView {
  @ApiProperty({ description: 'Kobo.' })
  totalBefore!: number;

  @ApiProperty()
  totalAfter!: number;

  @ApiProperty({ description: 'The VAT inside the new total.' })
  taxTotalAfter!: number;

  @ApiProperty()
  paidBefore!: number;

  @ApiProperty()
  paidAfter!: number;

  @ApiProperty({
    description:
      'Still owed after the correction. Positive: the customer owes. Negative: the business owes.',
  })
  balanceAfter!: number;

  @ApiProperty({
    description:
      'True when a payment is brought down to the new total: voided, and one for the true amount recorded in its place.',
  })
  paymentFollows!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The customer after, by name. Null is a walk-in.',
  })
  customerAfter!: string | null;

  @ApiProperty()
  customerChanged!: boolean;

  @ApiProperty({
    description:
      'Payments that move to the new customer with the sale, counting voided ones.',
  })
  paymentsMoved!: number;

  @ApiProperty({ type: () => [SaleCorrectionPreviewLine] })
  lines!: SaleCorrectionPreviewLine[];
}

/** One copy of the invoice: which copy, how it was made, by whom, when. */
export class SalePrintEntry {
  @ApiProperty({ example: 2, description: '1 is the original.' })
  copy!: number;

  @ApiProperty({
    enum: SalePrintKind,
    enumName: 'SalePrintKind',
    description:
      '`printed` from a Print button; `opened` as a PDF to look at or share.',
  })
  kind!: SalePrintKind;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => RecordedByView, nullable: true })
  printedBy!: RecordedByView | null;
}

export class SaleView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({
    example: 'INV-0001',
    description:
      'Sequential per organization. The number a customer quotes on the phone; `id` is the one machines use.',
  })
  number!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Null for a walk-in.',
  })
  customerId!: string | null;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The tier the prices were resolved against, kept so a sale stays explainable after the customer moves to another price list.',
  })
  tierId!: string | null;

  @ApiProperty({
    example: 16200000,
    description: 'Tax-inclusive, in kobo. The sum of its lines.',
  })
  total!: number;

  @ApiProperty({
    example: 1130233,
    description: 'The VAT inside `total`, frozen at sale time.',
  })
  taxTotal!: number;

  @ApiPropertyOptional({
    example: 2820000,
    description:
      'What the goods on this invoice cost, rounded once (§2). **Absent, not null,** for a role that may not see cost — it is the sum of the per-line `costOfGoodsSold` beneath it, so leaving it while redacting them would hand over the same margin added up (§9).',
  })
  costTotal?: number;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Why this sale was allowed out on credit to a customer who already owed. Supplying the reason *is* the override, so one can never be recorded without it (§6).',
  })
  creditOverrideReason!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When a sale that went out on credit should be paid — five days after it. Null when it was paid in full at the time.',
  })
  dueDate!: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      "When it happened by the recording device's clock. `createdAt` is when the server stored it.",
  })
  occurredAt!: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => SaleCustomerView, nullable: true })
  customer!: SaleCustomerView | null;

  @ApiProperty({ type: () => NamedRef })
  location!: NamedRef;

  @ApiProperty({ type: () => NamedRef, nullable: true })
  tier!: NamedRef | null;

  @ApiProperty({ type: () => RecordedByView, nullable: true })
  recordedBy!: RecordedByView | null;

  @ApiProperty({ type: () => [SaleLineView] })
  lines!: SaleLineView[];

  @ApiProperty({ type: () => [SaleReturnView] })
  returns!: SaleReturnView[];

  @ApiProperty({
    type: () => [SaleAllocationView],
    description:
      'Payments settling this invoice. Voided payments are excluded — one never settled anything, so counting it would show money that was never taken (§5).',
  })
  allocations!: SaleAllocationView[];

  @ApiProperty({
    type: () => [SaleCorrectionView],
    description:
      'Corrections made to the sale, oldest first. The sale itself already shows the corrected figures.',
  })
  corrections!: SaleCorrectionView[];

  @ApiPropertyOptional({
    description:
      'Copies of the invoice made so far — printed or opened as a PDF. **Absent** for anyone but an owner or manager (2026-10-09).',
  })
  printCount?: number;

  @ApiPropertyOptional({
    type: () => [SalePrintEntry],
    description:
      'Each copy, oldest first. On `GET /sales/:id` only, and **absent** for anyone but an owner or manager.',
  })
  prints?: SalePrintEntry[];

  @ApiProperty({
    description: 'Settled by payments, signed. Derived, never stored.',
  })
  allocated!: number;

  @ApiProperty({ description: 'Credited back by returns.' })
  refunded!: number;

  @ApiProperty({
    description:
      '`total − allocated − refunded`. Positive: the customer owes. Negative: the business owes.',
  })
  balance!: number;
}

/** One page of sales, plus where to resume. */
export class SaleListView {
  @ApiProperty({ type: () => [SaleView] })
  sales!: SaleView[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass back as `cursor` for the next page. Null at the end.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'Rows created after this point are held back, so a client syncing on `createdAt` cannot skip a row written while the page was being built (§8).',
  })
  syncedThrough!: Date;

  @ApiProperty()
  hasMore!: boolean;
}

export class ReceiptLineView {
  @ApiProperty({ example: 'Peak Milk Powder 400g' })
  description!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '400g',
    description:
      'Its own field rather than folded into `description`, so a printer that predates it keeps working and one that knows it can lay it out. Read live from the product, like the name.',
  })
  size!: string | null;

  @ApiProperty({ example: 'carton' })
  unit!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 1200000 })
  unitPrice!: number;

  @ApiProperty({ example: 2400000 })
  lineTotal!: number;
}

/** One way a sale was paid, on its receipt (2026-10-09). */
export class ReceiptPaidByView {
  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({
    example: 500000,
    description: 'Everything that came in this way, net of any handed back.',
  })
  amount!: number;
}

/**
 * What `GET /sales/:id/receipt` returns: the stable payload a thermal printer
 * renders, flattened and free of anything a customer should not read.
 *
 * Notably no cost of any kind, for anybody — a receipt goes in a customer's
 * hand, so the question of who may see buying prices does not arise.
 */
export class SaleReceiptView {
  @ApiProperty({ example: 'INV-0001' })
  number!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: String, nullable: true, example: 'Ngozi Okafor' })
  customer!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Amina' })
  servedBy!: string | null;

  @ApiProperty({ type: () => [ReceiptLineView] })
  lines!: ReceiptLineView[];

  @ApiProperty({ description: 'Tax-inclusive.' })
  total!: number;

  @ApiProperty({
    description:
      'The VAT already inside `total`. Prints as "of which", never added on top (§6).',
  })
  tax!: number;

  @ApiProperty({ description: 'Settled so far, signed.' })
  paid!: number;

  @ApiProperty({
    type: () => [ReceiptPaidByView],
    description:
      'How `paid` came in, a line per method in the order the money arrived; sums to `paid`. Empty while nothing is paid. Voided payments are not in it. Added after the first printers, so older ones simply ignore it.',
  })
  paidBy!: ReceiptPaidByView[];

  @ApiProperty({ description: 'What is still owed.' })
  balance!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the balance is due — five days after a credit sale (§6). Null once nothing is owed. Added after the first printers, so older ones simply ignore it.',
  })
  dueDate!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

/** A sale the one being recorded looks like (2026-10-08). */
export class PossibleDuplicateSale {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'INV-0123' })
  number!: string;

  @ApiProperty({ description: 'Minor units.' })
  total!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Ade Bayo',
    description: 'Who recorded it, when known.',
  })
  recordedBy!: string | null;
}

/**
 * The 409 for a sale that looks already recorded. Send the sale again with
 * `allowDuplicate: true` — the same `id`, a fresh key — to record it anyway.
 */
export class PossibleDuplicateConflict {
  @ApiProperty({ example: 'POSSIBLE_DUPLICATE' })
  error!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({
    type: () => [PossibleDuplicateSale],
    description: 'Newest first; at most three.',
  })
  duplicates!: PossibleDuplicateSale[];
}
