import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

/**
 * What `GET /receivables` and `GET /customers/:id/statement` return.
 *
 * **These are the service's declared return types, not a description of them**
 * (DECISIONS.md §17).
 *
 * Receivables is deliberately **a list sorted oldest-first, not 30/60/90
 * buckets**. Buckets are a convention borrowed from accounting packages; the
 * question people here actually ask is "who has owed me longest", which is a
 * sort. `daysOutstanding` is the field that answers it, and buckets can be
 * added the day somebody asks to read them (§5).
 */

export class DebtorCustomer {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ngozi' })
  firstName!: string;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Here because chasing a debt is a phone call — the point of the list is to act on it.',
  })
  phone!: string | null;
}

export class OutstandingInvoice {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'INV-0001' })
  number!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({
    type: () => DebtorCustomer,
    nullable: true,
    description:
      'Null on a walk-in, which has no account — but a walk-in invoice can still carry a balance if goods went back after payment.',
  })
  customer!: DebtorCustomer | null;

  @ApiProperty({ description: 'Tax-inclusive invoice total.' })
  total!: number;

  @ApiProperty({ description: 'Settled by payments, signed.' })
  allocated!: number;

  @ApiProperty({ description: 'Credited back by returns.' })
  refunded!: number;

  @ApiProperty({
    description:
      '`total − allocated − refunded`. Positive: they owe. Negative: the business does.',
  })
  balance!: number;

  @ApiProperty({
    description: 'Whole days since the sale. The field the list sorts on.',
  })
  daysOutstanding!: number;
}

export class DebtorGroup {
  @ApiProperty({ type: () => DebtorCustomer, nullable: true })
  customer!: DebtorCustomer | null;

  @ApiProperty({
    description:
      'Owed **to** the business: the invoices in credit are not netted off it, which is the same rule `totalOutstanding` follows. Summing these across the groups gives exactly that headline — they used to disagree, because this one netted and the headline did not.',
  })
  balance!: number;

  @ApiProperty({
    description:
      'Owed **back**, as a positive number: goods returned after an invoice was paid, or money taken twice. Reported beside the balance rather than subtracted from it, because the two are different debts and netting hides both.',
  })
  credit!: number;

  @ApiProperty({ description: 'How many invoices make up that balance.' })
  invoices!: number;

  @ApiProperty({ description: 'Age of the oldest, in days.' })
  oldestDays!: number;
}

export class ReceivablesView {
  @ApiProperty({
    type: () => [OutstandingInvoice],
    description: 'Longest outstanding first.',
  })
  invoices!: OutstandingInvoice[];

  @ApiProperty({
    type: () => [DebtorGroup],
    description: 'The same money grouped per customer, oldest debt first.',
  })
  byCustomer!: DebtorGroup[];

  @ApiProperty({
    description:
      'Owed **to** the business. Money owed back to a customer is excluded rather than netted off — the two are different problems and summing them hides both. Equal to the sum of `byCustomer[].balance`.',
  })
  totalOutstanding!: number;

  @ApiProperty({
    description:
      'Owed **back**, as a positive number — the other half of the same picture, and equal to the sum of `byCustomer[].credit`. Reported so that excluding it from `totalOutstanding` does not make it disappear: a credit nobody can see is one nobody honours.',
  })
  totalCredit!: number;
}

export class StatementAllocation {
  @ApiProperty()
  amount!: number;
}

export class StatementPayment {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  customerId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  locationId!: string | null;

  @ApiProperty({
    description:
      'Signed: positive in, negative back out, so a refund is an ordinary payment row rather than a second table (§5).',
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

  @ApiProperty({
    type: () => [StatementAllocation],
    description: 'What this payment was put against.',
  })
  allocations!: StatementAllocation[];
}

/**
 * One customer's position, and the payload both the statement screen and the
 * statement PDF render — they recompute nothing, so print and screen cannot
 * disagree (§6).
 *
 * **Voided payments are left out entirely.** This is the customer's position,
 * not an audit log, and a line claiming money moved when it never did is worse
 * than no line. The row stays on `GET /payments`, flagged, which is where the
 * audit trail belongs.
 */
export class StatementView {
  @ApiProperty({ type: () => DebtorCustomer })
  customer!: DebtorCustomer;

  @ApiProperty({ type: () => [OutstandingInvoice] })
  invoices!: OutstandingInvoice[];

  @ApiProperty({ type: () => [StatementPayment] })
  payments!: StatementPayment[];

  @ApiProperty({
    description:
      'Money received that no invoice has claimed yet. It stays with the customer rather than being spread cleverly across invoices (§5).',
  })
  credit!: number;

  @ApiProperty({ description: 'The sum of the balances above.' })
  owed!: number;
}
