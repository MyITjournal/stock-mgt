/**
 * What the stock on hand is worth, at what it actually cost.
 *
 * This is §2's rule applied to a whole warehouse: **cost is stored as an exact
 * total, and a per-unit figure is a ratio computed on read.** A lot that cost
 * ₦949,449 for 480 units is worth 4,747.245 kobo per unit — a fraction that is
 * never stored and never rounded until the very end.
 *
 * So valuation sums `onHand × (totalCost ÷ quantityReceived)` across every lot
 * and **rounds once**, at the total. Rounding each lot first and adding the
 * results lets the error compound with every lot in the building, which is the
 * failure §2 was written to prevent.
 *
 * `Product.costPrice` is not used here and must never be: it is a cached,
 * rounded snapshot for display, and §2 forbids it as an input to a calculation.
 *
 * Free goods need no special case. A carton received free raises
 * `quantityReceived` without raising `totalCost`, so the ratio falls and every
 * unit in the lot is worth slightly less — which is what actually happened.
 */
import { Minor } from '../../common/money/money';

/** One lot's on-hand quantity, paired with what the lot cost. */
export interface ValuedLot {
  /** Base units on hand from this lot. May be negative — see §5. */
  quantity: number;
  /** Exact invoice total for the lot, in kobo. */
  totalCost: Minor;
  /** Base units the lot brought in, free goods included. */
  quantityReceived: number;
}

/**
 * The exact, unrounded cost of one base unit from a lot.
 *
 * A ratio, not money — which is why it is returned as a fraction and never
 * written anywhere.
 */
export function unitCost(lot: ValuedLot): number {
  if (lot.quantityReceived === 0) return 0;
  return lot.totalCost / lot.quantityReceived;
}

/** One lot's contribution, still fractional. */
export function lotValue(lot: ValuedLot): number {
  return lot.quantity * unitCost(lot);
}

/** The value of a set of lots, rounded exactly once. */
export function valueOf(lots: readonly ValuedLot[]): Minor {
  return Math.round(lots.reduce((total, lot) => total + lotValue(lot), 0));
}

/**
 * Groups lots under a key and values each group, rounding once per group.
 *
 * Used for "by location" and "by category". The group totals will not always
 * add up to the grand total to the kobo — each is rounded from its own
 * fractions — so a caller that shows both must take the grand total from
 * `valueOf` over everything, not from summing the groups.
 */
export function valueByGroup<T extends ValuedLot>(
  lots: readonly T[],
  keyOf: (lot: T) => string,
): Map<string, Minor> {
  const grouped = new Map<string, T[]>();

  for (const lot of lots) {
    const key = keyOf(lot);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(lot);
    else grouped.set(key, [lot]);
  }

  return new Map(
    [...grouped.entries()].map(([key, group]) => [key, valueOf(group)]),
  );
}
