import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

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

  @ApiProperty({ example: 'carton' })
  unit!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 1200000 })
  unitPrice!: number;

  @ApiProperty({ example: 2400000 })
  lineTotal!: number;
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

  @ApiProperty({ description: 'What is still owed.' })
  balance!: number;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}
