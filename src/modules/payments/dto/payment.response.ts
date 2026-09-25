import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

/**
 * What `POST /payments`, `GET /payments` and `GET /payments/:id` return.
 *
 * **This is the service's declared return type, not a description of it**
 * (DECISIONS.md §17).
 *
 * Two rules from §5 are visible in this shape and are the reason it looks the
 * way it does:
 *
 * **A payment is one row per thing that happened.** A ₦50,000 transfer settling
 * three invoices is one `Payment` with three allocations, because ₦50,000 is
 * the number on the bank statement somebody will one day reconcile against.
 * Which invoices it answered is a separate claim.
 *
 * **The amount is signed** — positive in, negative back out — so a refund is an
 * ordinary payment row rather than a second table, and a customer's position is
 * a plain sum with no branch on type.
 */

class PaidByCustomer {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ngozi' })
  firstName!: string;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}

class NamedRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

class PersonRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

class BankedInto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'GTBank' })
  bankName!: string;

  @ApiProperty()
  accountName!: string;

  @ApiProperty()
  accountNumber!: string;
}

class SettledSale {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'INV-0001' })
  number!: string;

  @ApiProperty()
  total!: number;
}

export class PaymentAllocationView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  saleId!: string;

  @ApiProperty({ description: 'Signed, following the payment it belongs to.' })
  amount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => SettledSale })
  sale!: SettledSale;
}

export class PaymentView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Null for a walk-in refund, which names its sale instead.',
  })
  customerId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Set automatically by a counter sale, and what `GET /reports/collections` groups on for the end-of-shift cash-up (§11).',
  })
  locationId!: string | null;

  @ApiProperty({
    example: 1080000,
    description:
      'Signed: positive in, negative back out. A refund is a negative payment, which needs the same authority as a void.',
  })
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      '`transfer` and `pos` must name one, `cash` must not, and it is never defaulted for a caller who did not choose — a wrong account only surfaces at reconciliation (§11).',
  })
  bankAccountId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'FT26083012345' })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Set when this payment is declared a mistake that never happened. The row and its allocations are kept so the error and its correction stay legible; `LIVE_ALLOCATIONS` drops it out of every balance, so the invoices it had settled go back to owing.',
  })
  voidedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  voidedReason!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  voidedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => PaidByCustomer, nullable: true })
  customer!: PaidByCustomer | null;

  @ApiProperty({ type: () => NamedRef, nullable: true })
  location!: NamedRef | null;

  @ApiProperty({ type: () => BankedInto, nullable: true })
  bankAccount!: BankedInto | null;

  @ApiProperty({ type: () => PersonRef, nullable: true })
  recordedBy!: PersonRef | null;

  @ApiProperty({ type: () => PersonRef, nullable: true })
  voidedBy!: PersonRef | null;

  @ApiProperty({
    type: () => [PaymentAllocationView],
    description:
      'Unfiltered on purpose: a voided payment still shows what it *had* claimed, which is the point of keeping the row.',
  })
  allocations!: PaymentAllocationView[];

  @ApiProperty({ description: 'The sum of the allocations above.' })
  allocated!: number;

  @ApiProperty({
    description:
      'Money on this payment that no invoice has claimed. It stays as credit on the customer rather than being spread cleverly (§5).',
  })
  unallocated!: number;
}

/**
 * One page of payments.
 *
 * **Paged on `updatedAt`, not `createdAt`** — payments are mutable, because a
 * void changes a row that a client may already have synced. Ordering by
 * `updatedAt` can re-send a row, which is why clients upsert by id; it cannot
 * skip one, which is the failure that matters (§8).
 */
export class PaymentListView {
  @ApiProperty({ type: () => [PaymentView] })
  payments!: PaymentView[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  syncedThrough!: Date;

  @ApiProperty()
  hasMore!: boolean;
}
