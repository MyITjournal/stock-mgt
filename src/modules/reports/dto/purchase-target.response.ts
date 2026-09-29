import { ApiProperty } from '@nestjs/swagger';

/**
 * What the purchase-target endpoints return.
 *
 * **These are the service's declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * Four rules from §12 are load-bearing, and each one is a way of counting that
 * a reasonable implementation would get wrong:
 *
 * - **Progress counts goods received, not ordered.** An order the vendor has
 *   not delivered is exactly what still needs chasing, so it stays in
 *   "remaining".
 * - **Quantity comes from `quantityPaidFor`.** "Buy 19, get 1 free" advances a
 *   quota by 19 — the free case is real stock and counts for valuation, just
 *   not against the scheme.
 * - **Value comes from `GoodsReceiptLine.totalCost`**, never
 *   `costPrice × quantity`, which is a rounded average and would drift from the
 *   vendor's own sheet.
 * - **A category target counts only the products in it that carry no target of
 *   their own**, or one carton advances two rows. That subtraction is pure, in
 *   `purchase-target.ts`.
 *
 * All of it is buying-price data: `targetValue` is what the shop pays, so these
 * routes are closed to a `sales_rep` outright rather than redacted.
 */

class TargetSupplierRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dangote Distribution' })
  name!: string;
}

class TargetCategoryRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Lotions' })
  name!: string;
}

class TargetProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sku!: string;
}

class TargetUnitRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Carton' })
  name!: string;

  @ApiProperty({ example: 24 })
  factor!: number;
}

/** A vendor's monthly offtake quota. */
export class PurchaseTargetView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({
    format: 'uuid',
    description: "Whose scheme this is. Targets are always a vendor's.",
  })
  supplierId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Exactly one of this and `productId` is set, enforced by a CHECK. A category target covers the products in it that carry no target of their own — the named category only, never its children.',
  })
  categoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  productId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      "First instant of the target month, in the organization's timezone. Vendor schemes run on calendar months, not a rolling thirty days.",
  })
  periodStart!: Date;

  @ApiProperty({
    description: 'In **base units**, like everything the ledger counts.',
  })
  targetQuantity!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'What the owner typed it in, so "110 cartons" reads back as cartons.',
  })
  displayUnitId!: string | null;

  @ApiProperty({
    description:
      'The factor at write time. Redefining a carton later cannot silently restate a quota that was already agreed.',
  })
  unitFactor!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Optional value quota in kobo, for schemes written in money rather than cases.',
  })
  targetValue!: number | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Soft, so a month already reported on keeps explaining itself.',
  })
  deletedAt!: Date | null;

  @ApiProperty({ type: () => TargetSupplierRef })
  supplier!: TargetSupplierRef;

  @ApiProperty({ type: () => TargetCategoryRef, nullable: true })
  category!: TargetCategoryRef | null;

  @ApiProperty({ type: () => TargetProductRef, nullable: true })
  product!: TargetProductRef | null;

  @ApiProperty({ type: () => TargetUnitRef, nullable: true })
  displayUnit!: TargetUnitRef | null;
}

/** How much of one quota has actually landed. */
export class TargetProgressView {
  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @ApiProperty({ description: 'Base units.' })
  targetQuantity!: number;

  @ApiProperty({
    description:
      'Base units **paid for** in the month, from deliveries that arrived. Free goods do not advance it.',
  })
  achievedQuantity!: number;

  @ApiProperty({ description: 'What is still to be bought. Never below zero.' })
  remainingQuantity!: number;

  @ApiProperty({ type: Number, nullable: true })
  targetValue!: number | null;

  @ApiProperty({
    description: 'Summed from invoice totals, never `costPrice × quantity`.',
  })
  achievedValue!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null when the scheme is written in cases rather than money.',
  })
  remainingValue!: number | null;

  @ApiProperty({
    description:
      'Basis points of the quantity target, so 10000 is exactly met and anything above it is over-performance.',
  })
  achievedBps!: number;
}

/** A target with its progress attached. */
export class PurchaseTargetWithProgress extends PurchaseTargetView {
  @ApiProperty({ type: () => TargetProgressView })
  progress!: TargetProgressView;
}

/** Target versus actual for one month. */
export class PurchaseTargetReportView {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'First instant of the month, in the organization’s timezone.',
  })
  periodStart!: Date;

  @ApiProperty({ type: String, format: 'date-time', description: 'Exclusive.' })
  periodEnd!: Date;

  @ApiProperty({
    type: () => [PurchaseTargetWithProgress],
    description:
      'Always present, and empty when nothing was quotaed for the month — which is the common case, and not an error.',
  })
  targets!: PurchaseTargetWithProgress[];
}
