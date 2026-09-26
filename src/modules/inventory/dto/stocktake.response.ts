import { ApiProperty } from '@nestjs/swagger';
import { StocktakeStatus } from '@prisma/client';

/**
 * What the stocktake endpoints return.
 *
 * **These are the service's declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * **Counting is not adjusting** (§5), and every field here follows from that.
 * A storekeeper walks the aisles and records what is on the shelf; a manager
 * looks at the variance and decides it is real. Until it is **posted** a
 * stocktake changes no stock at all — it is a claim about the world, not a
 * change to it. Posting writes ordinary `adjustment` movements with reason
 * `count_correction`, so the ledger stays the only source of truth.
 */

class CountLocationRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Main Store' })
  name!: string;
}

class CountUserRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

class CountProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Peak Milk 400g' })
  name!: string;

  @ApiProperty({ example: 'PEAK-400' })
  sku!: string;
}

/** One product on a count sheet. */
export class StocktakeLineSummary {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  stocktakeId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({
    description:
      'What was actually on the shelf, in **base units** — the unit the ledger counts in.',
  })
  countedQuantity!: number;

  @ApiProperty({
    description:
      'What the ledger believed. Snapshotted when the line was counted, so the sheet still explains itself weeks later; it is evidence, not the arithmetic that posting does.',
  })
  expectedQuantity!: number;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  countedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  countedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => CountProductRef })
  product!: CountProductRef;

  @ApiProperty({ type: () => CountUserRef, nullable: true })
  countedBy!: CountUserRef | null;
}

/** The same line on the detail screen, with the gap worked out. */
export class StocktakeLineView extends StocktakeLineSummary {
  @ApiProperty({
    description:
      '`countedQuantity − expectedQuantity`. Negative is a shortfall, positive a surplus.',
  })
  variance!: number;
}

/** A count, as the list shows it. */
export class StocktakeSummary {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Counts are per location. Counting everywhere at once is not a thing anybody does with a clipboard.',
  })
  locationId!: string;

  @ApiProperty({
    enum: StocktakeStatus,
    enumName: 'StocktakeStatus',
    description:
      'Only a posted count has touched stock. One open count per location at a time: two would post variances against each other.',
  })
  status!: StocktakeStatus;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  postedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  startedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  postedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => CountLocationRef })
  location!: CountLocationRef;

  @ApiProperty({ type: () => CountUserRef, nullable: true })
  startedBy!: CountUserRef | null;

  @ApiProperty({
    type: () => CountUserRef,
    nullable: true,
    description:
      'Who decided the variance was real. Deliberately not the same job as finding it: a counter who could both report a shortfall and approve it can walk out with the difference.',
  })
  postedBy!: CountUserRef | null;

  @ApiProperty({ type: () => [StocktakeLineSummary] })
  lines!: StocktakeLineSummary[];
}

/**
 * One count, with the variance each line carries.
 *
 * While a count is **open** the variance is measured against live stock,
 * because that is what posting will compare. Once **posted** it reports the
 * snapshot, which is what was actually true when the correction was made.
 */
export class StocktakeView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;

  @ApiProperty({ enum: StocktakeStatus, enumName: 'StocktakeStatus' })
  status!: StocktakeStatus;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  postedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  startedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  postedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => CountLocationRef })
  location!: CountLocationRef;

  @ApiProperty({ type: () => CountUserRef, nullable: true })
  startedBy!: CountUserRef | null;

  @ApiProperty({ type: () => CountUserRef, nullable: true })
  postedBy!: CountUserRef | null;

  @ApiProperty({ type: () => [StocktakeLineView] })
  lines!: StocktakeLineView[];

  @ApiProperty({ description: 'How many products are on the sheet.' })
  counted!: number;

  @ApiProperty({
    description: 'Lines where the shelf and the ledger disagree.',
  })
  discrepancies!: number;

  @ApiProperty({
    description: 'Net base units the ledger would move if this were posted.',
  })
  netVariance!: number;
}

/**
 * What posting a count did.
 *
 * The variance is recomputed against live stock rather than trusting the
 * snapshot taken while counting: goods may have moved between the count and
 * the decision, and the ledger must record what was true when the correction
 * was made. Shortfalls leave FEFO — the same picking rule as a sale — and
 * surpluses land on the most recently received batch at that location, because
 * every movement carries a batch.
 */
export class PostedStocktakeView extends StocktakeView {
  @ApiProperty({
    description:
      'How many lines actually moved stock. Lines that matched are not corrections and write nothing.',
  })
  corrections!: number;
}
