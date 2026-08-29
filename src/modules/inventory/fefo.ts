/**
 * FEFO — first *expired* out, not first *in* out.
 *
 * For eggs, dairy and short-dated goods the two orders differ often enough to
 * matter: a lot received later can expire sooner, and picking by receipt date
 * costs you the older one. So the sort key is expiry, and receipt date is only
 * the tie-break.
 *
 * Kept as a pure function, like `money.ts` and `barcode.ts`, so the picking
 * rule can be tested exhaustively without a database.
 */

/** A batch with stock at one location, as the picker needs to see it. */
export interface AllocatableBatch {
  batchId: string;
  /** Base units on hand in this batch at this location. */
  quantity: number;
  /** Null for goods that do not perish; those sort last. */
  expiryDate: Date | null;
  receivedAt: Date;
}

export interface Allocation {
  batchId: string;
  /** Base units taken from this batch. Always positive. */
  quantity: number;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Base units that could not be covered. Zero when stock was sufficient. */
  shortfall: number;
}

/**
 * Orders batches for picking: earliest expiry first, undated last, then oldest
 * receipt, then batch id so the result is stable across calls.
 *
 * Undated batches sort last rather than first: a product with no expiry has no
 * urgency, so anything that *can* go off should leave the shelf ahead of it.
 */
export function sortFefo<T extends AllocatableBatch>(
  batches: readonly T[],
): T[] {
  return [...batches].sort((a, b) => {
    const aExpiry = a.expiryDate ? a.expiryDate.getTime() : null;
    const bExpiry = b.expiryDate ? b.expiryDate.getTime() : null;

    if (aExpiry !== bExpiry) {
      if (aExpiry === null) return 1;
      if (bExpiry === null) return -1;
      return aExpiry - bExpiry;
    }

    const received = a.receivedAt.getTime() - b.receivedAt.getTime();
    if (received !== 0) return received;

    return a.batchId.localeCompare(b.batchId);
  });
}

/**
 * Takes `quantity` base units from the batches that should go first.
 *
 * Batches holding nothing are skipped — including ones already negative, which
 * a forced movement can leave behind; taking more from them would bury the
 * shortfall instead of reporting it.
 *
 * Reports a shortfall rather than throwing. Whether an under-covered pick is an
 * error is a policy question, and it is answered one layer up in
 * `stock.service.ts`: refused by default, allowed for an owner or manager who
 * forces it.
 */
export function allocateFefo(
  batches: readonly AllocatableBatch[],
  quantity: number,
): AllocationResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError(
      `Quantity to allocate must be a positive integer, got ${quantity}`,
    );
  }

  const allocations: Allocation[] = [];
  let remaining = quantity;

  for (const batch of sortFefo(batches)) {
    if (remaining === 0) break;
    if (batch.quantity <= 0) continue;

    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }

  return { allocations, shortfall: remaining };
}
