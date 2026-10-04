import { ApiProperty } from '@nestjs/swagger';

/**
 * What the purchase-target endpoints return.
 *
 * **These are the service's declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * A target is a category and a number of cartons (§12, 2026-10-04). Three
 * counting rules are load-bearing:
 *
 * - **Progress counts goods received, not ordered.** An order the vendor has
 *   not delivered is exactly what still needs chasing, so it stays in
 *   "remaining".
 * - **Cartons come from `quantityPaidFor`.** "Buy 19, get 1 free" advances a
 *   quota by 19 — the free carton is real stock, just not against the scheme.
 * - **A carton is each product's biggest unit.** A carton of 12 and a carton
 *   of 24 each count as one; a product with nothing bigger than its base unit
 *   has no carton and is named in `productsWithoutCarton` rather than skipped.
 *
 * Buying-side data, so these routes are closed to a `sales_rep`.
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

  @ApiProperty({ example: 'Lotion' })
  name!: string;
}

class TargetProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Lotion sample sachet' })
  name!: string;
}

/** A vendor's monthly quota for one category, in cartons. */
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
    format: 'uuid',
    description:
      'Every product filed under this category counts. The named category only, never its children.',
  })
  categoryId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      "First instant of the target month, in the organization's timezone. Vendor schemes run on calendar months, not a rolling thirty days.",
  })
  periodStart!: Date;

  @ApiProperty({
    example: 112,
    description: "Cartons — each product's biggest unit counts as one.",
  })
  targetCartons!: number;

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

  @ApiProperty({ type: () => TargetCategoryRef })
  category!: TargetCategoryRef;
}

/** How many of the quota's cartons have actually landed. */
export class TargetProgressView {
  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @ApiProperty({ example: 112 })
  targetCartons!: number;

  @ApiProperty({
    example: 86.5,
    description:
      'Cartons **paid for** in the month, from deliveries that arrived, to one decimal — a half-slot is 9.5. Free goods do not advance it.',
  })
  achievedCartons!: number;

  @ApiProperty({ description: 'Still to buy. Never below zero.' })
  remainingCartons!: number;

  @ApiProperty({
    description:
      'Basis points of the target, so 10000 is exactly met and anything above it is over-performance.',
  })
  achievedBps!: number;

  @ApiProperty({
    type: () => [TargetProductRef],
    description:
      'Products in this category with no unit bigger than their base, so no carton to count in. Their deliveries are not counted — named so nobody wonders why the number is low.',
  })
  productsWithoutCarton!: TargetProductRef[];
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
