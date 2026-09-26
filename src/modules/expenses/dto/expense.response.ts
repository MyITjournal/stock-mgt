import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

/**
 * What the expense endpoints return.
 *
 * **These are the services' declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * Expenses exist so the profit view has both halves of its subtraction: cost of
 * goods sold comes off the sale lines, and everything else — rent, fuel, the
 * generator — comes from here.
 *
 * **A supplier payment is never an expense.** Buying stock already reaches
 * profit through cost of goods sold, so logging a vendor payment here would
 * count the same money twice and understate every margin. That is the trap
 * worth remembering on this screen (§16), and it is why `supplierId` below is
 * for attribution — who the money went to — and not a way to settle a bill.
 */

export class ExpenseCategoryView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Fuel' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

class CategoryRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Fuel' })
  name!: string;
}

class SupplierRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

class RecorderRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

export class ExpenseView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ example: 1500000, description: 'In kobo.' })
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Who the money went to, for attribution only. **Not** a way to settle a supplier bill — that is `POST /supplier-payments`, and recording it here instead would count the same money twice (§16).',
  })
  supplierId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: () => CategoryRef })
  category!: CategoryRef;

  @ApiProperty({ type: () => SupplierRef, nullable: true })
  supplier!: SupplierRef | null;

  @ApiProperty({ type: () => RecorderRef, nullable: true })
  recordedBy!: RecorderRef | null;
}

class CategoryTotal {
  @ApiProperty({ format: 'uuid' })
  categoryId!: string;

  @ApiProperty({ example: 'Fuel' })
  name!: string;

  @ApiProperty()
  total!: number;
}

/**
 * A page of expenses, with totals.
 *
 * **The totals come from their own aggregate, not from the rows above**, so
 * they stay true to the filter even when the rows are one page of many. Summing
 * what is on screen would quietly report a page total as a period total.
 *
 * The paging fields are optional because this endpoint serves two readers and
 * only one of them pages: passing a `cursor` or `since` puts it in sync mode —
 * ordered by `updatedAt`, held a second behind now — and everything else is a
 * person browsing, ordered by `occurredAt` with no lag and no cursor. This
 * endpoint had the sync/browse split right before `GET /sales` and
 * `GET /payments` were taught it.
 */
export class ExpenseListView {
  @ApiProperty({ type: () => [ExpenseView] })
  expenses!: ExpenseView[];

  @ApiProperty({
    description: 'Everything matching the filter, not this page.',
  })
  total!: number;

  @ApiProperty({ type: () => [CategoryTotal], description: 'Largest first.' })
  byCategory!: CategoryTotal[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Only present when syncing.',
  })
  nextCursor?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  syncedThrough?: Date;

  @ApiPropertyOptional()
  hasMore?: boolean;
}
