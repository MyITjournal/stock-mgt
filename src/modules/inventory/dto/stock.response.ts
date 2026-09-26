import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockAdjustmentReason, StockMovementType } from '@prisma/client';

/**
 * What the stock endpoints return.
 *
 * **These are the services' declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * Three rules from §2 and §3 run through all of it:
 *
 * - **Quantities are base units, and signed.** Positive brings stock in,
 *   negative takes it out, so a balance is a plain sum with no branch on type.
 * - **Every movement carries a batch.** There is no such thing as stock that
 *   belongs to no lot — even an opening balance invents one.
 * - **Cost is a ratio, never a stored average**, and it is absent rather than
 *   null for a role that may not see it. A client that assumes the key exists
 *   prints `NaN` to a rep (§9).
 */

class StockProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Peak Milk 400g' })
  name!: string;

  @ApiProperty({ example: 'PEAK-400' })
  sku!: string;
}

class StockLocationRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Main Store' })
  name!: string;
}

class StockUserRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

/** One lot behind a balance. */
class StockLevelBatch {
  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({ description: 'Base units of this lot on hand here.' })
  quantity!: number;

  @ApiProperty({ type: String, nullable: true, example: 'LOT-2026-04' })
  lotCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: Date | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'The exact invoice total divided by what arrived — output, never input. **Absent entirely** for a role that may not see cost: this is a buying price. Null only when the lot recorded no quantity to divide by.',
  })
  unitCost?: number | null;
}

/**
 * Stock on hand: one row per product and location.
 *
 * Read from the `StockBalance` cache rather than summed over movements — that
 * is what the cache is for — and `POST /stock/rebuild-balances` proves the two
 * still agree.
 */
export class StockLevelRow {
  @ApiProperty({ type: () => StockProductRef })
  product!: StockProductRef;

  @ApiProperty({ type: () => StockLocationRef })
  location!: StockLocationRef;

  @ApiProperty({
    description:
      'Base units on hand. May be negative — a forced movement records stock that went out before it was entered as received.',
  })
  quantity!: number;

  @ApiPropertyOptional({
    type: () => [StockLevelBatch],
    description:
      'Only when `includeBatches=true`. The lots that add up to `quantity`, which is what FEFO will pick from.',
  })
  batches?: StockLevelBatch[];
}

/**
 * A lot with stock left that goes off on or before a date — the list somebody
 * walks the shelves with, soonest first.
 */
export class ExpiringBatchRow {
  @ApiProperty({ type: () => StockProductRef })
  product!: StockProductRef;

  @ApiProperty({ type: () => StockLocationRef })
  location!: StockLocationRef;

  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({ type: String, nullable: true })
  lotCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: Date | null;

  @ApiProperty({ description: 'Base units still on hand in this lot.' })
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'What walks out of the door if this is not sold in time. **Absent** for a role that may not see cost — the list itself stays open, because knowing which lots to push is not a cost question.',
  })
  valueAtRisk?: number;
}

/**
 * One line of the ledger.
 *
 * Append-only: a mistake is corrected by another movement, never by editing
 * this one (§3).
 */
export class StockMovementView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;

  @ApiProperty({ format: 'uuid', description: 'Every movement carries a lot.' })
  batchId!: string;

  @ApiProperty({ enum: StockMovementType, enumName: 'StockMovementType' })
  type!: StockMovementType;

  @ApiProperty({
    description:
      'Signed, in base units: positive in, negative out. A balance is then a plain sum.',
  })
  quantity!: number;

  @ApiProperty({
    enum: StockAdjustmentReason,
    enumName: 'StockAdjustmentReason',
    nullable: true,
    description:
      'Why, for an adjustment. Damage and spoilage are movements with a reason, never silent decrements.',
  })
  reason!: StockAdjustmentReason | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'When it happened, by the recording device clock. `createdAt` is when the server stored it; offline, the two differ.',
  })
  occurredAt!: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'goods_receipt',
    description: 'What caused it — a delivery, a sale, a stocktake.',
  })
  referenceType!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  referenceId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Shared by the two halves of a transfer, so the pair reads as one act.',
  })
  transferGroupId!: string | null;

  @ApiProperty({
    description:
      'True when an owner or manager pushed this through a shortfall. The point of allowing the override is that it leaves this trail.',
  })
  isForced!: boolean;

  @ApiProperty({ type: String, nullable: true })
  forcedReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** The lot a synced movement touched, so a client can name it without a join. */
class MovementBatchRef {
  @ApiProperty({ type: String, nullable: true })
  lotCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: Date | null;
}

export class SyncedMovementView extends StockMovementView {
  @ApiProperty({ type: () => MovementBatchRef })
  batch!: MovementBatchRef;
}

/**
 * A page of the ledger.
 *
 * Keyset paging over (`createdAt`, `id`) — the append-only column, because a
 * movement is never edited (§8).
 *
 * Two readers, one endpoint. `order=asc` is the **sync** walk: it steps forward
 * from the oldest row a client has not seen, stops a second short of now so a
 * transaction still committing cannot be stepped over, and treats `since` as a
 * starting position a cursor overrides. `order=desc` is the **browsing** walk:
 * newest first, no lag — new rows arrive above wherever the reader has paged
 * to, so a late commit is never skipped — and `since`/`until` are plain filters
 * applied beside the cursor.
 */
export class MovementPageView {
  @ApiProperty({ type: () => [SyncedMovementView] })
  movements!: SyncedMovementView[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass back verbatim on the next call. Null when the page came up short.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'How far a forward walk is safe to trust. Reported on both orders, as the other three feeds do, but only the sync half is filtered by it.',
  })
  syncedThrough!: Date;

  @ApiProperty()
  hasMore!: boolean;
}

/**
 * A movement an owner or manager pushed through a shortfall.
 *
 * "We sold stock we had not entered yet" becomes a list with names against it,
 * rather than a stock count that quietly stops adding up.
 */
export class ForcedMovementView extends StockMovementView {
  @ApiProperty({ type: () => StockProductRef })
  product!: StockProductRef;

  @ApiProperty({ type: () => StockLocationRef })
  location!: StockLocationRef;

  @ApiProperty({ type: () => StockUserRef, nullable: true })
  recordedBy!: StockUserRef | null;
}

/**
 * What a transfer wrote.
 *
 * A matched pair of movements sharing a `transferGroupId`, rather than one row
 * with two location columns: a balance stays a plain sum over one column, and
 * the two halves still read as one act. Batch identity is preserved, so the
 * carton that arrives in the van is the same lot, with the same expiry, that
 * left the store.
 */
export class TransferResultView {
  @ApiProperty({ format: 'uuid' })
  transferGroupId!: string;

  @ApiProperty({
    type: () => [StockMovementView],
    description: 'The leaving half — one per lot the pick drew from.',
  })
  out!: StockMovementView[];

  @ApiProperty({
    type: () => [StockMovementView],
    description: 'The arriving half, lot for lot.',
  })
  in!: StockMovementView[];
}

class DriftedBalance {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;

  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({ description: 'What the cache held.' })
  was!: number;

  @ApiProperty({ description: 'What the ledger says.' })
  now!: number;
}

/**
 * What rebuilding the balance cache corrected.
 *
 * The cache is an optimisation, and one that cannot be reconstructed is a
 * liability. **An empty list is the proof that cache and ledger agree.**
 */
export class RebuildBalancesView {
  @ApiProperty()
  corrected!: number;

  @ApiProperty({ type: () => [DriftedBalance] })
  drifted!: DriftedBalance[];
}
