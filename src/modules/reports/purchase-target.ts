/**
 * Vendor purchase targets: how many cartons of a category have actually
 * arrived this month.
 *
 * Pure, like `period.ts` and `profit.ts`, because the one rule here that is
 * easy to get wrong — what "a carton" means across products of different
 * sizes — is arithmetic, and arithmetic is worth testing without a database.
 *
 * ## What a target is (2026-10-04)
 *
 * A category and a number of cartons: "112 cartons of lotion this month". Any
 * product filed under the category counts — Perfect & Radiant, Deep, Soft Cup
 * — because that is how the vendor counts. Product targets and money quotas
 * were removed: vendors set quotas per category, and what to buy within it is
 * decided by stock and customers, not by the scheme.
 *
 * ## What a carton is
 *
 * **Each product's biggest unit.** A carton of 12 and a carton of 24 each
 * count as one, which is what makes a category of different products countable
 * in one number at all. A product with no unit bigger than the one it is
 * counted in has no carton, so it cannot be counted — and is named, never
 * quietly skipped.
 */

/** A target as stored, reduced to what the arithmetic needs. */
export interface TargetRow {
  id: string;
  categoryId: string;
  targetCartons: number;
}

/** One received line inside the target month, from the right vendor. */
export interface ReceiptLine {
  productId: string;
  /** The product's category at the time of reading, or null. */
  categoryId: string | null;
  /**
   * Base units the vendor was **paid** for. Free goods are real stock and
   * count for valuation, but they do not advance a quota — confirmed with the
   * owner on 2026-08-29: "buy 19, get 1 free" moves a target by 19.
   */
  quantityPaidFor: number;
  /**
   * Base units in this product's carton — its biggest unit — or null when it
   * has no unit bigger than its base, and so no carton to count in.
   */
  cartonFactor: number | null;
}

export interface TargetProgress {
  targetId: string;
  targetCartons: number;
  /** Cartons paid for, to one decimal: a half-slot delivery is 9.5. */
  achievedCartons: number;
  /** Never below zero. */
  remainingCartons: number;
  /** Basis points of the target, so 10000 is exactly met. */
  achievedBps: number;
}

export function rollUpTargets(
  targets: readonly TargetRow[],
  lines: readonly ReceiptLine[],
): TargetProgress[] {
  return targets.map((target) => {
    // Exact, then rounded once for display — summing rounded figures would
    // drift on a month of part-cartons.
    const exact = lines
      .filter(
        (line) =>
          line.categoryId === target.categoryId && line.cartonFactor !== null,
      )
      .reduce(
        (sum, line) =>
          sum + line.quantityPaidFor / (line.cartonFactor as number),
        0,
      );

    const achievedCartons = oneDecimal(exact);
    return {
      targetId: target.id,
      targetCartons: target.targetCartons,
      achievedCartons,
      // Over-delivering leaves nothing to chase; a negative "remaining" would
      // read as a credit on a screen that is about shortfalls.
      remainingCartons: Math.max(0, oneDecimal(target.targetCartons - exact)),
      achievedBps: achievedShare(exact, target.targetCartons),
    };
  });
}

/** Base units in a product's carton — its biggest unit — or null if none. */
export function cartonFactor(
  units: readonly { factor: number }[],
): number | null {
  const biggest = Math.max(1, ...units.map((unit) => unit.factor));
  return biggest > 1 ? biggest : null;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Progress as basis points of the target.
 *
 * A target of zero is meaningless rather than infinite, so it reads as met:
 * nothing was asked for and nothing is outstanding.
 */
function achievedShare(achieved: number, target: number): number {
  if (target <= 0) return 10000;
  return Math.round((achieved / target) * 10000);
}
