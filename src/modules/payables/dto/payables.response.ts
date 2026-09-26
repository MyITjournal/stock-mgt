import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

/**
 * What the payables endpoints return.
 *
 * **These are the services' declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * `GET /payables` is the mirror of `GET /receivables` — bills with money still
 * on them, longest owed first, grouped per vendor — but the two sides are
 * deliberately **not** symmetrical below the surface, and a client that assumes
 * they are will get it wrong (§16):
 *
 * - **One payment settles exactly one bill.** There is no allocation table
 *   here. Vendors are paid on delivery or against one specific supply, so the
 *   join would be a row per payment with nothing in it. A lump sum across
 *   several deliveries would need allocations, and that is a migration on the
 *   day somebody actually does one.
 * - **Void, but no negative payments.** A mis-key is voided and the bill goes
 *   back to owing. Money genuinely coming back from a vendor is not a case this
 *   business has — the column is ready for it, the write path is not.
 */

export class BilledSupplier {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dangote Distribution' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Chasing a bill, like chasing a debt, is a phone call.',
  })
  phone!: string | null;
}

export class OutstandingBillView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'INV-88213',
    description: "The vendor's own number, which is what they quote.",
  })
  invoiceNumber!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  issuedAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Most bills never get one, which is why `overdue` only counts those that do.',
  })
  dueDate!: Date | null;

  @ApiProperty({ type: () => BilledSupplier })
  supplier!: BilledSupplier;

  @ApiProperty({
    description:
      'Stored, not derived. It defaults to the sum of the goods lines but is its own column, because a vendor invoice routinely carries a delivery charge or a settlement discount that no stock line can hold. It deliberately does **not** feed inventory cost — §2 still values stock from `GoodsReceiptLine.totalCost`.',
  })
  amountDue!: number;

  @ApiProperty({ description: 'Settled so far, excluding voided payments.' })
  paid!: number;

  @ApiProperty({ description: '`amountDue − paid`.' })
  balance!: number;

  @ApiProperty({ description: 'Whole days since the bill was issued.' })
  daysOutstanding!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Negative once the intended date has passed. Null when none was set.',
  })
  daysUntilDue!: number | null;
}

export class SupplierGroup {
  @ApiProperty({ type: () => BilledSupplier })
  supplier!: BilledSupplier;

  @ApiProperty()
  balance!: number;

  @ApiProperty({ description: 'How many bills make up that balance.' })
  bills!: number;

  @ApiProperty({ description: 'Age of the oldest, in days.' })
  oldestDays!: number;
}

export class PayablesView {
  @ApiProperty({
    type: () => [OutstandingBillView],
    description:
      'Longest owed first. A settled bill is history rather than a payable and drops out — it stays readable through `GET /supplier-bills`, which is where the audit trail belongs.',
  })
  bills!: OutstandingBillView[];

  @ApiProperty({ type: () => [SupplierGroup] })
  bySupplier!: SupplierGroup[];

  @ApiProperty({
    description:
      'The headline figure: everything still owed to every vendor. This is the number the dashboard shows and the one a click drills into.',
  })
  total!: number;

  @ApiProperty({ description: 'How many vendors are owed anything at all.' })
  suppliers!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The longest anything has gone unpaid, in days. Null when nothing is owed.',
  })
  oldestDays!: number | null;

  @ApiProperty({
    description:
      'Owed and already past the date the business said it would pay. Only counts bills that were given a date, since most are not.',
  })
  overdue!: number;
}

// Declared above its use: `emitDecoratorMetadata` writes a direct `design:type`
// reference for a non-array property and evaluates it while the decorator runs,
// so a class named before it is initialised throws at import time. Typecheck
// does not catch it; the server refusing to boot does (§17).
class BillRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  invoiceNumber!: string | null;
}

class StatementPaymentRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: () => BillRef })
  bill!: BillRef;
}

/** One vendor's position — what somebody reads out when a vendor rings to chase. */
export class SupplierStatementView {
  @ApiProperty({ format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ type: () => [OutstandingBillView] })
  bills!: OutstandingBillView[];

  @ApiProperty({
    type: () => [StatementPaymentRef],
    description: 'Voided payments are excluded: this is a position, not a log.',
  })
  payments!: StatementPaymentRef[];

  @ApiProperty()
  totalOwed!: number;

  @ApiProperty()
  totalPaid!: number;
}

class BillPaymentRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;
}

class ReceiptRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  invoiceNumber!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  receivedAt!: Date;
}

/**
 * A bill: what a vendor is owed.
 *
 * **Receipt is goods, bill is money.** `GoodsReceipt` stays the record of what
 * physically arrived; this is what the vendor is owed for it. They are separate
 * because an **opening balance has no receipt** — and an opening balance must
 * never create stock, since the goods behind it arrived and probably sold long
 * ago (§16). That is why `goodsReceiptId` is nullable.
 */
export class SupplierBillView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  supplierId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The delivery this bill is for. Null for an opening balance, which has no receipt and must never create stock.',
  })
  goodsReceiptId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  invoiceNumber!: string | null;

  @ApiProperty()
  amountDue!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  issuedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dueDate!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: () => BilledSupplier })
  supplier!: BilledSupplier;

  @ApiProperty({ type: () => ReceiptRef, nullable: true })
  goodsReceipt!: ReceiptRef | null;

  @ApiProperty({
    type: () => [BillPaymentRef],
    description: 'Live payments only — voided ones are excluded here.',
  })
  payments!: BillPaymentRef[];

  @ApiProperty({ description: 'Settled so far.' })
  paid!: number;

  @ApiProperty({ description: '`amountDue − paid`.' })
  balance!: number;
}

class PaidSupplierRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

class SettledBillRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  invoiceNumber!: string | null;

  @ApiProperty()
  amountDue!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  issuedAt!: Date;
}

class PaidFromAccount {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  bankName!: string;

  @ApiProperty()
  accountName!: string;
}

class RecorderRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

/**
 * Money paid to a vendor.
 *
 * **Never an `Expense`.** Buying stock already reaches profit through cost of
 * goods sold; logging vendor payments as expenses would count the same money
 * twice and understate every margin. This is the trap worth remembering (§16).
 */
export class SupplierPaymentView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Exactly one bill. There is no allocation table on this side — which debt a payment answered is still recorded, never inferred.',
  })
  billId!: string;

  @ApiProperty({ format: 'uuid' })
  supplierId!: string;

  @ApiProperty({
    description:
      'Positive. The column could hold a negative, but the write path refuses one: money coming back from a vendor is not a case this business has.',
  })
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  bankAccountId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  voidedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  voidedReason!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  voidedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => PaidSupplierRef })
  supplier!: PaidSupplierRef;

  @ApiProperty({ type: () => SettledBillRef })
  bill!: SettledBillRef;

  @ApiProperty({ type: () => PaidFromAccount, nullable: true })
  bankAccount!: PaidFromAccount | null;

  @ApiPropertyOptional({ type: () => RecorderRef, nullable: true })
  recordedBy?: RecorderRef | null;
}

/**
 * A page of vendor payments.
 *
 * Paged on `updatedAt`, because voiding one mutates the row and a client that
 * already synced it has to hear about that, or it goes on showing a bill as
 * settled (§8). `order=desc` is the browsing half and skips the sync lag.
 */
export class SupplierPaymentListView {
  @ApiProperty({ type: () => [SupplierPaymentView] })
  payments!: SupplierPaymentView[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  syncedThrough!: Date;

  @ApiProperty()
  hasMore!: boolean;
}
